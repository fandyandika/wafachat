import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireAdminOrg } from "./authz";
import { csKey, normalizeCsName } from "./lib";

// ─── Fase B2a: agents = the csConfigs registry, addressed through ONE resolver. ───
// Identity = the canonical per-org `key` (immutable across renames). Data rows keep
// carrying csKey strings; this module guarantees every WRITE stamps the canonical
// form, which kills phantom-CS fragmentation at the source. A resolver MISS returns
// null and callers fall back to legacy raw+csKey(raw) behavior — that is deliberate:
// unknown staff surface on the panel as-is (discovery), never silently swallowed.

export type ResolvedAgent = { key: string; csName: string; agentId: Id<"csConfigs"> };

const normName = (s: string) => s.trim().toLowerCase();

export async function resolveAgent(
  ctx: { db: any },
  orgId: Id<"organizations">,
  q: { name?: string; berduStaffId?: string; phoneNumberId?: string },
): Promise<ResolvedAgent | null> {
  if (!q.name && !q.berduStaffId && !q.phoneNumberId) return null;
  // Every resolution path is active-only. The org-scoped rows below cover phone, staff, current
  // name, alias, and legacy no-key matching; the exact canonical-key query repeats that policy.
  const rows = await ctx.db
    .query("csConfigs")
    .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("isActive", true))
    .collect();
  const keyOf = (r: any): string => r.key ?? csKey(r.csName); // pre-seed fallback
  // 1) provider phone_number_id (KirimDev message attribution)
  if (q.phoneNumberId) {
    const hit = rows.find((r: any) => r.providerNumberId === q.phoneNumberId || (r.providerNumberIds ?? []).includes(q.phoneNumberId));
    if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
  }
  // 2) Berdu staff id (order attribution)
  if (q.berduStaffId) {
    const hit = rows.find((r: any) => (r.berduStaffIds ?? []).includes(q.berduStaffId));
    if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
  }
  // 3) raw name form: current csName (REQUIRED for post-rename: csKey(newName) != key,
  //    only this match returns the old immutable key) > explicit alias > csKey match.
  if (q.name) {
    const n = normName(q.name);
    if (n.length > 0) {
      const hit =
        rows.find((r: any) => normName(r.csName) === n) ??
        rows.find((r: any) => (r.nameAliases ?? []).some((a: string) => normName(a) === n)) ??
        await ctx.db
          .query("csConfigs")
          .withIndex("by_org_key", (ix: any) => ix.eq("orgId", orgId).eq("key", csKey(q.name!)))
          .filter((filter: any) => filter.eq(filter.field("isActive"), true))
          .first() ??
        rows.find((r: any) => r.key == null && csKey(q.name!) === csKey(r.csName));
      if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
    }
  }
  return null;
}

/** Stamp-site helper: canonical {csName,key} for a raw name; never null. */
export async function canonicalizeCs(
  ctx: { db: any },
  orgId: Id<"organizations">,
  rawName: string | undefined,
): Promise<{ csName: string; key: string }> {
  const raw = rawName ?? "";
  const hit = raw.trim() ? await resolveAgent(ctx, orgId, { name: raw }) : null;
  return hit ? { csName: hit.csName, key: hit.key } : { csName: raw, key: csKey(raw) };
}

// Idempotent seeding: every registry row gets its immutable key (+empty aliases).
export const seedKeys = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "agents.seedKeys");
    const rows = await ctx.db.query("csConfigs").collect();
    let seeded = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (r.key === undefined) patch.key = csKey(r.csName);
      if (r.nameAliases === undefined) patch.nameAliases = [];
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(r._id, { ...patch, updatedAt: Date.now() });
        seeded++;
      }
    }
    return { seeded };
  },
});

// Admin: manage the raw name forms that resolve to this agent (Settings UI).
export const setNameAliases = mutation({
  args: { csName: v.string(), nameAliases: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "agents.setNameAliases");
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizeCsName(args.csName)))
      .unique();
    if (!existing) throw new Error(`csConfig not found: ${args.csName}`);
    const nameAliases = Array.from(new Set(args.nameAliases.map((a) => a.trim()).filter(Boolean)));
    await ctx.db.patch(existing._id, { nameAliases, updatedAt: Date.now() });
    return { success: true, csName: args.csName, nameAliases };
  },
});
