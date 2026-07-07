import { query, mutation } from "./_generated/server";
import { requireAdmin, requireMember } from "./authz";
import { v } from "convex/values";
import { csKey, normalizeCsName } from "./lib";
import { DEFAULT_CONFIGS } from "./csConfigs";

type CsRow = {
  csName: string; normalizedName: string; key: string; avatarUrl: string | null;
  isActive: boolean; orderAutomationEnabled: boolean; aiAssistantEnabled: boolean;
  reportingEnabled: boolean; autoFollowUpEnabled?: boolean; csPhone?: string;
};

export const listCs = query({
  args: {},
  handler: async (ctx): Promise<CsRow[]> => {
    await requireMember(ctx, "cs.listCs");
    // CS registry comes from csConfigs (~6 rows) + built-in DEFAULT_CONFIGS — NOT from a
    // 90-day scan of the orders table (that read ~18k docs on every render, on every page,
    // and was the single biggest avoidable DB I/O cost). New CS are registered in Settings.
    const stored = await ctx.db.query("csConfigs").collect();

    type Entry = {
      csName: string; isActive: boolean; orderAutomationEnabled: boolean; aiAssistantEnabled: boolean;
      reportingEnabled: boolean; autoFollowUpEnabled?: boolean; csPhone?: string; avatarStorageId?: typeof stored[number]["avatarStorageId"];
    };
    const byKey = new Map<string, Entry>();
    // Built-in defaults first…
    for (const d of DEFAULT_CONFIGS) {
      const k = csKey(d.csName);
      if (!k || k === "unknown") continue;
      byKey.set(k, {
        csName: d.csName, isActive: d.isActive, orderAutomationEnabled: d.orderAutomationEnabled,
        aiAssistantEnabled: d.aiAssistantEnabled, reportingEnabled: d.reportingEnabled,
        autoFollowUpEnabled: d.autoFollowUpEnabled, csPhone: d.csPhone,
      });
    }
    // …then stored configs override.
    for (const c of stored) {
      const k = csKey(c.csName);
      if (!k || k === "unknown") continue;
      byKey.set(k, {
        csName: c.csName, isActive: c.isActive, orderAutomationEnabled: c.orderAutomationEnabled,
        aiAssistantEnabled: c.aiAssistantEnabled, reportingEnabled: c.reportingEnabled,
        autoFollowUpEnabled: c.autoFollowUpEnabled, csPhone: c.csPhone, avatarStorageId: c.avatarStorageId,
      });
    }

    const rows: CsRow[] = [];
    for (const [k, e] of byKey) {
      const avatarUrl = e.avatarStorageId ? await ctx.storage.getUrl(e.avatarStorageId) : null;
      rows.push({
        csName: e.csName, normalizedName: normalizeCsName(e.csName), key: k, avatarUrl,
        isActive: e.isActive,
        orderAutomationEnabled: e.orderAutomationEnabled,
        aiAssistantEnabled: e.aiAssistantEnabled,
        reportingEnabled: e.reportingEnabled,
        autoFollowUpEnabled: e.autoFollowUpEnabled,
        csPhone: e.csPhone,
      });
    }
    rows.sort((a, b) => a.csName.localeCompare(b.csName));
    return rows;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setCsAvatar = mutation({
  args: { csName: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "cs.setCsAvatar");
    await requireAdmin(ctx, "cs.generateUploadUrl");
    const normalizedName = normalizeCsName(args.csName);
    const now = Date.now();
    const existing = await ctx.db.query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).unique();
    if (existing) {
      if (existing.avatarStorageId && existing.avatarStorageId !== args.storageId) {
        await ctx.storage.delete(existing.avatarStorageId);
      }
      await ctx.db.patch(existing._id, { avatarStorageId: args.storageId, updatedAt: now });
    } else {
      await ctx.db.insert("csConfigs", {
        normalizedName, csName: args.csName, avatarStorageId: args.storageId,
        orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
        createdAt: now, updatedAt: now,
      });
    }
    return { success: true } as const;
  },
});

export const clearCsAvatar = mutation({
  args: { csName: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "cs.clearCsAvatar");
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db.query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).unique();
    if (existing?.avatarStorageId) {
      await ctx.storage.delete(existing.avatarStorageId);
      await ctx.db.patch(existing._id, { avatarStorageId: undefined, updatedAt: Date.now() });
    }
    return { success: true } as const;
  },
});
