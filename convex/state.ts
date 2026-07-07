import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireAdmin } from "./authz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ConversationStatus,
  csKey,
  getJakartaDate,
  makeOrderKey,
  makeTransitionKey,
  normalizePhone,
  startOfJakartaDayMs,
  unique,
} from "./lib";
import { getCsFeatureConfig } from "./csConfigs";

const statusValidator = v.union(v.literal("active"), v.literal("handover"), v.literal("closed"));

const EXCLUDED_PHONES = new Set(["6285715682110", "6285774076061", "628211900201"]);

async function getGlobalEnabled(ctx: { db: any }): Promise<boolean> {
  const setting = await ctx.db
    .query("settings")
    .withIndex("by_key", (q: any) => q.eq("key", "global_ai_enabled"))
    .unique();

  return setting?.value !== false;
}

// DEPRECATED (Fase 1A): dailyStats counters retired — metrics now derive-on-read (convex/metrics.ts).
// emptyStats / getOrCreateStats / patchStatsWithKey / patchClosingStatsWithKey are kept temporarily
// (the two writers are no-ops); remove together with getDailyStats once the panel deploy has cut over.
function emptyStats(date: string) {
  return {
    date,
    orders: 0,
    closings: 0,
    aiClosings: 0,
    manualClosings: 0,
    cancelled: 0,
    handovers: 0,
    closedToday: 0,
    orderKeys: [] as string[],
    closingKeys: [] as string[],
    aiClosingKeys: [] as string[],
    manualClosingKeys: [] as string[],
    cancelledKeys: [] as string[],
    handoverKeys: [] as string[],
    closedKeys: [] as string[],
    updatedAt: Date.now(),
  };
}

async function getOrCreateStats(ctx: { db: any }, date = getJakartaDate()): Promise<Doc<"dailyStats">> {
  const existing = await ctx.db
    .query("dailyStats")
    .withIndex("by_date", (q: any) => q.eq("date", date))
    .unique();

  if (existing) return existing;

  const id = await ctx.db.insert("dailyStats", emptyStats(date));
  return await ctx.db.get(id);
}

async function patchStatsWithKey(
  ctx: { db: any },
  args: {
    field: "orders" | "closings" | "handovers" | "closedToday" | "cancelled";
    keyField: "orderKeys" | "closingKeys" | "handoverKeys" | "closedKeys" | "cancelledKeys";
    key: string;
    date?: string;
    remove?: boolean;
  },
) {
  // DEPRECATED (Fase 1A): dailyStats counters retired; metrics derive-on-read via convex/metrics.ts. No-op.
  void ctx;
  void args;
}

async function patchClosingStatsWithKey(
  ctx: { db: any },
  args: {
    key: string;
    source?: "ai" | "manual";
    date?: string;
    remove?: boolean;
  },
) {
  // DEPRECATED (Fase 1A): dailyStats counters retired; metrics derive-on-read via convex/metrics.ts. No-op.
  void ctx;
  void args;
}

async function getLatestConversationByPhone(ctx: { db: any }, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  return await ctx.db
    .query("conversations")
    .withIndex("by_customerPhone_updatedAt", (q: any) => q.eq("customerPhone", normalizedPhone))
    .order("desc")
    .first();
}

export const createTestConversation = mutation({
  args: {
    phone: v.string(),
    csName: v.optional(v.string()),
    productName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.createTestConversation");
    const now = Date.now();
    const phone = normalizePhone(args.phone);
    const csName = args.csName ?? "CS Aisyah";
    const productName = args.productName ?? "Test Product";
    const orderId = `TEST-${phone}-${Date.now()}`;
    const csConfig = await getCsFeatureConfig(ctx, csName);
    const reportable = csConfig.isActive && csConfig.reportingEnabled;
    const aiEligible = reportable && csConfig.aiAssistantEnabled;

    const existingCustomer = await ctx.db
      .query("customers")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    if (existingCustomer) {
      await ctx.db.patch(existingCustomer._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("customers", { phone, name: "Test Customer", firstSeenAt: now, lastSeenAt: now });
    }

    await ctx.db.insert("orders", {
      orderId,
      customerPhone: phone,
      customerName: "Test Customer",
      assignedCsName: csName,
      productName,
      products: productName,
      productsSubtotal: "",
      shippingCost: "",
      total: "",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu" as const,
      aiEligible,
      createdAt: now,
      updatedAt: now,
    });

    const conversationId = await ctx.db.insert("conversations", {
      orderId,
      customerPhone: phone,
      customerName: "Test Customer",
      assignedCsName: csName,
      status: "active",
      aiEnabled: aiEligible,
      note: "",
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, phone, orderId, conversationId, aiEnabled: aiEligible, csName };
  },
});

// DEPRECATED (Fase 1A): dailyStats retired (metrics derive-on-read). Manual repair no longer needed; kept temporarily.
export const repairDailyStats = mutation({
  args: {
    date: v.string(),
    orders: v.optional(v.number()),
    closings: v.optional(v.number()),
    aiClosings: v.optional(v.number()),
    manualClosings: v.optional(v.number()),
    cancelled: v.optional(v.number()),
    handovers: v.optional(v.number()),
    closedToday: v.optional(v.number()),
    clearOrderKeys: v.optional(v.boolean()),
    clearClosingKeys: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.repairDailyStats");
    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .unique();

    if (!stats) return { success: false, error: "stats not found", date: args.date };

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.orders !== undefined) patch.orders = args.orders;
    if (args.closings !== undefined) patch.closings = args.closings;
    if (args.aiClosings !== undefined) patch.aiClosings = args.aiClosings;
    if (args.manualClosings !== undefined) patch.manualClosings = args.manualClosings;
    if (args.cancelled !== undefined) patch.cancelled = args.cancelled;
    if (args.handovers !== undefined) patch.handovers = args.handovers;
    if (args.closedToday !== undefined) patch.closedToday = args.closedToday;
    if (args.clearOrderKeys) patch.orderKeys = [];
    if (args.clearClosingKeys) {
      patch.closingKeys = [];
      patch.aiClosingKeys = [];
      patch.manualClosingKeys = [];
    }

    await ctx.db.patch(stats._id, patch);
    return { success: true, date: args.date, patch };
  },
});

async function getConversationForArgs(ctx: { db: any }, args: { orderId?: string; phone?: string }) {
  if (args.orderId) {
    const byOrder = await ctx.db
      .query("conversations")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId!))
      .unique();
    if (byOrder) return byOrder;
  }

  if (args.phone) return await getLatestConversationByPhone(ctx, args.phone);
  return null;
}

export async function upsertOrderCore(
  ctx: any,
  args: {
    phone: string;
    csName: string;
    csNumber?: string;
    productName?: string;
    products?: string;
    productsSubtotal?: string;
    shippingCost?: string;
    total?: string;
    customerName?: string;
    shippingAddress?: string;
    shippingDistrict?: string;
    shippingCity?: string;
    order_id?: string;
    createdAt?: number;
  },
) {
  const now = Date.now();
  const phone = normalizePhone(args.phone);
  const orderId = args.order_id || makeOrderKey({ phone, productName: args.productName });
  const customerName = args.customerName || "";
  const csConfig = await getCsFeatureConfig(ctx, args.csName);
  const reportable = csConfig.isActive && csConfig.reportingEnabled;
  const aiEligible = reportable && csConfig.aiAssistantEnabled;

  const existingCustomer = await ctx.db
    .query("customers")
    .withIndex("by_phone", (q: any) => q.eq("phone", phone))
    .unique();

  if (existingCustomer) {
    await ctx.db.patch(existingCustomer._id, {
      name: customerName || existingCustomer.name,
      lastSeenAt: now,
    });
  } else {
    await ctx.db.insert("customers", {
      phone,
      name: customerName,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  const orderPayload = {
    orderId,
    customerPhone: phone,
    customerName,
    assignedCsName: args.csName,
    assignedCsNumber: args.csNumber,
    productName: args.productName || "",
    products: args.products || "",
    productsSubtotal: args.productsSubtotal || "",
    shippingCost: args.shippingCost || "",
    total: args.total || "",
    shippingAddress: args.shippingAddress || "",
    shippingDistrict: args.shippingDistrict || "",
    shippingCity: args.shippingCity || "",
    source: "berdu" as const,
    aiEligible,
    updatedAt: now,
  };

  const existingOrder = await ctx.db
    .query("orders")
    .withIndex("by_orderId", (q: any) => q.eq("orderId", orderId))
    .unique();

  if (existingOrder) {
    await ctx.db.patch(existingOrder._id, {
      ...orderPayload,
      ...(args.createdAt !== undefined ? { createdAt: args.createdAt } : {}),
    });
  } else {
    await ctx.db.insert("orders", { ...orderPayload, createdAt: args.createdAt ?? now });
  }

  let conversationId: Id<"conversations"> | null = null;
  if (reportable) {
    const existingConversation = await ctx.db
      .query("conversations")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", orderId))
      .unique();

    if (existingConversation) {
      conversationId = existingConversation._id;
      await ctx.db.patch(existingConversation._id, {
        customerName,
        assignedCsName: args.csName,
        status: existingConversation.status === "active" ? "active"
          : existingConversation.status === "closed" || aiEligible ? "active"
          : existingConversation.status,
        aiEnabled: aiEligible,
        ...(args.createdAt !== undefined ? { createdAt: args.createdAt } : {}),
        updatedAt: now,
      });
    } else {
      conversationId = await ctx.db.insert("conversations", {
        orderId,
        customerPhone: phone,
        customerName,
        assignedCsName: args.csName,
        status: "active",
        aiEnabled: aiEligible,
        note: "",
        createdAt: args.createdAt ?? now,
        updatedAt: now,
      });
    }

    await patchStatsWithKey(ctx, {
      field: "orders",
      keyField: "orderKeys",
      key: makeOrderKey({ orderId, phone, productName: args.productName }),
    });
  }

  await ctx.db.insert("events", {
    conversationId: conversationId ?? undefined,
    orderId,
    customerPhone: phone,
    type: "order_upserted",
    actor: "n8n",
    metadata: {
      aiEligible,
      reportable,
      orderAutomationEnabled: csConfig.orderAutomationEnabled,
      csName: args.csName,
    },
    createdAt: now,
  });

  return { success: true, phone, orderId, aiEligible, reportable, conversationId };
}

export const upsertOrderFromN8n = internalMutation({
  args: {
    phone: v.string(),
    csName: v.string(),
    csNumber: v.optional(v.string()),
    productName: v.optional(v.string()),
    products: v.optional(v.string()),
    productsSubtotal: v.optional(v.string()),
    shippingCost: v.optional(v.string()),
    total: v.optional(v.string()),
    customerName: v.optional(v.string()),
    shippingAddress: v.optional(v.string()),
    shippingDistrict: v.optional(v.string()),
    shippingCity: v.optional(v.string()),
    order_id: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => upsertOrderCore(ctx, args),
});

// Reconciler support: list the present per-day order counters for a Berdu date
// prefix (e.g. "260624" -> orderIds "O-260624######"). The n8n reconciler diffs
// these against Berdu's sequential daily numbering to find dropped orders to
// backfill via /order/detail. Returns only the counters present in WaFaChat.
export const listOrderCountersByPrefix = internalQuery({
  args: { datePrefix: v.string() },
  handler: async (ctx, args) => {
    const lo = `O-${args.datePrefix}000000`;
    const hi = `O-${args.datePrefix}999999`;
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_orderId", (q) => q.gte("orderId", lo).lte("orderId", hi))
      .collect();
    const counters = rows
      .map((r) => parseInt(r.orderId.slice(-6), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    return {
      datePrefix: args.datePrefix,
      counters,
      min: counters[0] ?? null,
      max: counters[counters.length - 1] ?? null,
      count: counters.length,
    };
  },
});

export const setConversationStatusFromN8n = internalMutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    status: statusValidator,
    note: v.optional(v.string()),
    customerName: v.optional(v.string()),
    csNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "set" };
    }

    const previousStatus = conversation.status;
    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });

    await ctx.db.patch(conversation._id, {
      status: args.status,
      note: args.note ?? conversation.note,
      customerName: args.customerName ?? conversation.customerName,
      updatedAt: now,
    });

    if (args.status === "handover" && previousStatus !== "handover" && conversation.aiEnabled) {
      await patchStatsWithKey(ctx, {
        field: "handovers",
        keyField: "handoverKeys",
        key: transitionKey,
      });
    }

    if (args.status === "closed" && previousStatus !== "closed") {
      await patchStatsWithKey(ctx, {
        field: "closedToday",
        keyField: "closedKeys",
        key: transitionKey,
      });
    }

    if (previousStatus === "closed" && args.status !== "closed") {
      await patchStatsWithKey(ctx, {
        field: "closedToday",
        keyField: "closedKeys",
        key: transitionKey,
        remove: true,
      });
    }

    const eventType =
      args.status === "handover"
        ? "pause_ai"
        : args.status === "active"
          ? previousStatus === "closed"
            ? "reactivated"
            : "resume_ai"
          : "closed";

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: eventType,
      actor: "n8n",
      metadata: { previousStatus, status: args.status, note: args.note ?? "" },
      createdAt: now,
    });

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      status: args.status,
      previousStatus,
      note: args.note ?? conversation.note,
      customerName: args.customerName ?? conversation.customerName,
      updated_at: new Date(now).toISOString(),
      _action: "set",
    };
  },
});

export const markConversationNotClosing = mutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.markConversationNotClosing");
    const now = Date.now();
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "not_closing" };
    }

    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });
    const nextNote = args.note ?? "not closing / corrected by CS";
    const previousStatus = conversation.status;

    await patchStatsWithKey(ctx, {
      field: "closedToday",
      keyField: "closedKeys",
      key: transitionKey,
      remove: true,
    });

    await patchClosingStatsWithKey(ctx, {
      key: transitionKey,
      remove: true,
    });
    await patchStatsWithKey(ctx, {
      field: "cancelled",
      keyField: "cancelledKeys",
      key: transitionKey,
      remove: true,
    });

    await ctx.db.patch(conversation._id, {
      status: "active",
      note: nextNote,
      updatedAt: now,
    });

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: "reactivated",
      actor: "cs",
      metadata: { previousStatus, status: "active", note: nextNote, closingCorrected: true },
      createdAt: now,
    });

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      status: "active",
      previousStatus,
      note: nextNote,
      _action: "not_closing",
    };
  },
});

export const markConversationCancelled = mutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.markConversationCancelled");
    const now = Date.now();
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "mark_cancelled" };
    }

    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });
    const nextNote = args.note ?? "customer cancelled";

    await patchClosingStatsWithKey(ctx, {
      key: transitionKey,
      remove: true,
    });
    await patchStatsWithKey(ctx, {
      field: "cancelled",
      keyField: "cancelledKeys",
      key: transitionKey,
    });

    await ctx.db.patch(conversation._id, {
      note: nextNote,
      updatedAt: now,
    });

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: "order_cancelled",
      actor: "cs",
      metadata: { key: transitionKey, note: nextNote },
      createdAt: now,
    });

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      status: conversation.status,
      note: nextNote,
      _action: "mark_cancelled",
    };
  },
});

export const undoConversationCancelled = mutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.undoConversationCancelled");
    const now = Date.now();
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "undo_cancelled" };
    }

    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });
    const nextNote = args.note ?? "cancel undone by CS";

    await patchStatsWithKey(ctx, {
      field: "cancelled",
      keyField: "cancelledKeys",
      key: transitionKey,
      remove: true,
    });

    await ctx.db.patch(conversation._id, {
      note: nextNote,
      updatedAt: now,
    });

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: "cancel_undone",
      actor: "cs",
      metadata: { key: transitionKey, note: nextNote },
      createdAt: now,
    });

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      status: conversation.status,
      note: nextNote,
      _action: "undo_cancelled",
    };
  },
});

export const markConversationClosing = mutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.markConversationClosing");
    const now = Date.now();
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "mark_closing" };
    }

    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });
    const nextNote = args.note ?? "manual closing by CS";

    await patchClosingStatsWithKey(ctx, {
      key: transitionKey,
      source: "manual",
    });

    await ctx.db.patch(conversation._id, {
      note: nextNote,
      updatedAt: now,
    });

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: "closing_detected",
      actor: "cs",
      metadata: { key: transitionKey, source: "manual", note: nextNote },
      createdAt: now,
    });

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      status: conversation.status,
      note: nextNote,
      _action: "mark_closing",
    };
  },
});

export const deleteConversationOrder = mutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "state.deleteConversationOrder");
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });

    if (!conversation) {
      return { success: false, error: "conversation not found", phone: args.phone, _action: "delete_order" };
    }

    const transitionKey = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone,
      conversation,
    });
    const orderKey = makeOrderKey({
      orderId: conversation.orderId,
      phone: conversation.customerPhone,
    });

    await patchStatsWithKey(ctx, {
      field: "orders",
      keyField: "orderKeys",
      key: orderKey,
      remove: true,
    });
    await patchStatsWithKey(ctx, {
      field: "handovers",
      keyField: "handoverKeys",
      key: transitionKey,
      remove: true,
    });
    await patchStatsWithKey(ctx, {
      field: "closedToday",
      keyField: "closedKeys",
      key: transitionKey,
      remove: true,
    });
    await patchClosingStatsWithKey(ctx, {
      key: transitionKey,
      remove: true,
    });
    await patchStatsWithKey(ctx, {
      field: "cancelled",
      keyField: "cancelledKeys",
      key: transitionKey,
      remove: true,
    });

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversation._id))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", conversation.orderId))
      .unique();
    if (order) {
      await ctx.db.delete(order._id);
    }

    await ctx.db.insert("events", {
      conversationId: conversation._id,
      orderId: conversation.orderId,
      customerPhone: conversation.customerPhone,
      type: "order_deleted",
      actor: "cs",
      metadata: { transitionKey },
      createdAt: Date.now(),
    });

    await ctx.db.delete(conversation._id);

    return {
      success: true,
      phone: conversation.customerPhone,
      order_id: conversation.orderId,
      _action: "delete_order",
    };
  },
});

export const recordStatEventFromN8n = internalMutation({
  args: {
    field: v.union(v.literal("closings"), v.literal("handovers")),
    phone: v.optional(v.string()),
    order_id: v.optional(v.string()),
    productName: v.optional(v.string()),
    date: v.optional(v.string()),
    source: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    if (args.phone && EXCLUDED_PHONES.has(normalizePhone(args.phone))) {
      return { success: true, skipped: true, reason: "excluded_phone", _action: "increment_stat" };
    }
    const conversation = await getConversationForArgs(ctx, { orderId: args.order_id, phone: args.phone });
    const key = makeTransitionKey({
      orderId: args.order_id,
      phone: args.phone || conversation?.customerPhone || "",
      productName: args.productName,
      conversation,
    });

    if (!key || key === ":") {
      return { success: false, error: "stat identity missing", field: args.field, _action: "increment_stat" };
    }

    if (args.field === "closings") {
      await patchClosingStatsWithKey(ctx, {
        key,
        source: args.source ?? "ai",
        date: args.date,
      });

      if (conversation) {
        await ctx.db.insert("events", {
          conversationId: conversation._id,
          orderId: conversation.orderId,
          customerPhone: conversation.customerPhone,
          type: "closing_detected",
          actor: args.source === "manual" ? "cs" : "ai",
          metadata: { key, source: args.source ?? "ai" },
          createdAt: Date.now(),
        });
      }
    } else {
      await patchStatsWithKey(ctx, {
        field: "handovers",
        keyField: "handoverKeys",
        key,
        date: args.date,
      });
    }

    const stats = await getOrCreateStats(ctx, args.date);
    return {
      success: true,
      date: stats.date,
      field: args.field,
      key,
      deduped: true,
      value: args.field === "closings" ? stats.closings : stats.handovers,
      _action: "increment_stat",
    };
  },
});

export const listConversations = internalQuery({
  args: { includeClosed: v.optional(v.boolean()), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const startToday = startOfJakartaDayMs();
    const rows: Doc<"conversations">[] = [];

    // active + handover: small, unbounded.
    for (const status of ["handover", "active"] as const) {
      rows.push(
        ...(await ctx.db
          .query("conversations")
          .withIndex("by_status_updatedAt", (q) => q.eq("status", status))
          .order("desc")
          .collect()),
      );
    }
    // closed: bound to TODAY (Asia/Jakarta) at the DB index level — no full-history scan.
    if (args.includeClosed) {
      rows.push(
        ...(await ctx.db
          .query("conversations")
          .withIndex("by_status_updatedAt", (q) => q.eq("status", "closed").gte("updatedAt", startToday))
          .order("desc")
          .collect()),
      );
    }

    const conversations = rows
      .filter((conversation) => !EXCLUDED_PHONES.has(normalizePhone(conversation.customerPhone)))
      .filter((conversation) => !args.csName || csKey(conversation.assignedCsName) === csKey(args.csName));

    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", getJakartaDate()))
      .unique();

    // de-N+1: prefetch each referenced order once (deduped) into a Map.
    const orderIds = unique(conversations.map((c) => c.orderId));
    const orderDocs = await Promise.all(
      orderIds.map((id) =>
        ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", id)).unique(),
      ),
    );
    const orderById = new Map(
      orderDocs.filter((o): o is NonNullable<typeof o> => o !== null).map((o) => [o.orderId, o]),
    );

    return conversations.map((conversation) => {
      const order = orderById.get(conversation.orderId) ?? null;
      const transitionKey = makeTransitionKey({
        orderId: conversation.orderId,
        phone: conversation.customerPhone,
        conversation,
      });
      const manualClosing = Boolean(stats?.manualClosingKeys?.includes(transitionKey));
      const aiClosing = Boolean(stats?.aiClosingKeys?.includes(transitionKey));
      const totalClosing = Boolean(stats?.closingKeys?.includes(transitionKey));
      const cancelled = Boolean(stats?.cancelledKeys?.includes(transitionKey));

      return {
        conversationId: conversation._id,
        phone: conversation.customerPhone,
        status: conversation.status,
        customerName: conversation.customerName,
        productName: order?.productName ?? "",
        products: order?.products ?? "",
        productsSubtotal: order?.productsSubtotal ?? "",
        shippingCost: order?.shippingCost ?? "",
        total: order?.total ?? "",
        shippingAddress: order?.shippingAddress ?? "",
        shippingDistrict: order?.shippingDistrict ?? "",
        shippingCity: order?.shippingCity ?? "",
        csName: conversation.assignedCsName,
        csNumber: order?.assignedCsNumber ?? "",
        order_id: conversation.orderId,
        updatedAt: new Date(conversation.updatedAt).toISOString(),
        note: conversation.note,
        aiEnabled: conversation.aiEnabled,
        salesOutcome: cancelled ? "cancelled" : manualClosing ? "manual_won" : aiClosing || totalClosing ? "ai_won" : "pending",
        closingSource: manualClosing ? "manual" : aiClosing || totalClosing ? "ai" : null,
      };
    });
  },
});

// DEPRECATED (Fase 1A): superseded by api.metrics.getDashboardSummary (derive-on-read). Kept until panel deploy cuts over.
export const getDailyStats = internalQuery({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const date = args.date ?? getJakartaDate();
    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();

    if (!stats) {
      return {
        success: true,
        date,
        orders: 0,
        closings: 0,
        ai_closings: 0,
        manual_closings: 0,
        cancelled: 0,
        handovers: 0,
        closed_today: 0,
        _action: "get_stats",
      };
    }

    return {
      success: true,
      date,
      orders: stats.orders,
      closings: stats.closings,
      ai_closings: stats.aiClosings ?? Math.max(stats.closings - (stats.manualClosings ?? 0), 0),
      manual_closings: stats.manualClosings ?? 0,
      cancelled: stats.cancelled ?? 0,
      handovers: stats.handovers,
      closed_today: stats.closedToday,
      _action: "get_stats",
    };
  },
});

export const health = internalQuery({
  args: {},
  handler: async (ctx) => {
    const globalEnabled = await getGlobalEnabled(ctx);
    const date = getJakartaDate();
    await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();

    return {
      success: true,
      service: "wafachat-convex-state-manager",
      schemaReady: true,
      globalEnabled,
      date,
      _action: "health",
    };
  },
});

export const getConversationContextForN8n = internalQuery({
  args: { phone: v.string(), messageLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);
    const conversation = await getLatestConversationByPhone(ctx, phone);
    const globalEnabled = await getGlobalEnabled(ctx);

    if (!conversation) {
      return {
        success: true,
        phone,
        status: "active",
        globalEnabled,
        aiEnabled: false,
        canAiReply: false,
        csName: "",
        productName: "",
        order_id: "",
        messages: [],
        _action: "get_with_global",
      };
    }

    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderId", (q) => q.eq("orderId", conversation.orderId))
      .unique();
    const csConfig = await getCsFeatureConfig(ctx, conversation.assignedCsName);

    const limit = Math.min(args.messageLimit ?? 50, 50);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", conversation._id))
      .order("desc")
      .take(limit);

    return {
      success: true,
      phone: conversation.customerPhone,
      status: conversation.status,
      globalEnabled,
      aiEnabled: conversation.aiEnabled,
      canAiReply: globalEnabled && conversation.aiEnabled && conversation.status === "active" && !EXCLUDED_PHONES.has(phone),
      reportingEnabled: csConfig.isActive && csConfig.reportingEnabled,
      orderAutomationEnabled: csConfig.isActive && csConfig.orderAutomationEnabled,
      note: conversation.note,
      updated_at: new Date(conversation.updatedAt).toISOString(),
      csName: conversation.assignedCsName,
      productName: order?.productName ?? "",
      products: order?.products ?? "",
      productsSubtotal: order?.productsSubtotal ?? "",
      shippingCost: order?.shippingCost ?? "",
      total: order?.total ?? "",
      customerName: conversation.customerName,
      shippingAddress: order?.shippingAddress ?? "",
      shippingDistrict: order?.shippingDistrict ?? "",
      shippingCity: order?.shippingCity ?? "",
      order_id: conversation.orderId,
      messages: messages.reverse().map((message) => ({
        role: message.role,
        direction: message.direction,
        content: message.content,
        messageType: message.messageType,
        createdAt: message.createdAt,
      })),
      _action: "get_with_global",
    };
  },
});
