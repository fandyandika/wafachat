import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAdminOrg } from "./authz";
import { canonicalizeProduct, csKey } from "./lib";
import { nextJakartaDueAt, type FollowUpStage } from "./followUpModel";

const PAGE_SIZE = 25;
const UNASSIGNED_CS_KEY = "unassigned";

const statusValidator = v.union(v.literal("active"), v.literal("handover"));
const preparationModeValidator = v.union(v.literal("dry_run"), v.literal("apply"));
const preparationStatusValidator = v.union(v.literal("running"), v.literal("complete"), v.literal("failed"));
const preparationPhaseValidator = v.union(
  v.literal("products_orders"),
  v.literal("products_recaps"),
  v.literal("recap_closing_buckets"),
  v.literal("normalize_active"),
  v.literal("normalize_handover"),
  v.literal("counters_delete"),
  v.literal("counters_waiting"),
  v.literal("counters_sending"),
  v.literal("counters_unknown"),
  v.literal("counters_failed"),
  v.literal("counters_review"),
);

type PreparationPhase =
  | "products_orders"
  | "products_recaps"
  | "recap_closing_buckets"
  | "normalize_active"
  | "normalize_handover"
  | "counters_delete"
  | "counters_waiting"
  | "counters_sending"
  | "counters_unknown"
  | "counters_failed"
  | "counters_review";

type ActiveFollowUpState = "waiting" | "sending" | "unknown" | "failed" | "review";
type CounterValues = { h1: number; h2: number; h3: number; review: number };

const NEXT_PHASE: Record<PreparationPhase, PreparationPhase | undefined> = {
  products_orders: "products_recaps",
  products_recaps: "recap_closing_buckets",
  recap_closing_buckets: "normalize_active",
  normalize_active: "normalize_handover",
  normalize_handover: "counters_delete",
  counters_delete: "counters_waiting",
  counters_waiting: "counters_sending",
  counters_sending: "counters_unknown",
  counters_unknown: "counters_failed",
  counters_failed: "counters_review",
  counters_review: undefined,
};

const COUNTER_STATE: Partial<Record<PreparationPhase, ActiveFollowUpState>> = {
  counters_waiting: "waiting",
  counters_sending: "sending",
  counters_unknown: "unknown",
  counters_failed: "failed",
  counters_review: "review",
};

const preparationResultValidator = v.object({
  phase: preparationPhaseValidator,
  processed: v.number(),
  eligible: v.number(),
  updated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  done: v.boolean(),
  continueCursor: v.string(),
  nextPhase: v.optional(preparationPhaseValidator),
  runComplete: v.boolean(),
});

const preparationRunResultValidator = v.object({
  runId: v.id("followUpPreparationRuns"),
  mode: preparationModeValidator,
  status: preparationStatusValidator,
  scanned: v.number(),
  eligible: v.number(),
  updated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function stageFromSnapshot(conversation: Doc<"conversations">): FollowUpStage | undefined {
  if (conversation.followUpNextStage === 1
    || conversation.followUpNextStage === 2
    || conversation.followUpNextStage === 3) {
    return conversation.followUpNextStage;
  }
  if (conversation.followUpStageOverride === 1
    || conversation.followUpStageOverride === 2
    || conversation.followUpStageOverride === 3) {
    return conversation.followUpStageOverride;
  }
  if (conversation.followUpStage === 1) return 2;
  if (conversation.followUpStage === 2) return 3;
  return undefined;
}

function anchorFromSnapshot(conversation: Doc<"conversations">) {
  if (finiteTimestamp(conversation.followUpStageAt)) {
    return { at: conversation.followUpStageAt, keepExistingDueAt: false };
  }
  if (finiteTimestamp(conversation.lastMessageAt)) {
    return { at: conversation.lastMessageAt, keepExistingDueAt: false };
  }
  if (finiteTimestamp(conversation.followUpDueAt)) {
    return { at: conversation.followUpDueAt, keepExistingDueAt: true };
  }
  return undefined;
}

function hasChanged(conversation: Doc<"conversations">, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).some(([key, value]) => (conversation as any)[key] !== value);
}

function reviewReason(missing: string[]): string {
  return `Migrasi memerlukan tinjauan: ${missing.join(", ")} tidak tersedia.`;
}

function normalizeConversation(conversation: Doc<"conversations">, migrationAt: number) {
  if (conversation.followUpState === "complete" || conversation.followUpState === "archived") {
    return { patch: undefined, eligible: false, skipped: true };
  }

  const hasLegacySnapshot = conversation.followUpState !== undefined
    || conversation.followUpStage !== undefined
    || conversation.followUpStageAt !== undefined
    || conversation.followUpStageOverride !== undefined
    || conversation.followUpCycleId !== undefined
    || conversation.followUpDueAt !== undefined;
  if (!hasLegacySnapshot) return { patch: undefined, eligible: false, skipped: true };

  const derivedCsKey = csKey(conversation.followUpCsKey ?? conversation.assignedCsName);
  const missingCs = !derivedCsKey;
  const ownerKey = derivedCsKey || UNASSIGNED_CS_KEY;
  const stage = stageFromSnapshot(conversation);
  const anchor = anchorFromSnapshot(conversation);
  const hasMaterializedCycle = Boolean(conversation.followUpCycleId);

  if (conversation.followUpState === "review") {
    const patch = {
      followUpCsKey: ownerKey,
      followUpReviewReason: conversation.followUpReviewReason
        ?? reviewReason(missingCs ? ["CS"] : ["detail tahap"]),
    };
    return { patch: hasChanged(conversation, patch) ? patch : undefined, eligible: true, skipped: false };
  }

  if ((conversation.followUpState === "sending"
      || conversation.followUpState === "unknown"
      || conversation.followUpState === "failed")
    && hasMaterializedCycle && stage && !missingCs) {
    const patch = { followUpCsKey: ownerKey };
    return { patch: hasChanged(conversation, patch) ? patch : undefined, eligible: true, skipped: false };
  }

  if (conversation.followUpState === "waiting"
    && hasMaterializedCycle
    && stage
    && finiteTimestamp(conversation.followUpDueAt)
    && !missingCs) {
    const patch = { followUpCsKey: ownerKey };
    return { patch: hasChanged(conversation, patch) ? patch : undefined, eligible: true, skipped: false };
  }

  const missing: string[] = [];
  if (!stage) missing.push("tahap");
  if (missingCs) missing.push("CS");
  if (!anchor) missing.push("waktu acuan");
  if ((conversation.followUpState === "sending"
      || conversation.followUpState === "unknown"
      || conversation.followUpState === "failed")
    && !hasMaterializedCycle) {
    missing.push("siklus aktif");
  }

  if (missing.length > 0) {
    const patch = {
      followUpCsKey: ownerKey,
      followUpCycleId: conversation.followUpCycleId
        ?? (anchor ? `cycle:${String(conversation._id)}:${anchor.at}` : undefined),
      followUpCycleInboundAt: conversation.followUpCycleInboundAt ?? anchor?.at,
      followUpCycleStartedAt: conversation.followUpCycleStartedAt ?? anchor?.at,
      followUpNextStage: stage,
      followUpDueAt: undefined,
      followUpState: "review" as const,
      followUpLastTransitionAt: conversation.followUpLastTransitionAt ?? anchor?.at ?? migrationAt,
      followUpReviewReason: reviewReason(missing),
    };
    return { patch: hasChanged(conversation, patch) ? patch : undefined, eligible: true, skipped: false };
  }

  const anchorAt = anchor!.at;
  const patch = {
    followUpCsKey: ownerKey,
    followUpCycleInboundAt: conversation.followUpCycleInboundAt ?? anchorAt,
    followUpCycleId: conversation.followUpCycleId ?? `cycle:${String(conversation._id)}:${anchorAt}`,
    followUpCycleStartedAt: conversation.followUpCycleStartedAt ?? anchorAt,
    followUpNextStage: stage,
    followUpDueAt: anchor!.keepExistingDueAt ? anchorAt : nextJakartaDueAt(anchorAt),
    followUpState: "waiting" as const,
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
    followUpLastTransitionAt: conversation.followUpLastTransitionAt ?? anchorAt,
    followUpOutcome: undefined,
    followUpReviewReason: undefined,
    followUpArchivedAt: undefined,
  };
  return { patch: hasChanged(conversation, patch) ? patch : undefined, eligible: true, skipped: false };
}

function emptyCounter(): CounterValues {
  return { h1: 0, h2: 0, h3: 0, review: 0 };
}

function counterField(conversation: Doc<"conversations">): keyof CounterValues | undefined {
  if (conversation.followUpState === "waiting") {
    if (conversation.followUpNextStage === 1) return "h1";
    if (conversation.followUpNextStage === 2) return "h2";
    if (conversation.followUpNextStage === 3) return "h3";
    return undefined;
  }
  if (conversation.followUpState === "sending"
    || conversation.followUpState === "unknown"
    || conversation.followUpState === "failed"
    || conversation.followUpState === "review") {
    return "review";
  }
  return undefined;
}

async function applyCounterPage(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  rows: Doc<"conversations">[],
): Promise<void> {
  if (run.mode !== "apply") return;
  const increments = new Map<string, CounterValues>();
  for (const conversation of rows) {
    if (conversation.status === "closed") continue;
    const field = counterField(conversation);
    if (!field) continue;
    const ownerKey = conversation.followUpCsKey || csKey(conversation.assignedCsName) || UNASSIGNED_CS_KEY;
    const values = increments.get(ownerKey) ?? emptyCounter();
    values[field] += 1;
    increments.set(ownerKey, values);
  }
  for (const [ownerKey, increment] of increments) {
    const existing = await ctx.db.query("followUpCounters")
      .withIndex("by_org_csKey", (q) => q.eq("orgId", run.orgId).eq("csKey", ownerKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        h1: existing.h1 + increment.h1,
        h2: existing.h2 + increment.h2,
        h3: existing.h3 + increment.h3,
        review: existing.review + increment.review,
        updatedAt: run.startedAt,
      });
    } else {
      await ctx.db.insert("followUpCounters", {
        orgId: run.orgId,
        csKey: ownerKey,
        ...increment,
        updatedAt: run.startedAt,
      });
    }
  }
}

async function conversationForSnapshot(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  orderId: string | undefined,
  conversationId?: Id<"conversations">,
) {
  if (conversationId) {
    const conversation = await ctx.db.get(conversationId);
    return conversation && String(conversation.orgId) === String(orgId) ? conversation : undefined;
  }
  if (!orderId) return undefined;
  const matches = await ctx.db.query("conversations")
    .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", orderId))
    .take(2);
  return matches.length === 1 ? matches[0] : undefined;
}

async function processProductOrders(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  cursor: string | null,
) {
  const page = await ctx.db.query("orders")
    .withIndex("by_org_createdAt", (q) => q.eq("orgId", run.orgId))
    .paginate({ cursor, numItems: PAGE_SIZE });
  let updated = 0;
  for (const row of page.page) {
    const product = canonicalizeProduct(row.productName || row.products);
    if (!product) continue;
    const conversation = await conversationForSnapshot(ctx, run.orgId, row.orderId);
    if (!conversation || conversation.followUpProductName) continue;
    if (run.mode === "apply") {
      await ctx.db.patch(conversation._id, { followUpProductName: product });
      updated += 1;
    }
  }
  return { page, eligible: 0, updated, skipped: 0, scanned: 0 };
}

async function processProductRecaps(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  cursor: string | null,
) {
  const page = await ctx.db.query("shippingRecaps")
    .withIndex("by_org_closedAt", (q) => q.eq("orgId", run.orgId))
    .paginate({ cursor, numItems: PAGE_SIZE });
  let updated = 0;
  for (const row of page.page) {
    const product = canonicalizeProduct(row.packageContent);
    if (!product) continue;
    const conversation = await conversationForSnapshot(ctx, run.orgId, row.orderIdBerdu, row.conversationId);
    if (!conversation || conversation.followUpProductName) continue;
    if (run.mode === "apply") {
      await ctx.db.patch(conversation._id, { followUpProductName: product });
      updated += 1;
    }
  }
  return { page, eligible: 0, updated, skipped: 0, scanned: 0 };
}

async function processRecapBuckets(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  cursor: string | null,
) {
  const page = await ctx.db.query("shippingRecaps")
    .withIndex("by_org_closedAt", (q) => q.eq("orgId", run.orgId))
    .paginate({ cursor, numItems: PAGE_SIZE });
  let updated = 0;
  for (const row of page.page) {
    const closingBucket = row.status === "cancelled" || row.status === "cancelled_after_export"
      ? undefined
      : "counted" as const;
    if (row.closingBucket === closingBucket) continue;
    if (run.mode === "apply") {
      await ctx.db.patch(row._id, { closingBucket });
      updated += 1;
    }
  }
  return { page, eligible: 0, updated, skipped: 0, scanned: 0 };
}

async function processConversations(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  status: "active" | "handover",
  cursor: string | null,
) {
  const page = await ctx.db.query("conversations")
    .withIndex("by_org_status_updatedAt", (q) => q.eq("orgId", run.orgId).eq("status", status))
    .paginate({ cursor, numItems: PAGE_SIZE });
  let eligible = 0;
  let updated = 0;
  let skipped = 0;
  for (const conversation of page.page) {
    const normalized = normalizeConversation(conversation, run.startedAt);
    if (normalized.eligible) eligible += 1;
    if (normalized.skipped) skipped += 1;
    if (run.mode === "apply" && normalized.patch) {
      await ctx.db.patch(conversation._id, normalized.patch);
      updated += 1;
    }
  }
  return { page, eligible, updated, skipped, scanned: page.page.length };
}

async function processCounterDeletion(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  cursor: string | null,
) {
  const query = ctx.db.query("followUpCounters")
    .withIndex("by_org_csKey", (q) => q.eq("orgId", run.orgId));
  const page = run.mode === "apply"
    ? await (async () => {
      const rows = await query.take(PAGE_SIZE);
      return {
        page: rows,
        isDone: rows.length < PAGE_SIZE,
        continueCursor: rows.length === PAGE_SIZE ? "remaining" : "",
      };
    })()
    : await query.paginate({ cursor, numItems: PAGE_SIZE });
  if (run.mode === "apply") for (const row of page.page) await ctx.db.delete(row._id);
  return { page, eligible: 0, updated: 0, skipped: 0, scanned: 0 };
}

async function processCounterState(
  ctx: MutationCtx,
  run: Doc<"followUpPreparationRuns">,
  state: ActiveFollowUpState,
  cursor: string | null,
) {
  const page = await ctx.db.query("conversations")
    .withIndex("by_org_followUpState_updatedAt", (q) => q.eq("orgId", run.orgId).eq("followUpState", state))
    .paginate({ cursor, numItems: PAGE_SIZE });
  await applyCounterPage(ctx, run, page.page);
  return { page, eligible: 0, updated: 0, skipped: 0, scanned: 0 };
}

async function startPreparationRun(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  mode: "dry_run" | "apply",
) {
  const running = await ctx.db.query("followUpPreparationRuns")
    .withIndex("by_org_status_startedAt", (q) => q.eq("orgId", orgId).eq("status", "running"))
    .first();
  if (running) throw new Error("Preparation Follow-up masih berjalan.");
  const startedAt = Date.now();
  const runId = await ctx.db.insert("followUpPreparationRuns", {
    orgId,
    mode,
    status: "running",
    phase: "products_orders",
    nextConversationStatus: "active",
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    startedAt,
    updatedAt: startedAt,
  });
  await ctx.scheduler.runAfter(0, internal.followUpMigration.preparePage, { runId });
  return { runId };
}

export const preparePage = internalMutation({
  args: {
    runId: v.id("followUpPreparationRuns"),
    scheduleNext: v.optional(v.boolean()),
    // Compatibility accepts already-scheduled arguments from the superseded worker.
    orgId: v.optional(v.id("organizations")),
    status: v.optional(statusValidator),
    now: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: preparationResultValidator,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") throw new Error("Preparation run tidak aktif.");
    if (args.orgId && String(args.orgId) !== String(run.orgId)) throw new Error("Preparation run tidak aktif.");

    const phase: PreparationPhase = run.phase ?? "products_orders";
    const cursor = run.phase ? run.cursor ?? null : null;
    const counterState = COUNTER_STATE[phase];
    const result = phase === "products_orders"
      ? await processProductOrders(ctx, run, cursor)
      : phase === "products_recaps"
        ? await processProductRecaps(ctx, run, cursor)
        : phase === "recap_closing_buckets"
          ? await processRecapBuckets(ctx, run, cursor)
          : phase === "normalize_active"
            ? await processConversations(ctx, run, "active", cursor)
            : phase === "normalize_handover"
              ? await processConversations(ctx, run, "handover", cursor)
              : phase === "counters_delete"
                ? await processCounterDeletion(ctx, run, cursor)
                : await processCounterState(ctx, run, counterState!, cursor);

    const nextPhase = result.page.isDone ? NEXT_PHASE[phase] : undefined;
    const runComplete = result.page.isDone && nextPhase === undefined;
    const updatedAt = Date.now();
    await ctx.db.patch(run._id, {
      phase: nextPhase ?? phase,
      cursor: result.page.isDone ? undefined : result.page.continueCursor,
      nextConversationStatus: phase === "normalize_active" && result.page.isDone ? "handover" : run.nextConversationStatus,
      scanned: run.scanned + result.scanned,
      eligible: run.eligible + result.eligible,
      updated: run.updated + result.updated,
      skipped: run.skipped + result.skipped,
      failed: run.failed,
      status: runComplete ? "complete" : "running",
      updatedAt,
      completedAt: runComplete ? updatedAt : undefined,
    });

    if (args.scheduleNext !== false && !runComplete) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.preparePage, { runId: run._id });
    }

    return {
      phase,
      processed: result.page.page.length,
      eligible: result.eligible,
      updated: result.updated,
      skipped: result.skipped,
      failed: 0,
      done: result.page.isDone,
      continueCursor: result.page.continueCursor,
      nextPhase,
      runComplete,
    };
  },
});

export const startRecentFollowUpPreparation = mutation({
  args: { mode: preparationModeValidator },
  returns: v.object({ runId: v.id("followUpPreparationRuns") }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpMigration.startRecentFollowUpPreparation");
    return startPreparationRun(ctx, orgId, args.mode);
  },
});

export const startCutoverBySlug = internalMutation({
  args: { orgSlug: v.string(), mode: preparationModeValidator },
  returns: v.object({ runId: v.id("followUpPreparationRuns") }),
  handler: async (ctx, args) => {
    const orgSlug = args.orgSlug.trim();
    if (!orgSlug) throw new Error("Slug organisasi wajib tersedia.");
    const organization = await ctx.db.query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .unique();
    if (!organization) throw new Error("Organisasi tidak ditemukan.");
    return startPreparationRun(ctx, organization._id, args.mode);
  },
});

export const getFollowUpPreparationRun = query({
  args: { runId: v.id("followUpPreparationRuns") },
  returns: preparationRunResultValidator,
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpMigration.getFollowUpPreparationRun");
    const run = await ctx.db.get(args.runId);
    if (!run || String(run.orgId) !== String(orgId)) throw new Error("Preparation run tidak ditemukan.");
    return {
      runId: run._id,
      mode: run.mode,
      status: run.status,
      scanned: run.scanned,
      eligible: run.eligible,
      updated: run.updated,
      skipped: run.skipped,
      failed: run.failed,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
    };
  },
});
