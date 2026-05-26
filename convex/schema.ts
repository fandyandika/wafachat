import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  customers: defineTable({
    phone: v.string(),
    name: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_phone", ["phone"]),

  orders: defineTable({
    orderId: v.string(),
    customerPhone: v.string(),
    customerName: v.string(),
    assignedCsName: v.string(),
    assignedCsNumber: v.optional(v.string()),
    productName: v.string(),
    products: v.string(),
    productsSubtotal: v.string(),
    shippingCost: v.string(),
    total: v.string(),
    shippingAddress: v.string(),
    shippingDistrict: v.string(),
    shippingCity: v.string(),
    source: v.literal("berdu"),
    aiEligible: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orderId", ["orderId"])
    .index("by_customerPhone", ["customerPhone"])
    .index("by_aiEligible_createdAt", ["aiEligible", "createdAt"]),

  conversations: defineTable({
    orderId: v.string(),
    customerPhone: v.string(),
    customerName: v.string(),
    assignedCsName: v.string(),
    status: v.union(v.literal("active"), v.literal("handover"), v.literal("closed")),
    aiEnabled: v.boolean(),
    note: v.string(),
    lastMessageAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orderId", ["orderId"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_customerPhone_updatedAt", ["customerPhone", "updatedAt"])
    .index("by_assignedCsName_status", ["assignedCsName", "status"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    orderId: v.string(),
    customerPhone: v.string(),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button")),
    source: v.union(v.literal("kirimchat"), v.literal("panel"), v.literal("n8n")),
    externalMessageId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_customerPhone_createdAt", ["customerPhone", "createdAt"])
    .index("by_orderId_createdAt", ["orderId", "createdAt"]),

  events: defineTable({
    conversationId: v.optional(v.id("conversations")),
    orderId: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    type: v.union(
      v.literal("order_upserted"),
      v.literal("message_inbound"),
      v.literal("ai_reply_sent"),
      v.literal("handover"),
      v.literal("pause_ai"),
      v.literal("resume_ai"),
      v.literal("closed"),
      v.literal("reactivated"),
      v.literal("closing_detected"),
      v.literal("order_deleted"),
      v.literal("order_cancelled"),
      v.literal("cancel_undone"),
      v.literal("global_ai_changed"),
    ),
    actor: v.union(v.literal("system"), v.literal("ai"), v.literal("cs"), v.literal("n8n")),
    metadata: v.any(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_type_createdAt", ["type", "createdAt"]),

  dailyStats: defineTable({
    date: v.string(),
    orders: v.number(),
    closings: v.number(),
    aiClosings: v.optional(v.number()),
    manualClosings: v.optional(v.number()),
    cancelled: v.optional(v.number()),
    handovers: v.number(),
    closedToday: v.number(),
    orderKeys: v.array(v.string()),
    closingKeys: v.array(v.string()),
    aiClosingKeys: v.optional(v.array(v.string())),
    manualClosingKeys: v.optional(v.array(v.string())),
    cancelledKeys: v.optional(v.array(v.string())),
    handoverKeys: v.array(v.string()),
    closedKeys: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  settings: defineTable({
    key: v.string(),
    value: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
