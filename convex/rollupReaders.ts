import type { Id } from "./_generated/dataModel";
import { windowKeyFor, isWindowAlignedRange, csKey as csKeyOf, normalizePhone, isInternalTestPhone, canonicalizeProduct } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile } from "./responseTimeMath";
import { getInternalPhoneSet } from "./orgSettings";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";
import { assertFallbackLookupBudget, assertPublicAnalyticsRange, collectExactBounded, MAX_RESPONSE_SAMPLES } from "./analyticsBounds";

/**
 * Analytics reader helpers.
 *
 * Identity-sensitive analytics stay on bounded raw reads until stored facts can
 * reproduce global set unions exactly. Response-time samples remain precomputed.
 */

// ── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Generate all window keys from startAt through endAt (inclusive of both).
 * Keys range from windowKeyFor(startAt) through windowKeyFor(endAt - 1).
 */
function windowKeysForRange(startAt: number, endAt: number): string[] {
  const keys: string[] = [];
  let current = windowKeyFor(startAt);
  const end = windowKeyFor(endAt - 1);
  while (current <= end) {
    keys.push(current);
    // Increment by one day
    const [y, m, d] = current.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + 1));
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const nd = String(date.getUTCDate()).padStart(2, "0");
    current = `${ny}-${nm}-${nd}`;
  }
  return keys;
}

// ── 1. Response Times from Samples ──────────────────────────────────────────

export async function responseTimesFromSamples(
  ctx: any,
  orgId: Id<"organizations">,
  args: { startAt: number; endAt: number; csName?: string }
) {
  assertPublicAnalyticsRange(args.startAt, args.endAt, "responseTime.getResponseTimes");
  // Fetch samples in range, sorted by createdAt
  const samples = (
    await ctx.db
      .query("responseSamples")
      .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lt("createdAt", args.endAt))
      .take(MAX_RESPONSE_SAMPLES + 1)
  ).sort((a: any, b: any) => a.createdAt - b.createdAt);
  if (samples.length > MAX_RESPONSE_SAMPLES) {
    throw new Error(`responseTime.getResponseTimes samples: exact row cap ${MAX_RESPONSE_SAMPLES} exceeded; narrow the requested range`);
  }

  // Group by conversationId, preserving order (ALL samples, no filter - need global overall stats)
  const byConv = new Map<string, typeof samples>();
  const convOrder: string[] = [];
  for (const s of samples) {
    const cKey = String(s.conversationId);
    if (!byConv.has(cKey)) convOrder.push(cKey);
    const arr = byConv.get(cKey) ?? [];
    arr.push(s);
    byConv.set(cKey, arr);
  }

  // Aggregate by csKey (process ALL conversations for overall stats)
  const agg = new Map<string, { rawCounts: Map<string, number>; first: number[]; all: number[]; slaBreaches: number }>();
  const overallFirst: number[] = [];
  let overallSlaBreaches = 0;
  const lastReplyByCs = new Map<string, number>();

  for (const cKey of convOrder) {
    const convSamples = byConv.get(cKey)!;
    if (convSamples.length === 0) continue;

    // First sample in range for this conversation
    const firstSample = convSamples[0];
    const rawCsName = firstSample.csName;
    const ck = csKeyOf(rawCsName);

    let a = agg.get(ck);
    if (!a) {
      a = { rawCounts: new Map(), first: [], all: [], slaBreaches: 0 };
      agg.set(ck, a);
    }
    a.rawCounts.set(rawCsName, (a.rawCounts.get(rawCsName) ?? 0) + 1);

    // First response metric (contributes to both CS and overall)
    if (firstSample.deltaMs !== null) {
      a.first.push(firstSample.deltaMs);
      overallFirst.push(firstSample.deltaMs);
      if (firstSample.slaBreach) {
        a.slaBreaches++;
        overallSlaBreaches++;
      }
    }

    // All responses (including the first) contribute to ongoing
    for (const sample of convSamples) {
      if (sample.deltaMs !== null) {
        a.all.push(sample.deltaMs);
      }
    }

    // Track lastReplyAt (max createdAt in conversation)
    const lastCreatedAt = convSamples[convSamples.length - 1].createdAt;
    const prev = lastReplyByCs.get(ck) ?? 0;
    if (lastCreatedAt > prev) lastReplyByCs.set(ck, lastCreatedAt);
  }

  let cs = Array.from(agg.entries()).map(([ck, a]) => {
    const raw = Array.from(a.rawCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
    return {
      csName: normalizeCsName(raw),
      csNameRaw: raw,
      firstReplyMedianMs: median(a.first),
      firstReplyP90Ms: percentile(a.first, 0.9),
      firstReplyCount: a.first.length,
      ongoingMedianMs: median(a.all),
      ongoingCount: a.all.length,
      slaBreaches: a.slaBreaches,
      lastReplyAt: lastReplyByCs.get(ck) ?? null,
    };
  });

  // Filter by csName if provided (but overall stats remain global)
  if (args.csName) {
    const k = csKeyOf(args.csName);
    cs = cs.filter((c) => csKeyOf(c.csNameRaw) === k);
  }
  cs.sort((x, y) => y.firstReplyCount - x.firstReplyCount);

  return {
    windowStart: args.startAt,
    windowEnd: args.endAt,
    overall: { firstReplyMedianMs: median(overallFirst), firstReplyCount: overallFirst.length, slaBreaches: overallSlaBreaches },
    cs,
  };
}

// ── 6. Raw Product Difficulty ──────────────────────────────────────

export async function productDifficultyFromRaw(
  ctx: any,
  orgId: Id<"organizations">,
  args: { startAt: number; endAt: number; minLeads?: number; csName?: string }
) {
  assertPublicAnalyticsRange(args.startAt, args.endAt, "analytics.getProductDifficulty");
  // Note: This function reads from raw tables like the legacy getProductDifficulty
  // because the rollups byProduct counts distinct customers, not raw orders.
  // getProductDifficulty needs raw order counts per product.

  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const key = args.csName ? csKeyOf(args.csName) : null;
  const minLeads = args.minLeads ?? 3;
  const len = args.endAt - args.startAt;
  const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);

  // Helper to aggregate products from raw tables (counts raw orders for leads, not distinct customers)
  const aggregateFromRawTables = async (startAt: number, endAt: number) => {
    const orders = (
      await collectExactBounded(ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lt("createdAt", endAt)), "analytics.getProductDifficulty orders")
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones) && (!key || csKeyOf(o.assignedCsName) === key));

    const recaps = (
      await collectExactBounded(ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lt("closedAt", endAt)), "analytics.getProductDifficulty recaps")
    ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone, internalPhones) && (!key || csKeyOf(r.csName) === key));

    const leads = new Map<string, number>();
    const closings = new Map<string, Set<string>>();

    for (const o of orders) {
      const p = canonicalizeProduct(o.productName || o.products);
      leads.set(p, (leads.get(p) ?? 0) + 1);  // Raw order count
    }

    for (const r of recaps) {
      const p = canonicalizeProduct(r.packageContent);
      const s = closings.get(p) ?? new Set<string>();
      s.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
      closings.set(p, s);
    }

    return { leads, closings };
  };

  const cur = await aggregateFromRawTables(args.startAt, args.endAt);
  const prev = await aggregateFromRawTables(args.startAt - len, args.startAt);

  const rows = Array.from(cur.leads.entries())
    .filter(([, leads]) => leads >= minLeads)
    .map(([productName, leads]) => {
      const closings = cur.closings.get(productName)?.size ?? 0;
      const prevLeads = prev.leads.get(productName) ?? 0;
      const prevClosings = prev.closings.get(productName)?.size ?? 0;
      const crNow = cr(closings, leads);
      const prevCr = cr(prevClosings, prevLeads);
      return {
        productName,
        leads,
        closings,
        cr: crNow,
        prevCr,
        deltaCr: Math.round((crNow - prevCr) * 10) / 10,
      };
    });

  rows.sort((a, b) => a.cr - b.cr || b.leads - a.leads);
  return rows;
}

export async function areRollupWindowsComplete(ctx: any, orgId: Id<"organizations">, startAt: number, endAt: number, nowMs = Date.now()): Promise<boolean> {
  assertPublicAnalyticsRange(startAt, endAt, "rollup completeness");
  if (!isWindowAlignedRange(startAt, endAt) || endAt > nowMs) return false;
  const keys = windowKeysForRange(startAt, endAt);
  const markers = await Promise.all(keys.map((windowKey) => ctx.db.query("rollupWindows")
    .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey))
    .unique()));
  return markers.every((marker: any) => marker?.schemaVersion === ROLLUP_SCHEMA_VERSION);
}

// ── 7. Raw Period Report ───────────────────────────────────────────

const JAK_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function startOfJakartaDay(ts: number) {
  return Math.floor((ts + JAK_MS) / DAY_MS) * DAY_MS - JAK_MS;
}

function periodRange(period: "week" | "month", anchor: number): { start: number; end: number; prevStart: number; prevEnd: number; label: string } {
  const dayStart = startOfJakartaDay(anchor);
  const jak = new Date(dayStart + JAK_MS);
  if (period === "week") {
    const dow = jak.getUTCDay();
    const mondayOffset = (dow + 6) % 7;
    const start = dayStart - mondayOffset * DAY_MS;
    const end = start + 7 * DAY_MS - 1;
    const mon = new Date(start + JAK_MS);
    const label = `Pekan ${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
    return { start, end, prevStart: start - 7 * DAY_MS, prevEnd: start - 1, label };
  }
  const y = jak.getUTCFullYear(),
    m = jak.getUTCMonth();
  const start = Date.UTC(y, m, 1) - JAK_MS;
  const end = Date.UTC(y, m + 1, 1) - JAK_MS - 1;
  const prevStart = Date.UTC(y, m - 1, 1) - JAK_MS;
  const label = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end, prevStart, prevEnd: start - 1, label };
}

export async function periodReportFromRaw(
  ctx: any,
  orgId: Id<"organizations">,
  args: { period: "week" | "month"; anchor?: number; csName?: string }
) {
  const { start, end, prevStart, prevEnd, label } = periodRange(args.period, args.anchor ?? Date.now());
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const filterKey = args.csName ? csKeyOf(args.csName) : null;
  const cr = (closed: number, leads: number) => leads > 0 ? Math.round((closed / leads) * 1000) / 10 : 0;
  const aggregate = async (rangeStart: number, rangeEnd: number) => {
    const endExclusive = rangeEnd + 1;
    const [orders, recapsAll] = await Promise.all([
      collectExactBounded(ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", rangeStart).lt("createdAt", endExclusive)), "analytics.getPeriodReport orders"),
      collectExactBounded(ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", rangeStart).lt("closedAt", endExclusive)), "analytics.getPeriodReport recaps"),
    ]);
    const visibleOrders = orders.filter((row: any) => !isInternalTestPhone(row.customerPhone, internalPhones) && (!filterKey || csKeyOf(row.assignedCsName) === filterKey));
    const visibleRecaps = recapsAll.filter((row: any) => !isInternalTestPhone(row.customerPhone, internalPhones) && (!filterKey || csKeyOf(row.csName) === filterKey));
    const activeRecaps = visibleRecaps.filter((row: any) => row.status !== "cancelled" && row.status !== "cancelled_after_export");
    const map = new Map<string, { csName: string; leads: Set<string>; closings: Set<string>; closed: Set<string>; revenue: number }>();
    const get = (name: string) => {
      const key = csKeyOf(name);
      const value = map.get(key) ?? { csName: name, leads: new Set<string>(), closings: new Set<string>(), closed: new Set<string>(), revenue: 0 };
      map.set(key, value);
      return value;
    };
    for (const order of visibleOrders) get(order.assignedCsName).leads.add(normalizePhone(order.customerPhone));
    for (const recap of activeRecaps) {
      const value = get(recap.csName);
      value.closings.add(recap.orderIdBerdu || normalizePhone(recap.customerPhone));
      value.closed.add(normalizePhone(recap.customerPhone));
      value.revenue += recap.total ?? recap.codValue ?? recap.nonCodItemPrice ?? 0;
    }
    const perCs = Array.from(map.values()).map((value) => ({
      csName: value.csName, leads: value.leads.size, closings: value.closings.size,
      cr: cr(value.closed.size, value.leads.size), revenue: value.revenue,
    })).sort((a, b) => b.closings - a.closings);
    return {
      leads: perCs.reduce((sum, row) => sum + row.leads, 0),
      closings: perCs.reduce((sum, row) => sum + row.closings, 0),
      closed: Array.from(map.values()).reduce((sum, row) => sum + row.closed.size, 0),
      revenue: perCs.reduce((sum, row) => sum + row.revenue, 0),
      cancelled: visibleRecaps.filter((row: any) => row.status === "cancelled" || row.status === "cancelled_after_export").length,
      perCs,
    };
  };
  const [current, previous] = await Promise.all([aggregate(start, end), aggregate(prevStart, prevEnd)]);
  return {
    label, rangeStart: start, rangeEnd: end,
    leads: current.leads, closings: current.closings, cr: cr(current.closed, current.leads), revenue: current.revenue, cancelled: current.cancelled,
    prevLeads: previous.leads, prevClosings: previous.closings, prevCr: cr(previous.closed, previous.leads), prevRevenue: previous.revenue,
    perCs: current.perCs,
  };
}

// ── 8. Raw Performance ─────────────────────────────────────────────

export async function performanceFromRaw(
  ctx: any,
  orgId: Id<"organizations">,
  args: { startAt: number; endAt: number; includeInferredDiscount?: boolean; csName?: string }
) {
  assertPublicAnalyticsRange(args.startAt, args.endAt, "shippingRecaps.getPerformance");
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const key = args.csName ? csKeyOf(args.csName) : null;

  const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);

  // Read raw recaps for detailed product breakdown and closed customer count (rollups don't have per-product revenue)
  const recaps = await collectExactBounded(ctx.db
    .query("shippingRecaps")
    .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", args.startAt).lt("closedAt", args.endAt))
    , "shippingRecaps.getPerformance recaps");

  const orders = await collectExactBounded(ctx.db
    .query("orders")
    .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lt("createdAt", args.endAt))
    , "shippingRecaps.getPerformance orders");

  const realOrders = orders.filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones) && (!key || csKeyOf(o.assignedCsName) === key));
  const visibleRecaps = recaps.filter((r: any) => (!key || csKeyOf(r.csName) === key) && !isInternalTestPhone(r.customerPhone, internalPhones));
  const validCandidateRows = visibleRecaps.filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export");

  // Deduplicate recaps by (orderIdBerdu || phone), keeping latest by closedAt
  const latestClosingByKey = new Map<string, any>();
  for (const recap of validCandidateRows) {
    const recapKey = recap.orderIdBerdu || normalizePhone(recap.customerPhone);
    const existing = latestClosingByKey.get(recapKey);
    if (!existing || recap.closedAt > existing.closedAt) latestClosingByKey.set(recapKey, recap);
  }
  const validClosings = Array.from(latestClosingByKey.values());

  // Deduplicate orders by phone, keeping latest by createdAt
  const latestOrderByPhone = new Map<string, any>();
  for (const o of realOrders) {
    const p = normalizePhone(o.customerPhone);
    const ex = latestOrderByPhone.get(p);
    if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
  }
  const uniqueOrders = Array.from(latestOrderByPhone.values());

  // Fallback order lookup for closings whose orders aren't in the range
  const fbNeeded: Array<{ phone: string; orderIdBerdu?: string }> = [];
  const fbSeen = new Set<string>();
  for (const r of validClosings) {
    const phone = normalizePhone(r.customerPhone);
    if (latestOrderByPhone.has(phone)) continue; // already covered by date-range orders
    if (fbSeen.has(phone)) continue; // already fetched
    if (r.packageContent && r.csName) continue; // no fallback needed
    fbSeen.add(phone);
    fbNeeded.push({ phone, orderIdBerdu: r.orderIdBerdu });
  }
  assertFallbackLookupBudget(fbNeeded.length, "shippingRecaps.getPerformance");
  const fbResults = await Promise.all(
    fbNeeded.map(async ({ phone, orderIdBerdu }) => {
      let order: any = null;
      if (orderIdBerdu) {
        order = await ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", orderIdBerdu)).unique();
      }
      if (!order) {
        order = await ctx.db.query("orders")
          .withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", phone))
          .order("desc")
          .first();
      }
      return { phone, order };
    }),
  );
  const fallbackOrderByPhone = new Map<string, any>();
  for (const { phone, order } of fbResults) if (order) fallbackOrderByPhone.set(phone, order);

  const productMap = new Map<string, { product: string; leads: number; closing: number; revenue: number; discount: number }>();
  const csMap = new Map<string, { csName: string; phones: Set<string>; closing: number; revenue: number; discount: number }>();
  const getCs = (name: string) => {
    const ck = csKeyOf(name);
    const entry = csMap.get(ck) ?? { csName: name, phones: new Set<string>(), closing: 0, revenue: 0, discount: 0 };
    csMap.set(ck, entry);
    return entry;
  };
  let totalRevenue = 0;
  let totalDiscount = 0;
  const closedCustomers = new Set<string>();

  for (const o of uniqueOrders) {
    const p = canonicalizeProduct(o.productName || o.products);
    const prod = productMap.get(p) ?? { product: p, leads: 0, closing: 0, revenue: 0, discount: 0 };
    prod.leads += 1;
    productMap.set(p, prod);
    getCs(o.assignedCsName).phones.add(normalizePhone(o.customerPhone));
  }

  for (const r of validClosings) {
    const phone = normalizePhone(r.customerPhone);
    const matchedOrder = latestOrderByPhone.get(phone) ?? fallbackOrderByPhone.get(phone);
    const product = canonicalizeProduct(matchedOrder?.productName || matchedOrder?.products || r.packageContent);
    const revenue = r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
    const discount = r.discount ?? (args.includeInferredDiscount ? r.inferredDiscount ?? 0 : 0);
    const prod = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
    prod.closing += 1;
    prod.revenue += revenue;
    prod.discount += discount;
    productMap.set(product, prod);
    closedCustomers.add(phone);
    const cs = getCs(r.csName);
    cs.closing += 1;
    cs.revenue += revenue;
    cs.discount += discount;
    totalRevenue += revenue;
    totalDiscount += discount;
  }

  const delivered = visibleRecaps.filter((r: any) => r.status === "delivered").length;
  const cancelled = visibleRecaps.filter((r: any) => r.status === "cancelled" || r.status === "cancelled_after_export").length;
  const totalCod = visibleRecaps.filter((r: any) => r.paymentMethod === "cod").length;
  const totalTransfer = visibleRecaps.filter((r: any) => r.paymentMethod === "transfer").length;

  return {
    totalLeads: uniqueOrders.length,
    totalClosing: validClosings.length,
    overallCr: uniqueOrders.length > 0 ? Math.round((closedCustomers.size / uniqueOrders.length) * 1000) / 10 : 0,
    totalCod,
    totalTransfer,
    totalRevenue,
    totalDiscount,
    delivered,
    cancelled,
    products: Array.from(productMap.values()).map((row) => ({
      ...row,
      cr: cr(row.closing, row.leads),
    })),
    cs: Array.from(csMap.values()).map((row) => ({
      csName: row.csName,
      leads: row.phones.size,
      closing: row.closing,
      revenue: row.revenue,
      discount: row.discount,
      cr: cr(row.closing, row.phones.size),
    })),
  };
}

// ── 9. Follow-Up Effectiveness ────────────────────────────────

