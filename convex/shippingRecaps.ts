import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

type RecapStatus = "ready" | "needs_review" | "exported" | "cancelled" | "cancelled_after_export";
type PaymentMethod = "cod" | "transfer" | "unknown";

const statusValidator = v.union(
  v.literal("ready"),
  v.literal("needs_review"),
  v.literal("exported"),
  v.literal("cancelled"),
  v.literal("cancelled_after_export"),
);

const paymentMethodValidator = v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown"));

function parseRupiah(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  return Number(digits);
}

function normalizePhone(value: string | undefined): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function includesClosingMarker(text: string): boolean {
  return /\bPEMESANAN\s+BERHASIL\b/i.test(text);
}

function detectPaymentMethod(text: string): PaymentMethod {
  if (/\b(PEMBAYARAN|ORDER)\s+COD\b/i.test(text)) return "cod";
  if (/\b(PEMBAYARAN|ORDER)\s+TRANSFER\b/i.test(text)) return "transfer";
  if (/\bTRANSFER\b/i.test(text) && !/\bCOD\b/i.test(text)) return "transfer";
  return "unknown";
}

function extractLineValue(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function extractShippingBlock(text: string): string {
  const match = text.match(
    /(?:Dikirim ke|Dikirimkan ke)\s*:\s*\n([\s\S]+?)(?:\n\s*(?:PEMBAYARAN|ORDER|Catatan|Baarakallahu|$))/i,
  );
  return match?.[1]?.trim() ?? "";
}

function parseRecipient(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? "";
  const firstParts = first.split("|").map((part) => part.trim());
  const recipientName = firstParts[0] ?? "";
  const recipientPhone = normalizePhone(firstParts[1] ?? "");
  const recipientAddress = lines.slice(1).join(" ").trim();
  const addressParts = recipientAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    recipientName,
    recipientPhone,
    recipientAddress,
    recipientDistrict: addressParts.length >= 2 ? addressParts[addressParts.length - 2] : "",
    recipientCity: addressParts.length >= 1 ? addressParts[addressParts.length - 1] : "",
  };
}

function parseClosingMessage(sourceMessageText: string) {
  const text = normalizeText(sourceMessageText);
  const shippingBlock = extractShippingBlock(text);
  const recipient = parseRecipient(shippingBlock);
  const packageContent = extractLineValue(text, "Produk");
  const total = parseRupiah(extractLineValue(text, "Total"));
  const shippingCost = parseRupiah(extractLineValue(text, "Ongkir"));
  const itemPrice = parseRupiah(extractLineValue(text, "Harga"));
  const discount = parseRupiah(extractLineValue(text, "Diskon"));
  const paymentMethod = detectPaymentMethod(text);
  const flags: string[] = [];

  if (!includesClosingMarker(text)) flags.push("PARSE_LOW_CONFIDENCE");
  if (!recipient.recipientDistrict) flags.push("MISSING_DISTRICT");
  if (!recipient.recipientCity) flags.push("MISSING_CITY");
  if (
    !recipient.recipientName ||
    !recipient.recipientPhone ||
    !recipient.recipientAddress ||
    !packageContent ||
    paymentMethod === "unknown"
  ) {
    flags.push("PARSE_LOW_CONFIDENCE");
  }

  return {
    ...recipient,
    packageContent,
    paymentMethod,
    nonCodItemPrice: paymentMethod === "transfer" ? itemPrice : undefined,
    codValue: paymentMethod === "cod" ? total : undefined,
    shippingCost,
    total,
    discount,
    status: flags.length > 0 ? ("needs_review" as RecapStatus) : ("ready" as RecapStatus),
    flags: unique(flags),
  };
}

function normalizeComparable(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function compareWithOrder(parsed: ReturnType<typeof parseClosingMessage>, order: Doc<"orders"> | null) {
  const flags = [...parsed.flags];
  let inferredDiscount: number | undefined;

  if (!order) {
    flags.push("MISSING_ORDER_CONTEXT");
    return { flags: unique(flags), inferredDiscount };
  }

  if (
    parsed.recipientAddress &&
    normalizeComparable(order.shippingAddress) &&
    normalizeComparable(parsed.recipientAddress) !== normalizeComparable(order.shippingAddress)
  ) {
    flags.push("ADDRESS_CHANGED");
  }

  const originalTotal = parseRupiah(order.total);
  if (parsed.total !== undefined && originalTotal !== undefined && parsed.total !== originalTotal) {
    flags.push("TOTAL_CHANGED");
    if (parsed.total < originalTotal) {
      inferredDiscount = originalTotal - parsed.total;
      flags.push("INFERRED_DISCOUNT");
    }
  }

  const orderPhone = normalizePhone(order.customerPhone);
  if (parsed.recipientPhone && orderPhone && parsed.recipientPhone !== orderPhone) {
    flags.push("PHONE_CHANGED");
  }

  return { flags: unique(flags), inferredDiscount };
}

async function findOrder(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }) {
  if (args.orderIdBerdu) {
    const byOrderId = await ctx.db
      .query("orders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrderId) return byOrderId as Doc<"orders">;
  }

  return (await ctx.db
    .query("orders")
    .withIndex("by_customerPhone", (q: any) => q.eq("customerPhone", args.customerPhone))
    .order("desc")
    .first()) as Doc<"orders"> | null;
}

async function findConversation(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }) {
  if (args.orderIdBerdu) {
    const byOrder = await ctx.db
      .query("conversations")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrder) return byOrder as Doc<"conversations">;
  }

  return (await ctx.db
    .query("conversations")
    .withIndex("by_customerPhone_updatedAt", (q: any) => q.eq("customerPhone", args.customerPhone))
    .order("desc")
    .first()) as Doc<"conversations"> | null;
}

async function findExistingRecap(
  ctx: { db: any },
  args: { orderIdBerdu?: string; customerPhone: string; conversationId?: Id<"conversations"> },
) {
  if (args.orderIdBerdu) {
    const byOrder = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_orderIdBerdu", (q: any) => q.eq("orderIdBerdu", args.orderIdBerdu!))
      .first();
    if (byOrder) return byOrder as Doc<"shippingRecaps">;
  }

  const recentByPhone = (await ctx.db
    .query("shippingRecaps")
    .withIndex("by_customerPhone", (q: any) => q.eq("customerPhone", args.customerPhone))
    .order("desc")
    .take(10)) as Doc<"shippingRecaps">[];

  return recentByPhone.find((row) => row.conversationId === args.conversationId) ?? recentByPhone[0] ?? null;
}

export const upsertFromN8n = mutation({
  args: {
    customerPhone: v.string(),
    customerName: v.optional(v.string()),
    csName: v.optional(v.string()),
    csPhone: v.optional(v.string()),
    orderIdBerdu: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceMessageText: v.string(),
    closedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const closedAt = args.closedAt ?? now;
    const order = await findOrder(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone });
    const conversation = await findConversation(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone });
    const parsed = parseClosingMessage(args.sourceMessageText);
    const comparison = compareWithOrder(parsed, order);
    const existing = await findExistingRecap(ctx, {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      conversationId: conversation?._id,
    });

    const status: RecapStatus = existing?.status === "exported"
      ? "needs_review"
      : comparison.flags.length > 0
        ? "needs_review"
        : parsed.status;
    const flags = existing?.status === "exported" ? unique([...comparison.flags, "UPDATED_AFTER_EXPORT"]) : comparison.flags;
    const payload = {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      conversationId: conversation?._id,
      customerPhone: args.customerPhone,
      customerName: args.customerName ?? order?.customerName ?? conversation?.customerName ?? "",
      csName: args.csName ?? order?.assignedCsName ?? conversation?.assignedCsName ?? "",
      csPhone: args.csPhone ?? order?.assignedCsNumber,
      orderedAt: order?.createdAt,
      closedAt,
      recipientName: parsed.recipientName,
      recipientPhone: parsed.recipientPhone,
      recipientAddress: parsed.recipientAddress,
      recipientDistrict: parsed.recipientDistrict,
      recipientCity: parsed.recipientCity,
      packageContent: parsed.packageContent,
      paymentMethod: parsed.paymentMethod,
      nonCodItemPrice: parsed.nonCodItemPrice,
      codValue: parsed.codValue,
      shippingCost: parsed.shippingCost,
      total: parsed.total,
      discount: parsed.discount,
      inferredDiscount: comparison.inferredDiscount,
      status,
      flags,
      sourceMessageId: args.sourceMessageId,
      sourceMessageText: args.sourceMessageText,
      updatedAt: now,
    };

    let recapId: Id<"shippingRecaps">;
    if (existing) {
      recapId = existing._id;
      await ctx.db.patch(existing._id, {
        ...payload,
        version: existing.version + 1,
      });
    } else {
      recapId = await ctx.db.insert("shippingRecaps", {
        ...payload,
        version: 1,
        createdAt: now,
      });
    }

    await ctx.db.insert("events", {
      conversationId: conversation?._id,
      orderId: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      type: "shipping_recap_upserted",
      actor: "n8n",
      metadata: { recapId, status, flags },
      createdAt: now,
    });

    return { success: true, recapId, status, flags, _action: "upsert_shipping_recap" };
  },
});

export const list = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    status: v.optional(statusValidator),
    paymentMethod: v.optional(paymentMethodValidator),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = args.status
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_status_closedAt", (q) =>
            q.eq("status", args.status as RecapStatus).gte("closedAt", args.startAt).lte("closedAt", args.endAt),
          )
          .order("desc")
          .take(limit * 4)
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
          .order("desc")
          .take(limit * 4);

    const search = String(args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => !args.paymentMethod || row.paymentMethod === args.paymentMethod)
      .filter((row) => {
        if (!search) return true;
        return [
          row.recipientName,
          row.recipientPhone,
          row.customerPhone,
          row.orderIdBerdu,
          row.packageContent,
          row.recipientCity,
          row.recipientDistrict,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .slice(0, limit);
  },
});

export const updateFields = mutation({
  args: {
    recapId: v.id("shippingRecaps"),
    recipientName: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    recipientDistrict: v.optional(v.string()),
    recipientCity: v.optional(v.string()),
    packageContent: v.optional(v.string()),
    paymentMethod: v.optional(paymentMethodValidator),
    nonCodItemPrice: v.optional(v.number()),
    codValue: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    total: v.optional(v.number()),
    discount: v.optional(v.number()),
    shippingInstruction: v.optional(v.string()),
    bumpOrder: v.optional(v.string()),
    upsell: v.optional(v.string()),
    specialBonus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { recapId, ...patch } = args;
    await ctx.db.patch(recapId, {
      ...patch,
      status: "ready",
      flags: [],
      updatedAt: Date.now(),
    });
    return { success: true, recapId };
  },
});

export const markReady = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.recapId, { status: "ready", flags: [], updatedAt: Date.now() });
    return { success: true, recapId: args.recapId };
  },
});

export const markCancelled = mutation({
  args: { recapId: v.id("shippingRecaps"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status: RecapStatus = row.status === "exported" ? "cancelled_after_export" : "cancelled";
    const now = Date.now();
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: args.reason,
      cancelledAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancelled",
      actor: "cs",
      metadata: { recapId: args.recapId, reason: args.reason, status },
      createdAt: now,
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const undoCancelled = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status: RecapStatus = row.flags.length > 0 ? "needs_review" : "ready";
    const now = Date.now();
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: undefined,
      cancelledAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancel_undone",
      actor: "cs",
      metadata: { recapId: args.recapId, status },
      createdAt: now,
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const markExported = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")), exportBatchId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      await ctx.db.patch(recapId, {
        status: "exported",
        exportedAt: now,
        exportBatchId: args.exportBatchId,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_exported",
        actor: "cs",
        metadata: { recapId, exportBatchId: args.exportBatchId },
        createdAt: now,
      });
    }
    return { success: true, count: args.recapIds.length, exportBatchId: args.exportBatchId };
  },
});

export const getPerformance = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    includeInferredDiscount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_aiEligible_createdAt", (q) =>
        q.eq("aiEligible", true).gte("createdAt", args.startAt).lte("createdAt", args.endAt),
      )
      .collect();

    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .order("desc")
      .collect();

    const validClosings = recaps.filter((row) => row.status === "ready" || row.status === "exported");
    const productMap = new Map<string, { product: string; leads: number; closing: number; revenue: number; discount: number }>();
    const csMap = new Map<string, { csName: string; leads: number; closing: number; revenue: number; discount: number }>();

    for (const order of orders) {
      const product = order.productName || order.products || "Unknown";
      const productRow = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      productRow.leads += 1;
      productMap.set(product, productRow);

      const csName = order.assignedCsName || "Unknown";
      const csRow = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      csRow.leads += 1;
      csMap.set(csName, csRow);
    }

    for (const recap of validClosings) {
      const product = recap.packageContent || "Unknown";
      const revenue = recap.total ?? recap.codValue ?? recap.nonCodItemPrice ?? 0;
      const discount = recap.discount ?? (args.includeInferredDiscount ? recap.inferredDiscount ?? 0 : 0);
      const productRow = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      productRow.closing += 1;
      productRow.revenue += revenue;
      productRow.discount += discount;
      productMap.set(product, productRow);

      const csName = recap.csName || "Unknown";
      const csRow = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      csRow.closing += 1;
      csRow.revenue += revenue;
      csRow.discount += discount;
      csMap.set(csName, csRow);
    }

    const totalLeads = orders.length;
    const totalClosing = validClosings.length;
    const totalDiscount = validClosings.reduce(
      (sum, row) => sum + (row.discount ?? (args.includeInferredDiscount ? row.inferredDiscount ?? 0 : 0)),
      0,
    );
    const totalRevenue = validClosings.reduce((sum, row) => sum + (row.total ?? row.codValue ?? row.nonCodItemPrice ?? 0), 0);

    return {
      totalLeads,
      totalClosing,
      overallCr: totalLeads > 0 ? Math.round((totalClosing / totalLeads) * 1000) / 10 : 0,
      totalCod: validClosings.filter((row) => row.paymentMethod === "cod").length,
      totalTransfer: validClosings.filter((row) => row.paymentMethod === "transfer").length,
      totalRevenue,
      totalDiscount,
      cancelled: recaps.filter((row) => row.status === "cancelled" || row.status === "cancelled_after_export").length,
      products: Array.from(productMap.values()).map((row) => ({
        ...row,
        cr: row.leads > 0 ? Math.round((row.closing / row.leads) * 1000) / 10 : 0,
      })),
      cs: Array.from(csMap.values()).map((row) => ({
        ...row,
        cr: row.leads > 0 ? Math.round((row.closing / row.leads) * 1000) / 10 : 0,
      })),
    };
  },
});
