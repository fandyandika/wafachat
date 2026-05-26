import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ConversationStatus,
  getJakartaDate,
  isAisyah,
  makeOrderKey,
  makeTransitionKey,
  unique,
} from "./lib";

const statusValidator = v.union(v.literal("active"), v.literal("handover"), v.literal("closed"));

async function getGlobalEnabled(ctx: { db: any }): Promise<boolean> {
  const setting = await ctx.db
    .query("settings")
    .withIndex("by_key", (q: any) => q.eq("key", "global_ai_enabled"))
    .unique();

  return setting?.value !== false;
}

function emptyStats(date: string) {
  return {
    date,
    orders: 0,
    closings: 0,
    handovers: 0,
    closedToday: 0,
    orderKeys: [] as string[],
    closingKeys: [] as string[],
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
    field: "orders" | "closings" | "handovers" | "closedToday";
    keyField: "orderKeys" | "closingKeys" | "handoverKeys" | "closedKeys";
    key: string;
    date?: string;
    remove?: boolean;
  },
) {
  const stats = await getOrCreateStats(ctx, args.date);
  const keys = unique(stats[args.keyField] ?? []);
  const nextKeys = args.remove ? keys.filter((key) => key !== args.key) : unique([...keys, args.key]);

  await ctx.db.patch(stats._id, {
    [args.keyField]: nextKeys,
    [args.field]: nextKeys.length,
    updatedAt: Date.now(),
  });
}

async function getLatestConversationByPhone(ctx: { db: any }, phone: string) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_customerPhone_updatedAt", (q: any) => q.eq("customerPhone", phone))
    .order("desc")
    .first();
}

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

export const upsertOrderFromN8n = mutation({
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const orderId = args.order_id || makeOrderKey({ phone: args.phone, productName: args.productName });
    const customerName = args.customerName || "";
    const aiEligible = isAisyah(args.csName);

    const existingCustomer = await ctx.db
      .query("customers")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();

    if (existingCustomer) {
      await ctx.db.patch(existingCustomer._id, {
        name: customerName || existingCustomer.name,
        lastSeenAt: now,
      });
    } else {
      await ctx.db.insert("customers", {
        phone: args.phone,
        name: customerName,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    const orderPayload = {
      orderId,
      customerPhone: args.phone,
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
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .unique();

    if (existingOrder) {
      await ctx.db.patch(existingOrder._id, orderPayload);
    } else {
      await ctx.db.insert("orders", { ...orderPayload, createdAt: now });
    }

    let conversationId: Id<"conversations"> | null = null;
    if (aiEligible) {
      const existingConversation = await ctx.db
        .query("conversations")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .unique();

      if (existingConversation) {
        conversationId = existingConversation._id;
        await ctx.db.patch(existingConversation._id, {
          customerName,
          assignedCsName: args.csName,
          status: existingConversation.status === "closed" ? "active" : existingConversation.status,
          aiEnabled: true,
          updatedAt: now,
        });
      } else {
        conversationId = await ctx.db.insert("conversations", {
          orderId,
          customerPhone: args.phone,
          customerName,
          assignedCsName: args.csName,
          status: "active",
          aiEnabled: true,
          note: "",
          createdAt: now,
          updatedAt: now,
        });
      }

      await patchStatsWithKey(ctx, {
        field: "orders",
        keyField: "orderKeys",
        key: makeOrderKey({ orderId, phone: args.phone, productName: args.productName }),
      });
    }

    await ctx.db.insert("events", {
      conversationId: conversationId ?? undefined,
      orderId,
      customerPhone: args.phone,
      type: "order_upserted",
      actor: "n8n",
      metadata: { aiEligible, csName: args.csName },
      createdAt: now,
    });

    return { success: true, phone: args.phone, orderId, aiEligible, conversationId };
  },
});

export const setConversationStatusFromN8n = mutation({
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

    if (args.status === "handover" && previousStatus !== "handover") {
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

export const recordStatEventFromN8n = mutation({
  args: {
    field: v.union(v.literal("closings"), v.literal("handovers")),
    phone: v.optional(v.string()),
    order_id: v.optional(v.string()),
    productName: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
      await patchStatsWithKey(ctx, {
        field: "closings",
        keyField: "closingKeys",
        key,
        date: args.date,
      });

      if (conversation) {
        await ctx.db.insert("events", {
          conversationId: conversation._id,
          orderId: conversation.orderId,
          customerPhone: conversation.customerPhone,
          type: "closing_detected",
          actor: "ai",
          metadata: { key },
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

export const listConversations = query({
  args: { includeClosed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const statuses: ConversationStatus[] = args.includeClosed
      ? ["handover", "active", "closed"]
      : ["handover", "active"];
    const today = getJakartaDate();
    const rows: Doc<"conversations">[] = [];

    for (const status of statuses) {
      const statusRows = await ctx.db
        .query("conversations")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", status))
        .order("desc")
        .collect();
      rows.push(...statusRows);
    }

    const conversations = rows
      .filter((conversation) => isAisyah(conversation.assignedCsName))
      .filter((conversation) => conversation.status !== "closed" || getJakartaDate(conversation.updatedAt) === today);

    return await Promise.all(conversations.map(async (conversation) => {
      const order = await ctx.db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", conversation.orderId))
        .unique();

      return {
        phone: conversation.customerPhone,
        status: conversation.status,
        customerName: conversation.customerName,
        productName: order?.productName ?? "",
        csName: conversation.assignedCsName,
        csNumber: order?.assignedCsNumber ?? "",
        order_id: conversation.orderId,
        updatedAt: new Date(conversation.updatedAt).toISOString(),
        note: conversation.note,
      };
    }));
  },
});

export const getDailyStats = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const date = args.date ?? getJakartaDate();
    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();

    if (!stats) {
      return { success: true, date, orders: 0, closings: 0, handovers: 0, closed_today: 0, _action: "get_stats" };
    }

    return {
      success: true,
      date,
      orders: stats.orders,
      closings: stats.closings,
      handovers: stats.handovers,
      closed_today: stats.closedToday,
      _action: "get_stats",
    };
  },
});

export const health = query({
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

export const getConversationContextForN8n = query({
  args: { phone: v.string(), messageLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const conversation = await getLatestConversationByPhone(ctx, args.phone);
    const globalEnabled = await getGlobalEnabled(ctx);

    if (!conversation) {
      return {
        success: true,
        phone: args.phone,
        status: "active",
        globalEnabled,
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

    const limit = Math.min(args.messageLimit ?? 20, 50);
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
