import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { resolveAgent } from "../agents";
import { upsertOrderCore } from "../state";
import { bumpForRecapDoc } from "../rollups";

const enrichmentResultValidator = v.object({
  status: v.union(v.literal("updated"), v.literal("missing"), v.literal("unassigned"), v.literal("unmapped")),
  handlerId: v.optional(v.string()),
  csName: v.optional(v.string()),
});

export const applyEnrichedHandler = internalMutation({
  args: {
    orgId: v.id("organizations"),
    orderId: v.string(),
    handlerId: v.string(),
    handlerName: v.optional(v.string()),
  },
  returns: enrichmentResultValidator,
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q) => q.eq("orgId", args.orgId).eq("orderId", args.orderId))
      .unique();
    if (!order || order.source !== "scalev") return { status: "missing" as const };

    const agent =
      await resolveAgent(ctx, args.orgId, { scalevHandlerId: args.handlerId }) ??
      (args.handlerName
        ? await resolveAgent(ctx, args.orgId, { name: args.handlerName })
        : null);
    if (!agent) return { status: "unmapped" as const, handlerId: args.handlerId };

    await upsertOrderCore(ctx, {
      orgId: args.orgId,
      phone: order.customerPhone,
      csName: agent.csName,
      csNumber: order.assignedCsNumber,
      customerName: order.customerName,
      productName: order.productName,
      products: order.products,
      productsSubtotal: order.productsSubtotal,
      shippingCost: order.shippingCost,
      total: order.total,
      shippingAddress: order.shippingAddress,
      shippingDistrict: order.shippingDistrict,
      shippingCity: order.shippingCity,
      order_id: order.orderId,
      externalOrderId: order.externalOrderId,
      providerRecordId: order.providerRecordId,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      source: "scalev",
    });

    let recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", args.orgId).eq("orderIdBerdu", order.orderId))
      .take(10);
    if (recaps.length === 0) {
      recaps = (await ctx.db
        .query("shippingRecaps")
        .withIndex("by_org_customerPhone", (q) => q.eq("orgId", args.orgId).eq("customerPhone", order.customerPhone))
        .order("desc")
        .take(10))
        .filter((recap) => recap.csKey === "scalevunassigned" && recap.closedAt >= order.createdAt);
    }
    for (const recap of recaps) {
      const before = recap;
      await ctx.db.patch(recap._id, {
        csName: agent.csName,
        csKey: agent.key,
        orderSource: "scalev",
        updatedAt: Date.now(),
      });
      await bumpForRecapDoc(ctx, before, await ctx.db.get(recap._id));
    }
    return { status: "updated" as const, handlerId: args.handlerId, csName: agent.csName };
  },
});

export const listUnassignedOrders = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.number(),
  },
  returns: v.array(v.object({ orderId: v.string(), providerRecordId: v.string() })),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new Error("limit must be an integer between 1 and 100");
    }
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_org_source_csKey_createdAt", (q) => q
        .eq("orgId", args.orgId)
        .eq("source", "scalev")
        .eq("csKey", "scalevunassigned"))
      .order("desc")
      .take(args.limit);
    return rows.flatMap((row) => row.providerRecordId
      ? [{ orderId: row.orderId, providerRecordId: row.providerRecordId }]
      : []);
  },
});
