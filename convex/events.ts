import { mutation } from "./_generated/server";
import { requireAdmin } from "./authz";
import { v } from "convex/values";
import { requireDefaultOrgId } from "./orgs";

export const appendEvent = mutation({
  args: {
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
      v.literal("global_ai_changed"),
    ),
    actor: v.union(v.literal("system"), v.literal("ai"), v.literal("cs"), v.literal("n8n")),
    metadata: v.any(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "events.appendEvent");
    const orgId = await requireDefaultOrgId(ctx);
    const eventId = await ctx.db.insert("events", {
      ...args,
      createdAt: args.createdAt ?? Date.now(),
      orgId,
    });

    return { success: true, eventId };
  },
});
