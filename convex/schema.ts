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
    .index("by_createdAt", ["createdAt"])
    .index("by_assignedCsName_createdAt", ["assignedCsName", "createdAt"])
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

  csConfigs: defineTable({
    normalizedName: v.string(),
    csName: v.string(),
    csPhone: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerNumberId: v.optional(v.string()),
    orderAutomationEnabled: v.boolean(),
    aiAssistantEnabled: v.boolean(),
    reportingEnabled: v.boolean(),
    isActive: v.boolean(),
    avatarStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_normalizedName", ["normalizedName"])
    .index("by_active", ["isActive"]),

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
    .index("by_createdAt", ["createdAt"])
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_customerPhone_createdAt", ["customerPhone", "createdAt"])
    .index("by_orderId_createdAt", ["orderId", "createdAt"])
    .index("by_externalMessageId", ["externalMessageId"]),

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
      v.literal("shipping_recap_upserted"),
      v.literal("shipping_recap_exported"),
      v.literal("shipping_recap_delivered"),
      v.literal("shipping_recap_cancelled"),
      v.literal("shipping_recap_cancel_undone"),
      v.literal("shipping_recap_marked_ready"),
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

  shippingRecaps: defineTable({
    orderIdBerdu: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    customerPhone: v.string(),
    customerName: v.string(),
    csName: v.string(),
    csPhone: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    closedAt: v.number(),
    recipientName: v.string(),
    recipientPhone: v.string(),
    recipientAddress: v.string(),
    recipientDistrict: v.string(),
    recipientCity: v.string(),
    packageContent: v.string(),
    paymentMethod: v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown")),
    nonCodItemPrice: v.optional(v.number()),
    codValue: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    total: v.optional(v.number()),
    discount: v.optional(v.number()),
    inferredDiscount: v.optional(v.number()),
    bumpOrder: v.optional(v.string()),
    upsell: v.optional(v.string()),
    specialBonus: v.optional(v.string()),
    shippingInstruction: v.optional(v.string()),
    status: v.union(
      v.literal("ready"),
      v.literal("needs_review"),
      v.literal("exported"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("cancelled_after_export"),
    ),
    flags: v.array(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceMessageText: v.string(),
    version: v.number(),
    exportedAt: v.optional(v.number()),
    exportBatchId: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orderIdBerdu", ["orderIdBerdu"])
    .index("by_customerPhone", ["customerPhone"])
    .index("by_closedAt", ["closedAt"])
    .index("by_status_closedAt", ["status", "closedAt"])
    .index("by_csName_closedAt", ["csName", "closedAt"])
    .index("by_paymentMethod_closedAt", ["paymentMethod", "closedAt"]),

  settings: defineTable({
    key: v.string(),
    value: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  closingRules: defineTable({
    phrase: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_active", ["active"]),

  users: defineTable({
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("cs")),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),
});
