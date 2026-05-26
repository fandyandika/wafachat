import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const appendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    orderId: v.string(),
    customerPhone: v.string(),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button")),
    source: v.union(v.literal("kirimchat"), v.literal("panel"), v.literal("n8n")),
    externalMessageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const messageId = await ctx.db.insert("messages", { ...args, createdAt });

    await ctx.db.patch(args.conversationId, { lastMessageAt: createdAt, updatedAt: createdAt });
    await ctx.db.insert("events", {
      conversationId: args.conversationId,
      orderId: args.orderId,
      customerPhone: args.customerPhone,
      type: args.direction === "inbound" ? "message_inbound" : "ai_reply_sent",
      actor: args.role === "ai" ? "ai" : args.role === "cs" ? "cs" : "n8n",
      metadata: {
        messageId,
        role: args.role,
        direction: args.direction,
        messageType: args.messageType,
        source: args.source,
      },
      createdAt,
    });

    return { success: true, messageId };
  },
});

export const listMessages = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(limit);

    return messages.reverse();
  },
});
