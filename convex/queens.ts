import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireAdminOrg, requireMemberOrg } from "./authz";
import {
  businessDateKeyForWindowKey, csKey, windowKeyFor, windowKeyForBusinessDate,
  windowRangeForKey, windowKeyToday,
} from "./lib";
import { responseTimesFromSamples } from "./rollupReaders";
import { computeQueenCs, computeQueenScores } from "../lib/queen";
import { queenExclusionForDate } from "../lib/queen-calendar";

type Award = {
  windowKey: string;
  status: "won" | "no_winner";
  winnerCsKey?: string;
  winnerCsName?: string;
  score?: number;
  leads?: number;
  closings?: number;
  cr?: number;
  respMedianMs?: number;
  excludedReason?: string;
};

async function computeWindowStanding(ctx: any, orgId: Id<"organizations">, windowKey: string) {
  const range = windowRangeForKey(windowKey);
  const [rollups, response] = await Promise.all([
    ctx.db.query("dailyRollups")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey))
      .collect(),
    responseTimesFromSamples(ctx, orgId, range),
  ]);
  const responseByCs = new Map(response.cs.map((row: any) => [csKey(row.csName), row]));
  const inputs = rollups.map((row: any) => {
    const responseRow: any = responseByCs.get(row.csKey);
    return {
      csName: row.csName,
      leads: row.leadsCust,
      closings: row.closings,
      cr: row.leadsCust ? Math.round((row.closedCust / row.leadsCust) * 1000) / 10 : 0,
      respMedianMs: responseRow?.firstReplyMedianMs ?? null,
      respCount: responseRow?.firstReplyCount ?? 0,
    };
  });
  const scores = computeQueenScores(inputs);
  return { scores, queen: computeQueenCs(inputs), rollups };
}

function nextWindowKey(key: string) {
  return windowKeyFor(windowRangeForKey(key).endAt);
}

function isBusinessDate(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function closedWindowKey(now = Date.now()) {
  return windowKeyFor(windowRangeForKey(windowKeyToday(now)).startAt - 1);
}

function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { first: `${month}-01`, afterLast: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01` };
}

function keysInRange(first: string, last: string | null) {
  if (!last || first > last) return [];
  const keys: string[] = [];
  for (let key = first; key <= last; key = nextWindowKey(key)) keys.push(key);
  return keys;
}

function monthWeeks(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const key = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  return [[1, 7], [8, 14], [15, 21], [22, lastDay]].map(([start, end], index) => ({
    week: index + 1,
    startKey: key(start),
    endKey: key(end),
  }));
}

function standings(awards: Award[], participants: Array<{ csKey: string; csName: string }> = []) {
  const byCs = new Map<string, { csKey: string; csName: string; wins: number }>();
  for (const participant of participants) {
    byCs.set(participant.csKey, { ...participant, wins: 0 });
  }
  for (const award of awards) {
    if (award.status !== "won" || !award.winnerCsKey || !award.winnerCsName) continue;
    const row = byCs.get(award.winnerCsKey) ?? { csKey: award.winnerCsKey, csName: award.winnerCsName, wins: 0 };
    row.csName = award.winnerCsName;
    byCs.set(row.csKey, row);
    if (award.excludedReason) continue;
    row.wins++;
  }
  const rows = Array.from(byCs.values()).sort((a, b) => b.wins - a.wins || a.csName.localeCompare(b.csName));
  const winCount = rows[0]?.wins ?? 0;
  const winners = winCount ? rows.filter((row) => row.wins === winCount).map((row) => row.csName) : [];
  return { standings: rows, winCount, winners };
}

export const captureWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId as Id<"organizations">;
    const range = windowRangeForKey(args.windowKey);
    if (range.endAt > Date.now()) return { status: "open" as const };
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", args.windowKey)).unique();
    if (!marker && !args.force) return { status: "pending" as const };

    const { scores, queen, rollups } = await computeWindowStanding(ctx, orgId, args.windowKey);
    const winner = queen ? scores.find((row) => csKey(row.csName) === csKey(queen.csName)) : undefined;
    const value = winner ? {
      status: "won" as const, winnerCsKey: csKey(winner.csName), winnerCsName: winner.csName,
      score: winner.score, leads: rollups.find((row: any) => row.csKey === csKey(winner.csName))?.leadsCust,
      closings: winner.closings, cr: winner.cr, respMedianMs: winner.respMedianMs ?? undefined,
    } : {
      status: "no_winner" as const, winnerCsKey: undefined, winnerCsName: undefined,
      score: undefined, leads: undefined, closings: undefined, cr: undefined, respMedianMs: undefined,
    };
    const existing = await ctx.db.query("queenAwards")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", args.windowKey)).unique();
    const record = { ...value, sealedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, record);
    else await ctx.db.insert("queenAwards", { orgId, windowKey: args.windowKey, ...record });
    return { status: value.status, winnerCsName: winner?.csName ?? null };
  },
});

const queenScoreValidator = v.object({
  csName: v.string(),
  score: v.number(),
  eligible: v.boolean(),
  cr: v.number(),
  closings: v.number(),
  respMedianMs: v.union(v.number(), v.null()),
  crWpts: v.number(),
  closeWpts: v.number(),
  speedWpts: v.number(),
});

export const getDailyStanding = query({
  args: { businessDate: v.string() },
  returns: v.object({
    winnerCsName: v.union(v.string(), v.null()),
    scores: v.array(queenScoreValidator),
    sealed: v.boolean(),
    excludedReason: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!isBusinessDate(args.businessDate)) {
      throw new Error("businessDate must be YYYY-MM-DD");
    }
    const { orgId } = await requireMemberOrg(ctx, "queens.getDailyStanding");
    const windowKey = windowKeyForBusinessDate(args.businessDate);
    const exclusion = queenExclusionForDate(args.businessDate);
    const [{ scores, queen }, award] = await Promise.all([
      computeWindowStanding(ctx, orgId, windowKey),
      ctx.db.query("queenAwards")
        .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", windowKey))
        .unique(),
    ]);
    return {
      winnerCsName: exclusion
        ? null
        : award
        ? award.status === "won" ? award.winnerCsName ?? null : null
        : queen?.csName ?? null,
      scores,
      sealed: award !== null,
      excludedReason: exclusion?.label ?? null,
    };
  },
});

export const rebuildThenCaptureWindow = internalAction({
  args: { orgId: v.string(), windowKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    const rebuilt: any = await ctx.runMutation(internal.rollups.recomputeWindow, args);
    if (!rebuilt.done) {
      await ctx.scheduler.runAfter(0, internal.queens.rebuildThenCaptureWindow, args);
      return { status: "rebuilding" };
    }
    return ctx.runMutation(internal.queens.captureWindow, args);
  },
});

export const captureClosedWindows = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page: any = await ctx.runQuery(internal.orgs.listOrgPageInternal, { cursor: args.cursor });
    const windowKey = closedWindowKey();
    for (const org of page.page) await ctx.scheduler.runAfter(0, internal.queens.captureWindow, { orgId: String(org._id), windowKey });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.queens.captureClosedWindows, { cursor: page.continueCursor });
    return { windowKey, scheduled: page.page.length, done: page.isDone };
  },
});

export const getMonth = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "queens.getMonth");
    const bounds = monthBounds(args.month);
    const sourceFirst = windowKeyForBusinessDate(bounds.first);
    const sourceAfterLast = windowKeyForBusinessDate(bounds.afterLast);
    const [rows, configs] = await Promise.all([
      ctx.db.query("queenAwards")
        .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).gte("windowKey", sourceFirst).lt("windowKey", sourceAfterLast)).collect(),
      ctx.db.query("csConfigs")
        .withIndex("by_org_active", (q) => q.eq("orgId", orgId).eq("isActive", true)).collect(),
    ]);
    const awards = rows.map(({ windowKey, status, winnerCsKey, winnerCsName, score, leads, closings, cr, respMedianMs }) => {
      const businessDate = businessDateKeyForWindowKey(windowKey);
      return {
        windowKey: businessDate, status, winnerCsKey, winnerCsName, score, leads, closings, cr, respMedianMs,
        excludedReason: queenExclusionForDate(businessDate)?.label,
      };
    }).sort((a, b) => a.windowKey.localeCompare(b.windowKey));
    const participants = configs.filter((config) => config.reportingEnabled).map((config) => ({
      csKey: csKey(config.csName),
      csName: config.csName,
    }));
    const sourceLast = windowKeyFor(windowRangeForKey(sourceAfterLast).startAt - 1);
    const lastClosed = closedWindowKey();
    const expectedInMonth = keysInRange(sourceFirst, lastClosed < sourceLast ? lastClosed : sourceLast);
    const knownSourceKeys = new Set(rows.map((row) => row.windowKey));
    const currentBusinessDate = businessDateKeyForWindowKey(windowKeyToday());
    const closedBusinessDate = businessDateKeyForWindowKey(lastClosed);
    const weekly = monthWeeks(args.month).map((week) => ({
      ...week,
      weekStart: week.startKey,
      status: closedBusinessDate >= week.endKey
        ? "complete" as const
        : currentBusinessDate >= week.startKey && currentBusinessDate <= week.endKey
          ? "running" as const
          : "upcoming" as const,
      ...standings(awards.filter((award) => award.windowKey >= week.startKey && award.windowKey <= week.endKey), participants),
    }));
    return { awards, monthly: standings(awards, participants), weekly, setupNeeded: expectedInMonth.some((key) => !knownSourceKeys.has(key)) };
  },
});

async function queueMonth(ctx: MutationCtx, orgId: Id<"organizations">, month: string) {
    const bounds = monthBounds(month);
    const sourceFirst = windowKeyForBusinessDate(bounds.first);
    const sourceAfterLast = windowKeyForBusinessDate(bounds.afterLast);
    const existing = await ctx.db.query("queenAwards")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).gte("windowKey", sourceFirst).lt("windowKey", sourceAfterLast)).collect();
    const known = new Set(existing.map((row) => row.windowKey));
    const sourceLast = windowKeyFor(windowRangeForKey(sourceAfterLast).startAt - 1);
    const lastClosed = closedWindowKey();
    const missing = keysInRange(sourceFirst, lastClosed < sourceLast ? lastClosed : sourceLast).filter((windowKey) => !known.has(windowKey));
    // Historical Queen snapshots use the already-published daily rollups. Rebuilding every
    // historical window here is both slow and needlessly expensive; the normal rollup/reconciler
    // pipeline remains the source that maintains those rows.
    for (const windowKey of missing) await ctx.scheduler.runAfter(0, internal.queens.captureWindow, { orgId: String(orgId), windowKey, force: true });
    return { scheduled: missing.length, month };
}

export const queueMonthBackfill = mutation({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "queens.queueMonthBackfill");
    return queueMonth(ctx, orgId, args.month);
  },
});

// Compatibility for the previous frontend during a rolling Convex/Vercel deploy.
export const queueCurrentMonthBackfill = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "queens.queueCurrentMonthBackfill");
    return queueMonth(ctx, orgId, businessDateKeyForWindowKey(windowKeyToday()).slice(0, 7));
  },
});
