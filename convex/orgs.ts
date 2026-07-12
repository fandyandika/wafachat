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

// One-time B1 backfill. CURSOR-PAGED over the by_creation_time system index:
// each call reads exactly <=limit docs regardless of how many are already
// stamped. (The first version used .filter(orgId==undefined).take(limit) —
// that SCANS past the already-stamped prefix, and once the prefix exceeded
// Convex's ~16k docs-read-per-transaction limit it Server-Errored on the big
// tables. Live-hit at GATE A on `events`.) Idempotent; controller threads
// nextCursor and loops per table until { done: true }.
export const backfillOrgId = mutation({
  args: { table: tableValidator, limit: v.optional(v.number()), cursor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgs.backfillOrgId");
    const orgId = await requireDefaultOrgId(ctx);
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query(args.table as any)
      .withIndex("by_creation_time", (q: any) => q.gt("_creationTime", args.cursor ?? 0))
      .take(limit);
    let patched = 0;
    for (const r of rows) {
      if ((r as any).orgId === undefined) {
        await ctx.db.patch(r._id, { orgId });
        patched++;
      }
    }
    return {
      patched,
      scanned: rows.length,
      nextCursor: rows.length > 0 ? rows[rows.length - 1]._creationTime : null,
      done: rows.length < limit,
    };
  },
});

// Coverage check, cursor-paged for the same read-limit reason (a fully-stamped
// big table would otherwise scan to the transaction cap looking for misses).
// Controller pages each table and sums `missing`.
export const orgIdCoverage = query({
  args: { table: tableValidator, limit: v.optional(v.number()), cursor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgs.orgIdCoverage");
    const limit = args.limit ?? 2000;
    const rows = await ctx.db
      .query(args.table as any)
      .withIndex("by_creation_time", (q: any) => q.gt("_creationTime", args.cursor ?? 0))
      .take(limit);
    let missing = 0;
    for (const r of rows) if ((r as any).orgId === undefined) missing++;
    return {
      missing,
      scanned: rows.length,
      nextCursor: rows.length > 0 ? rows[rows.length - 1]._creationTime : null,
      done: rows.length < limit,
    };
  },
});
