import { query, internalQuery } from "./_generated/server";
import { requireMember, requireMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone, csKey, canonicalizeProduct, startOfJakartaDayMs } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { dailyReportFromRollups, leaderboardFromRollups, productDifficultyFromRollups, periodReportFromRollups } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";
import { requireDefaultOrgId } from "./orgs";

// leads/closedCust are keyed by customer PHONE (unique customers); closings by ORDER
// (orderIdBerdu) — order-level is right for volume + revenue (a double-ordering customer
// really did buy twice) but WRONG for CR: 2 closings over 1 lead inflates the rate. CR
// must therefore use closedCust/leads (same unit: customers).
type CsAgg = { leads: Set<string>; closings: Set<string>; closedCust: Set<string>; revenue: number; rawCounts: Map<string, number> };

async function computeCsAgg(ctx: any, orgId: Id<"organizations">, startAt: number, endAt: number, csName?: string): Promise<Map<string, CsAgg>> {
  const internalPhones = await getInternalPhoneSet(ctx);
  const key = csName ? csKey(csName) : null;
  const orders = (
    await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones) && (!key || csKey(o.assignedCsName) === key));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone, internalPhones) && (!key || csKey(r.csName) === key));

  // Group by csKey so a CS's raw name-forms ("Aisyah"/"CS Aisyah") merge into one row.
  const map = new Map<string, CsAgg>();
  const get = (cs: string) => {
    const k = csKey(cs);
    let a = map.get(k);
    if (!a) { a = { leads: new Set(), closings: new Set(), closedCust: new Set(), revenue: 0, rawCounts: new Map() }; map.set(k, a); }
    a.rawCounts.set(cs, (a.rawCounts.get(cs) ?? 0) + 1);
    return a;
  };
  for (const o of orders) get(o.assignedCsName).leads.add(normalizePhone(o.customerPhone));
  for (const r of recaps) {
    const a = get(r.csName);
    a.closings.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
    a.closedCust.add(normalizePhone(r.customerPhone));
    a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
  }
  return map;
}

// Dominant raw name-form for a merged CsAgg, for display (normalizeCsName applied by caller).
function aggName(a: CsAgg): string {
  return Array.from(a.rawCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
}

export async function computeCsLeaderboardRaw(ctx: any, orgId: Id<"organizations">, args: { startAt: number; endAt: number; csName?: string }) {
    const len = args.endAt - args.startAt;
    const cur = await computeCsAgg(ctx, orgId, args.startAt, args.endAt, args.csName);
    const prev = await computeCsAgg(ctx, orgId, args.startAt - len, args.startAt - 1, args.csName);
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const keys = Array.from(new Set(Array.from(cur.keys()).concat(Array.from(prev.keys()))));
    const rows = keys.map((k) => {
      const empty = (): CsAgg => ({ leads: new Set(), closings: new Set(), closedCust: new Set(), revenue: 0, rawCounts: new Map() });
      const c = cur.get(k) ?? empty();
      const p = prev.get(k) ?? empty();
      const csName = aggName(cur.get(k) ?? prev.get(k)!); // dominant raw form (display unchanged from before)
      const leads = c.leads.size, closings = c.closings.size;
      const prevLeads = p.leads.size, prevClosings = p.closings.size;
      // CR in customer units on both sides (order double must not inflate the rate).
      const crNow = cr(c.closedCust.size, leads), prevCr = cr(p.closedCust.size, prevLeads);
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
}

export const getCsLeaderboard = query({
  // raw=true → calendar-day / any-range raw computation (cheap for a small "today" slice);
  // omitted/false → rollup reader (whole 16:00-windows). Same output shape either way.
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()), raw: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getCsLeaderboard");
    return args.raw ? computeCsLeaderboardRaw(ctx, orgId, args) : leaderboardFromRollups(ctx, orgId, args);
  },
});

async function computeProductAgg(ctx: any, orgId: Id<"organizations">, startAt: number, endAt: number, csName?: string) {
  const internalPhones = await getInternalPhoneSet(ctx);
  const key = csName ? csKey(csName) : null;
  const orders = (
    await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones) && (!key || csKey(o.assignedCsName) === key));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone, internalPhones) && (!key || csKey(r.csName) === key));

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
  args: { startAt: v.number(), endAt: v.number(), minLeads: v.optional(v.number()), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getProductDifficulty");
    return productDifficultyFromRollups(ctx, orgId, args);
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
  args: { period: v.union(v.literal("week"), v.literal("month")), anchor: v.optional(v.number()), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getPeriodReport");
    return periodReportFromRollups(ctx, orgId, args);
  },
});

type ProductAcc = { leads: Set<string>; closings: Set<string> };
type CsReportAcc = {
  leads: Set<string>; closings: Set<string>; closedCust: Set<string>;
  revenue: number; discount: number; rawLeads: number;
  products: Map<string, ProductAcc>;
  rawCounts: Map<string, number>; // raw name-forms seen -> pick the dominant for display
};

// Self-check drill-down for ONE CS in a window: the exact rows behind the card's
// "Total Leads / Total Closing" numbers, so a CS can reconcile their own manual
// count ("saya 20, panel 19") without the owner tracing it by hand. Also surfaces
// the two most common discrepancy causes we CAN see: cancelled recaps (excluded
// from the count) and closings just OUTSIDE the window (they landed in the
// neighboring 16:00 period). Fetched on-demand only (drawer open) — index-bounded
// reads, zero standing subscriptions.
export const getCsDetail = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getCsDetail");
    const internalPhones = await getInternalPhoneSet(ctx);
    const k = csKey(args.csName);
    const BOUNDARY_MS = 6 * 60 * 60 * 1000; // neighbor-period peek on each side

    const orders = (
      await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lte("createdAt", args.endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones) && csKey(o.assignedCsName) === k);

    // One index read covers the window AND both boundary peeks.
    const recapsAll = (
      await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", args.startAt - BOUNDARY_MS).lte("closedAt", args.endAt + BOUNDARY_MS)).collect()
    ).filter((r: any) => !isInternalTestPhone(r.customerPhone, internalPhones) && csKey(r.csName) === k);

    const inWin = (r: any) => r.closedAt >= args.startAt && r.closedAt <= args.endAt;
    const isCancelled = (s: string) => s === "cancelled" || s === "cancelled_after_export";
    const money = (r: any) => r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;

    // Canonical product per closing (same rule as the card's product breakdown): prefer the
    // matched in-window order's name over the recap's SKU text — uses orders already fetched,
    // zero extra reads. Lets the sheet group rows per product without name fragmentation.
    const latestOrderByPhone = new Map<string, any>();
    for (const o of orders) {
      const p = normalizePhone(o.customerPhone);
      const ex = latestOrderByPhone.get(p);
      if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
    }
    const productOf = (r: any) => {
      const mo = latestOrderByPhone.get(normalizePhone(r.customerPhone));
      return canonicalizeProduct(mo?.productName || mo?.products || r.packageContent);
    };

    // Counted closings: dedup by the SAME key the card count uses (orderIdBerdu || phone),
    // keeping the latest row, so list length always equals the card's Total Closing.
    const byKey = new Map<string, any>();
    for (const r of recapsAll.filter((r: any) => inWin(r) && !isCancelled(r.status))) {
      const kk = r.orderIdBerdu || normalizePhone(r.customerPhone);
      const ex = byKey.get(kk);
      if (!ex || r.closedAt > ex.closedAt) byKey.set(kk, r);
    }
    const closings = Array.from(byKey.values())
      .sort((a, b) => a.closedAt - b.closedAt)
      .map((r) => ({
        closedAt: r.closedAt,
        customerName: r.customerName || "-",
        customerPhone: r.customerPhone,
        orderIdBerdu: r.orderIdBerdu ?? null,
        product: productOf(r),
        total: money(r),
        payment: r.paymentMethod ?? null,
      }));

    const excludedCancelled = recapsAll
      .filter((r: any) => inWin(r) && isCancelled(r.status))
      .sort((a: any, b: any) => a.closedAt - b.closedAt)
      .map((r: any) => ({ closedAt: r.closedAt, customerName: r.customerName || "-", orderIdBerdu: r.orderIdBerdu ?? null }));

    const boundary = recapsAll
      .filter((r: any) => !inWin(r) && !isCancelled(r.status))
      .sort((a: any, b: any) => a.closedAt - b.closedAt)
      .map((r: any) => ({
        closedAt: r.closedAt,
        customerName: r.customerName || "-",
        orderIdBerdu: r.orderIdBerdu ?? null,
        when: r.closedAt < args.startAt ? ("before" as const) : ("after" as const),
      }));

    // Leads: every order row (the raw Berdu count), with a per-customer order count so
    // doubles are visible; unique-customer count matches the card's Total Leads.
    const perPhone = new Map<string, number>();
    for (const o of orders) { const p = normalizePhone(o.customerPhone); perPhone.set(p, (perPhone.get(p) ?? 0) + 1); }
    const leads = orders
      .sort((a: any, b: any) => a.createdAt - b.createdAt)
      .map((o: any) => ({
        createdAt: o.createdAt,
        customerName: o.customerName || "-",
        customerPhone: o.customerPhone,
        orderId: o.orderId,
        product: canonicalizeProduct(o.productName || o.products),
        orderCount: perPhone.get(normalizePhone(o.customerPhone)) ?? 1,
      }));

    return {
      closings,
      excludedCancelled,
      boundary,
      leads,
      counts: { closings: closings.length, leadsUnique: perPhone.size, leadOrders: orders.length },
    };
  },
});

// Daily CS report on a 16:00→16:00 WIB window. Mirrors computeCsAgg's dedup/exclusion
// rules exactly (so totals match the Performance page), adding discount + per-CS×product
// nesting + a duplicate-phone count (a judging aid for the CS-reported "Mis Rep").
export async function computeDailyReportRaw(ctx: any, orgId: Id<"organizations">, startAt: number, endAt: number) {
    const internalPhones = await getInternalPhoneSet(ctx);
    const orders = (
      await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lte("createdAt", endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones));
    const recaps = (
      await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lte("closedAt", endAt)).collect()
    ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone, internalPhones));

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
          order = await ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", orderIdBerdu)).unique();
        }
        if (!order) {
          const all = await ctx.db.query("orders").withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", phone)).collect();
          order = all.sort((a: any, b: any) => b.createdAt - a.createdAt)[0] ?? null;
        }
        return { phone, order };
      }),
    );
    const fallbackOrderByPhone = new Map<string, any>();
    for (const { phone, order } of fbResults) if (order) fallbackOrderByPhone.set(phone, order);

    // Group by csKey (canonical) so raw name-forms of one CS ("Aisyah" vs "CS Aisyah")
    // MERGE into a single card instead of fragmenting into duplicates (which also
    // collided on the React key). Display uses the dominant raw form via normalizeCsName.
    const map = new Map<string, CsReportAcc>();
    const getCs = (cs: string): CsReportAcc => {
      const k = csKey(cs);
      let a = map.get(k);
      if (!a) { a = { leads: new Set(), closings: new Set(), closedCust: new Set(), revenue: 0, discount: 0, rawLeads: 0, products: new Map(), rawCounts: new Map() }; map.set(k, a); }
      a.rawCounts.set(cs, (a.rawCounts.get(cs) ?? 0) + 1);
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
      a.closedCust.add(normalizePhone(r.customerPhone));
      a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      a.discount += r.discount ?? 0;
      const cphone = normalizePhone(r.customerPhone);
      const matched = latestOrderByPhone.get(cphone) ?? fallbackOrderByPhone.get(cphone);
      getProd(a, canonicalizeProduct(matched?.productName || matched?.products || r.packageContent)).closings.add(key);
    }

    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cpd = (disc: number, c: number) => (c > 0 ? Math.round(disc / c) : 0);

    const cs = Array.from(map.entries())
      .map(([, a]) => {
        const rawName = Array.from(a.rawCounts.entries()).sort((x, y) => y[1] - x[1])[0][0];
        const leads = a.leads.size, closings = a.closings.size;
        const products = Array.from(a.products.entries())
          .map(([product, p]) => ({ product, leads: p.leads.size, closings: p.closings.size, cr: cr(p.closings.size, p.leads.size) }))
          .filter((p) => p.leads > 0 || p.closings > 0)
          .sort((x, y) => y.leads - x.leads || x.product.localeCompare(y.product));
        return {
          csName: normalizeCsName(rawName),
          // CR in customer units (closedCust/leads) — an order double closing twice must
          // not inflate the rate. closings stays order-level (volume + revenue).
          leads, closings, cr: cr(a.closedCust.size, leads),
          revenue: a.revenue, discount: a.discount, cpDiscount: cpd(a.discount, closings),
          duplicates: a.rawLeads - leads,
          products,
        };
      })
      .filter((c) => c.leads > 0 || c.closings > 0)
      .sort((x, y) => y.closings - x.closings || y.leads - x.leads);

    // Grand totals: global union dedup (matches getPeriodReport totals semantics).
    const gLeads = new Set<string>(), gClos = new Set<string>(), gClosedCust = new Set<string>();
    let gRevenue = 0, gDiscount = 0, gRawLeads = 0;
    for (const o of orders) { gRawLeads += 1; gLeads.add(normalizePhone(o.customerPhone)); }
    for (const r of recaps) {
      gClos.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
      gClosedCust.add(normalizePhone(r.customerPhone));
      gRevenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      gDiscount += r.discount ?? 0;
    }

    return {
      windowStart: startAt, windowEnd: endAt,
      totals: {
        leads: gLeads.size, closings: gClos.size, cr: cr(gClosedCust.size, gLeads.size),
        revenue: gRevenue, discount: gDiscount, cpDiscount: cpd(gDiscount, gClos.size),
        duplicates: gRawLeads - gLeads.size,
      },
      cs,
    };
}

// Owner "Live Hari Ini" — calendar-day (midnight WIB → now), raw bounded read of today's
// slice (cheap; NOT the 16:00 CS-report window, NOT the whole-history scan). On-demand page.
// TODO(SaaS §14): midnight boundary + timezone become per-org settings.
export const getLiveToday = query({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getLiveToday");
    const now = args.nowMs ?? Date.now();
    const startAt = startOfJakartaDayMs(now);
    return computeDailyReportRaw(ctx, orgId, startAt, now);
  },
});

export const getDailyReport = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "analytics.getDailyReport");
    return dailyReportFromRollups(ctx, orgId, args);
  },
});
