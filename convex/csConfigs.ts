import { mutation, query } from "./_generated/server";
import { requireAdmin, requireAdminOrg, requireMemberOrg } from "./authz";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { normalizeCsName, csKey } from "./lib";
import { canAssignProviderNumberId, syncProviderNumberClaims } from "./agents";

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

// Names match the actual data (assignedCsName from Berdu/n8n is prefix-less: "Aisyah", not
// "CS Aisyah"), so normalizeCsName lines up config <-> data. "CS Azela" was a typo phantom
// (0 closings) — the real CS is the stored "Azelia" config.
export const DEFAULT_CONFIGS: CsFeatureConfig[] = [
  {
    csName: "Aisyah",
    orderAutomationEnabled: true,
    aiAssistantEnabled: true,
    reportingEnabled: true,
    isActive: true,
  },
  {
    csName: "Risma",
    orderAutomationEnabled: true,
    aiAssistantEnabled: false,
    reportingEnabled: true,
    isActive: true,
  },
  {
    csName: "Lila",
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

function activeProviderClaims(isActive: boolean, providerNumberId?: string, providerNumberIds?: string[]): Set<string> {
  return new Set(isActive ? [providerNumberId, ...(providerNumberIds ?? [])].filter((id): id is string => Boolean(id)) : []);
}

function sameClaims(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && Array.from(left).every((claim) => right.has(claim));
}

export async function getCsFeatureConfig(ctx: { db: any }, orgId: Id<"organizations">, csName: string): Promise<CsFeatureConfig> {
  const normalizedName = normalizeCsName(csName);
  const stored = await ctx.db
    .query("csConfigs")
    .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
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
    const { orgId } = await requireMemberOrg(ctx, "csConfigs.list");
    const stored = await ctx.db.query("csConfigs").withIndex("by_org_active", (q) => q.eq("orgId", orgId).eq("isActive", true)).collect();
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
    providerNumberIds: v.optional(v.array(v.string())),
    orderAutomationEnabled: v.boolean(),
    aiAssistantEnabled: v.boolean(),
    reportingEnabled: v.boolean(),
    autoFollowUpEnabled: v.optional(v.boolean()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "csConfigs.upsert");
    const now = Date.now();
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
      .unique();
    const scalarExplicit = Object.prototype.hasOwnProperty.call(args, "providerNumberId");
    const aliasesExplicit = Object.prototype.hasOwnProperty.call(args, "providerNumberIds");
    let providerNumberId = scalarExplicit ? args.providerNumberId : existing?.providerNumberId;
    let providerNumberIds = aliasesExplicit ? args.providerNumberIds : existing?.providerNumberIds;
    if (aliasesExplicit) {
      const candidate = providerNumberIds?.length === 1 ? providerNumberIds[0] : undefined;
      if (scalarExplicit && args.providerNumberId !== candidate) {
        throw new Error("providerNumberId must match a singleton providerNumberIds array");
      }
      providerNumberId = candidate;
    } else if (scalarExplicit) {
      providerNumberIds = providerNumberId ? [providerNumberId] : [];
    }
    const previousClaims = activeProviderClaims(
      existing?.isActive ?? false, existing?.providerNumberId, existing?.providerNumberIds,
    );
    const nextClaims = activeProviderClaims(args.isActive, providerNumberId, providerNumberIds);
    const ownershipChanged = !sameClaims(previousClaims, nextClaims);
    if (ownershipChanged) {
      for (const claim of nextClaims) {
        if (!await canAssignProviderNumberId(ctx, orgId, claim, existing?._id)) {
          throw new Error(`providerNumberId is already assigned or cannot be proven unique: ${claim}`);
        }
      }
    }
    const { providerNumberId: _scalar, providerNumberIds: _aliases, ...rest } = args;
    const shouldWriteProviderIds = scalarExplicit || aliasesExplicit || Boolean(existing);
    const payload = {
      ...rest,
      normalizedName,
      updatedAt: now,
      providerNumberId: shouldWriteProviderIds ? providerNumberId : undefined,
      providerNumberIds: shouldWriteProviderIds ? providerNumberIds : undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      if (ownershipChanged) {
        await syncProviderNumberClaims(ctx, orgId, existing._id, args.isActive, providerNumberId, providerNumberIds);
      }
      return { success: true, action: "updated", csName: args.csName };
    }

    const configId = await ctx.db.insert("csConfigs", { ...payload, createdAt: now, orgId });
    if (ownershipChanged) {
      await syncProviderNumberClaims(ctx, orgId, configId, args.isActive, providerNumberId, providerNumberIds);
    }
    return { success: true, action: "inserted", csName: args.csName };
  },
});

// Map a CS to one or more WABA phone_number_ids so the Ingestion API can attribute
// messages/closings to the right CS without n8n (replaces the hardcoded n8n map).
// Synchronizes the indexed scalar only when the replacement array has one provably unique ID.
export const setProviderNumberIds = mutation({
  args: { csName: v.string(), providerNumberIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "csConfigs.setProviderNumberIds");
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
      .unique();
    if (!existing) throw new Error(`csConfig not found: ${args.csName}`);
    const candidate = args.providerNumberIds.length === 1 ? args.providerNumberIds[0] : undefined;
    const previousClaims = activeProviderClaims(existing.isActive, existing.providerNumberId, existing.providerNumberIds);
    const nextClaims = activeProviderClaims(existing.isActive, candidate, args.providerNumberIds);
    const ownershipChanged = !sameClaims(previousClaims, nextClaims);
    if (ownershipChanged) {
      for (const claim of nextClaims) {
        if (!await canAssignProviderNumberId(ctx, orgId, claim, existing._id)) {
          throw new Error(`providerNumberId is already assigned or cannot be proven unique: ${claim}`);
        }
      }
    }
    const providerNumberId = candidate;
    await ctx.db.patch(existing._id, { providerNumberIds: args.providerNumberIds, providerNumberId, updatedAt: Date.now() });
    if (ownershipChanged) {
      await syncProviderNumberClaims(ctx, orgId, existing._id, existing.isActive, providerNumberId, args.providerNumberIds);
    }
    return { success: true, csName: args.csName, providerNumberIds: args.providerNumberIds };
  },
});

// Map a CS to their Berdu staff id(s) so order attribution reads the registry
// instead of the baked DEFAULT_BERDU_STAFF_MAP. Patches only berduStaffIds.
export const setBerduStaffIds = mutation({
  args: { csName: v.string(), berduStaffIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "csConfigs.setBerduStaffIds");
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
      .unique();
    if (!existing) throw new Error(`csConfig not found: ${args.csName}`);
    await ctx.db.patch(existing._id, { berduStaffIds: args.berduStaffIds, updatedAt: Date.now() });
    return { success: true, csName: args.csName, berduStaffIds: args.berduStaffIds };
  },
});

// Rename a CS's display name in place (patches the stored config's csName + normalizedName).
// Historical orders/recaps keep their raw name but still group under this CS via csKey on the
// panel, so no data migration is needed for a cosmetic rename (e.g. "CS Aisyah" -> "Aisyah").
export const renameCs = mutation({
  args: { fromCsName: v.string(), toCsName: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "csConfigs.renameCs");
    const to = args.toCsName.trim();
    if (!to) return { ok: false as const, error: "nama baru kosong" };
    const fromNorm = normalizeCsName(args.fromCsName);
    const toNorm = normalizeCsName(to);
    const stored = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", fromNorm))
      .unique();
    if (!stored) return { ok: false as const, error: `tidak ada config tersimpan untuk "${args.fromCsName}" (CS bawaan)` };
    if (toNorm !== fromNorm) {
      const clash = await ctx.db
        .query("csConfigs")
        .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", toNorm))
        .unique();
      if (clash) return { ok: false as const, error: `sudah ada CS "${to}"` };
    }
    const stableKey = stored.key ?? csKey(args.fromCsName); // backstop for pre-seed rows
    const aliases = Array.from(new Set([...(stored.nameAliases ?? []), stored.csName]
      .map((a: string) => a.trim()).filter((a: string) => a && a.toLowerCase() !== to.toLowerCase())));
    await ctx.db.patch(stored._id, {
      csName: to, normalizedName: toNorm, key: stableKey, nameAliases: aliases, updatedAt: Date.now(),
    });
    return { ok: true as const, from: args.fromCsName, to };
  },
});

// Delete a stored CS config entirely (only stored records; built-in defaults have no row).
export const deleteCsConfig = mutation({
  args: { csName: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "csConfigs.deleteCsConfig");
    const stored = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizeCsName(args.csName)))
      .unique();
    if (!stored) return { ok: false as const, error: "tidak ada config tersimpan (mungkin CS bawaan — pakai toggle Aktif)" };
    await syncProviderNumberClaims(ctx, orgId, stored._id, false);
    await ctx.db.delete(stored._id);
    return { ok: true as const };
  },
});
