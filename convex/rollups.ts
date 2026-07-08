import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { csKey as csKeyOf, isInternalTestPhone, normalizePhone, windowKeyFor, windowRangeForKey } from "./lib";
import { canonicalizeProduct } from "./shippingRecaps";

const PRODUCT_CAP = 50;

export async function computeRollupRow(ctx: any, csKeyArg: string, windowKey: string): Promise<void> {
  const { startAt, endAt } = windowRangeForKey(windowKey);

  // Fetch orders in window, filter by csKey and exclude internal test phones
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone) && csKeyOf(o.assignedCsName) === csKeyArg);

  // Fetch recaps in window, exclude cancelled, filter by csKey and exclude internal test phones
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone) && csKeyOf(r.csName) === csKeyArg);

  // Fetch ALL cancelled/cancelled_after_export recaps to count them (no csKey filter for cancelled)
  const allCancelled = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => (r.status === "cancelled" || r.status === "cancelled_after_export") && !isInternalTestPhone(r.customerPhone) && csKeyOf(r.csName) === csKeyArg);

  // Resolve a closing's product to the matched in-window order's name, falling back to the recap's packageContent
  const latestOrderByPhone = new Map<string, any>();
  for (const o of orders) {
    const p = normalizePhone(o.customerPhone);
    const ex = latestOrderByPhone.get(p);
    if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
  }

  // Orphan-recap fallback: fetch orders for recaps whose leads aren't in THIS window
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

  // Aggregate counts
  const leads = new Set<string>(); // distinct customer phones
  const rawLeads = orders.length; // raw order count
  for (const o of orders) {
    leads.add(normalizePhone(o.customerPhone));
  }

  // Dedup closings by orderIdBerdu || phone, keeping latest
  const byKey = new Map<string, any>();
  for (const r of recaps) {
    const kk = r.orderIdBerdu || normalizePhone(r.customerPhone);
    const ex = byKey.get(kk);
    if (!ex || r.closedAt > ex.closedAt) byKey.set(kk, r);
  }
  const closingsList = Array.from(byKey.values());

  const closedCust = new Set<string>();
  let revenue = 0;
  let discount = 0;
  let manualClosings = 0;
  let delivered = 0;
  let fuClosings = 0;
  let fuH1 = 0;
  let fuH2 = 0;
  let fuH3 = 0;

  for (const r of closingsList) {
    closedCust.add(normalizePhone(r.customerPhone));
    revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
    discount += r.discount ?? 0;
    if (!r.sourceMessageId) manualClosings += 1;
    if (r.status === "delivered") delivered += 1;
    const touchCount = r.followUpTouchesAtClose ?? 0;
    if (touchCount >= 1) fuClosings += 1;
    if (touchCount === 1) fuH1 += 1;
    if (touchCount === 2) fuH2 += 1;
    if (touchCount >= 3) fuH3 += 1;
  }

  // Per-product aggregation
  const productMap = new Map<string, { leads: Set<string>; closings: Set<string> }>();
  for (const o of orders) {
    const p = canonicalizeProduct(o.productName || o.products);
    let prod = productMap.get(p);
    if (!prod) {
      prod = { leads: new Set(), closings: new Set() };
      productMap.set(p, prod);
    }
    prod.leads.add(normalizePhone(o.customerPhone));
  }

  for (const r of closingsList) {
    const cphone = normalizePhone(r.customerPhone);
    const matched = latestOrderByPhone.get(cphone) ?? fallbackOrderByPhone.get(cphone);
    const p = canonicalizeProduct(matched?.productName || matched?.products || r.packageContent);
    let prod = productMap.get(p);
    if (!prod) {
      prod = { leads: new Set(), closings: new Set() };
      productMap.set(p, prod);
    }
    prod.closings.add(r.orderIdBerdu || cphone);
  }

  // Build byProduct array, cap at 50 + overflow bucket
  const productsEntries = Array.from(productMap.entries())
    .map(([product, p]) => ({ product, leads: p.leads.size, closings: p.closings.size }))
    .filter((p) => p.leads > 0 || p.closings > 0)
    .sort((x, y) => y.leads - x.leads || x.product.localeCompare(y.product));

  const byProduct: Array<{ product: string; leads: number; closings: number }> = [];
  let overflowLeads = 0;
  let overflowClosings = 0;

  for (let i = 0; i < productsEntries.length; i++) {
    if (i < PRODUCT_CAP) {
      byProduct.push(productsEntries[i]);
    } else {
      overflowLeads += productsEntries[i].leads;
      overflowClosings += productsEntries[i].closings;
    }
  }

  if (overflowLeads > 0 || overflowClosings > 0) {
    byProduct.push({ product: "lainnya", leads: overflowLeads, closings: overflowClosings });
  }

  // Get most frequent csName
  const rawCounts = new Map<string, number>();
  for (const r of recaps) {
    rawCounts.set(r.csName, (rawCounts.get(r.csName) ?? 0) + 1);
  }
  for (const o of orders) {
    rawCounts.set(o.assignedCsName, (rawCounts.get(o.assignedCsName) ?? 0) + 1);
  }
  const csName = Array.from(rawCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";

  // Delete if all counters are zero
  const isEmpty = leads.size === 0 && closingsList.length === 0 && allCancelled.length === 0;

  if (isEmpty) {
    // Delete existing row
    const existing = await ctx.db
      .query("dailyRollups")
      .withIndex("by_window_cs", (q: any) => q.eq("windowKey", windowKey).eq("csKey", csKeyArg))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  } else {
    // Upsert via by_window_cs
    const existing = await ctx.db
      .query("dailyRollups")
      .withIndex("by_window_cs", (q: any) => q.eq("windowKey", windowKey).eq("csKey", csKeyArg))
      .unique();

    const row = {
      windowKey,
      csKey: csKeyArg,
      csName,
      leadOrders: rawLeads,
      leadsCust: leads.size,
      closings: closingsList.length,
      closedCust: closedCust.size,
      cancelled: allCancelled.length,
      manualClosings,
      delivered,
      revenue,
      discount,
      fuClosings,
      fuH1,
      fuH2,
      fuH3,
      byProduct,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("dailyRollups", row);
    }
  }
}

export async function bumpForOrderDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.createdAt) continue;
    const k = csKeyOf(doc.assignedCsName);
    const w = windowKeyFor(doc.createdAt);
    pairs.set(`${k}|${w}`, { k, w });
  }
  for (const { k, w } of pairs.values()) await computeRollupRow(ctx, k, w);
}

export async function bumpForRecapDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.closedAt) continue;
    const k = csKeyOf(doc.csName);
    const w = windowKeyFor(doc.closedAt);
    pairs.set(`${k}|${w}`, { k, w });
  }
  for (const { k, w } of pairs.values()) await computeRollupRow(ctx, k, w);
}

export const recomputeWindow = internalMutation({
  args: { windowKey: v.string() },
  handler: async (ctx, args) => {
    const { startAt, endAt } = windowRangeForKey(args.windowKey);
    const keys = new Set<string>();

    // Collect csKeys from orders in the window
    const orders = (
      await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
    for (const o of orders) {
      keys.add(csKeyOf(o.assignedCsName));
    }

    // Collect csKeys from recaps in the window (including orphan attribution)
    const recaps = (
      await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
    ).filter((r: any) => !isInternalTestPhone(r.customerPhone));
    for (const r of recaps) {
      keys.add(csKeyOf(r.csName));
    }

    // Collect csKeys from existing dailyRollups rows in the window (so stale rows get zeroed/deleted)
    const existingRollups = (
      await ctx.db.query("dailyRollups").withIndex("by_windowKey", (q: any) => q.eq("windowKey", args.windowKey)).collect()
    );
    for (const row of existingRollups) {
      keys.add(row.csKey);
    }

    // Recompute all csKeys in the window
    for (const k of keys) {
      await computeRollupRow(ctx, k, args.windowKey);
    }

    return { windowKey: args.windowKey, csKeys: keys.size };
  },
});
