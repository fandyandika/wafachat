// Conversation lifecycle resolver. WaFaChat never marked conversations "closed" (closing happens
// in WhatsApp), so the "active" pool grew unbounded. This resolves them: a conversation is closed
// when it's WON (a shippingRecap exists for its order) or STALE (the customer's last message — or
// the conversation's creation if they never wrote — is older than the 5-day funnel ceiling).
//
// Status is independent of the sales/CR metrics (those come from shippingRecaps), and a new order
// reactivates a closed conversation (state.upsertOrderFromN8n), so closing here is safe. We use a
// DIRECT patch (no dailyStats bookkeeping) so the cleanup doesn't spike the "closed today" metric.

import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdminOrg } from "./authz";
import { messageHasDoneMarker } from "./followUpMath";

// 5 days — same ceiling the follow-up funnel uses (followUpMath). Past this, a silent lead is dead.
export const ARCHIVE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const BATCH = 25; // small: each non-closed row also scans its recent messages for "done" markers
export const SWEEP_MAX_PAGES = 800; // total across both statuses: at most 20,000 unique rows per run

// "Done" markers are shared with the live hook in messages.ts (via followUpMath.messageHasDoneMarker),
// so the keyword list never drifts. New markers close a conversation in REAL TIME on message insert;
// this sweep is the BACKSTOP that catches any that pre-date the hook.
async function hasDoneMarker(ctx: { db: any }, conversationId: any): Promise<boolean> {
  const msgs = await ctx.db
    .query("messages")
    .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversationId))
    .order("desc")
    .take(120); // latest 120 only — markers are recent; bounds reads per row
  return msgs.some((m: any) => messageHasDoneMarker(m.content ?? "", m.direction));
}

type CloseReason = "won" | "marker" | "stale" | null;

async function closeReason(
  ctx: { db: any },
  c: any,
  orgId: any,
  now: number,
): Promise<CloseReason> {
  // WON: a recap for this order. For an order-less "manual:" thread, fall back to ANY recap for
  // this customer's phone (a buyer's side-thread isn't a fresh lead). Real orders stay by-order
  // only, so a repeat customer's NEW order is never falsely closed by an OLD recap.
  let recap = await ctx.db
    .query("shippingRecaps")
    .withIndex("by_org_orderIdBerdu", (q: any) => q.eq("orgId", orgId).eq("orderIdBerdu", c.orderId))
    .first();
  if (!recap && String(c.orderId).startsWith("manual:")) {
    recap = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", c.customerPhone))
      .first();
  }
  if (recap) return "won";
  if (await hasDoneMarker(ctx, c._id)) return "marker";

  const lastInbound = await ctx.db
    .query("messages")
    .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", c._id).eq("direction", "inbound"))
    .order("desc")
    .first();
  const ref = lastInbound?.createdAt ?? c.createdAt;
  return now - ref > ARCHIVE_AFTER_MS ? "stale" : null;
}

// Phase 1 uses an immutable creation-time keyset; processed rows may leave the status index safely.
export const scanOpenBatch = internalQuery({
  args: {
    afterCreationTime: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("handover")),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_org_status", (q: any) => {
        const statusRange = q.eq("orgId", args.orgId).eq("status", args.status);
        return args.afterCreationTime === undefined
          ? statusRange
          : statusRange.gt("_creationTime", args.afterCreationTime);
      })
      .take(BATCH);
    return {
      ids: rows.map((conversation) => conversation._id),
      nextAfterCreationTime: rows.at(-1)?._creationTime ?? args.afterCreationTime,
      isDone: rows.length < BATCH,
    };
  },
});

export const getSweepState = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: (ctx, args) => ctx.db
    .query("lifecycleSweepStates")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .unique(),
});

export const commitSweepState = internalMutation({
  args: {
    orgId: v.id("organizations"),
    reset: v.boolean(),
    activeAfterCreationTime: v.optional(v.number()),
    handoverAfterCreationTime: v.optional(v.number()),
    activeDone: v.boolean(),
    handoverDone: v.boolean(),
    nextStatus: v.union(v.literal("active"), v.literal("handover")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lifecycleSweepStates")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (args.reset) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    const value = {
      orgId: args.orgId,
      activeAfterCreationTime: args.activeAfterCreationTime,
      handoverAfterCreationTime: args.handoverAfterCreationTime,
      activeDone: args.activeDone,
      handoverDone: args.handoverDone,
      nextStatus: args.nextStatus,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("lifecycleSweepStates", value);
  },
});

// Phase 2 re-reads every selected row and makes the close decision in the same transaction as its patch.
export const processConversationIds = internalMutation({
  args: {
    ids: v.array(v.id("conversations")),
    dryRun: v.boolean(),
    now: v.number(),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    if (args.ids.length > BATCH) {
      throw new Error(`processConversationIds accepts at most ${BATCH} IDs`);
    }
    if (new Set(args.ids.map(String)).size !== args.ids.length) {
      throw new Error("processConversationIds does not accept duplicate IDs");
    }
    let closedWon = 0;
    let closedMarker = 0;
    let closedStale = 0;
    for (const id of args.ids) {
      const conversation = await ctx.db.get(id);
      if (
        !conversation ||
        conversation.orgId !== args.orgId ||
        (conversation.status !== "active" && conversation.status !== "handover")
      ) continue;
      const reason = await closeReason(ctx, conversation, args.orgId, args.now);
      if (!reason) continue;
      if (!args.dryRun) await ctx.db.patch(id, { status: "closed", updatedAt: args.now });
      if (reason === "won") closedWon++;
      else if (reason === "marker") closedMarker++;
      else closedStale++;
    }
    return { closedWon, closedMarker, closedStale };
  },
});

type SweepResult = { considered: number; closedWon: number; closedMarker: number; closedStale: number; dryRun: boolean };

export async function sweep(
  ctx: { runQuery: any; runMutation: any },
  orgId: any,
  dryRun: boolean,
  pageBudget = SWEEP_MAX_PAGES,
): Promise<SweepResult> {
  const now = Date.now();
  const saved: any = dryRun
    ? null
    : await ctx.runQuery(internal.conversationLifecycle.getSweepState, { orgId });
  const after: Record<"active" | "handover", number | undefined> = {
    active: saved?.activeAfterCreationTime,
    handover: saved?.handoverAfterCreationTime,
  };
  const done: Record<"active" | "handover", boolean> = {
    active: saved?.activeDone ?? false,
    handover: saved?.handoverDone ?? false,
  };
  let nextStatus: "active" | "handover" = saved?.nextStatus ?? "active";
  let pages = 0;
  let considered = 0;
  let closedWon = 0;
  let closedMarker = 0;
  let closedStale = 0;

  // The budget is TOTAL pages across both statuses. Each page is applied before its immutable
  // creation-time boundary can advance. Durable progress is committed only after every selected
  // page succeeds, so action retries are idempotent and never skip unapplied rows.
  // A status transition that lands behind a saved boundary remains open until both streams reach
  // terminal and the state resets; the following cycle catches it without an unbounded extra scan.
  const totalPageBudget = Math.max(0, Math.floor(pageBudget));
  while (pages < totalPageBudget && !(done.active && done.handover)) {
    const status: "active" | "handover" = done[nextStatus]
      ? (nextStatus === "active" ? "handover" : "active")
      : nextStatus;
    const page: any = await ctx.runQuery(internal.conversationLifecycle.scanOpenBatch, {
      afterCreationTime: after[status], status, orgId,
    });
    const result: any = await ctx.runMutation(internal.conversationLifecycle.processConversationIds, {
      ids: page.ids, dryRun, now, orgId,
    });
    pages++;
    considered += page.ids.length;
    closedWon += result.closedWon;
    closedMarker += result.closedMarker;
    closedStale += result.closedStale;
    after[status] = page.nextAfterCreationTime;
    done[status] = page.isDone;
    nextStatus = status === "active" ? "handover" : "active";
  }

  if (!dryRun) {
    await ctx.runMutation(internal.conversationLifecycle.commitSweepState, {
      orgId,
      reset: done.active && done.handover,
      activeAfterCreationTime: after.active,
      handoverAfterCreationTime: after.handover,
      activeDone: done.active,
      handoverDone: done.handover,
      nextStatus,
    });
  }
  return { considered, closedWon, closedMarker, closedStale, dryRun };
}

// Internal entry point. The daily cron calls it with no args (executes). For the one-time backfill /
// dry-run, run it via the admin CLI (internal funcs are callable through `npx convex run`):
//   npx convex run conversationLifecycle:cronArchiveSweep '{"dryRun":true}' --prod   (preview, no writes)
//   npx convex run conversationLifecycle:cronArchiveSweep '{}' --prod                (execute)
// Kept internal (not a public action) so it can never be triggered by an unauthenticated client.
// Per-org loop: iterate every org, thread orgId through mutations.
export const cronArchiveSweep = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<SweepResult> => {
    const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {});
    let totalConsidered = 0, totalClosedWon = 0, totalClosedMarker = 0, totalClosedStale = 0;
    for (const org of orgs) {
      const result = await sweep(ctx, org._id, args.dryRun ?? false);
      totalConsidered += result.considered;
      totalClosedWon += result.closedWon;
      totalClosedMarker += result.closedMarker;
      totalClosedStale += result.closedStale;
    }
    return { considered: totalConsidered, closedWon: totalClosedWon, closedMarker: totalClosedMarker, closedStale: totalClosedStale, dryRun: args.dryRun ?? false };
  },
});

// PUBLIC but READ-ONLY (always dryRun) — counts how many WON/STALE conversations the cron would
// close, without writing. Safe to expose (no mutation, no data beyond counts). Used for the
// pre-backfill preview via `npx convex run conversationLifecycle:archiveDryRun --prod`.
export const archiveDryRun = action({
  args: {},
  handler: async (ctx): Promise<SweepResult> => {
    const { orgId } = await requireAdminOrg(ctx, "conversationLifecycle.archiveDryRun");
    return sweep(ctx, orgId, true);
  },
});
