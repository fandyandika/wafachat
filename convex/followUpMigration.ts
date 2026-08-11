import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdminOrg } from "./authz";
import { csKey, isInternalTestPhone } from "./lib";
import { getInternalPhoneSet } from "./orgSettings";
import { FOLLOW_UP_DAY_MS, FOLLOW_UP_EXPIRY_MS } from "./followUpModel";
import { messageHasDoneMarker } from "./followUpMath";

const statusValidator = v.union(v.literal("active"), v.literal("handover"));
const pageResultValidator = v.object({
  processed: v.number(),
  done: v.boolean(),
  continueCursor: v.string(),
  nextStatus: v.optional(statusValidator),
});

function clearedPatch(cycleInboundAt?: number, state?: "complete" | "archived") {
  return {
    followUpCycleInboundAt: cycleInboundAt,
    followUpNextStage: undefined,
    followUpDueAt: undefined,
    followUpState: state,
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
  } as const;
}

async function deriveConversationPatch(ctx: any, conversation: any, now: number, internalPhones: ReadonlySet<string>) {
  if (isInternalTestPhone(conversation.customerPhone, internalPhones)) {
    return clearedPatch(undefined, "archived");
  }

  const [lastMessage, lastInbound, recap] = await Promise.all([
    ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversation._id))
      .order("desc")
      .first(),
    ctx.db
      .query("messages")
      .withIndex("by_conversation_direction_createdAt", (q: any) => q
        .eq("conversationId", conversation._id)
        .eq("direction", "inbound"))
      .order("desc")
      .first(),
    ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q: any) => q
        .eq("orgId", conversation.orgId)
        .eq("orderIdBerdu", conversation.orderId))
      .first(),
  ]);

  if (recap || !lastInbound || now - lastInbound.createdAt >= FOLLOW_UP_EXPIRY_MS) {
    return clearedPatch(lastInbound?.createdAt, recap ? "complete" : "archived");
  }
  if (!lastMessage || lastMessage.direction !== "outbound" || lastMessage.role !== "cs") {
    return clearedPatch(lastInbound.createdAt);
  }
  if (messageHasDoneMarker(lastMessage.content, "outbound")) {
    return clearedPatch(lastInbound.createdAt, "complete");
  }

  const followUpCsKey = csKey(conversation.assignedCsName);
  if (!followUpCsKey) {
    return clearedPatch(lastInbound.createdAt, "archived");
  }

  const windowClose = lastInbound.createdAt + FOLLOW_UP_DAY_MS;
  const touches = await ctx.db
    .query("messages")
    .withIndex("by_conversation_direction_createdAt", (q: any) => q
      .eq("conversationId", conversation._id)
      .eq("direction", "outbound")
      .gt("createdAt", windowClose))
    .take(4);
  if (touches.length >= 3) {
    return {
      ...clearedPatch(lastInbound.createdAt, "complete"),
      followUpCsKey,
    };
  }

  const followUpNextStage = (touches.length + 1) as 1 | 2 | 3;
  const followUpDueAt = touches.length === 0
    ? lastMessage.createdAt + FOLLOW_UP_DAY_MS
    : touches[touches.length - 1].createdAt + FOLLOW_UP_DAY_MS;
  return {
    followUpCsKey,
    followUpCycleInboundAt: lastInbound.createdAt,
    followUpNextStage,
    followUpDueAt,
    followUpState: "waiting",
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
  } as const;
}

async function materializeConversation(ctx: any, conversation: any, now: number, internalPhones: ReadonlySet<string>) {
  const patch = await deriveConversationPatch(ctx, conversation, now, internalPhones);
  await ctx.db.patch(conversation._id, patch);
}

const preparationResultValidator = v.object({
  processed: v.number(), eligible: v.number(), updated: v.number(), skipped: v.number(), failed: v.number(),
  done: v.boolean(), continueCursor: v.string(), nextStatus: v.optional(statusValidator),
});

export const preparePage = internalMutation({
  args: {
    runId: v.id("followUpPreparationRuns"), orgId: v.id("organizations"), status: statusValidator,
    now: v.number(), cursor: v.optional(v.string()), scheduleNext: v.optional(v.boolean()),
  },
  returns: preparationResultValidator,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || String(run.orgId) !== String(args.orgId) || run.status !== "running") {
      throw new Error("Preparation run tidak aktif.");
    }
    const page = await ctx.db.query("conversations")
      .withIndex("by_org_status_updatedAt", (q) => q.eq("orgId", args.orgId).eq("status", args.status)
        .gte("updatedAt", args.now - FOLLOW_UP_EXPIRY_MS))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const internalPhones = await getInternalPhoneSet(ctx, args.orgId);
    let eligible = 0, updated = 0, skipped = 0, failed = 0;
    for (const conversation of page.page) {
      try {
        const patch = await deriveConversationPatch(ctx, conversation, args.now, internalPhones);
        const isEligible = patch.followUpState === "waiting";
        if (isEligible) eligible += 1;
        else skipped += 1;
        if (run.mode === "apply" && isEligible) {
          await ctx.db.patch(conversation._id, patch);
          updated += 1;
        }
      } catch {
        failed += 1;
      }
    }
    const nextStatus = page.isDone && args.status === "active" ? "handover" as const : undefined;
    const complete = page.isDone && args.status === "handover";
    await ctx.db.patch(run._id, {
      cursor: page.isDone ? undefined : page.continueCursor,
      nextConversationStatus: nextStatus ?? args.status,
      scanned: run.scanned + page.page.length,
      eligible: run.eligible + eligible,
      updated: run.updated + updated,
      skipped: run.skipped + skipped,
      failed: run.failed + failed,
      status: complete ? "complete" : "running",
      updatedAt: Date.now(),
      completedAt: complete ? Date.now() : undefined,
    });
    if (args.scheduleNext !== false && (!page.isDone || nextStatus)) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.preparePage, {
        runId: run._id, orgId: args.orgId, status: nextStatus ?? args.status, now: args.now,
        cursor: page.isDone ? undefined : page.continueCursor,
      });
    }
    return { processed: page.page.length, eligible, updated, skipped, failed,
      done: page.isDone, continueCursor: page.continueCursor, nextStatus };
  },
});

export const backfillPage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    status: statusValidator,
    now: v.number(),
    cursor: v.optional(v.string()),
    scheduleNext: v.optional(v.boolean()),
  },
  returns: pageResultValidator,
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("Waktu backfill tidak valid.");
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q) => q
        .eq("orgId", args.orgId)
        .eq("status", args.status)
        .gte("updatedAt", args.now - FOLLOW_UP_EXPIRY_MS))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const internalPhones = await getInternalPhoneSet(ctx, args.orgId);
    for (const conversation of page.page) {
      await materializeConversation(ctx, conversation, args.now, internalPhones);
    }

    const nextStatus = page.isDone && args.status === "active" ? "handover" as const : undefined;
    if (args.scheduleNext !== false && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
        orgId: args.orgId,
        status: args.status,
        now: args.now,
        cursor: page.continueCursor,
      });
    } else if (args.scheduleNext !== false && nextStatus) {
      await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
        orgId: args.orgId,
        status: nextStatus,
        now: args.now,
      });
    }

    return {
      processed: page.page.length,
      done: page.isDone,
      continueCursor: page.continueCursor,
      nextStatus,
    };
  },
});

export const startRecentFollowUpBackfill = mutation({
  args: {},
  returns: v.object({ scheduled: v.literal(true) }),
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpMigration.startRecentFollowUpBackfill");
    await ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, {
      orgId,
      status: "active",
      now: Date.now(),
    });
    return { scheduled: true as const };
  },
});

const preparationModeValidator = v.union(v.literal("dry_run"), v.literal("apply"));
const preparationStatusValidator = v.union(v.literal("running"), v.literal("complete"), v.literal("failed"));
const preparationRunResultValidator = v.object({
  runId: v.id("followUpPreparationRuns"),
  mode: preparationModeValidator,
  status: preparationStatusValidator,
  scanned: v.number(), eligible: v.number(), updated: v.number(), skipped: v.number(), failed: v.number(),
  startedAt: v.number(), updatedAt: v.number(), completedAt: v.optional(v.number()),
});

export const startRecentFollowUpPreparation = mutation({
  args: { mode: preparationModeValidator },
  returns: v.object({ runId: v.id("followUpPreparationRuns") }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpMigration.startRecentFollowUpPreparation");
    const recent = await ctx.db.query("followUpPreparationRuns")
      .withIndex("by_org_startedAt", (q) => q.eq("orgId", orgId))
      .order("desc").take(10);
    if (recent.some((row) => row.status === "running")) throw new Error("Preparation Follow-up masih berjalan.");
    const startedAt = Date.now();
    const runId = await ctx.db.insert("followUpPreparationRuns", {
      orgId, mode: args.mode, status: "running", nextConversationStatus: "active",
      scanned: 0, eligible: 0, updated: 0, skipped: 0, failed: 0, startedAt, updatedAt: startedAt,
    });
    await ctx.scheduler.runAfter(0, internal.followUpMigration.preparePage, {
      runId, orgId, status: "active", now: startedAt,
    });
    return { runId };
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
      runId: run._id, mode: run.mode, status: run.status,
      scanned: run.scanned, eligible: run.eligible, updated: run.updated,
      skipped: run.skipped, failed: run.failed, startedAt: run.startedAt,
      updatedAt: run.updatedAt, completedAt: run.completedAt,
    };
  },
});
