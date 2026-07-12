import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireAdmin, requireMember } from "./authz";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { normalizePhone, csKey } from "./lib";
import { getCsFeatureConfig } from "./csConfigs";
import { messageMatchesPhrase, upsertRecapFromMessage } from "./shippingRecaps";
import { getActiveClosingPhrases } from "./closingRules";
import { messageHasDoneMarker } from "./followUpMath";
import { countFollowUpTouchesBeforeTime } from "./followUp";
import { businessMinutesBetween, isSlaBreach } from "./responseTimeMath";
import { getDefaultOrgId } from "./orgs";

async function getConversationForMessage(ctx: { db: any }, args: { orderId?: string; customerPhone: string }) {
  if (args.orderId) {
    const byOrder = await ctx.db
      .query("conversations")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId!))
      .unique();
    if (byOrder) return byOrder;
  }

  const phone = normalizePhone(args.customerPhone);
  return await ctx.db
    .query("conversations")
    .withIndex("by_customerPhone_updatedAt", (q: any) => q.eq("customerPhone", phone))
    .order("desc")
    .first();
}

export const appendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    orderId: v.string(),
    customerPhone: v.string(),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button")),
    source: v.union(v.literal("kirimchat"), v.literal("panel"), v.literal("n8n")),
    externalMessageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, "messages.appendMessage");
    const createdAt = args.createdAt ?? Date.now();
    const orgId = await getDefaultOrgId(ctx);
    const messageId = await ctx.db.insert("messages", { ...args, createdAt, orgId: orgId ?? undefined });

    await ctx.db.patch(args.conversationId, { lastMessageAt: createdAt, updatedAt: createdAt });
    await ctx.db.insert("events", {
      conversationId: args.conversationId,
      orderId: args.orderId,
      customerPhone: args.customerPhone,
      type: args.direction === "inbound" ? "message_inbound" : "ai_reply_sent",
      actor: args.role === "ai" ? "ai" : args.role === "cs" ? "cs" : "n8n",
      metadata: {
        messageId,
        role: args.role,
        direction: args.direction,
        messageType: args.messageType,
        source: args.source,
      },
      createdAt,
      orgId: orgId ?? undefined,
    });

    return { success: true, messageId };
  },
});

export const listMessages = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 50);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(limit);

    return messages.reverse();
  },
});

export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "messages.deleteMessage");
    const message = await ctx.db.get(args.messageId);
    if (!message) return { success: false, error: "message not found" };

    await ctx.db.delete(args.messageId);
    await ctx.db.insert("events", {
      conversationId: message.conversationId,
      orderId: message.orderId,
      customerPhone: message.customerPhone,
      type: "message_inbound",
      actor: "n8n",
      metadata: {
        deletedMessageId: args.messageId,
        deletedRole: message.role,
        deletedDirection: message.direction,
      },
      createdAt: Date.now(),
    });

    return { success: true, messageId: args.messageId };
  },
});

// Shared ingestion core: called by the n8n adapter route (legacy, during transition)
// and by the Ingestion API (convex/ingest/core.ts). Behavior is identical to the
// pre-refactor appendMessageFromN8n handler, plus an optional `source` tag.
export type AppendMessageCoreArgs = {
  phone: string;
  order_id?: string;
  customerName?: string;
  csName?: string;
  role: "customer" | "ai" | "cs" | "system";
  direction: "inbound" | "outbound";
  content: string;
  messageType?: "text" | "image" | "template" | "button";
  externalMessageId?: string;
  createdAt?: number;
  source?: string; // "n8n" (default) | "ingest"
  orgId?: Id<"organizations"> | null;
};

export async function appendMessageCore(ctx: any, args: AppendMessageCoreArgs) {
  const phone = normalizePhone(args.phone);
  if (args.externalMessageId) {
    const dup = await ctx.db
      .query("messages")
      .withIndex("by_externalMessageId", (q: any) => q.eq("externalMessageId", args.externalMessageId))
      .first();
    if (dup) {
      return {
        success: true, messageId: dup._id, conversationId: dup.conversationId,
        order_id: dup.orderId, phone: dup.customerPhone, _action: "append_message", deduped: true,
      };
    }
  }
  let conversation = await getConversationForMessage(ctx, {
    customerPhone: phone,
    orderId: args.order_id,
  });

  if (!conversation) {
    const now = Date.now();
    const csName = args.csName || "Unknown";
    const csConfig = await getCsFeatureConfig(ctx, csName);
    const orderId = args.order_id || `manual:${phone}`;
    const conversationId = await ctx.db.insert("conversations", {
      orderId,
      customerPhone: phone,
      customerName: args.customerName || "",
      assignedCsName: csName,
      status: "handover",
      aiEnabled: false,
      note: "created from webhook message",
      createdAt: now,
      updatedAt: now,
      orgId: args.orgId ?? undefined,
    });

    conversation = await ctx.db.get(conversationId);

    await ctx.db.insert("events", {
      conversationId,
      orderId,
      customerPhone: phone,
      type: "order_upserted",
      actor: "n8n",
      metadata: {
        source: "message_append_fallback",
        reportingEnabled: csConfig.reportingEnabled,
        aiEnabled: false,
      },
      createdAt: now,
      orgId: args.orgId ?? undefined,
    });
  }

  const createdAt = args.createdAt ?? Date.now();
  const messageId = await ctx.db.insert("messages", {
    conversationId: conversation._id,
    orderId: conversation.orderId,
    customerPhone: conversation.customerPhone,
    role: args.role,
    direction: args.direction,
    content: args.content,
    messageType: args.messageType ?? "text",
    source: args.source ?? "n8n",
    externalMessageId: args.externalMessageId,
    createdAt,
    orgId: args.orgId ?? undefined,
  });

  const convPatch: { lastMessageAt: number; updatedAt: number; assignedCsName?: string; followUpStageOverride?: undefined; rtPendingInboundAt?: number | undefined } = {
    lastMessageAt: createdAt,
    updatedAt: createdAt,
  };

  // Response-time pairing: track pending inbound and pair with outbound (non-template, non-system)
  if (args.direction === "inbound") {
    // Inbound: set pending if not already set (first inbound of streak)
    if (!conversation.rtPendingInboundAt) {
      convPatch.rtPendingInboundAt = createdAt;
    }
  } else if (args.direction === "outbound" && (args.messageType ?? "text") !== "template" && args.role !== "system" && conversation.rtPendingInboundAt) {
    // Outbound (non-template, non-system) with pending: create sample and clear pending
    const activeMs = Math.round(businessMinutesBetween(conversation.rtPendingInboundAt, createdAt) * 60_000);
    const deltaMs = activeMs > 0 ? activeMs : createdAt - conversation.rtPendingInboundAt;
    const csName = conversation.assignedCsName ?? args.csName ?? "Unknown";
    const csKeyValue = csKey(csName);

    // Wrap sample extraction in try/catch to prevent message ingestion failure.
    // If sampling fails, true-up/live retry can still pair; we log the error and continue.
    // On failure, we CLEAR rtPendingInboundAt anyway so we don't leave the conversation in pending state forever.
    try {
      await ctx.db.insert("responseSamples", {
        csKey: csKeyValue,
        csName,
        conversationId: conversation._id,
        deltaMs,
        inboundAt: conversation.rtPendingInboundAt,
        slaBreach: isSlaBreach(conversation.rtPendingInboundAt, createdAt),
        createdAt,
        orgId: args.orgId ?? undefined,
      });
    } catch (e) {
      console.warn("[rt-sample] extraction failed; true-up will heal", (e as Error).message);
    }

    // Always clear pending regardless of sample extraction success
    convPatch.rtPendingInboundAt = undefined;
  }
  // Heal CS attribution: adopt a known CS when the existing conversation is still
  // unattributed ("Unknown"/empty). Never clobber a real CS. The closing detection
  // below re-reads this conversation, so a closing message also lands the right CS.
  if (
    args.csName &&
    args.csName !== "Unknown" &&
    (!conversation.assignedCsName || conversation.assignedCsName === "Unknown")
  ) {
    convPatch.assignedCsName = args.csName;
  }
  // Feature #8: clear override on customer reply (customer reply resets the manual pin).
  if (args.direction === "inbound") {
    convPatch.followUpStageOverride = undefined;
  }
  await ctx.db.patch(conversation._id, convPatch);
  await ctx.db.insert("events", {
    conversationId: conversation._id,
    orderId: conversation.orderId,
    customerPhone: conversation.customerPhone,
    type: args.direction === "inbound" ? "message_inbound" : "ai_reply_sent",
    actor: args.role === "ai" ? "ai" : args.role === "cs" ? "cs" : "n8n",
    metadata: {
      messageId,
      role: args.role,
      direction: args.direction,
      messageType: args.messageType ?? "text",
      source: args.source ?? "n8n",
    },
    createdAt,
    orgId: args.orgId ?? undefined,
  });

  let closingRecapId: Id<"shippingRecaps"> | undefined;
  if (args.direction === "outbound") {
    const phrases = await getActiveClosingPhrases(ctx);
    if (messageMatchesPhrase(args.content, phrases)) {
      const result = await upsertRecapFromMessage(ctx, {
        orderId: conversation.orderId,
        customerPhone: conversation.customerPhone,
        content: args.content,
        externalMessageId: args.externalMessageId,
        _id: messageId,
        createdAt,
      }, { orgId: args.orgId });
      if (result.action !== "skipped") {
        closingRecapId = result.recapId;

        // Feature #10: record follow-up touches that preceded this closing.
        const lastInbound = await ctx.db
          .query("messages")
          .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversation._id))
          .order("desc")
          .filter((q: any) => q.eq(q.field("direction"), "inbound"))
          .first();
        const touchCount = await countFollowUpTouchesBeforeTime(ctx, conversation._id, lastInbound?.createdAt ?? null, createdAt);
        await ctx.db.patch(result.recapId, { followUpTouchesAtClose: touchCount });

        await ctx.db.insert("events", {
          conversationId: conversation._id,
          orderId: conversation.orderId,
          customerPhone: conversation.customerPhone,
          type: "closing_detected",
          actor: "n8n",
          metadata: { recapId: result.recapId, source: "auto_message", externalMessageId: args.externalMessageId },
          createdAt,
          orgId: args.orgId ?? undefined,
        });
      }
    }
  }

  // Funnel-exclude markers (shopee / bonus / review / testi / feedback / cod diproses): the lead is
  // post-sale or handled elsewhere → close it in REAL TIME so it drops out of the follow-up funnel
  // immediately (same idea as closing detection above; the daily sweep is the backstop). Reversible.
  if (conversation.status !== "closed" && messageHasDoneMarker(args.content, args.direction)) {
    await ctx.db.patch(conversation._id, { status: "closed", updatedAt: createdAt });
  }

  return {
    success: true,
    messageId,
    conversationId: conversation._id,
    order_id: conversation.orderId,
    phone: conversation.customerPhone,
    closingRecapId,
    _action: "append_message",
  };
}

export const appendMessageFromN8n = internalMutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    customerName: v.optional(v.string()),
    csName: v.optional(v.string()),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button"))),
    externalMessageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getDefaultOrgId(ctx);
    return appendMessageCore(ctx, { ...args, orgId });
  },
});
