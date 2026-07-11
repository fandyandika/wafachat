import { v } from "convex/values";
import { internalQuery, mutation, query } from "../_generated/server";
import { requireAdmin } from "../authz";
import { requireDefaultOrgId } from "../orgs";

const kindValidator = v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom"));

export const getBySourceKey = internalQuery({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
  },
});

export const upsertSource = mutation({
  args: {
    sourceKey: v.string(),
    name: v.string(),
    kind: kindValidator,
    secret: v.string(),
    enabled: v.boolean(),
    enforceSignature: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.upsertSource");
    const existing = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("ingestSources", { ...args, createdAt: Date.now() });
  },
});

export const setEnforceSignature = mutation({
  args: { sourceKey: v.string(), enforce: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.setEnforceSignature");
    const existing = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (!existing) throw new Error(`unknown source: ${args.sourceKey}`);
    await ctx.db.patch(existing._id, { enforceSignature: args.enforce });
  },
});

// Attach the source to the default org (B1 single-tenant; per-org keys arrive in B3).
export const setSourceOrg = mutation({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.setSourceOrg");
    const src = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (!src) throw new Error(`source not found: ${args.sourceKey}`);
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.patch(src._id, { orgId });
    return { ok: true, sourceKey: args.sourceKey, orgId };
  },
});

export const listSources = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "ingest.sources.listSources");
    const rows = await ctx.db.query("ingestSources").collect();
    return rows.map((r) => ({ ...r, secret: `…${r.secret.slice(-4)}` }));
  },
});
