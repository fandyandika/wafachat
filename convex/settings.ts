import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const GLOBAL_AI_KEY = "global_ai_enabled";

export const getGlobalAiEnabled = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_org_key", (q) => q.eq("orgId", args.orgId).eq("key", GLOBAL_AI_KEY))
      .unique();

    return setting?.value !== false;
  },
});

export const setGlobalAiEnabled = internalMutation({
  args: { enabled: v.boolean(), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_org_key", (q) => q.eq("orgId", args.orgId).eq("key", GLOBAL_AI_KEY))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: args.enabled, updatedAt: now });
    } else {
      await ctx.db.insert("settings", { key: GLOBAL_AI_KEY, value: args.enabled, updatedAt: now, orgId: args.orgId });
    }

    await ctx.db.insert("events", {
      type: "global_ai_changed",
      actor: "cs",
      metadata: { enabled: args.enabled },
      createdAt: now,
      orgId: args.orgId,
    });

    return { success: true, globalEnabled: args.enabled };
  },
});
