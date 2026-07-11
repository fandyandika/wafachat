import { v } from "convex/values";
import { mutation, internalQuery } from "./_generated/server";
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
