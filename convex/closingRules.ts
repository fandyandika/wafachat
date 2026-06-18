import { mutation, query } from "./_generated/server";

const DEFAULT_PHRASES = ["PEMESANAN BERHASIL"];

export async function getActiveClosingPhrases(ctx: { db: any }): Promise<string[]> {
  const rows = await ctx.db
    .query("closingRules")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();
  const phrases = rows
    .map((r: any) => String(r.phrase || "").trim().toUpperCase())
    .filter((p: string) => p.length > 0);
  return phrases.length > 0 ? phrases : [...DEFAULT_PHRASES];
}

export const getActivePhrases = query({
  args: {},
  handler: async (ctx) => getActiveClosingPhrases(ctx),
});

export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("closingRules").collect();
    if (existing.length > 0) return { seeded: false, count: existing.length };
    for (const phrase of DEFAULT_PHRASES) {
      await ctx.db.insert("closingRules", { phrase, active: true, createdAt: Date.now() });
    }
    return { seeded: true, count: DEFAULT_PHRASES.length };
  },
});
