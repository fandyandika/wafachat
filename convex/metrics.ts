import { query, internalQuery, type QueryCtx } from "./_generated/server";
import { requireAdminOrg, requireMember, requireMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone, getJakartaDate, csKey } from "./lib";
import { dashboardSummaryFromRollups, trendFromRollups } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";

export async function computeDashboardSummaryRaw(ctx: QueryCtx, orgId: Id<"organizations">, args: { startAt: number; endAt: number; csName?: string; includeActiveChats?: boolean }) {
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const orders = await ctx.db.query("orders")
      .withIndex("by_org_createdAt", (q) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const recaps = await ctx.db.query("shippingRecaps")
      .withIndex("by_org_closedAt", (q) => q.eq("orgId", orgId).gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();
    const events = await ctx.db.query("events")
      .withIndex("by_org_type_createdAt", (q) => q.eq("orgId", orgId).eq("type", "handover").gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const key = args.csName ? csKey(args.csName) : null;
    const csOk = (cs: string | undefined) => !key || csKey(cs) === key;
    const leadPhones = new Set(
      orders.filter((o) => !isInternalTestPhone(o.customerPhone, internalPhones) && csOk(o.assignedCsName))
        .map((o) => normalizePhone(o.customerPhone)),
    );
    const validRecaps = recaps.filter(
      (r) => r.status !== "cancelled" && r.status !== "cancelled_after_export" &&
        !isInternalTestPhone(r.customerPhone, internalPhones) && csOk(r.csName),
    );
    const closingKeys = new Set(validRecaps.map((r) => r.orderIdBerdu || normalizePhone(r.customerPhone)));
    const cancelled = recaps.filter(
      (r) => (r.status === "cancelled" || r.status === "cancelled_after_export") &&
        !isInternalTestPhone(r.customerPhone, internalPhones) && csOk(r.csName),
    ).length;
    const handovers = new Set(
      events.filter((e) => !isInternalTestPhone(e.customerPhone ?? "", internalPhones)).map((e) => e.orderId ?? e.customerPhone ?? String(e._id)),
    ).size;
    // activeChats scans the WHOLE active-conversation pool (unbounded by time). The dashboard
    // does not render it, so only compute it when a caller explicitly asks (default off →
    // skip the read entirely). A future CS-AI ops page can pass includeActiveChats: true.
    const activeChats = args.includeActiveChats
      ? (await ctx.db.query("conversations").withIndex("by_org_status_updatedAt", (q) => q.eq("orgId", orgId).eq("status", "active")).collect())
          .filter((c) => !isInternalTestPhone(c.customerPhone, internalPhones) && csOk(c.assignedCsName)).length
      : 0;

    const leads = leadPhones.size;
    const closings = closingKeys.size;
    return {
      leads, closings,
      cr: leads > 0 ? Math.round((closings / leads) * 1000) / 10 : 0,
      manualClosings: validRecaps.filter((r) => r.sourceMessageId === undefined).length,
      cancelled, handovers, activeChats,
      revenue: validRecaps.reduce((s, r) => s + (r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0), 0),
    };
}

export const getDashboardSummary = query({
  // raw=true → calendar-day / any-range raw computation (cheap for a small "today" slice);
  // omitted/false → rollup reader (whole 16:00-windows). Same output shape either way.
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()), raw: v.optional(v.boolean()), includeActiveChats: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "metrics.getDashboardSummary");
    return args.raw ? computeDashboardSummaryRaw(ctx, orgId, args) : dashboardSummaryFromRollups(ctx, orgId, args);
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
    const { orgId } = await requireMemberOrg(ctx, "metrics.getTrend");
    return trendFromRollups(ctx, orgId, args);
  },
});

export const getDuplicateOrders = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "metrics.getDuplicateOrders");
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const key = args.csName ? csKey(args.csName) : null;
    const orders = (
      await ctx.db
        .query("orders")
        .withIndex("by_org_createdAt", (q) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lte("createdAt", args.endAt))
        .collect()
    ).filter((o) => !isInternalTestPhone(o.customerPhone, internalPhones) && (!key || csKey(o.assignedCsName) === key));

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
    const { orgId } = await requireAdminOrg(ctx, "metrics.debugFindOrders");
    const results = [];
    for (const raw of args.orderIds) {
      const stripped = raw.replace(/^#/, "").trim();
      const orderId = stripped.startsWith("O-") ? stripped : `O-${stripped}`;
      const order = await ctx.db
        .query("orders")
        .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", orderId))
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
    const { orgId } = await requireAdminOrg(ctx, "metrics.debugOrderReconcile");
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_org_createdAt", (q) => q.eq("orgId", orgId).gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const excluded = orders.filter((o) => isInternalTestPhone(o.customerPhone, internalPhones));
    const valid = orders.filter((o) => !isInternalTestPhone(o.customerPhone, internalPhones));
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
