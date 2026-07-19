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

// Compatibility entry point for callers that process one page directly. Production sweeping does not
// chain these mutation cursors; it uses the read-only scan + bounded apply flow below.
export const resolveBatch = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    status: v.optional(v.union(v.literal("active"), v.literal("handover"))),
    dryRun: v.boolean(), now: v.number(), orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const status = args.status ?? "active";
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", args.orgId).eq("status", status))
      .paginate({ cursor: args.cursor, numItems: BATCH });
    let closedWon = 0;
    let closedMarker = 0;
    let closedStale = 0;
    let considered = 0;
    for (const c of page.page) {
      considered++;
      const reason = await closeReason(ctx, c, args.orgId, args.now);
      if (reason) {
        if (!args.dryRun) await ctx.db.patch(c._id, { status: "closed", updatedAt: args.now });
        if (reason === "won") closedWon++;
        else if (reason === "marker") closedMarker++;
        else closedStale++;
      }
    }
    return { continueCursor: String(page.continueCursor), isDone: page.isDone, considered, closedWon, closedMarker, closedStale };
  },
});

// Phase 1 is read-only: cursors remain valid because indexed status rows are not patched while scanning.
export const scanOpenBatch = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    status: v.union(v.literal("active"), v.literal("handover")),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", args.orgId).eq("status", args.status))
      .paginate({ cursor: args.cursor, numItems: BATCH });
    return {
      ids: page.page.map((conversation) => conversation._id),
      continueCursor: String(page.continueCursor),
      isDone: page.isDone,
    };
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
  const cursors: Record<"active" | "handover", string | null> = { active: null, handover: null };
  const done: Record<"active" | "handover", boolean> = { active: false, handover: false };
  const ids: any[] = [];
  const seen = new Set<string>();
  let nextStatus: "active" | "handover" = "active";
  let pages = 0;

  // The budget is TOTAL pages across both statuses. Alternation is fair while both have work; after
  // one finishes, the other consumes the remaining budget. BATCH=25 caps selection at 20k rows.
  const totalPageBudget = Math.max(0, Math.floor(pageBudget));
  while (pages < totalPageBudget && !(done.active && done.handover)) {
    const status: "active" | "handover" = done[nextStatus]
      ? (nextStatus === "active" ? "handover" : "active")
      : nextStatus;
    const page: any = await ctx.runQuery(internal.conversationLifecycle.scanOpenBatch, {
      cursor: cursors[status], status, orgId,
    });
    pages++;
    cursors[status] = page.continueCursor;
    done[status] = page.isDone;
    for (const id of page.ids) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        ids.push(id);
      }
    }
    nextStatus = status === "active" ? "handover" : "active";
  }

  let closedWon = 0;
  let closedMarker = 0;
  let closedStale = 0;
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    const result: any = await ctx.runMutation(internal.conversationLifecycle.processConversationIds, {
      ids: ids.slice(offset, offset + BATCH), dryRun, now, orgId,
    });
    closedWon += result.closedWon;
    closedMarker += result.closedMarker;
    closedStale += result.closedStale;
  }
  return { considered: ids.length, closedWon, closedMarker, closedStale, dryRun };
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
