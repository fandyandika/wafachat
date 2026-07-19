import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const MAX_UNRESOLVED_COUNTERS = 500;
const MAX_COUNTER = 999_999;
// A delayed cron run advances through a bounded page at a time instead of
// turning an incremental query back into an unbounded daily read.
const MAX_TAIL_ORDERS_PER_RUN = 500;

function orderIdFor(datePrefix: string, counter: number): string {
  return `O-${datePrefix}${String(counter).padStart(6, "0")}`;
}

function counterFromOrderId(orderId: string, datePrefix: string): number | null {
  const prefix = `O-${datePrefix}`;
  if (!orderId.startsWith(prefix)) return null;
  const suffix = orderId.slice(prefix.length);
  if (!/^\d{6}$/.test(suffix)) return null;
  const counter = Number(suffix);
  return counter >= 1 && counter <= MAX_COUNTER ? counter : null;
}

function sortedCounters(counters: Iterable<number>): number[] {
  return [...new Set(counters)]
    .filter((counter) => Number.isInteger(counter) && counter >= 1 && counter <= MAX_COUNTER)
    .sort((a, b) => a - b);
}

function cappedSorted(counters: Iterable<number>): number[] {
  return sortedCounters(counters).slice(0, MAX_UNRESOLVED_COUNTERS);
}

function rotateCounters(counters: number[], probeCursor: number): number[] {
  if (counters.length === 0) return [];
  const start = counters.findIndex((counter) => counter >= probeCursor);
  if (start <= 0) return counters;
  return [...counters.slice(start), ...counters.slice(0, start)];
}

// nextCounter is the lowest counter that is not known present or persisted in
// unresolvedCounters. Never advance past a missing counter that did not fit.
function gapsAndCursor(presentCounters: number[], start: number, end: number, capacity: number) {
  if (end < start || capacity <= 0) return { gaps: [], nextCounter: start };
  const present = new Set(presentCounters);
  const gaps: number[] = [];
  for (let counter = start; counter <= end; counter++) {
    if (present.has(counter)) continue;
    if (gaps.length === capacity) return { gaps, nextCounter: counter };
    gaps.push(counter);
  }
  return { gaps, nextCounter: end + 1 };
}

async function orderExists(ctx: { db: any }, orgId: Id<"organizations">, datePrefix: string, counter: number) {
  return await ctx.db
    .query("orders")
    .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", orderIdFor(datePrefix, counter)))
    .unique();
}

export const prepareReconcileRun = internalQuery({
  args: { orgId: v.id("organizations"), datePrefix: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("reconcileStates")
      .withIndex("by_org_datePrefix", (q: any) => q.eq("orgId", args.orgId).eq("datePrefix", args.datePrefix))
      .unique();

    if (!state) {
      // Bootstrap once for this WIB date. Later invocations never revisit this
      // range; the cursor makes their read begin at the last observed counter.
      const rows = await ctx.db
        .query("orders")
        .withIndex("by_org_orderId", (q: any) =>
          q.eq("orgId", args.orgId)
            .gte("orderId", orderIdFor(args.datePrefix, 0))
            .lte("orderId", orderIdFor(args.datePrefix, MAX_COUNTER)),
        )
        .collect();
      const counters = rows
        .map((row: any) => counterFromOrderId(row.orderId, args.datePrefix))
        .filter((counter: number | null): counter is number => counter !== null);
      const maxCounter = counters.length === 0 ? 0 : Math.max(...counters);
      const minCounter = counters.length === 0 ? 1 : Math.min(...counters);
      const bootstrap = gapsAndCursor(counters, minCounter, maxCounter, MAX_UNRESOLVED_COUNTERS);
      return { gaps: bootstrap.gaps, nextCounter: Math.max(bootstrap.nextCounter, 1) };
    }

    const unresolvedCounters = cappedSorted(state.unresolvedCounters);
    const resolved = await Promise.all(
      unresolvedCounters.map(async (counter) => Boolean(await orderExists(ctx, args.orgId, args.datePrefix, counter))),
    );
    const stillUnresolved = unresolvedCounters.filter((_, index) => !resolved[index]);

    // A full unresolved set consumes all durable gap capacity. Do not read a
    // new tail until a point-check has freed a slot for its first missing row.
    if (stillUnresolved.length === MAX_UNRESOLVED_COUNTERS) {
      return {
        gaps: rotateCounters(stillUnresolved, state.probeCursor ?? 1),
        nextCounter: Math.max(state.nextCounter, 1),
      };
    }

    const tailRows = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q: any) =>
        q.eq("orgId", args.orgId)
          .gte("orderId", orderIdFor(args.datePrefix, Math.max(state.nextCounter, 1)))
          .lte("orderId", orderIdFor(args.datePrefix, MAX_COUNTER)),
      )
      .take(MAX_TAIL_ORDERS_PER_RUN);
    const tailCounters = tailRows
      .map((row: any) => counterFromOrderId(row.orderId, args.datePrefix))
      .filter((counter: number | null): counter is number => counter !== null);
    const tailMax = tailCounters.length === 0 ? 0 : Math.max(...tailCounters);
    const tail = tailMax === 0
      ? { gaps: [], nextCounter: Math.max(state.nextCounter, 1) }
      : gapsAndCursor(
        tailCounters,
        Math.max(state.nextCounter, 1),
        tailMax,
        MAX_UNRESOLVED_COUNTERS - stillUnresolved.length,
      );

    return {
      gaps: rotateCounters(sortedCounters([...stillUnresolved, ...tail.gaps]), state.probeCursor ?? 1),
      nextCounter: tail.nextCounter,
    };
  },
});

export const commitReconcileRun = internalMutation({
  args: {
    orgId: v.id("organizations"),
    datePrefix: v.string(),
    nextCounter: v.number(),
    unresolvedCounters: v.array(v.number()),
    probeCursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reconcileStates")
      .withIndex("by_org_datePrefix", (q: any) => q.eq("orgId", args.orgId).eq("datePrefix", args.datePrefix))
      .unique();
    // Merge with the persisted set and re-check each candidate in this atomic
    // mutation. A retried, stale cron therefore cannot move the cursor back or
    // resurrect a gap that a concurrent run has already ingested.
    const candidates = sortedCounters([
      ...cappedSorted(existing?.unresolvedCounters ?? []),
      ...cappedSorted(args.unresolvedCounters),
    ]);
    const present = await Promise.all(
      candidates.map(async (counter) => Boolean(await orderExists(ctx, args.orgId, args.datePrefix, counter))),
    );
    const missingCandidates = candidates.filter((_, index) => !present[index]);
    const unresolvedCounters = missingCandidates.slice(0, MAX_UNRESOLVED_COUNTERS);
    // A stale retry can race a run that filled the state. Clamp its cursor at
    // the first missing counter it could not durably retain instead of losing
    // that hole. The normal path remains monotonic; this only corrects an
    // otherwise unsafe, over-full merge.
    const firstUnpersisted = missingCandidates[MAX_UNRESOLVED_COUNTERS];
    const requestedNext = Math.max(args.nextCounter, 1);
    const nextCounter = firstUnpersisted === undefined
      ? Math.max(existing?.nextCounter ?? 1, requestedNext)
      : Math.min(Math.max(existing?.nextCounter ?? 1, requestedNext), firstUnpersisted);
    const probeCursor = args.probeCursor ?? existing?.probeCursor ?? 1;
    const patch = { nextCounter, unresolvedCounters, probeCursor, updatedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("reconcileStates", { orgId: args.orgId, datePrefix: args.datePrefix, ...patch });
    }
    return { nextCounter, unresolvedCounters, probeCursor };
  },
});
