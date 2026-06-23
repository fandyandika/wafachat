import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone } from "./lib";
import { normalizeCsName, canonicalizeProduct } from "./shippingRecaps";

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
    const p = canonicalizeProduct(o.productName || o.products);
    leads.set(p, (leads.get(p) ?? 0) + 1);
  }
  for (const r of recaps) {
    const p = canonicalizeProduct(r.packageContent);
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
    const label = `Pekan ${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
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

type ProductAcc = { leads: Set<string>; closings: Set<string> };
type CsReportAcc = {
  leads: Set<string>; closings: Set<string>;
  revenue: number; discount: number; rawLeads: number;
  products: Map<string, ProductAcc>;
};

// Daily CS report on a 16:00→16:00 WIB window. Mirrors computeCsAgg's dedup/exclusion
// rules exactly (so totals match the Performance page), adding discount + per-CS×product
// nesting + a duplicate-phone count (a judging aid for the CS-reported "Mis Rep").
export const getDailyReport = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    const orders = (
      await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
    const recaps = (
      await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt)).collect()
    ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

    // Resolve a closing's product to the matched in-window order's name (anti-fragmentation),
    // falling back to the recap's own packageContent.
    const latestOrderByPhone = new Map<string, any>();
    for (const o of orders) {
      const p = normalizePhone(o.customerPhone);
      const ex = latestOrderByPhone.get(p);
      if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
    }

    // Cross-window order lookup: a closing whose lead isn't in THIS window (lead created on an
    // earlier day) has no in-window order to name its product, so it would fall back to the
    // recap's SKU packageContent ("QURAN MAPPING 1 PCS") and fragment from the canonical lead
    // name ("Quran Mapping"). Fetch the real order (by Berdu order id, else latest by phone) to
    // canonicalize. Counts (leads/closings) are unaffected — this only resolves the product name.
    // Collect the unique phones needing a fallback lookup (first recap per phone wins), then
    // fetch them ALL in parallel — a sequential await-loop here was an N+1 that slowed this query.
    const fbNeeded: Array<{ phone: string; orderIdBerdu?: string }> = [];
    const fbSeen = new Set<string>();
    for (const r of recaps) {
      const phone = normalizePhone(r.customerPhone);
      if (latestOrderByPhone.has(phone) || fbSeen.has(phone)) continue;
      fbSeen.add(phone);
      fbNeeded.push({ phone, orderIdBerdu: r.orderIdBerdu });
    }
    const fbResults = await Promise.all(
      fbNeeded.map(async ({ phone, orderIdBerdu }) => {
        let order: any = null;
        if (orderIdBerdu) {
          order = await ctx.db.query("orders").withIndex("by_orderId", (q: any) => q.eq("orderId", orderIdBerdu)).unique();
        }
        if (!order) {
          const all = await ctx.db.query("orders").withIndex("by_customerPhone", (q: any) => q.eq("customerPhone", phone)).collect();
          order = all.sort((a: any, b: any) => b.createdAt - a.createdAt)[0] ?? null;
        }
        return { phone, order };
      }),
    );
    const fallbackOrderByPhone = new Map<string, any>();
    for (const { phone, order } of fbResults) if (order) fallbackOrderByPhone.set(phone, order);

    const map = new Map<string, CsReportAcc>();
    const getCs = (cs: string): CsReportAcc => {
      let a = map.get(cs);
      if (!a) { a = { leads: new Set(), closings: new Set(), revenue: 0, discount: 0, rawLeads: 0, products: new Map() }; map.set(cs, a); }
      return a;
    };
    const getProd = (a: CsReportAcc, prod: string): ProductAcc => {
      let p = a.products.get(prod);
      if (!p) { p = { leads: new Set(), closings: new Set() }; a.products.set(prod, p); }
      return p;
    };

    for (const o of orders) {
      const a = getCs(o.assignedCsName);
      a.rawLeads += 1;
      const phone = normalizePhone(o.customerPhone);
      a.leads.add(phone);
      getProd(a, canonicalizeProduct(o.productName || o.products)).leads.add(phone);
    }
    for (const r of recaps) {
      const a = getCs(r.csName);
      const key = r.orderIdBerdu || normalizePhone(r.customerPhone);
      a.closings.add(key);
      a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      a.discount += r.discount ?? 0;
      const cphone = normalizePhone(r.customerPhone);
      const matched = latestOrderByPhone.get(cphone) ?? fallbackOrderByPhone.get(cphone);
      getProd(a, canonicalizeProduct(matched?.productName || matched?.products || r.packageContent)).closings.add(key);
    }

    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cpd = (disc: number, c: number) => (c > 0 ? Math.round(disc / c) : 0);

    const cs = Array.from(map.entries())
      .map(([rawName, a]) => {
        const leads = a.leads.size, closings = a.closings.size;
        const products = Array.from(a.products.entries())
          .map(([product, p]) => ({ product, leads: p.leads.size, closings: p.closings.size, cr: cr(p.closings.size, p.leads.size) }))
          .filter((p) => p.leads > 0 || p.closings > 0)
          .sort((x, y) => y.leads - x.leads || x.product.localeCompare(y.product));
        return {
          csName: normalizeCsName(rawName),
          leads, closings, cr: cr(closings, leads),
          revenue: a.revenue, discount: a.discount, cpDiscount: cpd(a.discount, closings),
          duplicates: a.rawLeads - leads,
          products,
        };
      })
      .filter((c) => c.leads > 0 || c.closings > 0)
      .sort((x, y) => y.closings - x.closings || y.leads - x.leads);

    // Grand totals: global union dedup (matches getPeriodReport totals semantics).
    const gLeads = new Set<string>(), gClos = new Set<string>();
    let gRevenue = 0, gDiscount = 0, gRawLeads = 0;
    for (const o of orders) { gRawLeads += 1; gLeads.add(normalizePhone(o.customerPhone)); }
    for (const r of recaps) {
      gClos.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
      gRevenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      gDiscount += r.discount ?? 0;
    }

    return {
      windowStart: args.startAt, windowEnd: args.endAt,
      totals: {
        leads: gLeads.size, closings: gClos.size, cr: cr(gClos.size, gLeads.size),
        revenue: gRevenue, discount: gDiscount, cpDiscount: cpd(gDiscount, gClos.size),
        duplicates: gRawLeads - gLeads.size,
      },
      cs,
    };
  },
});
