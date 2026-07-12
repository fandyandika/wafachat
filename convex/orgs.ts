import { v } from "convex/values";
import { mutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import { loadOrgSettings } from "./orgSettings";

export const DEFAULT_ORG_SLUG = "pustakaislam";

// Null-tolerant resolver: before seedDefaultOrg runs, returns null and callers
// SKIP stamping (orgId still optional) — a deploy with an empty organizations
// table is fully inert. After seeding it always resolves. (Structural { db }
// ctx: works from queries, mutations, and convex-test t.run alike.)
export async function getDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations"> | null> {
  const row = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q: any) => q.eq("slug", DEFAULT_ORG_SLUG))
    .unique();
  return row?._id ?? null;
}

// Post-flip strictness (spec §3.4): write paths that MUST stamp use this.
export async function requireDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations">> {
  const id = await getDefaultOrgId(ctx);
  if (!id) throw new Error("org not seeded: run orgs.seedDefaultOrg first");
  return id;
}

export const seedDefaultOrg = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgs.seedDefaultOrg");
    const existing = await getDefaultOrgId(ctx);
    if (existing) return { seeded: false as const, orgId: existing };
    const settings = await loadOrgSettings(ctx);
    const orgId = await ctx.db.insert("organizations", {
      slug: DEFAULT_ORG_SLUG,
      name: settings.orgName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { seeded: true as const, orgId };
  },
});

export const defaultOrgIdInternal = internalQuery({
  args: {},
  handler: async (ctx) => getDefaultOrgId(ctx),
});

const B1_TABLES = [
  "orders", "shippingRecaps", "messages", "conversations", "customers", "events",
  "csConfigs", "ingestEvents", "ingestSources", "dailyRollups", "responseSamples",
  "alertState", "settings", "closingRules", "orgSettings", "users",
] as const;
const tableValidator = v.union(
  v.literal("orders"),
  v.literal("shippingRecaps"),
  v.literal("messages"),
  v.literal("conversations"),
  v.literal("customers"),
  v.literal("events"),
  v.literal("csConfigs"),
  v.literal("ingestEvents"),
  v.literal("ingestSources"),
  v.literal("dailyRollups"),
  v.literal("responseSamples"),
  v.literal("alertState"),
  v.literal("settings"),
  v.literal("closingRules"),
  v.literal("orgSettings"),
  v.literal("users"),
);

// One-time B1 backfill (pattern: rollups.backfillCsKey). Idempotent; controller
// loops per table until { done: true }. Bounded read via take(limit).
export const backfillOrgId = mutation({
  args: { table: tableValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgs.backfillOrgId");
    const orgId = await requireDefaultOrgId(ctx);
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query(args.table as any)
      .filter((q: any) => q.eq(q.field("orgId"), undefined))
      .take(limit);
    for (const r of rows) await ctx.db.patch(r._id, { orgId });
    return { patched: rows.length, done: rows.length < limit };
  },
});

export const orgIdCoverage = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgs.orgIdCoverage");
    const out: Record<string, number> = {};
    for (const table of B1_TABLES) {
      // take(1001): bounded read — exact up to 1000, "1001" = more remain. Enough
      // to steer the backfill loop without scanning huge tables in one query.
      const missing = await ctx.db
        .query(table as any)
        .filter((q: any) => q.eq(q.field("orgId"), undefined))
        .take(1001);
      out[table] = missing.length;
    }
    return out;
  },
});
