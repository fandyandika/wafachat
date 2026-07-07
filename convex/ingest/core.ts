import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { requireAdmin } from "../authz";
import { appendMessageCore } from "../messages";
import { parseKirimdevWebhook } from "./kirimdevAdapter";

// Resolve CS display name from a WABA phone_number_id via csConfigs.
// Matches BOTH the legacy single field and the new array field.
export async function resolveCsByPhoneNumberId(ctx: any, phoneNumberId: string | undefined) {
  if (!phoneNumberId) return undefined;
  const configs = await ctx.db.query("csConfigs").collect(); // small table (~5 rows)
  const hit = configs.find(
    (c: any) => c.providerNumberId === phoneNumberId || (c.providerNumberIds ?? []).includes(phoneNumberId),
  );
  return hit?.csName as string | undefined;
}

type ProcessOutcome =
  | { status: "processed"; resultRef?: string }
  | { status: "skipped"; skipReason: string };

// The single dispatcher both the HTTP path and replay use. Throws on real
// processing errors (caller decides how to record the failure).
export async function processCapturedEvent(
  ctx: any,
  event: { sourceKey: string; kind: string; rawHeaders: string; rawBody: string; receivedAt: number },
): Promise<ProcessOutcome> {
  const headers = JSON.parse(event.rawHeaders || "{}");
  const body = JSON.parse(event.rawBody);

  if (event.kind === "message.event") {
    const parsed = parseKirimdevWebhook(headers, body, event.receivedAt);
    if (parsed.kind === "skip") return { status: "skipped", skipReason: parsed.reason };
    const csName = await resolveCsByPhoneNumberId(ctx, parsed.event.phoneNumberId);
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
    });
    return { status: "processed", resultRef: String(result?.messageId ?? "") };
  }

  // Task 10 adds "lead.created"; Task 12 adds "generic.message"/"generic.lead".
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
      });
      const outcome = await processCapturedEvent(ctx, { ...event, receivedAt: Date.now() });
      await finishReplay(ctx, replayId, outcome);
      await ctx.db.patch(event._id, { status: "processed", processedAt: Date.now() });
      replayed++;
    }
    return { replayed };
  },
});
