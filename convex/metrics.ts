import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone } from "./lib";

export const getDashboardSummary = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orders = await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const recaps = await ctx.db.query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();
    const events = await ctx.db.query("events")
      .withIndex("by_type_createdAt", (q) => q.eq("type", "handover").gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const csOk = (cs: string | undefined) => !args.csName || cs === args.csName;
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
