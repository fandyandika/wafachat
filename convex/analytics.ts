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
