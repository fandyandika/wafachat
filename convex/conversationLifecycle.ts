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
import type { Id } from "./_generated/dataModel";
import { requireAdminOrg } from "./authz";
import { messageHasDoneMarker } from "./followUpMath";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";

// 5 days — same ceiling the follow-up funnel uses (followUpMath). Past this, a silent lead is dead.
export const ARCHIVE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const BATCH = 25; // small: each non-closed row also scans its recent messages for "done" markers
export const SWEEP_MAX_PAGES = 4; // total across both statuses: at most 100 selected rows per action

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

// convex-helpers serializes the full index key [orgId, status, _creationTime, _id]. The final _id
// makes equal-creation-time rows unique, and the manual cursor remains valid if earlier rows leave
// the status index after apply.
export const scanOpenBatch = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("handover")),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const page = await paginator(ctx.db, schema)
      .query("conversations")
      .withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", args.status))
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH });
    return {
      ids: page.page.map((conversation) => conversation._id),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
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
    activeCursor: v.optional(v.string()),
    handoverCursor: v.optional(v.string()),
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
      activeCursor: args.activeCursor,
      handoverCursor: args.handoverCursor,
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

type SweepResult = {
  considered: number;
  closedWon: number;
  closedMarker: number;
  closedStale: number;
  dryRun: boolean;
  pages: number;
  complete: boolean;
};

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
  const cursors: Record<"active" | "handover", string | undefined> = {
    active: saved?.activeCursor,
    handover: saved?.handoverCursor,
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

  // The budget is TOTAL pages across both statuses. Each page is applied before its immutable,
  // full-index-key cursor can advance. Durable progress is committed only after every selected
  // page succeeds, so action retries are idempotent and never skip unapplied rows.
  // A status transition that lands behind a saved boundary remains open until both streams reach
  // terminal and the state resets; the following cycle catches it without an unbounded extra scan.
  const totalPageBudget = Math.max(0, Math.floor(pageBudget));
  while (pages < totalPageBudget && !(done.active && done.handover)) {
    const status: "active" | "handover" = done[nextStatus]
      ? (nextStatus === "active" ? "handover" : "active")
      : nextStatus;
    const page: any = await ctx.runQuery(internal.conversationLifecycle.scanOpenBatch, {
      cursor: cursors[status], status, orgId,
    });
    const result: any = await ctx.runMutation(internal.conversationLifecycle.processConversationIds, {
      ids: page.ids, dryRun, now, orgId,
    });
    pages++;
    considered += page.ids.length;
    closedWon += result.closedWon;
    closedMarker += result.closedMarker;
    closedStale += result.closedStale;
    cursors[status] = page.continueCursor;
    done[status] = page.isDone;
    nextStatus = status === "active" ? "handover" : "active";
    if (!dryRun) {
      // Persist immediately after the page's apply succeeds. If an action is
      // interrupted, the next invocation resumes after the last applied page.
      await ctx.runMutation(internal.conversationLifecycle.commitSweepState, {
        orgId,
        reset: done.active && done.handover,
        activeCursor: cursors.active,
        handoverCursor: cursors.handover,
        activeDone: done.active,
        handoverDone: done.handover,
        nextStatus,
      });
    }
  }
  return {
    considered, closedWon, closedMarker, closedStale, dryRun, pages,
    complete: done.active && done.handover,
  };
}

export async function scheduleOrganizationSweeps<T>(
  orgIds: readonly T[],
  schedule: (orgId: T) => Promise<unknown>,
) {
  let scheduledOrganizations = 0;
  const failedOrganizations: string[] = [];
  for (const orgId of orgIds) {
    try {
      await schedule(orgId);
      scheduledOrganizations++;
    } catch {
      // Scheduling one tenant must not prevent later tenants from being queued.
      failedOrganizations.push(String(orgId));
    }
  }
  return { scheduledOrganizations, failedOrganizations };
}

type RunOrgSweepResult = SweepResult & { scheduledContinuation: boolean };

// One tenant and a small page budget per action. The durable page checkpoints
// make scheduled continuations safe to retry after interruption.
export const runOrgSweep = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<RunOrgSweepResult> => {
    const result = await sweep(ctx, args.orgId, false, SWEEP_MAX_PAGES);
    if (!result.complete) {
      await ctx.scheduler.runAfter(0, internal.conversationLifecycle.runOrgSweep, {
        orgId: args.orgId,
      });
    }
    return { ...result, scheduledContinuation: !result.complete };
  },
});

// Internal entry point. The daily cron calls it with no args and it schedules bounded per-org
// workers. For a bounded dry-run page, run it via the admin CLI:
//   npx convex run conversationLifecycle:cronArchiveSweep '{"dryRun":true}' --prod   (preview, no writes)
//   npx convex run conversationLifecycle:cronArchiveSweep '{}' --prod                (execute)
// Kept internal (not a public action) so it can never be triggered by an unauthenticated client.
type CronArchiveResult =
  | (SweepResult & { dryRun: true })
  | {
    scheduledOrganizations: number;
    failedOrganizations: string[];
    scheduledDriverContinuation: boolean;
    complete: boolean;
    dryRun: false;
  };

export const cronArchiveSweep = internalAction({
  args: { dryRun: v.optional(v.boolean()), cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<CronArchiveResult> => {
    const page: {
      page: Array<{ _id: Id<"organizations"> }>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.orgs.listOrgPageInternal, {
      cursor: args.cursor,
    });
    if (args.dryRun) {
      let considered = 0, closedWon = 0, closedMarker = 0, closedStale = 0, pages = 0;
      for (const org of page.page) {
        const result = await sweep(ctx, org._id, true);
        considered += result.considered;
        closedWon += result.closedWon;
        closedMarker += result.closedMarker;
        closedStale += result.closedStale;
        pages += result.pages;
      }
      return {
        considered, closedWon, closedMarker, closedStale, pages, dryRun: true,
        complete: page.isDone,
      };
    }

    const scheduled: { scheduledOrganizations: number; failedOrganizations: string[] } =
      await scheduleOrganizationSweeps(
      page.page.map((org) => org._id),
      (orgId) => ctx.scheduler.runAfter(0, internal.conversationLifecycle.runOrgSweep, { orgId }),
    );
    let scheduledDriverContinuation = false;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.conversationLifecycle.cronArchiveSweep, {
        cursor: page.continueCursor,
      });
      scheduledDriverContinuation = true;
    }
    return {
      ...scheduled,
      scheduledDriverContinuation,
      complete: page.isDone,
      dryRun: false,
    };
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
