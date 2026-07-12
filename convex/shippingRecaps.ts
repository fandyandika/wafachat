import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireAdmin, requireMember, requireAdminOrg } from "./authz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isInternalTestPhone, csKey, canonicalizeProduct as canonicalizeProductLib, normalizeProductName as normalizeProductNameLib, windowKeyFor } from "./lib";
import { getActiveClosingPhrases } from "./closingRules";
import { bumpForOrderDoc, bumpForRecapDoc, computeRollupRow } from "./rollups";
import { performanceFromRollups } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";
import { requireDefaultOrgId } from "./orgs";
import { canonicalizeCs } from "./agents";

// Re-export from lib for backward compatibility
export const canonicalizeProduct = canonicalizeProductLib;
export const normalizeProductName = normalizeProductNameLib;

type RecapStatus = "ready" | "needs_review" | "exported" | "delivered" | "cancelled" | "cancelled_after_export";
type PaymentMethod = "cod" | "transfer" | "unknown";

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
  // Tolerant of both templates: "PEMBAYARAN TRANSFER" and "Pembayaran: `COD / ...`".
  const m = text.match(/(?:PEMBAYARAN|ORDER)\b[\s:`*_]*(COD|TRANSFER)/i);
  if (m) return /cod/i.test(m[1]) ? "cod" : "transfer";
  if (/\bTRANSFER\b/i.test(text) && !/\bCOD\b/i.test(text)) return "transfer";
  if (/\bCOD\b/i.test(text) && !/\bTRANSFER\b/i.test(text)) return "cod";
  return "unknown";
}

function extractLineValue(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*[*_\`]*${escaped}[*_\`]*\\s*:\\s*(.+)$`, "im"));
  return cleanMarkdown(match?.[1]?.trim() ?? "");
}

function extractAmount(text: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Tolerant of "Total: Rp198.000", "*Total: Rp198.000*", "Harga Rp.205.000",
  // and "Harga Rp. *205.000*" (bold/spaced amount, with or without colon).
  const match = text.match(
    new RegExp(`[*_\`]*${escaped}[*_\`]*\\s*:?\\s*(?:Rp|[.\\s*_\`])*([\\d][\\d.,]*)`, "im"),
  );
  return match ? parseRupiah(match[1]) : undefined;
}

function extractProduct(text: string): string {
  const labeled = extractLineValue(text, "Produk");
  if (labeled) return labeled;
  // Some templates put the product as a bold header line (no "Produk:" label),
  // typically just above the price line.
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const priceIdx = lines.findIndex((line) => /^[*_\`]*\s*(Harga|Total)\b/i.test(line));
  const scope = priceIdx > 0 ? lines.slice(0, priceIdx) : lines;
  for (let i = scope.length - 1; i >= 0; i--) {
    if (!/^\*[^*\n].*\*$/.test(scope[i])) continue; // a fully *bold* line
    const value = cleanMarkdown(scope[i]);
    if (!value || /PEMESANAN\s+BERHASIL/i.test(value) || /^(NOTE|BONUS|CATATAN|Dikirim)/i.test(value)) continue;
    return value;
  }
  return "";
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

export function parseClosingMessage(sourceMessageText: string) {
  const text = normalizeText(sourceMessageText);
  const shippingBlock = extractShippingBlock(text);
  const recipient = parseRecipient(shippingBlock);
  const packageContent = extractProduct(text);
  const total = extractAmount(text, "Total") ?? extractAmount(text, "Harga");
  const shippingCost = extractAmount(text, "Ongkir");
  const itemPrice = extractAmount(text, "Harga");
  const discount = extractAmount(text, "Diskon");
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


export function normalizeCsName(value: string | undefined): string {
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

async function findOrder(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }, orgId: Id<"organizations">) {
  if (args.orderIdBerdu) {
    const byOrderId = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrderId) return byOrderId as Doc<"orders">;
  }

  return (await ctx.db
    .query("orders")
    .withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", args.customerPhone))
    .order("desc")
    .first()) as Doc<"orders"> | null;
}

async function findConversation(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }, orgId: Id<"organizations">) {
  if (args.orderIdBerdu) {
    const byOrder = await ctx.db
      .query("conversations")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrder) return byOrder as Doc<"conversations">;
  }

  return (await ctx.db
    .query("conversations")
    .withIndex("by_org_customerPhone_updatedAt", (q: any) => q.eq("orgId", orgId).eq("customerPhone", args.customerPhone))
    .order("desc")
    .first()) as Doc<"conversations"> | null;
}

async function findExistingRecap(
  ctx: { db: any },
  args: { orderIdBerdu?: string; customerPhone: string; conversationId?: Id<"conversations"> },
  orgId: Id<"organizations">,
) {
  if (args.orderIdBerdu) {
    const byOrder = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q: any) => q.eq("orgId", orgId).eq("orderIdBerdu", args.orderIdBerdu!))
      .first();
    if (byOrder) return byOrder as Doc<"shippingRecaps">;
  }

  const recentByPhone = (await ctx.db
    .query("shippingRecaps")
    .withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", args.customerPhone))
    .order("desc")
    .take(10)) as Doc<"shippingRecaps">[];

  return recentByPhone.find((row) => row.conversationId === args.conversationId) ?? recentByPhone[0] ?? null;
}

export const upsertFromN8n = internalMutation({
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
    const orgId = await requireDefaultOrgId(ctx);
    const closedAt = args.closedAt ?? now;
    const order = await findOrder(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone }, orgId);
    const conversation = await findConversation(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone }, orgId);
    const parsed = applyOrderFallbacks(parseClosingMessage(args.sourceMessageText), order);
    const comparison = compareWithOrder(parsed, order);
    const existing = await findExistingRecap(ctx, {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      conversationId: conversation?._id,
    }, orgId);

    const rawResolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    const canonCs = await canonicalizeCs(ctx, rawResolvedCsName);
    const resolvedCsName = canonCs.csName;
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
      csKey: canonCs.key,
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
      const before = existing;
      await ctx.db.patch(existing._id, {
        ...payload,
        version: existing.version + 1,
      });
      const after = await ctx.db.get(existing._id);
      await bumpForRecapDoc(ctx, before, after);
    } else {
      recapId = await ctx.db.insert("shippingRecaps", {
        ...payload,
        version: 1,
        createdAt: now,
        orgId,
      });
      const after = await ctx.db.get(recapId);
      await bumpForRecapDoc(ctx, null, after);
    }

    await ctx.db.insert("events", {
      conversationId: conversation?._id,
      orderId: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      type: "shipping_recap_upserted",
      actor: "n8n",
      metadata: { recapId, status, flags },
      orgId,
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
    await requireAdmin(ctx, "shippingRecaps.createFromPanelClosing");
    const now = Date.now();
    const orgId = await requireDefaultOrgId(ctx);
    const order = await findOrder(ctx, { orderIdBerdu: args.orderId, customerPhone: args.customerPhone }, orgId);
    const conversation = await findConversation(ctx, { orderIdBerdu: args.orderId, customerPhone: args.customerPhone }, orgId);
    const existing = await findExistingRecap(ctx, {
      orderIdBerdu: args.orderId ?? order?.orderId,
      customerPhone: args.customerPhone,
      conversationId: conversation?._id,
    }, orgId);

    // Don't overwrite already-exported or delivered recaps
    if (existing && (existing.status === "exported" || existing.status === "delivered")) {
      return { success: true, recapId: existing._id, status: existing.status, _action: "create_from_panel_closing", skipped: true };
    }

    const rawResolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    const canonCs = await canonicalizeCs(ctx, rawResolvedCsName);
    const resolvedCsName = canonCs.csName;
    const panelFlags: string[] = order ? ["MANUAL_CLOSING"] : ["MANUAL_CLOSING", "NO_ORDER_DATA"];
    if (!resolvedCsName) panelFlags.push("NO_CS_DATA");
    const payload = {
      orderIdBerdu: args.orderId ?? order?.orderId,
      conversationId: conversation?._id,
      customerPhone: args.customerPhone,
      customerName: order?.customerName ?? conversation?.customerName ?? "",
      csName: resolvedCsName,
      csKey: canonCs.key,
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
      const before = existing;
      await ctx.db.patch(existing._id, { ...payload, version: existing.version + 1 });
      const after = await ctx.db.get(existing._id);
      await bumpForRecapDoc(ctx, before, after);
    } else {
      recapId = await ctx.db.insert("shippingRecaps", { ...payload, version: 1, createdAt: now, orgId });
      const after = await ctx.db.get(recapId);
      await bumpForRecapDoc(ctx, null, after);
    }

    await ctx.db.insert("events", {
      conversationId: conversation?._id,
      orderId: args.orderId ?? order?.orderId,
      customerPhone: args.customerPhone,
      type: "shipping_recap_upserted",
      actor: "cs",
      metadata: { recapId, source: "panel_manual_closing" },
      createdAt: now,
      orgId,
    });

    return { success: true, recapId, status: "needs_review", _action: "create_from_panel_closing" };
  },
});

export function messageMatchesPhrase(content: string, phrases: string[]): boolean {
  const haystack = String(content || "").toUpperCase();
  return phrases.some((p) => haystack.includes(p));
}

export async function upsertRecapFromMessage(
  ctx: any,
  message: { orderId?: string; customerPhone: string; content: string; externalMessageId?: string; _id: any; createdAt: number },
  opts: { force?: boolean; orgId: Id<"organizations"> },
): Promise<{ recapId: Id<"shippingRecaps">; action: "created" | "updated" | "skipped" }> {
  const order = await findOrder(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone }, opts.orgId);
  const conversation = await findConversation(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone }, opts.orgId);
  const parsed = applyOrderFallbacks(parseClosingMessage(message.content), order);
  const comparison = compareWithOrder(parsed, order);
  const existing = await findExistingRecap(ctx, {
    orderIdBerdu: message.orderId || order?.orderId,
    customerPhone: message.customerPhone,
    conversationId: conversation?._id,
  }, opts.orgId);
  if (existing && (existing.status === "exported" || existing.status === "delivered")) {
    return { recapId: existing._id, action: "skipped" };
  }
  const flags = comparison.flags;
  const status: RecapStatus = flags.length > 0 ? "needs_review" : parsed.status;
  const sourceMessageId = message.externalMessageId ?? message._id;
  const payload = {
    orderIdBerdu: message.orderId || order?.orderId,
    conversationId: conversation?._id,
    customerPhone: message.customerPhone,
    customerName: order?.customerName ?? conversation?.customerName ?? "",
    csName: order?.assignedCsName ?? conversation?.assignedCsName ?? "",
    csKey: csKey(order?.assignedCsName ?? conversation?.assignedCsName ?? ""),
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
    sourceMessageId,
    sourceMessageText: message.content,
    updatedAt: Date.now(),
  };
  if (existing && existing.sourceMessageId === sourceMessageId && !opts?.force) {
    return { recapId: existing._id, action: "skipped" };
  }
  if (existing) {
    const before = existing;
    await ctx.db.patch(existing._id, { ...payload, version: existing.version + 1 });
    const after = await ctx.db.get(existing._id);
    await bumpForRecapDoc(ctx, before, after);
    return { recapId: existing._id, action: "updated" };
  }
  const recapId = await ctx.db.insert("shippingRecaps", { ...payload, version: 1, createdAt: Date.now(), orgId: opts.orgId });
  const after = await ctx.db.get(recapId);
  await bumpForRecapDoc(ctx, null, after);
  return { recapId, action: "created" };
}

export const backfillFromMessages = mutation({
  args: {
    limit: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.backfillFromMessages");
    const orgId = await requireDefaultOrgId(ctx);
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

    const phrases = await getActiveClosingPhrases(ctx);
    for (const message of messages) {
      if (args.startAt && message.createdAt < args.startAt) continue;
      if (args.endAt && message.createdAt > args.endAt) continue;
      if (message.direction !== "outbound") continue;
      if (!messageMatchesPhrase(message.content, phrases)) continue;
      scanned += 1;
      const result = await upsertRecapFromMessage(ctx, message, { force: args.force, orgId });
      if (result.action === "skipped") {
        skipped += 1;
        continue;
      }
      upserted += 1;
      recapIds.push(result.recapId);
    }

    return { success: true, scanned, upserted, skipped, recapIds };
  },
});

// One-off cleanup: re-parse `needs_review` recaps from their stored closing message
// with the current parser, filling only MISSING fields. Never overwrites data a CS
// already entered, and never touches exported/delivered/cancelled recaps.
export const reparseNeedsReview = mutation({
  args: {
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.reparseNeedsReview");
    const limit = Math.min(args.limit ?? 1000, 2000);
    const rows =
      args.startAt !== undefined && args.endAt !== undefined
        ? await ctx.db
            .query("shippingRecaps")
            .withIndex("by_status_closedAt", (q) =>
              q.eq("status", "needs_review").gte("closedAt", args.startAt!).lte("closedAt", args.endAt!),
            )
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("shippingRecaps")
            .withIndex("by_status_closedAt", (q) => q.eq("status", "needs_review"))
            .order("desc")
            .take(limit);

    let updated = 0;
    for (const row of rows) {
      if (!row.sourceMessageText || row.sourceMessageText === "manual_closing_by_cs") continue;
      const parsed = parseClosingMessage(row.sourceMessageText);
      const patch: Record<string, unknown> = {};
      if (!row.packageContent && parsed.packageContent) patch.packageContent = parsed.packageContent;
      if ((!row.paymentMethod || row.paymentMethod === "unknown") && parsed.paymentMethod !== "unknown") {
        patch.paymentMethod = parsed.paymentMethod;
      }
      if (row.total === undefined && parsed.total !== undefined) patch.total = parsed.total;
      if (row.codValue === undefined && parsed.paymentMethod === "cod" && parsed.total !== undefined) {
        patch.codValue = parsed.total;
      }
      if (
        row.nonCodItemPrice === undefined &&
        parsed.paymentMethod === "transfer" &&
        parsed.nonCodItemPrice !== undefined
      ) {
        patch.nonCodItemPrice = parsed.nonCodItemPrice;
      }
      if (Object.keys(patch).length === 0) continue;
      patch.updatedAt = Date.now();
      const before = row;
      await ctx.db.patch(row._id, patch);
      const after = await ctx.db.get(row._id);
      await bumpForRecapDoc(ctx, before, after);
      updated += 1;
    }
    return { success: true, updated, scanned: rows.length };
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
    await requireMember(ctx, "shippingRecaps.list");
    const internalPhones = await getInternalPhoneSet(ctx);
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
      .filter((row) => !isInternalTestPhone(row.customerPhone, internalPhones))
      .filter((row) => !args.csName || csKey(row.csName) === csKey(args.csName))
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
    await requireMember(ctx, "shippingRecaps.getCounts");
    const internalPhones = await getInternalPhoneSet(ctx);
    const rows = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();

    const filtered = rows.filter(
      (row) =>
        !isInternalTestPhone(row.customerPhone, internalPhones) &&
        (!args.csName || csKey(row.csName) === csKey(args.csName)),
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
    await requireAdmin(ctx, "shippingRecaps.updateFields");
    const { recapId, ...patch } = args;
    const before = await ctx.db.get(recapId);
    await ctx.db.patch(recapId, {
      ...patch,
      status: "ready",
      flags: [],
      updatedAt: Date.now(),
    });
    const after = await ctx.db.get(recapId);
    await bumpForRecapDoc(ctx, before, after);
    return { success: true, recapId };
  },
});

export const markReady = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markReady");
    const before = await ctx.db.get(args.recapId);
    await ctx.db.patch(args.recapId, { status: "ready", flags: [], updatedAt: Date.now() });
    const after = await ctx.db.get(args.recapId);
    await bumpForRecapDoc(ctx, before, after);
    return { success: true, recapId: args.recapId };
  },
});

export const markCancelled = mutation({
  args: { recapId: v.id("shippingRecaps"), reason: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markCancelled");
    const orgId = await requireDefaultOrgId(ctx);
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status: RecapStatus = row.status === "exported" ? "cancelled_after_export" : "cancelled";
    const now = Date.now();
    const before = row;
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: args.reason,
      cancelledAt: now,
      updatedAt: now,
    });
    const after = await ctx.db.get(args.recapId);
    await bumpForRecapDoc(ctx, before, after);
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancelled",
      actor: "cs",
      metadata: { recapId: args.recapId, reason: args.reason, status },
      createdAt: now,
      orgId,
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const undoCancelled = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.undoCancelled");
    const orgId = await requireDefaultOrgId(ctx);
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status: RecapStatus = row.flags.length > 0 ? "needs_review" : "ready";
    const now = Date.now();
    const before = row;
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: undefined,
      cancelledAt: undefined,
      updatedAt: now,
    });
    const after = await ctx.db.get(args.recapId);
    await bumpForRecapDoc(ctx, before, after);
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancel_undone",
      actor: "cs",
      metadata: { recapId: args.recapId, status },
      createdAt: now,
      orgId,
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const markExported = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")), exportBatchId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markExported");
    const orgId = await requireDefaultOrgId(ctx);
    const now = Date.now();
    const pairs = new Map<string, { k: string; w: string }>();

    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      const before = row;
      await ctx.db.patch(recapId, {
        status: "exported",
        exportedAt: now,
        exportBatchId: args.exportBatchId,
        updatedAt: now,
      });
      const after = await ctx.db.get(recapId);

      // Collect affected pairs for batch rollup computation
      for (const doc of [before, after]) {
        if (!doc?.closedAt) continue;
        const k = csKey(doc.csName);
        const w = windowKeyFor(doc.closedAt);
        pairs.set(`${k}|${w}`, { k, w });
      }

      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_exported",
        actor: "cs",
        metadata: { recapId, exportBatchId: args.exportBatchId },
        createdAt: now,
        orgId,
      });
    }

    // Single batch rollup computation for all affected cs+window pairs
    for (const { k, w } of pairs.values()) {
      await computeRollupRow(ctx, k, w);
    }

    return { success: true, count: args.recapIds.length, exportBatchId: args.exportBatchId };
  },
});

export const markDelivered = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markDelivered");
    const now = Date.now();
    const pairs = new Map<string, { k: string; w: string }>();

    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      const before = row;
      await ctx.db.patch(recapId, { status: "delivered", deliveredAt: now, updatedAt: now });
      const after = await ctx.db.get(recapId);

      // Collect affected pairs for batch rollup computation
      for (const doc of [before, after]) {
        if (!doc?.closedAt) continue;
        const k = csKey(doc.csName);
        const w = windowKeyFor(doc.closedAt);
        pairs.set(`${k}|${w}`, { k, w });
      }

      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_delivered",
        actor: "cs",
        metadata: { recapId },
        createdAt: now,
        orgId: row.orgId,
      });
    }

    // Single batch rollup computation for all affected cs+window pairs
    for (const { k, w } of pairs.values()) {
      await computeRollupRow(ctx, k, w);
    }

    return { success: true, count: args.recapIds.length };
  },
});

export const undoDelivered = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.undoDelivered");
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const before = row;
    await ctx.db.patch(args.recapId, { status: "exported", deliveredAt: undefined, updatedAt: Date.now() });
    const after = await ctx.db.get(args.recapId);
    await bumpForRecapDoc(ctx, before, after);
    return { success: true, recapId: args.recapId };
  },
});

export const markReadyBulk = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markReadyBulk");
    const now = Date.now();
    const pairs = new Map<string, { k: string; w: string }>();

    for (const recapId of args.recapIds) {
      const before = await ctx.db.get(recapId);
      if (!before) continue;
      await ctx.db.patch(recapId, { status: "ready", flags: [], updatedAt: now });
      const after = await ctx.db.get(recapId);

      // Collect affected pairs for batch rollup computation
      for (const doc of [before, after]) {
        if (!doc?.closedAt) continue;
        const k = csKey(doc.csName);
        const w = windowKeyFor(doc.closedAt);
        pairs.set(`${k}|${w}`, { k, w });
      }
    }

    // Single batch rollup computation for all affected cs+window pairs
    for (const { k, w } of pairs.values()) {
      await computeRollupRow(ctx, k, w);
    }

    return { success: true, count: args.recapIds.length };
  },
});

export const markCancelledBulk = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")), reason: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.markCancelledBulk");
    const now = Date.now();
    const pairs = new Map<string, { k: string; w: string }>();

    for (const recapId of args.recapIds) {
      const row = await ctx.db.get(recapId);
      if (!row) continue;
      const status: RecapStatus = row.status === "exported" || row.status === "delivered" ? "cancelled_after_export" : "cancelled";
      const before = row;
      await ctx.db.patch(recapId, { status, cancelReason: args.reason, cancelledAt: now, updatedAt: now });
      const after = await ctx.db.get(recapId);

      // Collect affected pairs for batch rollup computation
      for (const doc of [before, after]) {
        if (!doc?.closedAt) continue;
        const k = csKey(doc.csName);
        const w = windowKeyFor(doc.closedAt);
        pairs.set(`${k}|${w}`, { k, w });
      }

      await ctx.db.insert("events", {
        conversationId: row.conversationId,
        orderId: row.orderIdBerdu,
        customerPhone: row.customerPhone,
        type: "shipping_recap_cancelled",
        actor: "cs",
        metadata: { recapId, reason: args.reason, status },
        createdAt: now,
        orgId: row.orgId,
      });
    }

    // Single batch rollup computation for all affected cs+window pairs
    for (const { k, w } of pairs.values()) {
      await computeRollupRow(ctx, k, w);
    }

    return { success: true, count: args.recapIds.length };
  },
});

export const markLatestCancelledByPhone = internalMutation({
  args: {
    customerPhone: v.string(),
    orderIdBerdu: v.optional(v.string()),
    reason: v.optional(v.string()),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.customerPhone);
    const rows = args.orderIdBerdu
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", args.orgId).eq("orderIdBerdu", normalizeOrderId(args.orderIdBerdu)))
          .take(1)
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_org_customerPhone", (q) => q.eq("orgId", args.orgId).eq("customerPhone", phone))
          .order("desc")
          .take(1);
    const row = rows[0];
    if (!row) return { success: false, error: "recap not found", phone };

    const now = Date.now();
    const status: RecapStatus = row.status === "exported" || row.status === "delivered" ? "cancelled_after_export" : "cancelled";
    const before = row;
    await ctx.db.patch(row._id, {
      status,
      cancelReason: args.reason || "-Cancel",
      cancelledAt: now,
      updatedAt: now,
    });
    const after = await ctx.db.get(row._id);
    await bumpForRecapDoc(ctx, before, after);
    await ctx.db.insert("events", {
      conversationId: row.conversationId,
      orderId: row.orderIdBerdu,
      customerPhone: row.customerPhone,
      type: "shipping_recap_cancelled",
      actor: "cs",
      metadata: { recapId: row._id, reason: args.reason || "-Cancel", status, source: "chat_command" },
      createdAt: now,
      orgId: row.orgId,
    });

    return { success: true, recapId: row._id, status, phone };
  },
});

export const importBerduVerifiedRows = internalMutation({
  args: {
    rows: v.array(berduVerifiedRowValidator),
    importBatchId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await requireDefaultOrgId(ctx);
    const now = Date.now();
    const results: Array<{ orderIdBerdu: string; recapId: Id<"shippingRecaps">; action: "inserted" | "updated" }> = [];
    const pairs = new Map<string, { k: string; w: string }>();

    for (const row of args.rows) {
      const orderIdBerdu = normalizeOrderId(row.orderIdBerdu);
      const customerPhone = normalizePhone(row.customerPhone);
      const recipientPhone = normalizePhone(row.recipientPhone || row.customerPhone);
      const order = await findOrder(ctx, { orderIdBerdu, customerPhone }, orgId);
      const conversation = await findConversation(ctx, { orderIdBerdu, customerPhone }, orgId);
      const existing = await findExistingRecap(ctx, {
        orderIdBerdu,
        customerPhone,
        conversationId: conversation?._id,
      }, orgId);
      const status: RecapStatus =
        existing?.status === "exported" || existing?.status === "delivered" || existing?.status === "cancelled" || existing?.status === "cancelled_after_export"
          ? existing.status
          : "ready";
      const flags = unique([...(existing?.flags ?? []).filter((flag) => flag !== "MISSING_ORDER_CONTEXT"), "BERDU_VERIFIED"]);
      const rawImportCsName = row.csName || order?.assignedCsName || conversation?.assignedCsName || "";
      const canonImport = await canonicalizeCs(ctx, rawImportCsName);
      const payload = {
        orderIdBerdu,
        conversationId: conversation?._id,
        customerPhone,
        customerName: row.customerName || order?.customerName || conversation?.customerName || "",
        csName: canonImport.csName,
        csKey: canonImport.key,
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
        const before = existing;
        await ctx.db.patch(existing._id, {
          ...payload,
          version: existing.version + 1,
        });
        const after = await ctx.db.get(existing._id);

        // Collect affected pairs for batch rollup computation
        for (const doc of [before, after]) {
          if (!doc?.closedAt) continue;
          const k = csKey(doc.csName);
          const w = windowKeyFor(doc.closedAt);
          pairs.set(`${k}|${w}`, { k, w });
        }
      } else {
        action = "inserted";
        recapId = await ctx.db.insert("shippingRecaps", {
          ...payload,
          version: 1,
          createdAt: now,
          orgId,
        });
        const after = await ctx.db.get(recapId);

        // Collect affected pairs for batch rollup computation
        if (after?.closedAt) {
          const k = csKey(after.csName);
          const w = windowKeyFor(after.closedAt);
          pairs.set(`${k}|${w}`, { k, w });
        }
      }

      await ctx.db.insert("events", {
        conversationId: conversation?._id,
        orderId: orderIdBerdu,
        customerPhone,
        type: "shipping_recap_upserted",
        actor: "cs",
        metadata: { recapId, source: "berdu_csv", importBatchId: args.importBatchId, action },
        createdAt: now,
        orgId,
      });

      results.push({ orderIdBerdu, recapId, action });
    }

    // Single batch rollup computation for all affected cs+window pairs
    for (const { k, w } of pairs.values()) {
      await computeRollupRow(ctx, k, w);
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
    await requireAdmin(ctx, "shippingRecaps.repairRecipientNamesFromOrders");
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

      const order = await findOrder(ctx, { orderIdBerdu: row.orderIdBerdu, customerPhone: row.customerPhone }, row.orgId);
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

      const before = row;
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
      const after = await ctx.db.get(row._id);
      await bumpForRecapDoc(ctx, before, after);

      repaired.push({ recapId: row._id, orderId: row.orderIdBerdu, recipientName: parsed.recipientName || order.customerName });
    }

    return { success: true, repaired: repaired.length, skipped, sample: repaired.slice(0, 10) };
  },
});

export const getPerformanceLegacy = internalQuery({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    includeInferredDiscount: v.optional(v.boolean()),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const internalPhones = await getInternalPhoneSet(ctx);
    const key = args.csName ? csKey(args.csName) : null;
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
      (order) => !isInternalTestPhone(order.customerPhone, internalPhones) && (!key || csKey(order.assignedCsName) === key),
    );
    const validCandidateRows = recaps.filter(
      (row) =>
        row.status !== "cancelled" &&
        row.status !== "cancelled_after_export" &&
        (!key || csKey(row.csName) === key) &&
        !isInternalTestPhone(row.customerPhone, internalPhones),
    );
    const totalDelivered = recaps.filter(
      (row) => row.status === "delivered" && (!key || csKey(row.csName) === key) && !isInternalTestPhone(row.customerPhone, internalPhones),
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
      const product = canonicalizeProduct(order.productName || order.products);
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
      // Group closings under the canonical product name (same as leads) so the message's
      // SKU-style name (e.g. "QURAN MAPPING 1 PCS") doesn't fragment the breakdown — even when
      // no order matched and only the recap SKU is available.
      const product = canonicalizeProduct(matchedOrder?.productName || matchedOrder?.products || recap.packageContent);
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

    // CR in customer units: a double-ordering customer closing twice must not inflate
    // the rate (totalClosing stays order-level for volume/revenue).
    const closedCustomers = new Set(validClosings.map((r) => normalizePhone(r.customerPhone))).size;

    return {
      totalLeads,
      totalClosing,
      overallCr: totalLeads > 0 ? Math.round((closedCustomers / totalLeads) * 1000) / 10 : 0,
      totalCod: validClosings.filter((row) => row.paymentMethod === "cod").length,
      totalTransfer: validClosings.filter((row) => row.paymentMethod === "transfer").length,
      totalRevenue,
      totalDiscount,
      delivered: totalDelivered,
      cancelled: recaps.filter(
        (row) =>
          (row.status === "cancelled" || row.status === "cancelled_after_export") &&
          (!args.csName || csKey(row.csName) === csKey(args.csName)) &&
          !isInternalTestPhone(row.customerPhone, internalPhones),
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

export const getPerformance = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    includeInferredDiscount: v.optional(v.boolean()),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, "shippingRecaps.getPerformance");
    return performanceFromRollups(ctx, args);
  },
});

// One-off backfill: patch csName on recaps/orders/conversations for a list of Berdu order IDs.
// Run via: npx convex run shippingRecaps:backfillCsNameByOrderIds '{"orderIds":["O-260528000047","O-260530000074","O-260530000071","O-260530000042"],"csName":"CS Risma"}'
export const backfillCsNameByOrderIds = mutation({
  args: { orderIds: v.array(v.string()), csName: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "shippingRecaps.backfillCsNameByOrderIds");
    const now = Date.now();
    const results: Array<{ orderId: string; recap: string; order: string; conversation: string }> = [];
    const canonBf = await canonicalizeCs(ctx, args.csName);

    for (const rawId of args.orderIds) {
      const orderId = normalizeOrderId(rawId);
      let recapAction = "not_found";
      let orderAction = "not_found";
      let conversationAction = "not_found";

      const recap = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", orderId))
        .first();
      if (recap) {
        const recapBefore = recap;
        await ctx.db.patch(recap._id, { csName: canonBf.csName, csKey: canonBf.key, updatedAt: now });
        const recapAfter = await ctx.db.get(recap._id);
        await bumpForRecapDoc(ctx, recapBefore, recapAfter);
        recapAction = "patched";
      }

      const order = await ctx.db
        .query("orders")
        .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", orderId))
        .unique();
      if (order) {
        const orderBefore = order;
        await ctx.db.patch(order._id, { assignedCsName: canonBf.csName, csKey: canonBf.key, updatedAt: now });
        const orderAfter = await ctx.db.get(order._id);
        await bumpForOrderDoc(ctx, orderBefore, orderAfter);
        orderAction = "patched";
      }

      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", orderId))
        .unique();
      if (conversation) {
        await ctx.db.patch(conversation._id, { assignedCsName: canonBf.csName, updatedAt: now });
        conversationAction = "patched";
      }

      results.push({ orderId, recap: recapAction, order: orderAction, conversation: conversationAction });
    }

    return { success: true, csName: args.csName, results };
  },
});

// One-off admin: rename a CS everywhere (orders.assignedCsName / shippingRecaps.csName /
// conversations.assignedCsName) — e.g. a placeholder name to the real one.
// Run via: npx convex run shippingRecaps:renameCsName '{"from":"Afisah","to":"Nabila"}'
export const renameCsName = mutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "shippingRecaps.renameCsName");
    const now = Date.now();
    // B2a: route the hard rename target through the registry so a bulk merge into a
    // registered agent lands on that agent's canonical name+key (unregistered target
    // = same as before: {to, csKey(to)}). Resolve once — `to` is constant.
    const canonTo = await canonicalizeCs(ctx, args.to);
    let orders = 0;
    for (const o of await ctx.db.query("orders").collect()) {
      if (o.assignedCsName === args.from) {
        const orderBefore = o;
        await ctx.db.patch(o._id, { assignedCsName: canonTo.csName, csKey: canonTo.key, updatedAt: now });
        const orderAfter = await ctx.db.get(o._id);
        await bumpForOrderDoc(ctx, orderBefore, orderAfter);
        orders++;
      }
    }
    let recaps = 0;
    for (const r of await ctx.db.query("shippingRecaps").collect()) {
      if (r.csName === args.from) {
        const recapBefore = r;
        await ctx.db.patch(r._id, { csName: canonTo.csName, csKey: canonTo.key, updatedAt: now });
        const recapAfter = await ctx.db.get(r._id);
        await bumpForRecapDoc(ctx, recapBefore, recapAfter);
        recaps++;
      }
    }
    let conversations = 0;
    for (const c of await ctx.db
      .query("conversations")
      .withIndex("by_assignedCsName_status", (q) => q.eq("assignedCsName", args.from))
      .collect()) {
      await ctx.db.patch(c._id, { assignedCsName: canonTo.csName, updatedAt: now });
      conversations++;
    }
    return { from: args.from, to: canonTo.csName, orders, recaps, conversations };
  },
});

// One-off backfill: patch customerName + csName on conversations/orders/recaps by phone number.
// Run via: npx convex run shippingRecaps:backfillByPhone '{"entries":[{"phone":"6285260251151","customerName":"Fika Syi Farol","csName":"CS Risma"}]}'
export const backfillByPhone = mutation({
  args: {
    entries: v.array(v.object({ phone: v.string(), customerName: v.string(), csName: v.string() })),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "shippingRecaps.backfillByPhone");
    const now = Date.now();
    const results: Array<{ phone: string; conversations: number; orders: number; recaps: number }> = [];

    for (const entry of args.entries) {
      const phone = normalizePhone(entry.phone);

      const conversations = await ctx.db
        .query("conversations")
        .withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", phone))
        .collect();
      for (const conv of conversations) {
        await ctx.db.patch(conv._id, { customerName: entry.customerName, assignedCsName: entry.csName, updatedAt: now });
      }

      const orders = await ctx.db
        .query("orders")
        .withIndex("by_org_customerPhone", (q) => q.eq("orgId", orgId).eq("customerPhone", phone))
        .collect();
      for (const order of orders) {
        const orderBefore = order;
        await ctx.db.patch(order._id, { customerName: entry.customerName, assignedCsName: entry.csName, csKey: csKey(entry.csName), updatedAt: now });
        const orderAfter = await ctx.db.get(order._id);
        await bumpForOrderDoc(ctx, orderBefore, orderAfter);
      }

      const recaps = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_org_customerPhone", (q) => q.eq("orgId", orgId).eq("customerPhone", phone))
        .collect();
      for (const recap of recaps) {
        const recapBefore = recap;
        await ctx.db.patch(recap._id, { customerName: entry.customerName, csName: entry.csName, csKey: csKey(entry.csName), updatedAt: now });
        const recapAfter = await ctx.db.get(recap._id);
        await bumpForRecapDoc(ctx, recapBefore, recapAfter);
      }

      results.push({ phone, conversations: conversations.length, orders: orders.length, recaps: recaps.length });
    }

    return { success: true, results };
  },
});

