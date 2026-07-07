import { query } from "./_generated/server";
import { requireAdmin, requireMember } from "./authz";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone, getJakartaDate, csKey } from "./lib";

export const getDashboardSummary = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, "metrics.getDashboardSummary");
    const orders = await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const recaps = await ctx.db.query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();
    const events = await ctx.db.query("events")
      .withIndex("by_type_createdAt", (q) => q.eq("type", "handover").gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const key = args.csName ? csKey(args.csName) : null;
    const csOk = (cs: string | undefined) => !key || csKey(cs) === key;
    const leadPhones = new Set(
      orders.filter((o) => !isInternalTestPhone(o.customerPhone) && csOk(o.assignedCsName))
        .map((o) => normalizePhone(o.customerPhone)),
    );
    const validRecaps = recaps.filter(
      (r) => r.status !== "cancelled" && r.status !== "cancelled_after_export" &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName),
    );
    const closingKeys = new Set(validRecaps.map((r) => r.orderIdBerdu || normalizePhone(r.customerPhone)));
    const cancelled = recaps.filter(
      (r) => (r.status === "cancelled" || r.status === "cancelled_after_export") &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName),
    ).length;
    const handovers = new Set(
      events.filter((e) => !isInternalTestPhone(e.customerPhone ?? "")).map((e) => e.orderId ?? e.customerPhone ?? String(e._id)),
    ).size;
    const activeChats = (await ctx.db.query("conversations")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "active")).collect())
      .filter((c) => !isInternalTestPhone(c.customerPhone) && csOk(c.assignedCsName)).length;

    const leads = leadPhones.size;
    const closings = closingKeys.size;
    return {
      leads, closings,
      cr: leads > 0 ? Math.round((closings / leads) * 1000) / 10 : 0,
      manualClosings: validRecaps.filter((r) => r.sourceMessageId === undefined).length,
      cancelled, handovers, activeChats,
      revenue: validRecaps.reduce((s, r) => s + (r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0), 0),
    };
  },
});

function bucketKey(ts: number, bucket: "day" | "week" | "month"): string {
  const d = getJakartaDate(ts); // YYYY-MM-DD (Asia/Jakarta)
  if (bucket === "month") return d.slice(0, 7);
  if (bucket === "week") {
    const dt = new Date(d + "T00:00:00Z");
    const onejan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86_400_000 + onejan.getUTCDay() + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return d;
}

export const getTrend = query({
  args: { startAt: v.number(), endAt: v.number(),
    bucket: v.union(v.literal("day"), v.literal("week"), v.literal("month")), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, "metrics.getTrend");
    const key = args.csName ? csKey(args.csName) : null;
    const csOk = (cs: string | undefined) => !key || csKey(cs) === key;
    const orders = (await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt)).collect())
      .filter((o) => !isInternalTestPhone(o.customerPhone) && csOk(o.assignedCsName));
    const recaps = (await ctx.db.query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt)).collect())
      .filter((r) => r.status !== "cancelled" && r.status !== "cancelled_after_export" &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName));
    const leadSets = new Map<string, Set<string>>();
    const closeSets = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, k: string, v2: string) => {
      const s = m.get(k) ?? new Set<string>(); s.add(v2); m.set(k, s);
    };
    for (const o of orders) add(leadSets, bucketKey(o.createdAt, args.bucket), normalizePhone(o.customerPhone));
    for (const r of recaps) add(closeSets, bucketKey(r.closedAt, args.bucket), r.orderIdBerdu || normalizePhone(r.customerPhone));
    const buckets = Array.from(new Set(Array.from(leadSets.keys()).concat(Array.from(closeSets.keys())))).sort();
    return buckets.map((b) => {
      const leads = leadSets.get(b)?.size ?? 0;
      const closings = closeSets.get(b)?.size ?? 0;
      return { bucket: b, leads, closings, cr: leads > 0 ? Math.round((closings / leads) * 1000) / 10 : 0 };
    });
  },
});

export const getDuplicateOrders = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, "metrics.getDuplicateOrders");
    const key = args.csName ? csKey(args.csName) : null;
    const orders = (
      await ctx.db
        .query("orders")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
        .collect()
    ).filter((o) => !isInternalTestPhone(o.customerPhone) && (!key || csKey(o.assignedCsName) === key));

    const groups = new Map<string, typeof orders>();
    for (const o of orders) {
      const p = normalizePhone(o.customerPhone);
      const arr = groups.get(p) ?? [];
      arr.push(o);
      groups.set(p, arr);
    }

    const seq = (orderId: string) => parseInt(orderId.replace(/\D/g, ""), 10);
    const result = [];
    for (const [phone, list] of Array.from(groups.entries())) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
      const sameProduct = new Set(sorted.map((o) => o.productName)).size === 1;
      const seqs = sorted.map((o) => seq(o.orderId)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      let nearConsecutive = false;
      for (let i = 1; i < seqs.length; i++) if (seqs[i] - seqs[i - 1] <= 3) nearConsecutive = true;
      result.push({
        phone,
        customerName: sorted[0].customerName,
        csName: sorted[0].assignedCsName,
        count: sorted.length,
        sameProduct,
        nearConsecutive,
        likelyAccidental: sameProduct || nearConsecutive,
        orders: sorted.map((o) => ({ orderId: o.orderId, productName: o.productName, total: o.total, createdAt: o.createdAt })),
      });
    }
    result.sort(
      (a, b) =>
        Number(b.likelyAccidental) - Number(a.likelyAccidental) ||
        b.count - a.count ||
        (b.orders[0]?.createdAt ?? 0) - (a.orders[0]?.createdAt ?? 0),
    );
    return result;
  },
});

// Diagnostic: look up specific Berdu order ids in Convex to see if they synced.
export const debugFindOrders = query({
  args: { orderIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "metrics.debugFindOrders");
    const results = [];
    for (const raw of args.orderIds) {
      const stripped = raw.replace(/^#/, "").trim();
      const orderId = stripped.startsWith("O-") ? stripped : `O-${stripped}`;
      const order = await ctx.db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .unique();
      results.push({
        orderId,
        found: order !== null,
        phone: order?.customerPhone ?? null,
        name: order?.customerName ?? null,
        cs: order?.assignedCsName ?? null,
        createdAt: order ? new Date(order.createdAt).toISOString() : null,
      });
    }
    return results;
  },
});

// Diagnostic: reconcile Convex order count against the source (Berdu) for a range.
// rawOrders should match Berdu's count if every order synced; leads = distinctValidPhones.
export const debugOrderReconcile = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "metrics.debugOrderReconcile");
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const excluded = orders.filter((o) => isInternalTestPhone(o.customerPhone));
    const valid = orders.filter((o) => !isInternalTestPhone(o.customerPhone));
    const distinctValid = new Set(valid.map((o) => normalizePhone(o.customerPhone))).size;
    return {
      rawOrders: orders.length,
      validOrders: valid.length,
      distinctValidPhones: distinctValid,
      duplicateExtra: valid.length - distinctValid,
      excludedOrders: excluded.length,
      excludedSample: excluded.slice(0, 12).map((o) => ({
        phone: o.customerPhone,
        name: o.customerName,
        cs: o.assignedCsName,
        orderId: o.orderId,
      })),
    };
  },
});
