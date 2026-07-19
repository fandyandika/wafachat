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
const PROVIDER_CLAIM_VERSION = 2;
const MAX_PROVIDER_IDS_PER_AGENT = 100;

function providerClaims(providerNumberId?: string, providerNumberIds?: string[]): string[] {
  return Array.from(new Set([providerNumberId, ...(providerNumberIds ?? [])].filter((id): id is string => Boolean(id))));
}

async function getClaimRun(ctx: { db: any }, orgId: Id<"organizations">) {
  return ctx.db.query("providerNumberBackfillRuns")
    .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique();
}

function claimRunIsComplete(run: any): boolean {
  return run?.version === PROVIDER_CLAIM_VERSION && run.phase === "complete";
}

async function getIndexedClaims(ctx: { db: any }, orgId: Id<"organizations">, runId: Id<"providerNumberBackfillRuns">, providerNumberId: string) {
  return ctx.db.query("providerNumberBackfillClaims")
    .withIndex("by_org_run_providerNumberId", (q: any) =>
      q.eq("orgId", orgId).eq("runId", runId).eq("providerNumberId", providerNumberId))
    .take(2);
}

async function getBoundedActiveLegacyRegistry(ctx: { db: any }, orgId: Id<"organizations">): Promise<any[] | null> {
  const rows = await ctx.db
    .query("csConfigs")
    .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("isActive", true))
    .take(PROVIDER_NUMBER_ID_REGISTRY_LIMIT + 1);
  return rows.length > PROVIDER_NUMBER_ID_REGISTRY_LIMIT ? null : rows;
}

/** Validate an active ownership claim through the durable index, or a bounded pre-migration proof. */
export async function canAssignProviderNumberId(
  ctx: { db: any }, orgId: Id<"organizations">, providerNumberId: string, exceptId?: Id<"csConfigs">,
): Promise<boolean> {
  const run = await getClaimRun(ctx, orgId);
  if (claimRunIsComplete(run)) {
    const claims = await getIndexedClaims(ctx, orgId, run._id, providerNumberId);
    return !claims.some((claim: any) => claim.agentId !== exceptId);
  }
  const rows = await getBoundedActiveLegacyRegistry(ctx, orgId);
  return rows !== null && !rows.some((row: any) =>
    row._id !== exceptId && providerClaims(row.providerNumberId, row.providerNumberIds).includes(providerNumberId));
}

/** Keep durable active claims synchronized in the same transaction as the csConfig write. */
export async function syncProviderNumberClaims(
  ctx: { db: any }, orgId: Id<"organizations">, agentId: Id<"csConfigs">,
  isActive: boolean, providerNumberId?: string, providerNumberIds?: string[],
): Promise<void> {
  const run = await getClaimRun(ctx, orgId);
  if (!run || run.version !== PROVIDER_CLAIM_VERSION) return;
  const existing = await ctx.db.query("providerNumberBackfillClaims")
    .withIndex("by_org_run_agent", (q: any) => q.eq("orgId", orgId).eq("runId", run._id).eq("agentId", agentId))
    .take(MAX_PROVIDER_IDS_PER_AGENT + 1);
  if (existing.length > MAX_PROVIDER_IDS_PER_AGENT) throw new Error("too many existing provider claims for agent");
  const desired = isActive ? providerClaims(providerNumberId, providerNumberIds) : [];
  if (desired.length > MAX_PROVIDER_IDS_PER_AGENT) throw new Error(`providerNumberIds exceeds ${MAX_PROVIDER_IDS_PER_AGENT}`);
  for (const claim of existing) await ctx.db.delete(claim._id);
  for (const claim of desired) {
    await ctx.db.insert("providerNumberBackfillClaims", {
      orgId, runId: run._id, providerNumberId: claim, agentId, createdAt: Date.now(),
    });
  }
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
    const run = await getClaimRun(ctx, orgId);
    if (claimRunIsComplete(run)) {
      const claims = await getIndexedClaims(ctx, orgId, run._id, q.phoneNumberId);
      if (claims.length > 1) return null;
      if (claims.length === 1) {
        const hit = await ctx.db.get(claims[0].agentId);
        if (!hit || !hit.isActive || !providerClaims(hit.providerNumberId, hit.providerNumberIds).includes(q.phoneNumberId)) {
          return null;
        }
        return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
      }
    } else {
      // Until the durable claim migration completes, prove the whole active registry is bounded.
      const registry = await getBoundedActiveLegacyRegistry(ctx, orgId);
      if (!registry) return null;
      const matches = registry.filter((row: any) =>
        providerClaims(row.providerNumberId, row.providerNumberIds).includes(q.phoneNumberId!));
      if (matches.length === 1) {
        const hit = matches[0];
        return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
      }
      if (matches.length > 1) return null;
    }
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

// Durable claim migration. Cleanup restarts old/transient runs, scan synchronizes every active
// scalar+alias claim, apply backfills safe singleton scalars, and complete remains as proof state.
export const seedKeys = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "agents.seedKeys");
    let run = await getClaimRun(ctx, orgId);
    if (!run) {
      const now = Date.now();
      const runId = await ctx.db.insert("providerNumberBackfillRuns", {
        orgId, phase: "cleanup", version: PROVIDER_CLAIM_VERSION, createdAt: now, updatedAt: now,
      });
      run = await ctx.db.get(runId);
    }
    if (!run) throw new Error("provider backfill run creation failed");
    if (run.version !== PROVIDER_CLAIM_VERSION) {
      await ctx.db.patch(run._id, {
        phase: "cleanup", version: PROVIDER_CLAIM_VERSION, cursor: undefined, updatedAt: Date.now(),
      });
      run = await ctx.db.get(run._id);
      if (!run) throw new Error("provider backfill run upgrade failed");
    }

    if (run.phase === "complete") return { seeded: 0, phase: "complete" as const, done: true };

    if (run.phase === "cleanup") {
      const claims = await ctx.db.query("providerNumberBackfillClaims")
        .withIndex("by_org_run", (q) => q.eq("orgId", orgId).eq("runId", run!._id))
        .take(SEED_BATCH);
      for (const claim of claims) await ctx.db.delete(claim._id);
      if (claims.length < SEED_BATCH) {
        await ctx.db.patch(run._id, { phase: "scan", cursor: undefined, updatedAt: Date.now() });
        return { seeded: 0, phase: "scan" as const, done: false };
      }
      return { seeded: 0, phase: "cleanup" as const, done: false };
    }

    const configs = paginator(ctx.db, schema).query("csConfigs");
    const page = run.phase === "apply"
      ? await configs.withIndex("by_org_active", (q) => q.eq("orgId", orgId).eq("isActive", true))
        .paginate({ cursor: run.cursor ?? null, numItems: SEED_BATCH })
      : await configs.withIndex("by_org", (q) => q.eq("orgId", orgId))
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
        await syncProviderNumberClaims(
          ctx, orgId, row._id, row.isActive, row.providerNumberId, row.providerNumberIds,
        );
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
      if (claims.length === 1 && claims[0].agentId === row._id) {
        await ctx.db.patch(row._id, { providerNumberId: candidate, updatedAt: Date.now() });
        seeded++;
      }
    }
    await ctx.db.patch(run._id, page.isDone
      ? { phase: "complete", cursor: undefined, updatedAt: Date.now() }
      : { cursor: page.continueCursor, updatedAt: Date.now() });
    return { seeded, phase: page.isDone ? "complete" as const : "apply" as const, done: page.isDone };
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
