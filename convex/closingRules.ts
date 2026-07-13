import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberOrg, requireAdminOrg } from "./authz";

const DEFAULT_PHRASES = ["PEMESANAN BERHASIL"];

export async function getActiveClosingPhrases(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<string[]> {
  const rows = await ctx.db
    .query("closingRules")
    .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("active", true))
    .collect();
  const phrases = rows
    .map((r: any) => String(r.phrase || "").trim().toUpperCase())
    .filter((p: string) => p.length > 0);
  return phrases.length > 0 ? phrases : [...DEFAULT_PHRASES]; // universal fallback all orgs
}

export const getActivePhrases = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireMemberOrg(ctx, "closingRules.getActivePhrases");
    return getActiveClosingPhrases(ctx, orgId);
  },
});

export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "closingRules.seedDefault");
    const existing = await ctx.db
      .query("closingRules")
      .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId))
      .collect();
    if (existing.length > 0) return { seeded: false, count: existing.length };
    for (const phrase of DEFAULT_PHRASES) {
      await ctx.db.insert("closingRules", { phrase, active: true, createdAt: Date.now(), orgId });
    }
    return { seeded: true, count: DEFAULT_PHRASES.length };
  },
});
