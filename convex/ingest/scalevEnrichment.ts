import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getBoundedActiveAgentRegistry, resolveAgent } from "../agents";
import { upsertOrderCore } from "../state";
import { bumpForRecapDoc } from "../rollups";
import { csKey, normalizeCsName } from "../lib";

const enrichmentResultValidator = v.object({
  status: v.union(v.literal("updated"), v.literal("missing"), v.literal("unassigned"), v.literal("unmapped")),
  handlerId: v.optional(v.string()),
  csName: v.optional(v.string()),
});

export const configureAgentIdentity = internalMutation({
  args: {
    orgId: v.id("organizations"),
    fromCsName: v.string(),
    toCsName: v.string(),
    scalevHandlerIds: v.array(v.string()),
  },
  returns: v.object({ csName: v.string(), stableKey: v.string(), scalevHandlerIds: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const toCsName = args.toCsName.trim();
    if (!toCsName) throw new Error("new CS name is empty");
    const fromNorm = normalizeCsName(args.fromCsName);
    const toNorm = normalizeCsName(toCsName);
    const stored = await ctx.db.query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", args.orgId).eq("normalizedName", fromNorm))
      .unique();
    if (!stored) throw new Error(`csConfig not found: ${args.fromCsName}`);
    if (toNorm !== fromNorm) {
      const clash = await ctx.db.query("csConfigs")
        .withIndex("by_org_normalizedName", (q) => q.eq("orgId", args.orgId).eq("normalizedName", toNorm))
        .unique();
      if (clash) throw new Error(`CS already exists: ${toCsName}`);
    }
    const scalevHandlerIds = Array.from(new Set(args.scalevHandlerIds.map((id) => id.trim()).filter(Boolean)));
    if (scalevHandlerIds.length > 20) throw new Error("Scalev handler IDs exceeds 20");
    const activeRows = await getBoundedActiveAgentRegistry(ctx, args.orgId);
    if (!activeRows) throw new Error("active agent registry exceeds supported Scalev mapping limit");
    for (const handlerId of scalevHandlerIds) {
      const collision = activeRows.find((row) => row._id !== stored._id && (row.scalevHandlerIds ?? []).includes(handlerId));
      if (collision) throw new Error(`Scalev handler ID already assigned: ${handlerId}`);
    }
    const stableKey = stored.key ?? csKey(stored.csName);
    const nameAliases = Array.from(new Set([...(stored.nameAliases ?? []), stored.csName]
      .map((name) => name.trim()).filter((name) => name && normalizeCsName(name) !== toNorm)));
    await ctx.db.patch(stored._id, {
      csName: toCsName,
      normalizedName: toNorm,
      key: stableKey,
      nameAliases,
      scalevHandlerIds,
      updatedAt: Date.now(),
    });
    return { csName: toCsName, stableKey, scalevHandlerIds };
  },
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
