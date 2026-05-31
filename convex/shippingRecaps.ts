import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

type RecapStatus = "ready" | "needs_review" | "exported" | "delivered" | "cancelled" | "cancelled_after_export";
type PaymentMethod = "cod" | "transfer" | "unknown";

const INTERNAL_TEST_PHONES = new Set(["6285715682110", "6285774076061", "628211900201"]);

const statusValidator = v.union(
  v.literal("ready"),
  v.literal("needs_review"),
  v.literal("exported"),
  v.literal("delivered"),
  v.literal("cancelled"),
  v.literal("cancelled_after_export"),
);

const paymentMethodValidator = v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown"));

const berduVerifiedRowValidator = v.object({
  orderIdBerdu: v.string(),
  customerName: v.string(),
  customerPhone: v.string(),
  csName: v.string(),
  orderedAt: v.number(),
  closedAt: v.number(),
  recipientName: v.string(),
  recipientPhone: v.string(),
  recipientAddress: v.string(),
  recipientDistrict: v.string(),
  recipientCity: v.string(),
  packageContent: v.string(),
  paymentMethod: paymentMethodValidator,
  itemPrice: v.optional(v.number()),
  shippingCost: v.optional(v.number()),
  total: v.optional(v.number()),
  discount: v.optional(v.number()),
  sourceMessageText: v.string(),
});

function parseRupiah(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  return Number(digits);
}

function normalizePhone(value: string | undefined): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function normalizeOrderId(value: string | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.startsWith("O-") ? text : `O-${text}`;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/[*_`]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isGeneratedCustomerName(value: string | undefined): boolean {
  const text = cleanMarkdown(value ?? "");
  return !text || /^Customer\s+\d{3,}$/i.test(text) || /Dikirim(?:kan)?\s+ke\s*:?/i.test(text);
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
  const match = text.match(new RegExp(`^\\s*[*_\`]*${escaped}[*_\`]*\\s*:\\s*(.+)$`, "im"));
  return cleanMarkdown(match?.[1]?.trim() ?? "");
}

function extractShippingBlock(text: string): string {
  const match = text.match(
    /(?:Dikirim ke|Dikirimkan ke)\s*:\s*\n([\s\S]+?)(?:\n\s*(?:📱|📌|PEMBAYARAN|ORDER|Catatan|_Catatan|Pastikan|Semoga|Baarakallahu|$))/i,
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
  const recipientAddress = cleanMarkdown(lines.slice(1).join(" ").trim())
    .replace(/\s*(?:📱|📌|Pastikan|_Pastikan|Semoga|Baarakallahu)[\s\S]*$/i, "")
    .trim();
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

function normalizeProductName(value: string | undefined): string {
  return cleanMarkdown(value ?? "")
    .replace(/\(\s*\d+\s*x\s*\)/gi, "")
    .replace(/\s+-\s+Pilih Paket:.*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Tanpa Data Produk";
}

function isInternalTestPhone(value: string | undefined): boolean {
  return INTERNAL_TEST_PHONES.has(normalizePhone(value));
}

function normalizeCsName(value: string | undefined): string {
  const name = cleanMarkdown(value ?? "") || "Tanpa Data CS";
  if (/^aisyah$/i.test(name)) return "CS Aisyah";
  return name;
}

function compareWithOrder(parsed: ReturnType<typeof parseClosingMessage>, order: Doc<"orders"> | null) {
  const flags = [...parsed.flags];
  let inferredDiscount: number | undefined;

  if (!order) {
    flags.push("MISSING_ORDER_CONTEXT");
    return { flags: unique(flags), inferredDiscount };
  }

  const finalAddress = normalizeComparable(parsed.recipientAddress);
  const originalAddress = normalizeComparable([order.shippingAddress, order.shippingDistrict, order.shippingCity].filter(Boolean).join(", "));
  const baseOrderAddress = normalizeComparable(order.shippingAddress);
  if (finalAddress && originalAddress && !finalAddress.includes(baseOrderAddress) && !originalAddress.includes(finalAddress)) {
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

function applyOrderFallbacks(parsed: ReturnType<typeof parseClosingMessage>, order: Doc<"orders"> | null) {
  if (!order) return parsed;

  const orderAddress = [order.shippingAddress, order.shippingDistrict, order.shippingCity].filter(Boolean).join(", ");
  const recipientName = isGeneratedCustomerName(parsed.recipientName) ? order.customerName : parsed.recipientName;
  const recipientPhone = parsed.recipientPhone || normalizePhone(order.customerPhone);
  const recipientAddress = parsed.recipientAddress || orderAddress;
  const recipientDistrict = parsed.recipientDistrict || order.shippingDistrict || "";
  const recipientCity = parsed.recipientCity || order.shippingCity || "";

  let flags = parsed.flags;
  if (recipientDistrict) flags = flags.filter((flag) => flag !== "MISSING_DISTRICT");
  if (recipientCity) flags = flags.filter((flag) => flag !== "MISSING_CITY");
  if (
    recipientName &&
    recipientPhone &&
    recipientAddress &&
    parsed.packageContent &&
    parsed.paymentMethod !== "unknown"
  ) {
    flags = flags.filter((flag) => flag !== "PARSE_LOW_CONFIDENCE");
  }

  return {
    ...parsed,
    recipientName,
    recipientPhone,
    recipientAddress,
    recipientDistrict,
    recipientCity,
    status: flags.length > 0 ? ("needs_review" as RecapStatus) : ("ready" as RecapStatus),
    flags: unique(flags),
  };
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
    const parsed = applyOrderFallbacks(parseClosingMessage(args.sourceMessageText), order);
    const comparison = compareWithOrder(parsed, order);
    const existing = await findExistingRecap(ctx, {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      conversationId: conversation?._id,
    });

    const resolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    const status: RecapStatus = existing?.status === "exported"
      ? "needs_review"
      : comparison.flags.length > 0
        ? "needs_review"
        : parsed.status;
    const baseFlags = existing?.status === "exported" ? unique([...comparison.flags, "UPDATED_AFTER_EXPORT"]) : comparison.flags;
    const flags = resolvedCsName ? baseFlags : unique([...baseFlags, "NO_CS_DATA"]);
    const payload = {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      conversationId: conversation?._id,
      customerPhone: args.customerPhone,
      customerName: isGeneratedCustomerName(args.customerName) ? order?.customerName ?? conversation?.customerName ?? "" : args.customerName ?? order?.customerName ?? conversation?.customerName ?? "",
      csName: resolvedCsName,
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

// Called when a manual CS (e.g. Risma) marks closing from the panel.
// Creates a needs_review recap using order data — no AI message to parse.
export const createFromPanelClosing = mutation({
  args: {
    customerPhone: v.string(),
    orderId: v.optional(v.string()),
    packageContent: v.optional(v.string()),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const order = await findOrder(ctx, { orderIdBerdu: args.orderId, customerPhone: args.customerPhone });
    const conversation = await findConversation(ctx, { orderIdBerdu: args.orderId, customerPhone: args.customerPhone });
    const existing = await findExistingRecap(ctx, {
      orderIdBerdu: args.orderId ?? order?.orderId,
      customerPhone: args.customerPhone,
      conversationId: conversation?._id,
    });

    // Don't overwrite already-exported or delivered recaps
    if (existing && (existing.status === "exported" || existing.status === "delivered")) {
      return { success: true, recapId: existing._id, status: existing.status, _action: "create_from_panel_closing", skipped: true };
    }

    const resolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    const panelFlags: string[] = order ? ["MANUAL_CLOSING"] : ["MANUAL_CLOSING", "NO_ORDER_DATA"];
    if (!resolvedCsName) panelFlags.push("NO_CS_DATA");
    const payload = {
      orderIdBerdu: args.orderId ?? order?.orderId,
      conversationId: conversation?._id,
      customerPhone: args.customerPhone,
      customerName: order?.customerName ?? conversation?.customerName ?? "",
      csName: resolvedCsName,
      csPhone: order?.assignedCsNumber,
      orderedAt: order?.createdAt,
      closedAt: now,
      recipientName: order?.customerName ?? "",
      recipientPhone: args.customerPhone,
      recipientAddress: order?.shippingAddress ?? "",
      recipientDistrict: order?.shippingDistrict ?? "",
      recipientCity: order?.shippingCity ?? "",
      packageContent: args.packageContent || order?.productName || order?.products || (order ? "" : "Tanpa Order"),
      paymentMethod: "unknown" as PaymentMethod,
      shippingCost: parseRupiah(order?.shippingCost),
      total: parseRupiah(order?.total),
      status: "needs_review" as RecapStatus,
      flags: panelFlags,
      sourceMessageText: "manual_closing_by_cs",
      updatedAt: now,
    };

    let recapId: Id<"shippingRecaps">;
    if (existing) {
      recapId = existing._id;
      await ctx.db.patch(existing._id, { ...payload, version: existing.version + 1 });
    } else {
      recapId = await ctx.db.insert("shippingRecaps", { ...payload, version: 1, createdAt: now });
    }

    await ctx.db.insert("events", {
      conversationId: conversation?._id,
      orderId: args.orderId ?? order?.orderId,
      customerPhone: args.customerPhone,
      type: "shipping_recap_upserted",
      actor: "cs",
      metadata: { recapId, source: "panel_manual_closing" },
      createdAt: now,
    });

    return { success: true, recapId, status: "needs_review", _action: "create_from_panel_closing" };
  },
});

export const backfillFromMessages = mutation({
  args: {
    limit: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 300, 1000);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_customerPhone_createdAt")
      .order("desc")
      .take(limit);
    let scanned = 0;
    let upserted = 0;
    let skipped = 0;
    const recapIds: Id<"shippingRecaps">[] = [];

    for (const message of messages) {
      if (args.startAt && message.createdAt < args.startAt) continue;
      if (args.endAt && message.createdAt > args.endAt) continue;
      if (message.direction !== "outbound") continue;
      if (!String(message.content || "").includes("PEMESANAN BERHASIL")) continue;
      scanned += 1;

      const order = await findOrder(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone });
      const conversation = await findConversation(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone });
      const parsed = applyOrderFallbacks(parseClosingMessage(message.content), order);
      const comparison = compareWithOrder(parsed, order);
      const existing = await findExistingRecap(ctx, {
        orderIdBerdu: message.orderId || order?.orderId,
        customerPhone: message.customerPhone,
        conversationId: conversation?._id,
      });
      const flags = comparison.flags;
      const status: RecapStatus = flags.length > 0 ? "needs_review" : parsed.status;
      const payload = {
        orderIdBerdu: message.orderId || order?.orderId,
        conversationId: conversation?._id,
        customerPhone: message.customerPhone,
        customerName: order?.customerName ?? conversation?.customerName ?? "",
        csName: order?.assignedCsName ?? conversation?.assignedCsName ?? "",
        csPhone: order?.assignedCsNumber,
        orderedAt: order?.createdAt,
        closedAt: message.createdAt,
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
        sourceMessageId: message.externalMessageId ?? message._id,
        sourceMessageText: message.content,
        updatedAt: Date.now(),
      };

      if (existing && existing.sourceMessageId === payload.sourceMessageId && !args.force) {
        skipped += 1;
        continue;
      }

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
          createdAt: Date.now(),
        });
      }
      recapIds.push(recapId);
      upserted += 1;
    }

    return { success: true, scanned, upserted, skipped, recapIds };
  },
});

export const list = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    status: v.optional(statusValidator),
    paymentMethod: v.optional(paymentMethodValidator),
    search: v.optional(v.string()),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = args.status
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_status_closedAt", (q) =>
            q.eq("status", args.status as RecapStatus).gte("closedAt", args.startAt).lte("closedAt", args.endAt),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
          .order("desc")
          .collect();
    const search = String(args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => !isInternalTestPhone(row.customerPhone))
      .filter((row) => !args.csName || row.csName === args.csName)
      .filter((row) => !args.paymentMethod || row.paymentMethod === args.paymentMethod)
      .filter((row) => {
        if (!search) return true;
        return [
          row.recipientName,
          row.customerName,
          row.recipientPhone,
          row.customerPhone,
          row.orderIdBerdu,
          row.packageContent,
          row.recipientCity,
          row.recipientDistrict,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      });
  },
});

export const getCounts = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();

    const filtered = rows.filter(
      (row) =>
        !isInternalTestPhone(row.customerPhone) &&
        (!args.csName || row.csName === args.csName),
    );

    const nonCancelled = filtered.filter(
      (row) => row.status !== "cancelled" && row.status !== "cancelled_after_export",
    );

    return {
      all: filtered.length,
      needs_review: filtered.filter((r) => r.status === "needs_review").length,
      ready: filtered.filter((r) => r.status === "ready").length,
      exported: filtered.filter((r) => r.status === "exported").length,
      delivered: filtered.filter((r) => r.status === "delivered").length,
      cancelled: filtered.filter(
        (r) => r.status === "cancelled" || r.status === "cancelled_after_export",
      ).length,
      totalCodValue: nonCancelled.reduce(
        (sum, r) => sum + (r.codValue ?? r.total ?? 0),
        0,
      ),
    };
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

export const markDelivered = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      await ctx.db.patch(recapId, { status: "delivered", deliveredAt: now, updatedAt: now });
      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_delivered",
        actor: "cs",
        metadata: { recapId },
        createdAt: now,
      });
    }
    return { success: true, count: args.recapIds.length };
  },
});

export const undoDelivered = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    await ctx.db.patch(args.recapId, { status: "exported", deliveredAt: undefined, updatedAt: Date.now() });
    return { success: true, recapId: args.recapId };
  },
});

export const markReadyBulk = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const recapId of args.recapIds) {
      await ctx.db.patch(recapId, { status: "ready", flags: [], updatedAt: now });
    }
    return { success: true, count: args.recapIds.length };
  },
});

export const markCancelledBulk = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")), reason: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      const status: RecapStatus = row.status === "exported" || row.status === "delivered" ? "cancelled_after_export" : "cancelled";
      await ctx.db.patch(recapId, { status, cancelReason: args.reason, cancelledAt: now, updatedAt: now });
      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_cancelled",
        actor: "cs",
        metadata: { recapId, reason: args.reason, status },
        createdAt: now,
      });
    }
    return { success: true, count: args.recapIds.length };
  },
});

export const markLatestCancelledByPhone = mutation({
  args: {
    customerPhone: v.string(),
    orderIdBerdu: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.customerPhone);
    const rows = args.orderIdBerdu
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_orderIdBerdu", (q) => q.eq("orderIdBerdu", normalizeOrderId(args.orderIdBerdu)))
          .take(1)
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_customerPhone", (q) => q.eq("customerPhone", phone))
          .order("desc")
          .take(1);
    const row = rows[0];
    if (!row) return { success: false, error: "recap not found", phone };

    const now = Date.now();
    const status: RecapStatus = row.status === "exported" || row.status === "delivered" ? "cancelled_after_export" : "cancelled";
    await ctx.db.patch(row._id, {
      status,
      cancelReason: args.reason || "-Cancel",
      cancelledAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancelled",
      actor: "cs",
      metadata: { recapId: row._id, reason: args.reason || "-Cancel", status, source: "chat_command" },
      createdAt: now,
    });

    return { success: true, recapId: row._id, status, phone };
  },
});

export const importBerduVerifiedRows = mutation({
  args: {
    rows: v.array(berduVerifiedRowValidator),
    importBatchId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: Array<{ orderIdBerdu: string; recapId: Id<"shippingRecaps">; action: "inserted" | "updated" }> = [];

    for (const row of args.rows) {
      const orderIdBerdu = normalizeOrderId(row.orderIdBerdu);
      const customerPhone = normalizePhone(row.customerPhone);
      const recipientPhone = normalizePhone(row.recipientPhone || row.customerPhone);
      const order = await findOrder(ctx, { orderIdBerdu, customerPhone });
      const conversation = await findConversation(ctx, { orderIdBerdu, customerPhone });
      const existing = await findExistingRecap(ctx, {
        orderIdBerdu,
        customerPhone,
        conversationId: conversation?._id,
      });
      const status: RecapStatus =
        existing?.status === "exported" || existing?.status === "delivered" || existing?.status === "cancelled" || existing?.status === "cancelled_after_export"
          ? existing.status
          : "ready";
      const flags = unique([...(existing?.flags ?? []).filter((flag) => flag !== "MISSING_ORDER_CONTEXT"), "BERDU_VERIFIED"]);
      const payload = {
        orderIdBerdu,
        conversationId: conversation?._id,
        customerPhone,
        customerName: row.customerName || order?.customerName || conversation?.customerName || "",
        csName: row.csName || order?.assignedCsName || conversation?.assignedCsName || "",
        csPhone: order?.assignedCsNumber,
        orderedAt: order?.createdAt ?? row.orderedAt,
        closedAt: row.closedAt,
        recipientName: row.recipientName || row.customerName || order?.customerName || "",
        recipientPhone,
        recipientAddress: row.recipientAddress,
        recipientDistrict: row.recipientDistrict,
        recipientCity: row.recipientCity,
        packageContent: row.packageContent,
        paymentMethod: row.paymentMethod,
        nonCodItemPrice: row.paymentMethod === "transfer" ? row.itemPrice ?? row.total : undefined,
        codValue: row.paymentMethod === "cod" ? row.total : undefined,
        shippingCost: row.shippingCost,
        total: row.total,
        discount: row.discount,
        inferredDiscount: undefined,
        status,
        flags,
        sourceMessageId: `berdu:${orderIdBerdu}:${args.importBatchId}`,
        sourceMessageText: row.sourceMessageText,
        updatedAt: now,
      };

      let recapId: Id<"shippingRecaps">;
      let action: "inserted" | "updated";
      if (existing) {
        recapId = existing._id;
        action = "updated";
        await ctx.db.patch(existing._id, {
          ...payload,
          version: existing.version + 1,
        });
      } else {
        action = "inserted";
        recapId = await ctx.db.insert("shippingRecaps", {
          ...payload,
          version: 1,
          createdAt: now,
        });
      }

      await ctx.db.insert("events", {
        conversationId: conversation?._id,
        orderId: orderIdBerdu,
        customerPhone,
        type: "shipping_recap_upserted",
        actor: "cs",
        metadata: { recapId, source: "berdu_csv", importBatchId: args.importBatchId, action },
        createdAt: now,
      });

      results.push({ orderIdBerdu, recapId, action });
    }

    return {
      success: true,
      importBatchId: args.importBatchId,
      inserted: results.filter((row) => row.action === "inserted").length,
      updated: results.filter((row) => row.action === "updated").length,
      count: results.length,
      sample: results.slice(0, 10),
    };
  },
});

export const repairRecipientNamesFromOrders = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 1000);
    const rows = await ctx.db.query("shippingRecaps").order("desc").take(limit);
    const repaired: Array<{ recapId: Id<"shippingRecaps">; orderId?: string; recipientName: string }> = [];
    let skipped = 0;

    for (const row of rows) {
      const needsRepair = isGeneratedCustomerName(row.recipientName) || isGeneratedCustomerName(row.customerName);
      if (!needsRepair) {
        skipped += 1;
        continue;
      }

      const order = await findOrder(ctx, { orderIdBerdu: row.orderIdBerdu, customerPhone: row.customerPhone });
      if (!order || isGeneratedCustomerName(order.customerName)) {
        skipped += 1;
        continue;
      }

      const parsed = applyOrderFallbacks(parseClosingMessage(row.sourceMessageText), order);
      const comparison = compareWithOrder(parsed, order);
      const nextStatus: RecapStatus =
        row.status === "exported" || row.status === "delivered" || row.status === "cancelled" || row.status === "cancelled_after_export"
          ? row.status
          : comparison.flags.length > 0
            ? "needs_review"
            : parsed.status;

      await ctx.db.patch(row._id, {
        customerName: order.customerName,
        recipientName: parsed.recipientName || order.customerName,
        recipientPhone: parsed.recipientPhone || normalizePhone(order.customerPhone),
        recipientAddress:
          parsed.recipientAddress ||
          [order.shippingAddress, order.shippingDistrict, order.shippingCity].filter(Boolean).join(", "),
        recipientDistrict: parsed.recipientDistrict || order.shippingDistrict || "",
        recipientCity: parsed.recipientCity || order.shippingCity || "",
        flags: comparison.flags,
        status: nextStatus,
        updatedAt: Date.now(),
      });

      repaired.push({ recapId: row._id, orderId: row.orderIdBerdu, recipientName: parsed.recipientName || order.customerName });
    }

    return { success: true, repaired: repaired.length, skipped, sample: repaired.slice(0, 10) };
  },
});

export const getPerformance = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    includeInferredDiscount: v.optional(v.boolean()),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .order("desc")
      .collect();

    const realOrders = orders.filter(
      (order) => !isInternalTestPhone(order.customerPhone) && (!args.csName || order.assignedCsName === args.csName),
    );
    const validCandidateRows = recaps.filter(
      (row) =>
        row.status !== "cancelled" &&
        row.status !== "cancelled_after_export" &&
        (!args.csName || row.csName === args.csName) &&
        !isInternalTestPhone(row.customerPhone),
    );
    const totalDelivered = recaps.filter(
      (row) => row.status === "delivered" && (!args.csName || row.csName === args.csName) && !isInternalTestPhone(row.customerPhone),
    ).length;
    const validClosingRows = validCandidateRows;
    const latestOrderByPhone = new Map<string, Doc<"orders">>();
    // Dedup by orderIdBerdu (unique order) with phone fallback.
    // Phone-only dedup was too aggressive: same customer with 2 separate orders got only 1 closing counted.
    const latestClosingByKey = new Map<string, Doc<"shippingRecaps">>();

    for (const order of realOrders) {
      const phone = normalizePhone(order.customerPhone);
      const existing = latestOrderByPhone.get(phone);
      if (!existing || order.createdAt > existing.createdAt) latestOrderByPhone.set(phone, order);
    }

    for (const recap of validClosingRows) {
      const key = recap.orderIdBerdu || normalizePhone(recap.customerPhone);
      const existing = latestClosingByKey.get(key);
      if (!existing || recap.closedAt > existing.closedAt) latestClosingByKey.set(key, recap);
    }

    const uniqueOrders = Array.from(latestOrderByPhone.values());
    const validClosings = Array.from(latestClosingByKey.values());

    // For closings whose order isn't in the date-range window (order created before startAt),
    // do a targeted fallback lookup by orderIdBerdu or customerPhone.
    const fallbackOrderByPhone = new Map<string, Doc<"orders">>();
    for (const recap of validClosings) {
      const phone = normalizePhone(recap.customerPhone);
      if (latestOrderByPhone.has(phone)) continue; // already covered by date-range orders
      if (fallbackOrderByPhone.has(phone)) continue; // already fetched
      if (recap.packageContent && recap.csName) continue; // no fallback needed
      // Try by orderIdBerdu first (exact match), then by customerPhone (latest)
      let order: Doc<"orders"> | null = null;
      if (recap.orderIdBerdu) {
        order = await ctx.db
          .query("orders")
          .withIndex("by_orderId", (q) => q.eq("orderId", recap.orderIdBerdu!))
          .unique();
      }
      if (!order) {
        const all = await ctx.db
          .query("orders")
          .withIndex("by_customerPhone", (q) => q.eq("customerPhone", phone))
          .collect();
        order = all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      }
      if (order) fallbackOrderByPhone.set(phone, order);
    }

    const productMap = new Map<string, { product: string; leads: number; closing: number; revenue: number; discount: number }>();
    const csMap = new Map<string, { csName: string; leads: number; closing: number; revenue: number; discount: number }>();

    for (const order of uniqueOrders) {
      const product = normalizeProductName(order.productName || order.products);
      const productRow = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      productRow.leads += 1;
      productMap.set(product, productRow);

      const csName = normalizeCsName(order.assignedCsName);
      const csRow = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      csRow.leads += 1;
      csMap.set(csName, csRow);
    }

    for (const recap of validClosings) {
      const phone = normalizePhone(recap.customerPhone);
      const matchedOrder = latestOrderByPhone.get(phone) ?? fallbackOrderByPhone.get(phone);
      const product = normalizeProductName(recap.packageContent || matchedOrder?.productName || matchedOrder?.products);
      const revenue = recap.total ?? recap.codValue ?? recap.nonCodItemPrice ?? 0;
      const discount = recap.discount ?? (args.includeInferredDiscount ? recap.inferredDiscount ?? 0 : 0);
      const productRow = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      productRow.closing += 1;
      productRow.revenue += revenue;
      productRow.discount += discount;
      productMap.set(product, productRow);

      const csName = normalizeCsName(recap.csName || matchedOrder?.assignedCsName);
      const csRow = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      csRow.closing += 1;
      csRow.revenue += revenue;
      csRow.discount += discount;
      csMap.set(csName, csRow);
    }

    const totalLeads = uniqueOrders.length;
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
      delivered: totalDelivered,
      cancelled: recaps.filter(
        (row) =>
          (row.status === "cancelled" || row.status === "cancelled_after_export") &&
          (!args.csName || row.csName === args.csName) &&
          !isInternalTestPhone(row.customerPhone),
      ).length,
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

// One-off backfill: patch csName on recaps/orders/conversations for a list of Berdu order IDs.
// Run via: npx convex run shippingRecaps:backfillCsNameByOrderIds '{"orderIds":["O-260528000047","O-260530000074","O-260530000071","O-260530000042"],"csName":"CS Risma"}'
export const backfillCsNameByOrderIds = mutation({
  args: { orderIds: v.array(v.string()), csName: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: Array<{ orderId: string; recap: string; order: string; conversation: string }> = [];

    for (const rawId of args.orderIds) {
      const orderId = normalizeOrderId(rawId);
      let recapAction = "not_found";
      let orderAction = "not_found";
      let conversationAction = "not_found";

      const recap = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_orderIdBerdu", (q) => q.eq("orderIdBerdu", orderId))
        .first();
      if (recap) {
        await ctx.db.patch(recap._id, { csName: args.csName, updatedAt: now });
        recapAction = "patched";
      }

      const order = await ctx.db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .unique();
      if (order) {
        await ctx.db.patch(order._id, { assignedCsName: args.csName, updatedAt: now });
        orderAction = "patched";
      }

      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .unique();
      if (conversation) {
        await ctx.db.patch(conversation._id, { assignedCsName: args.csName, updatedAt: now });
        conversationAction = "patched";
      }

      results.push({ orderId, recap: recapAction, order: orderAction, conversation: conversationAction });
    }

    return { success: true, csName: args.csName, results };
  },
});

// One-off backfill: patch customerName + csName on conversations/orders/recaps by phone number.
// Run via: npx convex run shippingRecaps:backfillByPhone '{"entries":[{"phone":"6285260251151","customerName":"Fika Syi Farol","csName":"CS Risma"}]}'
export const backfillByPhone = mutation({
  args: {
    entries: v.array(v.object({ phone: v.string(), customerName: v.string(), csName: v.string() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: Array<{ phone: string; conversations: number; orders: number; recaps: number }> = [];

    for (const entry of args.entries) {
      const phone = normalizePhone(entry.phone);

      const conversations = await ctx.db
        .query("conversations")
        .withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", phone))
        .collect();
      for (const conv of conversations) {
        await ctx.db.patch(conv._id, { customerName: entry.customerName, assignedCsName: entry.csName, updatedAt: now });
      }

      const orders = await ctx.db
        .query("orders")
        .withIndex("by_customerPhone", (q) => q.eq("customerPhone", phone))
        .collect();
      for (const order of orders) {
        await ctx.db.patch(order._id, { customerName: entry.customerName, assignedCsName: entry.csName, updatedAt: now });
      }

      const recaps = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_customerPhone", (q) => q.eq("customerPhone", phone))
        .collect();
      for (const recap of recaps) {
        await ctx.db.patch(recap._id, { customerName: entry.customerName, csName: entry.csName, updatedAt: now });
      }

      results.push({ phone, conversations: conversations.length, orders: orders.length, recaps: recaps.length });
    }

    return { success: true, results };
  },
});
