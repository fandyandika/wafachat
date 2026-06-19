import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone } from "./lib";
import { normalizeProductName } from "./shippingRecaps";

type CsAgg = { leads: Set<string>; closings: Set<string>; revenue: number };

async function computeCsAgg(ctx: any, startAt: number, endAt: number): Promise<Map<string, CsAgg>> {
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

  const map = new Map<string, CsAgg>();
  const get = (cs: string) => {
    let a = map.get(cs);
    if (!a) { a = { leads: new Set(), closings: new Set(), revenue: 0 }; map.set(cs, a); }
    return a;
  };
  for (const o of orders) get(o.assignedCsName).leads.add(normalizePhone(o.customerPhone));
  for (const r of recaps) {
    const a = get(r.csName);
    a.closings.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
    a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
  }
  return map;
}

export const getCsLeaderboard = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    const len = args.endAt - args.startAt;
    const cur = await computeCsAgg(ctx, args.startAt, args.endAt);
    const prev = await computeCsAgg(ctx, args.startAt - len, args.startAt - 1);
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const names = Array.from(new Set(Array.from(cur.keys()).concat(Array.from(prev.keys()))));
    const rows = names.map((csName) => {
      const c = cur.get(csName) ?? { leads: new Set(), closings: new Set(), revenue: 0 };
      const p = prev.get(csName) ?? { leads: new Set(), closings: new Set(), revenue: 0 };
      const leads = c.leads.size, closings = c.closings.size;
      const prevLeads = p.leads.size, prevClosings = p.closings.size;
      const crNow = cr(closings, leads), prevCr = cr(prevClosings, prevLeads);
      return {
        csName, leads, closings, cr: crNow, revenue: c.revenue,
        prevLeads, prevClosings, prevCr,
        deltaLeads: leads - prevLeads,
        deltaClosings: closings - prevClosings,
        deltaCr: Math.round((crNow - prevCr) * 10) / 10,
      };
    });
    rows.sort((a, b) => b.closings - a.closings || b.leads - a.leads);
    return rows;
  },
});

async function computeProductAgg(ctx: any, startAt: number, endAt: number) {
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

  const leads = new Map<string, number>();
  const closings = new Map<string, Set<string>>();
  for (const o of orders) {
    const p = normalizeProductName(o.productName || o.products);
    leads.set(p, (leads.get(p) ?? 0) + 1);
  }
  for (const r of recaps) {
    const p = normalizeProductName(r.packageContent);
    const s = closings.get(p) ?? new Set<string>();
    s.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
    closings.set(p, s);
  }
  return { leads, closings };
}

export const getProductDifficulty = query({
  args: { startAt: v.number(), endAt: v.number(), minLeads: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const minLeads = args.minLeads ?? 3;
    const len = args.endAt - args.startAt;
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cur = await computeProductAgg(ctx, args.startAt, args.endAt);
    const prev = await computeProductAgg(ctx, args.startAt - len, args.startAt - 1);
    const rows = Array.from(cur.leads.entries())
      .filter(([, leads]) => leads >= minLeads)
      .map(([productName, leads]) => {
        const closings = cur.closings.get(productName)?.size ?? 0;
        const prevLeads = prev.leads.get(productName) ?? 0;
        const prevClosings = prev.closings.get(productName)?.size ?? 0;
        const crNow = cr(closings, leads), prevCr = cr(prevClosings, prevLeads);
        return { productName, leads, closings, cr: crNow, prevCr, deltaCr: Math.round((crNow - prevCr) * 10) / 10 };
      });
    rows.sort((a, b) => a.cr - b.cr || b.leads - a.leads);
    return rows;
  },
});

const JAK_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
function startOfJakartaDay(ts: number) {
  return Math.floor((ts + JAK_MS) / DAY_MS) * DAY_MS - JAK_MS;
}
function periodRange(period: "week" | "month", anchor: number): { start: number; end: number; prevStart: number; prevEnd: number; label: string } {
  const dayStart = startOfJakartaDay(anchor);
  const jak = new Date(dayStart + JAK_MS); // Jakarta wall-clock midnight of anchor's day
  if (period === "week") {
    const dow = jak.getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7;
    const start = dayStart - mondayOffset * DAY_MS;
    const end = start + 7 * DAY_MS - 1;
    const mon = new Date(start + JAK_MS);
    const label = `Minggu ${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
    return { start, end, prevStart: start - 7 * DAY_MS, prevEnd: start - 1, label };
  }
  const y = jak.getUTCFullYear(), m = jak.getUTCMonth();
  const start = Date.UTC(y, m, 1) - JAK_MS;
  const end = Date.UTC(y, m + 1, 1) - JAK_MS - 1;
  const prevStart = Date.UTC(y, m - 1, 1) - JAK_MS;
  const label = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end, prevStart, prevEnd: start - 1, label };
}

export const getPeriodReport = query({
  args: { period: v.union(v.literal("week"), v.literal("month")), anchor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { start, end, prevStart, prevEnd, label } = periodRange(args.period, args.anchor ?? Date.now());
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cur = await computeCsAgg(ctx, start, end);
    const prev = await computeCsAgg(ctx, prevStart, prevEnd);
    const totals = (m: Map<string, CsAgg>) => {
      const leads = new Set<string>(), closings = new Set<string>();
      let revenue = 0;
      m.forEach((a) => {
        a.leads.forEach((p) => leads.add(p));
        a.closings.forEach((c) => closings.add(c));
        revenue += a.revenue;
      });
      return { leads: leads.size, closings: closings.size, revenue };
    };
    const curT = totals(cur), prevT = totals(prev);
    const cancelled = (
      await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", start).lte("closedAt", end)).collect()
    ).filter((r: any) => (r.status === "cancelled" || r.status === "cancelled_after_export") && !isInternalTestPhone(r.customerPhone)).length;
    const perCs = Array.from(cur.entries())
      .map(([csName, a]) => ({ csName, leads: a.leads.size, closings: a.closings.size, cr: cr(a.closings.size, a.leads.size), revenue: a.revenue }))
      .sort((a, b) => b.closings - a.closings);
    return {
      label, rangeStart: start, rangeEnd: end,
      leads: curT.leads, closings: curT.closings, cr: cr(curT.closings, curT.leads), revenue: curT.revenue, cancelled,
      prevLeads: prevT.leads, prevClosings: prevT.closings, prevCr: cr(prevT.closings, prevT.leads), prevRevenue: prevT.revenue,
      perCs,
    };
  },
});
