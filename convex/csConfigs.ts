import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeCsName } from "./lib";

export type CsFeatureConfig = {
  csName: string;
  csPhone?: string;
  provider?: string;
  providerNumberId?: string;
  orderAutomationEnabled: boolean;
  aiAssistantEnabled: boolean;
  reportingEnabled: boolean;
  autoFollowUpEnabled?: boolean;
  isActive: boolean;
};

const DEFAULT_CONFIGS: CsFeatureConfig[] = [
  {
    csName: "CS Aisyah",
    orderAutomationEnabled: true,
    aiAssistantEnabled: true,
    reportingEnabled: true,
    isActive: true,
  },
  {
    csName: "CS Risma",
    orderAutomationEnabled: true,
    aiAssistantEnabled: false,
    reportingEnabled: true,
    isActive: true,
  },
  {
    csName: "CS Lila",
    orderAutomationEnabled: false,
    aiAssistantEnabled: false,
    reportingEnabled: false,
    isActive: false,
  },
  {
    csName: "CS Azela",
    orderAutomationEnabled: false,
    aiAssistantEnabled: false,
    reportingEnabled: false,
    isActive: false,
  },
];

function defaultForName(csName: string): CsFeatureConfig {
  const normalizedName = normalizeCsName(csName);
  const match = DEFAULT_CONFIGS.find((config) => normalizeCsName(config.csName) === normalizedName);
  if (match) return match;

  return {
    csName: csName || "Unknown",
    orderAutomationEnabled: false,
    aiAssistantEnabled: false,
    reportingEnabled: true,
    isActive: true,
  };
}

export async function getCsFeatureConfig(ctx: { db: any }, csName: string): Promise<CsFeatureConfig> {
  const normalizedName = normalizeCsName(csName);
  const stored = await ctx.db
    .query("csConfigs")
    .withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", normalizedName))
    .unique();

  if (stored) {
    return {
      csName: stored.csName,
      csPhone: stored.csPhone,
      provider: stored.provider,
      providerNumberId: stored.providerNumberId,
      orderAutomationEnabled: stored.orderAutomationEnabled,
      aiAssistantEnabled: stored.aiAssistantEnabled,
      reportingEnabled: stored.reportingEnabled,
      autoFollowUpEnabled: stored.autoFollowUpEnabled ?? false,
      isActive: stored.isActive,
    };
  }

  return defaultForName(csName);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db.query("csConfigs").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
    const byName = new Map(stored.map((config) => [config.normalizedName, config]));

    const defaults = DEFAULT_CONFIGS.map((config) => {
      const storedConfig = byName.get(normalizeCsName(config.csName));
      return storedConfig
        ? {
            csName: storedConfig.csName,
            csPhone: storedConfig.csPhone,
            provider: storedConfig.provider,
            providerNumberId: storedConfig.providerNumberId,
            orderAutomationEnabled: storedConfig.orderAutomationEnabled,
            aiAssistantEnabled: storedConfig.aiAssistantEnabled,
            reportingEnabled: storedConfig.reportingEnabled,
            autoFollowUpEnabled: storedConfig.autoFollowUpEnabled ?? false,
            isActive: storedConfig.isActive,
          }
        : config;
    });
    const defaultNames = new Set(DEFAULT_CONFIGS.map((config) => normalizeCsName(config.csName)));
    const extras = stored
      .filter((config) => !defaultNames.has(config.normalizedName))
      .map((config) => ({
        csName: config.csName,
        csPhone: config.csPhone,
        provider: config.provider,
        providerNumberId: config.providerNumberId,
        orderAutomationEnabled: config.orderAutomationEnabled,
        aiAssistantEnabled: config.aiAssistantEnabled,
        reportingEnabled: config.reportingEnabled,
        autoFollowUpEnabled: config.autoFollowUpEnabled ?? false,
        isActive: config.isActive,
      }));

    return [...defaults, ...extras];
  },
});

export const upsert = mutation({
  args: {
    csName: v.string(),
    csPhone: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerNumberId: v.optional(v.string()),
    orderAutomationEnabled: v.boolean(),
    aiAssistantEnabled: v.boolean(),
    reportingEnabled: v.boolean(),
    autoFollowUpEnabled: v.optional(v.boolean()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName))
      .unique();
    const payload = { ...args, normalizedName, updatedAt: now };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { success: true, action: "updated", csName: args.csName };
    }

    await ctx.db.insert("csConfigs", { ...payload, createdAt: now });
    return { success: true, action: "inserted", csName: args.csName };
  },
});
