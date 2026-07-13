import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdminOrg } from "./authz";
import { normalizePhone } from "./lib";
import { DEFAULT_ORG_SLUG } from "./orgs";

// In-code fallback = tenant #1's values, verbatim from the old convex/lib.ts
// INTERNAL_TEST_PHONES hardcode. Used whenever the orgSettings table is empty
// (fresh dev env, convex-test without seeding) so behavior never regresses.
// Prod is seeded via seedDefault; after that the table is the source of truth.
export const DEFAULT_INTERNAL_PHONES: string[] = [
  "6285715682110", // owner Pustaka Islam
  "6285774076061", // admin input
  "628211900201", // admin input
  "6282280000661", // owner Pustaka Islam
  "6281385708799", // CS Aisyah line
  "6282321381742", // CS Risma line
  "6285210047441", // CS Lila line
  "6282113515152", // CS Azelia line
  "6281220823210", // CS Nabila line
];

export const DEFAULT_ORG_SETTINGS = {
  orgName: "Pustaka Islam",
  internalPhones: DEFAULT_INTERNAL_PHONES,
};

// Non-default org with no row yet: neutral empty settings (spec §2.1) — NOT
// tenant #1's phone list, which would leak pustakaislam filters into org #2.
export const EMPTY_ORG_SETTINGS = { orgName: "", internalPhones: [] as string[] };

// Structural { db } ctx (same convention as getActiveClosingPhrases) so this
// works from queries, mutations, and convex-test t.run alike.
export async function loadOrgSettings(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<{ orgName: string; internalPhones: string[] }> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_org_key", (q: any) => q.eq("orgId", orgId).eq("key", "default"))
    .unique();
  if (row) return row;
  const org = await ctx.db.get(orgId);
  return org?.slug === DEFAULT_ORG_SLUG ? DEFAULT_ORG_SETTINGS : EMPTY_ORG_SETTINGS;
}

/** One indexed point-read per handler; pass the returned set down into filters. */
export async function getInternalPhoneSet(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<ReadonlySet<string>> {
  const s = await loadOrgSettings(ctx, orgId);
  return new Set(s.internalPhones);
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "orgSettings.get");
    return loadOrgSettings(ctx, orgId);
  },
});

export const update = mutation({
  args: {
    orgName: v.optional(v.string()),
    internalPhones: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "orgSettings.update");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.orgName !== undefined) {
      const name = args.orgName.trim();
      if (!name) throw new Error("orgName kosong");
      patch.orgName = name;
    }
    if (args.internalPhones !== undefined) {
      // Normalize at write (62… form) + dedupe, so readers never re-normalize the set.
      patch.internalPhones = Array.from(
        new Set(args.internalPhones.map((p) => normalizePhone(p)).filter((p) => p.length > 0)),
      );
    }
    const existing = await ctx.db
      .query("orgSettings")
      .withIndex("by_org_key", (q: any) => q.eq("orgId", orgId).eq("key", "default"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true, action: "updated" as const };
    }
    await ctx.db.insert("orgSettings", {
      key: "default",
      orgName: DEFAULT_ORG_SETTINGS.orgName,
      internalPhones: DEFAULT_INTERNAL_PHONES,
      updatedAt: Date.now(),
      ...patch,
      orgId,
    });
    return { ok: true, action: "inserted" as const };
  },
});

// Idempotent prod seeding: copies the in-code defaults into the table once.
export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "orgSettings.seedDefault");
    const existing = await ctx.db
      .query("orgSettings")
      .withIndex("by_org_key", (q: any) => q.eq("orgId", orgId).eq("key", "default"))
      .unique();
    if (existing) return { seeded: false as const };
    await ctx.db.insert("orgSettings", {
      key: "default",
      orgName: DEFAULT_ORG_SETTINGS.orgName,
      internalPhones: DEFAULT_INTERNAL_PHONES,
      updatedAt: Date.now(),
      orgId,
    });
    return { seeded: true as const };
  },
});
