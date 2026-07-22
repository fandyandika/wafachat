import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireAdminOrg } from "./authz";
import { csKey, windowKeyFor, windowRangeForKey, windowKeyToday } from "./lib";
import { responseTimesFromSamples } from "./rollupReaders";
import { computeQueenCs, computeQueenScores } from "../lib/queen";

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
};

function nextWindowKey(key: string) {
  return windowKeyFor(windowRangeForKey(key).endAt);
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

function weekStartKey(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function standings(awards: Award[]) {
  const byCs = new Map<string, { csKey: string; csName: string; wins: number }>();
  for (const award of awards) {
    if (award.status !== "won" || !award.winnerCsKey || !award.winnerCsName) continue;
    const row = byCs.get(award.winnerCsKey) ?? { csKey: award.winnerCsKey, csName: award.winnerCsName, wins: 0 };
    row.csName = award.winnerCsName;
    row.wins++;
    byCs.set(row.csKey, row);
  }
  const rows = Array.from(byCs.values()).sort((a, b) => b.wins - a.wins || a.csName.localeCompare(b.csName));
  const winCount = rows[0]?.wins ?? 0;
  return { standings: rows, winCount, winners: winCount ? rows.filter((row) => row.wins === winCount).map((row) => row.csName) : [] };
}

export const captureWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: async (ctx, args) => {
    const orgId = args.orgId as Id<"organizations">;
    const range = windowRangeForKey(args.windowKey);
    if (range.endAt > Date.now()) return { status: "open" as const };
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", args.windowKey)).unique();
    if (!marker) return { status: "pending" as const };

    const [rollups, response] = await Promise.all([
      ctx.db.query("dailyRollups")
        .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", args.windowKey)).collect(),
      responseTimesFromSamples(ctx, orgId, range),
    ]);
    const responseByCs = new Map(response.cs.map((row) => [csKey(row.csName), row]));
    const inputs = rollups.map((row) => {
      const responseRow = responseByCs.get(row.csKey);
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
    const queen = computeQueenCs(inputs);
    const winner = queen ? scores.find((row) => csKey(row.csName) === csKey(queen.csName)) : undefined;
    const value = winner ? {
      status: "won" as const, winnerCsKey: csKey(winner.csName), winnerCsName: winner.csName,
      score: winner.score, leads: rollups.find((row) => row.csKey === csKey(winner.csName))?.leadsCust,
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
    const rows = await ctx.db.query("queenAwards")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).gte("windowKey", bounds.first).lt("windowKey", bounds.afterLast)).collect();
    const awards = rows.map(({ windowKey, status, winnerCsKey, winnerCsName, score, leads, closings, cr, respMedianMs }) => (
      { windowKey, status, winnerCsKey, winnerCsName, score, leads, closings, cr, respMedianMs }
    )).sort((a, b) => a.windowKey.localeCompare(b.windowKey));
    const monthLast = windowKeyFor(windowRangeForKey(bounds.afterLast).startAt - 1);
    const expectedInMonth = keysInRange(bounds.first, closedWindowKey() < monthLast ? closedWindowKey() : monthLast);
    const byWeek = new Map<string, Award[]>();
    for (const award of awards) {
      const week = weekStartKey(award.windowKey);
      byWeek.set(week, [...(byWeek.get(week) ?? []), award]);
    }
    const weekly = Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, weekAwards]) => ({ weekStart, ...standings(weekAwards) }));
    return { awards, monthly: standings(awards), weekly, setupNeeded: expectedInMonth.some((key) => !awards.some((award) => award.windowKey === key)) };
  },
});

export const queueCurrentMonthBackfill = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "queens.queueCurrentMonthBackfill");
    const key = closedWindowKey();
    const month = key.slice(0, 7);
    const bounds = monthBounds(month);
    const existing = await ctx.db.query("queenAwards")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).gte("windowKey", bounds.first).lt("windowKey", bounds.afterLast)).collect();
    const known = new Set(existing.map((row) => row.windowKey));
    const missing = keysInRange(bounds.first, key).filter((windowKey) => !known.has(windowKey));
    for (const windowKey of missing) await ctx.scheduler.runAfter(0, internal.queens.captureWindow, { orgId: String(orgId), windowKey });
    return { scheduled: missing.length, month };
  },
});
