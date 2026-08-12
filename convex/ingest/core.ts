import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "../authz";
import { appendMessageCore } from "../messages";
import { parseKirimdevWebhook } from "./kirimdevAdapter";
import { parseBerduOrderDetail, DEFAULT_BERDU_STAFF_MAP } from "./berduAdapter";
import { upsertOrderCore } from "../state";
import { getBoundedActiveAgentRegistry, resolveAgent } from "../agents";
import { getDefaultOrgId } from "../orgs";
import { extractAdminProviderNumberId, parseAdminKirimdevEvent } from "../adminInboxProvider";
import { applyAdminStatusCore, upsertAdminInboundCore } from "../adminInbox";
import { touchProviderChannelHealth } from "../providerChannelHealth";
import { normalizePhone } from "../lib";

/** @deprecated B2a — use resolveAgent({ phoneNumberId }) from ../agents. */
export async function resolveCsByPhoneNumberId(ctx: any, orgId: Id<"organizations">, phoneNumberId: string | undefined) {
  if (!phoneNumberId) return undefined;
  return (await resolveAgent(ctx, orgId, { phoneNumberId }))?.csName;
}

// Build the Berdu staffId -> CS-name map from this org's active registry. The baked
// pre-seed map belongs only to tenant #1; other unconfigured orgs stay neutral so
// the adapter surfaces `Staff <id>` instead of leaking tenant-1 staff names.
export async function resolveBerduStaffMap(ctx: any, orgId: Id<"organizations">): Promise<Record<string, string>> {
  const configs = await getBoundedActiveAgentRegistry(ctx, orgId);
  if (!configs) return {};
  const map: Record<string, string> = {};
  for (const c of configs) for (const id of c.berduStaffIds ?? []) map[id] = c.csName;
  if (Object.keys(map).length > 0) return map;
  const defaultOrgId = await getDefaultOrgId(ctx);
  return defaultOrgId != null && String(defaultOrgId) === String(orgId) ? DEFAULT_BERDU_STAFF_MAP : {};
}

type ProcessOutcome =
  | { status: "processed"; resultRef?: string }
  | { status: "skipped"; skipReason: string };

// The single dispatcher both the HTTP path and replay use. Throws on real
// processing errors (caller decides how to record the failure).
export async function processCapturedEvent(
  ctx: any,
  event: { sourceKey: string; kind: string; rawHeaders: string; rawBody: string; receivedAt: number; orgId: Id<"organizations"> },
): Promise<ProcessOutcome> {
  const headers = JSON.parse(event.rawHeaders || "{}");
  const body = JSON.parse(event.rawBody);

  if (event.kind === "message.event") {
    const adminProviderNumberId = extractAdminProviderNumberId(body);
    const adminChannel = adminProviderNumberId
      ? await ctx.db
          .query("adminChannels")
          .withIndex("by_org_providerNumberId", (q: any) => q.eq("orgId", event.orgId).eq("providerNumberId", adminProviderNumberId))
          .first()
      : null;
    if (adminChannel) {
      const parsedAdmin = parseAdminKirimdevEvent(headers, body, event.receivedAt);
      if (parsedAdmin.kind === "inbound") {
        await touchProviderChannelHealth(ctx, {
          orgId: event.orgId,
          providerNumberId: parsedAdmin.providerNumberId,
          channelType: "admin",
          direction: "inbound",
          touchedAt: parsedAdmin.createdAt,
        });
      }
      const providerEventId = parsedAdmin.kind === "skip"
        ? String(headers["x-kirim-event-id"] || `skip:${adminProviderNumberId}:${event.receivedAt}`)
        : parsedAdmin.providerEventId;
      const duplicate = await ctx.db
        .query("adminProviderEvents")
        .withIndex("by_org_providerEventId", (q: any) => q.eq("orgId", event.orgId).eq("providerEventId", providerEventId))
        .first();
      if (duplicate) return { status: "processed", resultRef: String(duplicate._id) };
      const auditId = await ctx.db.insert("adminProviderEvents", {
        orgId: event.orgId,
        providerEventId,
        kind: parsedAdmin.kind,
        rawBody: event.rawBody,
        status: "received",
        receivedAt: event.receivedAt,
      });
      if (!adminChannel.isActive) {
        await ctx.db.patch(auditId, { status: "skipped", error: "admin channel inactive", processedAt: Date.now() });
        return { status: "skipped", skipReason: "admin inbox: channel inactive" };
      }
      if (parsedAdmin.kind === "skip") {
        await ctx.db.patch(auditId, { status: "skipped", error: parsedAdmin.reason, processedAt: Date.now() });
        return { status: "skipped", skipReason: `admin inbox: ${parsedAdmin.reason}` };
      }
      if (parsedAdmin.kind === "inbound") {
        const result = await upsertAdminInboundCore(ctx, {
          orgId: event.orgId,
          channelId: adminChannel._id,
          customerPhone: parsedAdmin.customerPhone,
          customerName: parsedAdmin.customerName,
          content: parsedAdmin.content,
          providerMessageId: parsedAdmin.providerMessageId,
          providerEventId: parsedAdmin.providerEventId,
          createdAt: parsedAdmin.createdAt,
        });
        await ctx.db.patch(auditId, { status: "processed", processedAt: Date.now() });
        return { status: "processed", resultRef: String(result.messageId) };
      }
      const result = await applyAdminStatusCore(ctx, {
        orgId: event.orgId,
        providerMessageId: parsedAdmin.providerMessageId,
        status: parsedAdmin.status,
        updatedAt: parsedAdmin.createdAt,
      });
      await ctx.db.patch(auditId, {
        status: result.updated ? "processed" : "skipped",
        error: result.updated ? undefined : "outbound message not found",
        processedAt: Date.now(),
      });
      return result.updated
        ? { status: "processed", resultRef: String(auditId) }
        : { status: "skipped", skipReason: "admin inbox: outbound message not found" };
    }
    const parsed = parseKirimdevWebhook(headers, body, event.receivedAt);
    if (parsed.kind === "skip") return { status: "skipped", skipReason: parsed.reason };
    const agent = await resolveAgent(ctx, event.orgId, { phoneNumberId: parsed.event.phoneNumberId });
    const csName = agent?.csName;
    if (parsed.event.phoneNumberId) {
      await touchProviderChannelHealth(ctx, {
        orgId: event.orgId,
        providerNumberId: parsed.event.phoneNumberId,
        channelType: agent ? "cs" : "unknown",
        csKey: agent?.key,
        direction: parsed.event.direction,
        touchedAt: parsed.event.createdAt,
      });
      if (!agent) {
        const existingConversation = await ctx.db
          .query("conversations")
          .withIndex("by_org_customerPhone_updatedAt", (q: any) => q
            .eq("orgId", event.orgId)
            .eq("customerPhone", normalizePhone(parsed.event.phone)))
          .order("desc")
          .first();
        if (!existingConversation) {
          return {
            status: "skipped",
            skipReason: "provider number unmapped and customer conversation not found",
          };
        }
      }
    }
    const result = await appendMessageCore(ctx, {
      phone: parsed.event.phone,
      role: parsed.event.role,
      direction: parsed.event.direction,
      content: parsed.event.content,
      messageType: parsed.event.messageType,
      externalMessageId: parsed.event.externalMessageId,
      createdAt: parsed.event.createdAt,
      csName,
      source: "ingest",
      orgId: event.orgId,
    });
    return { status: "processed", resultRef: String(result?.messageId ?? "") };
  }

  if (event.kind === "lead.created") {
    const staffMap = await resolveBerduStaffMap(ctx, event.orgId);
    const parsed = parseBerduOrderDetail((body as any).order ?? body, staffMap);
    if (parsed.kind === "skip") return { status: "skipped", skipReason: parsed.reason };
    const e = parsed.event;
    const result = await upsertOrderCore(ctx, {
      phone: e.phone, csName: e.csName, customerName: e.customerName,
      productName: e.productName, products: e.products, productsSubtotal: e.productsSubtotal,
      shippingCost: e.shippingCost, total: e.total,
      shippingAddress: e.shippingAddress, shippingDistrict: e.shippingDistrict,
      shippingCity: e.shippingCity, order_id: e.orderId, createdAt: e.createdAt,
      orgId: event.orgId,
    });
    return { status: "processed", resultRef: String(result?.orderId ?? e.orderId) };
  }

  if (event.kind === "generic.message") {
    const p = body as Record<string, any>;
    if (!p.phone || !p.content || !p.externalMessageId) return { status: "skipped", skipReason: "missing phone/content/externalMessageId" };
    if (p.direction !== "inbound" && p.direction !== "outbound") return { status: "skipped", skipReason: "invalid direction" };
    if (p.role !== "customer" && p.role !== "cs" && p.role !== "ai") return { status: "skipped", skipReason: "invalid role" };
    const sourceMessageType = p.messageType ?? "text";
    const result = await appendMessageCore(ctx, {
      phone: String(p.phone), role: p.role, direction: p.direction,
      // Generic messages historically normalize to text. Keep that contract so the existing
      // response-sampling branch stays stable; source type gates closing-rule I/O separately.
      content: String(p.content), messageType: "text",
      closingSignalEligible: p.direction === "outbound" && sourceMessageType === "text",
      externalMessageId: String(p.externalMessageId),
      createdAt: typeof p.timestamp === "number" ? p.timestamp : event.receivedAt,
      csName: typeof p.csName === "string" ? p.csName : undefined,
      source: "ingest",
      orgId: event.orgId,
    });
    return { status: "processed", resultRef: String(result?.messageId ?? "") };
  }

  if (event.kind === "generic.lead") {
    const p = body as Record<string, any>;
    if (!p.phone || !p.orderId || !p.csName) return { status: "skipped", skipReason: "missing phone/orderId/csName" };
    const result = await upsertOrderCore(ctx, {
      phone: String(p.phone), csName: String(p.csName),
      customerName: p.customerName ? String(p.customerName) : undefined,
      products: p.products ? String(p.products) : undefined,
      total: p.total ? String(p.total) : undefined,
      order_id: String(p.orderId),
      createdAt: typeof p.timestamp === "number" ? p.timestamp : undefined,
      orgId: event.orgId,
    });
    return { status: "processed", resultRef: String(result?.orderId ?? p.orderId) };
  }

  // Task 12 adds "generic.message"/"generic.lead".
  return { status: "skipped", skipReason: `unsupported kind ${event.kind}` };
}

async function finishReplay(ctx: any, replayId: any, outcome: ProcessOutcome) {
  await ctx.db.patch(replayId, {
    ...(outcome.status === "processed"
      ? { status: "processed" as const, resultRef: outcome.resultRef }
      : { status: "skipped" as const, skipReason: outcome.skipReason }),
    processedAt: Date.now(),
  });
}

export const processEvent = internalMutation({
  args: { eventId: v.id("ingestEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("event not found");
    const outcome = await processCapturedEvent(ctx, event);
    await finishReplay(ctx, args.eventId, outcome);
    return outcome;
  },
});

export const replayEvent = mutation({
  args: { eventId: v.id("ingestEvents") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.core.replayEvent");
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("event not found");
    const replayId = await ctx.db.insert("ingestEvents", {
      sourceKey: event.sourceKey, kind: event.kind,
      rawHeaders: event.rawHeaders, rawBody: event.rawBody,
      signatureOk: event.signatureOk, status: "received",
      receivedAt: Date.now(), replayOf: args.eventId,
      orgId: event.orgId,
    });
    const outcome = await processCapturedEvent(ctx, { ...event, receivedAt: Date.now() });
    await finishReplay(ctx, replayId, outcome);
    // Close out the original so it stops counting as failed.
    if (event.status === "failed") {
      await ctx.db.patch(args.eventId, { status: "processed", processedAt: Date.now() });
    }
    return outcome;
  },
});

export const replayAllFailed = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "ingest.core.replayAllFailed");
    const failed = await ctx.db
      .query("ingestEvents")
      .withIndex("by_status_receivedAt", (q) => q.eq("status", "failed"))
      .take(100);
    let replayed = 0;
    for (const event of failed) {
      const replayId = await ctx.db.insert("ingestEvents", {
        sourceKey: event.sourceKey, kind: event.kind,
        rawHeaders: event.rawHeaders, rawBody: event.rawBody,
        signatureOk: event.signatureOk, status: "received",
        receivedAt: Date.now(), replayOf: event._id,
        orgId: event.orgId,
      });
      const outcome = await processCapturedEvent(ctx, { ...event, receivedAt: Date.now() });
      await finishReplay(ctx, replayId, outcome);
      await ctx.db.patch(event._id, { status: "processed", processedAt: Date.now() });
      replayed++;
    }
    return { replayed };
  },
});
