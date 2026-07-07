import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { requireAdmin } from "../authz";

const statusValidator = v.union(
  v.literal("received"), v.literal("processed"), v.literal("failed"), v.literal("skipped"),
);

export const captureEvent = internalMutation({
  args: {
    sourceKey: v.string(),
    kind: v.string(),
    rawHeaders: v.string(),
    rawBody: v.string(),
    signatureOk: v.boolean(),
    replayOf: v.optional(v.id("ingestEvents")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("ingestEvents", { ...args, status: "received", receivedAt: Date.now() });
  },
});

export const markProcessed = internalMutation({
  args: { eventId: v.id("ingestEvents"), resultRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "processed", resultRef: args.resultRef, processedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: { eventId: v.id("ingestEvents"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "failed", error: args.error.slice(0, 2000), processedAt: Date.now(),
    });
  },
});

export const markSkipped = internalMutation({
  args: { eventId: v.id("ingestEvents"), skipReason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "skipped", skipReason: args.skipReason, processedAt: Date.now(),
    });
  },
});

// Retention: bounded delete batch, driven by cron (Task 8 adds cleanupOldDaily wrapper).
export const cleanupOld = internalMutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("ingestEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", args.olderThanMs))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return { deleted: old.length };
  },
});

export const cleanupOldDaily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 3_600_000;
    const old = await ctx.db
      .query("ingestEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return { deleted: old.length };
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()), status: v.optional(statusValidator) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.events.listRecent");
    const limit = Math.min(args.limit ?? 50, 200);
    if (args.status) {
      return ctx.db
        .query("ingestEvents")
        .withIndex("by_status_receivedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    return ctx.db.query("ingestEvents").withIndex("by_receivedAt").order("desc").take(limit);
  },
});
