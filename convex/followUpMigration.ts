import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { requireAdminOrg } from "./authz";
import { csKey, isInternalTestPhone } from "./lib";
import { getInternalPhoneSet } from "./orgSettings";
import { FOLLOW_UP_DAY_MS, FOLLOW_UP_EXPIRY_MS } from "./followUpModel";
import { messageHasDoneMarker } from "./followUpMath";

const statusValidator = v.union(v.literal("active"), v.literal("handover"));
const pageResultValidator = v.object({
  processed: v.number(),
  done: v.boolean(),
  continueCursor: v.string(),
  nextStatus: v.optional(statusValidator),
});

function clearedPatch(cycleInboundAt?: number, state?: "complete" | "archived") {
  return {
    followUpCycleInboundAt: cycleInboundAt,
    followUpNextStage: undefined,
    followUpDueAt: undefined,
    followUpState: state,
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
  } as const;
}

async function materializeConversation(ctx: any, conversation: any, now: number, internalPhones: ReadonlySet<string>) {
  if (isInternalTestPhone(conversation.customerPhone, internalPhones)) {
    await ctx.db.patch(conversation._id, clearedPatch(undefined, "archived"));
    return;
  }

  const [lastMessage, lastInbound, recap] = await Promise.all([
    ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversation._id))
      .order("desc")
      .first(),
    ctx.db
      .query("messages")
      .withIndex("by_conversation_direction_createdAt", (q: any) => q
        .eq("conversationId", conversation._id)
        .eq("direction", "inbound"))
      .order("desc")
      .first(),
    ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q: any) => q
        .eq("orgId", conversation.orgId)
        .eq("orderIdBerdu", conversation.orderId))
      .first(),
  ]);

  if (recap || !lastInbound || now - lastInbound.createdAt >= FOLLOW_UP_EXPIRY_MS) {
    await ctx.db.patch(conversation._id, clearedPatch(lastInbound?.createdAt, recap ? "complete" : "archived"));
    return;
  }
  if (!lastMessage || lastMessage.direction !== "outbound" || lastMessage.role !== "cs") {
    await ctx.db.patch(conversation._id, clearedPatch(lastInbound.createdAt));
    return;
  }
  if (messageHasDoneMarker(lastMessage.content, "outbound")) {
    await ctx.db.patch(conversation._id, clearedPatch(lastInbound.createdAt, "complete"));
    return;
  }

  const followUpCsKey = csKey(conversation.assignedCsName);
  if (!followUpCsKey) {
    await ctx.db.patch(conversation._id, clearedPatch(lastInbound.createdAt, "archived"));
    return;
  }

  const windowClose = lastInbound.createdAt + FOLLOW_UP_DAY_MS;
  const touches = await ctx.db
    .query("messages")
    .withIndex("by_conversation_direction_createdAt", (q: any) => q
      .eq("conversationId", conversation._id)
      .eq("direction", "outbound")
      .gt("createdAt", windowClose))
    .take(4);
  if (touches.length >= 3) {
    await ctx.db.patch(conversation._id, {
      ...clearedPatch(lastInbound.createdAt, "complete"),
      followUpCsKey,
    });
    return;
  }

  const followUpNextStage = (touches.length + 1) as 1 | 2 | 3;
  const followUpDueAt = touches.length === 0
    ? lastInbound.createdAt + FOLLOW_UP_DAY_MS
    : touches[touches.length - 1].createdAt + FOLLOW_UP_DAY_MS;
  await ctx.db.patch(conversation._id, {
    followUpCsKey,
    followUpCycleInboundAt: lastInbound.createdAt,
    followUpNextStage,
    followUpDueAt,
    followUpState: "waiting",
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
  });
}

export const backfillPage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    status: statusValidator,
    now: v.number(),
    cursor: v.optional(v.string()),
    scheduleNext: v.optional(v.boolean()),
  },
  returns: pageResultValidator,
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("Waktu backfill tidak valid.");
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q) => q
        .eq("orgId", args.orgId)
        .eq("status", args.status)
        .gte("updatedAt", args.now - FOLLOW_UP_EXPIRY_MS))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const internalPhones = await getInternalPhoneSet(ctx, args.orgId);
    for (const conversation of page.page) {
      await materializeConversation(ctx, conversation, args.now, internalPhones);
    }

    const nextStatus = page.isDone && args.status === "active" ? "handover" as const : undefined;
    if (args.scheduleNext !== false && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
        orgId: args.orgId,
        status: args.status,
        now: args.now,
        cursor: page.continueCursor,
      });
    } else if (args.scheduleNext !== false && nextStatus) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
        orgId: args.orgId,
        status: nextStatus,
        now: args.now,
      });
    }

    return {
      processed: page.page.length,
      done: page.isDone,
      continueCursor: page.continueCursor,
      nextStatus,
    };
  },
});

export const startRecentFollowUpBackfill = mutation({
  args: {},
  returns: v.object({ scheduled: v.literal(true) }),
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpMigration.startRecentFollowUpBackfill");
    await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
      orgId,
      status: "active",
      now: Date.now(),
    });
    return { scheduled: true as const };
  },
});
