// Conversation lifecycle resolver. WaFaChat never marked conversations "closed" (closing happens
// in WhatsApp), so the "active" pool grew unbounded. This resolves them: a conversation is closed
// when it's WON (a shippingRecap exists for its order) or STALE (the customer's last message — or
// the conversation's creation if they never wrote — is older than the 5-day funnel ceiling).
//
// Status is independent of the sales/CR metrics (those come from shippingRecaps), and a new order
// reactivates a closed conversation (state.upsertOrderFromN8n), so closing here is safe. We use a
// DIRECT patch (no dailyStats bookkeeping) so the cleanup doesn't spike the "closed today" metric.

import { action, internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// 5 days — same ceiling the follow-up funnel uses (followUpMath). Past this, a silent lead is dead.
export const ARCHIVE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const BATCH = 200;

// Process one page of conversations: close the WON + STALE ones (unless dryRun). Returns a cursor.
// Paginates the FULL table (default order, unaffected by the status patch) and skips already-closed
// rows, so the cursor stays stable while we mutate `status`.
export const resolveBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), dryRun: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("conversations").paginate({ cursor: args.cursor, numItems: BATCH });
    let closedWon = 0;
    let closedStale = 0;
    let considered = 0;
    for (const c of page.page) {
      if (c.status === "closed") continue;
      considered++;
      // WON: a shipping recap exists for this conversation's order (precise — not by phone, so a
      // repeat customer's NEW order isn't falsely matched to an OLD recap).
      const recap = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_orderIdBerdu", (q) => q.eq("orderIdBerdu", c.orderId))
        .first();
      let reason: "won" | "stale" | null = null;
      if (recap) {
        reason = "won";
      } else {
        const lastInbound = await ctx.db
          .query("messages")
          .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id))
          .order("desc")
          .filter((q) => q.eq(q.field("direction"), "inbound"))
          .first();
        const ref = lastInbound?.createdAt ?? c.createdAt; // customer's last message, or creation if none
        if (args.now - ref > ARCHIVE_AFTER_MS) reason = "stale";
      }
      if (reason) {
        if (!args.dryRun) await ctx.db.patch(c._id, { status: "closed", updatedAt: args.now });
        if (reason === "won") closedWon++;
        else closedStale++;
      }
    }
    return { continueCursor: page.continueCursor, isDone: page.isDone, considered, closedWon, closedStale };
  },
});

type SweepResult = { considered: number; closedWon: number; closedStale: number; dryRun: boolean };

async function sweep(ctx: { runMutation: any }, dryRun: boolean): Promise<SweepResult> {
  const now = Date.now();
  let cursor: string | null = null;
  let isDone = false;
  let considered = 0;
  let closedWon = 0;
  let closedStale = 0;
  // Hard cap on iterations as a runaway guard (200 * 500 = 100k conversations).
  for (let i = 0; i < 500 && !isDone; i++) {
    const r: any = await ctx.runMutation(internal.conversationLifecycle.resolveBatch, { cursor, dryRun, now });
    cursor = r.continueCursor;
    isDone = r.isDone;
    considered += r.considered;
    closedWon += r.closedWon;
    closedStale += r.closedStale;
  }
  return { considered, closedWon, closedStale, dryRun };
}

// Internal entry point. The daily cron calls it with no args (executes). For the one-time backfill /
// dry-run, run it via the admin CLI (internal funcs are callable through `npx convex run`):
//   npx convex run conversationLifecycle:cronArchiveSweep '{"dryRun":true}' --prod   (preview, no writes)
//   npx convex run conversationLifecycle:cronArchiveSweep '{}' --prod                (execute)
// Kept internal (not a public action) so it can never be triggered by an unauthenticated client.
export const cronArchiveSweep = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<SweepResult> => sweep(ctx, args.dryRun ?? false),
});

// PUBLIC but READ-ONLY (always dryRun) — counts how many WON/STALE conversations the cron would
// close, without writing. Safe to expose (no mutation, no data beyond counts). Used for the
// pre-backfill preview via `npx convex run conversationLifecycle:archiveDryRun --prod`.
export const archiveDryRun = action({
  args: {},
  handler: async (ctx): Promise<SweepResult> => sweep(ctx, true),
});
