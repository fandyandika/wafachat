import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdminOrg } from "./authz";
import { csKey, normalizeCsName } from "./lib";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";

// ─── Fase B2a: agents = the csConfigs registry, addressed through ONE resolver. ───
// Identity = the canonical per-org `key` (immutable across renames). Data rows keep
// carrying csKey strings; this module guarantees every WRITE stamps the canonical
// form, which kills phantom-CS fragmentation at the source. A resolver MISS returns
// null and callers fall back to legacy raw+csKey(raw) behavior — that is deliberate:
// unknown staff surface on the panel as-is (discovery), never silently swallowed.

export type ResolvedAgent = { key: string; csName: string; agentId: Id<"csConfigs"> };

const normName = (s: string) => s.trim().toLowerCase();
export const PROVIDER_NUMBER_ID_REGISTRY_LIMIT = 50;

async function getActiveScalarMatches(ctx: { db: any }, orgId: Id<"organizations">, providerNumberId: string) {
  return ctx.db
    .query("csConfigs")
    .withIndex("by_org_providerNumberId", (q: any) => q.eq("orgId", orgId).eq("providerNumberId", providerNumberId))
    .filter((q: any) => q.eq(q.field("isActive"), true))
    .take(2);
}

async function getBoundedActiveLegacyRegistry(ctx: { db: any }, orgId: Id<"organizations">): Promise<any[] | null> {
  const rows = await ctx.db
    .query("csConfigs")
    .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("isActive", true))
    .take(PROVIDER_NUMBER_ID_REGISTRY_LIMIT + 1);
  return rows.length > PROVIDER_NUMBER_ID_REGISTRY_LIMIT ? null : rows;
}

/** A scalar write is safe only when the bounded tenant registry proves no other row claims it. */
export async function canAssignProviderNumberId(
  ctx: { db: any }, orgId: Id<"organizations">, providerNumberId: string, exceptId?: Id<"csConfigs">,
): Promise<boolean> {
  const scalarMatches = await getActiveScalarMatches(ctx, orgId, providerNumberId);
  if (scalarMatches.some((row: any) => row._id !== exceptId)) return false;
  const rows = await getBoundedActiveLegacyRegistry(ctx, orgId);
  return rows !== null && !rows.some((row: any) =>
    row._id !== exceptId && (row.providerNumberIds ?? []).includes(providerNumberId));
}

export async function resolveAgent(
  ctx: { db: any },
  orgId: Id<"organizations">,
  q: { name?: string; berduStaffId?: string; phoneNumberId?: string },
): Promise<ResolvedAgent | null> {
  if (!q.name && !q.berduStaffId && !q.phoneNumberId) return null;
  // Every resolution path is active-only. Avoid materializing the active registry for the
  // common phone-number path; the legacy array fallback remains org-scoped during migration.
  let activeRows: any[] | undefined;
  const getActiveRows = async () => activeRows ??= await ctx.db
    .query("csConfigs")
    .withIndex("by_org_active", (ix: any) => ix.eq("orgId", orgId).eq("isActive", true))
    .collect();
  const keyOf = (r: any): string => r.key ?? csKey(r.csName); // pre-seed fallback
  // 1) provider phone_number_id (KirimDev message attribution)
  if (q.phoneNumberId) {
    // Fast path: exact tenant+provider index, active-only. A unique scalar resolves without
    // touching the org registry; inactive stale rows do not count as claimants.
    const scalarMatches = await getActiveScalarMatches(ctx, orgId, q.phoneNumberId);
    if (scalarMatches.length > 1) return null;
    if (scalarMatches.length === 1) {
      const hit = scalarMatches[0];
      return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
    }

    // Migration-only fallback: only zero active scalar matches reach this bounded active scan.
    const registry = await getBoundedActiveLegacyRegistry(ctx, orgId);
    if (!registry) return null;
    const matches = registry.filter((row: any) => (row.providerNumberIds ?? []).includes(q.phoneNumberId));
    if (matches.length === 1) {
      const hit = matches[0];
      return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
    }
    return null;
  }
  // 2) Berdu staff id (order attribution)
  if (q.berduStaffId) {
    const hit = (await getActiveRows()).find((r: any) => (r.berduStaffIds ?? []).includes(q.berduStaffId));
    if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
  }
  // 3) raw name form: current csName (REQUIRED for post-rename: csKey(newName) != key,
  //    only this match returns the old immutable key) > explicit alias > csKey match.
  if (q.name) {
    const n = normName(q.name);
    if (n.length > 0) {
      const rows = await getActiveRows();
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

const SEED_BATCH = 50;

// Durable three-phase migration. Repeated calls resume the saved paginator cursor: scan builds
// active legacy claims, apply point-proves uniqueness and writes scalars, cleanup removes claims.
export const seedKeys = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "agents.seedKeys");
    let run = await ctx.db.query("providerNumberBackfillRuns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    if (!run) {
      const now = Date.now();
      const runId = await ctx.db.insert("providerNumberBackfillRuns", {
        orgId, phase: "scan", createdAt: now, updatedAt: now,
      });
      run = await ctx.db.get(runId);
    }
    if (!run) throw new Error("provider backfill run creation failed");

    if (run.phase === "cleanup") {
      const claims = await ctx.db.query("providerNumberBackfillClaims")
        .withIndex("by_org_run", (q) => q.eq("orgId", orgId).eq("runId", run!._id))
        .take(SEED_BATCH);
      for (const claim of claims) await ctx.db.delete(claim._id);
      const done = claims.length < SEED_BATCH;
      if (done) await ctx.db.delete(run._id);
      return { seeded: 0, phase: "cleanup" as const, done };
    }

    const activeOnly = run.phase === "apply";
    const page = await paginator(ctx.db, schema)
      .query("csConfigs")
      .withIndex("by_org_active", (q) => activeOnly
        ? q.eq("orgId", orgId).eq("isActive", true)
        : q.eq("orgId", orgId))
      .paginate({ cursor: run.cursor ?? null, numItems: SEED_BATCH });
    let seeded = 0;

    if (run.phase === "scan") {
      for (const row of page.page) {
        const patch: Record<string, unknown> = {};
        if (row.key === undefined) patch.key = csKey(row.csName);
        if (row.nameAliases === undefined) patch.nameAliases = [];
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
          seeded++;
        }
        if (row.isActive) {
          for (const providerNumberId of new Set(row.providerNumberIds ?? [])) {
            if (!providerNumberId) continue;
            await ctx.db.insert("providerNumberBackfillClaims", {
              orgId, runId: run._id, providerNumberId, agentId: row._id, createdAt: Date.now(),
            });
          }
        }
      }
      await ctx.db.patch(run._id, page.isDone
        ? { phase: "apply", cursor: undefined, updatedAt: Date.now() }
        : { cursor: page.continueCursor, updatedAt: Date.now() });
      return { seeded, phase: page.isDone ? "apply" as const : "scan" as const, done: false };
    }

    for (const row of page.page) {
      const candidate = row.providerNumberId === undefined && row.providerNumberIds?.length === 1
        ? row.providerNumberIds[0]
        : undefined;
      if (!candidate) continue;
      const claims = await ctx.db.query("providerNumberBackfillClaims")
        .withIndex("by_org_run_providerNumberId", (q) =>
          q.eq("orgId", orgId).eq("runId", run!._id).eq("providerNumberId", candidate))
        .take(2);
      const scalarMatches = await getActiveScalarMatches(ctx, orgId, candidate);
      if (claims.length === 1 && claims[0].agentId === row._id && scalarMatches.length === 0) {
        await ctx.db.patch(row._id, { providerNumberId: candidate, updatedAt: Date.now() });
        seeded++;
      }
    }
    await ctx.db.patch(run._id, page.isDone
      ? { phase: "cleanup", cursor: undefined, updatedAt: Date.now() }
      : { cursor: page.continueCursor, updatedAt: Date.now() });
    return { seeded, phase: page.isDone ? "cleanup" as const : "apply" as const, done: false };
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
