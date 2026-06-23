import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { csKey, normalizeCsName, isInternalTestPhone } from "./lib";

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

type CsRow = {
  csName: string; normalizedName: string; key: string; avatarUrl: string | null;
  isActive: boolean; orderAutomationEnabled: boolean; aiAssistantEnabled: boolean;
  reportingEnabled: boolean; csPhone?: string;
};

export const listCs = query({
  args: {},
  handler: async (ctx): Promise<CsRow[]> => {
    const since = Date.now() - NINETY_DAYS;
    const orders = await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since)).collect();

    const dataName = new Map<string, string>(); // key -> first-seen display name
    for (const o of orders) {
      if (isInternalTestPhone(o.customerPhone)) continue;
      const raw = (o.assignedCsName ?? "").trim();
      const k = csKey(raw);
      if (!k || k === "unknown") continue;
      if (!dataName.has(k)) dataName.set(k, raw);
    }

    const configs = await ctx.db.query("csConfigs").collect();
    const configByKey = new Map(configs.map((c) => [csKey(c.csName), c]));
    const keys = Array.from(new Set<string>([...Array.from(dataName.keys()), ...Array.from(configByKey.keys())].filter(Boolean)));

    const rows: CsRow[] = [];
    for (const k of keys) {
      if (!k || k === "unknown") continue;
      const cfg = configByKey.get(k);
      const display = cfg?.csName ?? dataName.get(k) ?? k;
      const avatarUrl = cfg?.avatarStorageId ? await ctx.storage.getUrl(cfg.avatarStorageId) : null;
      rows.push({
        csName: display, normalizedName: normalizeCsName(display), key: k, avatarUrl,
        isActive: cfg?.isActive ?? true,
        orderAutomationEnabled: cfg?.orderAutomationEnabled ?? false,
        aiAssistantEnabled: cfg?.aiAssistantEnabled ?? false,
        reportingEnabled: cfg?.reportingEnabled ?? true,
        csPhone: cfg?.csPhone,
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
