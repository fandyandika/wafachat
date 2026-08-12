import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { nextJakartaDueAt, type FollowUpStage } from "./followUpModel";
import { nextStageAfterDetected } from "./followUpTriggers";
import { csKey as normalizeCsKey } from "./lib";

type LifecycleCtx = Pick<MutationCtx, "db">;
type CounterBucket = FollowUpStage | "review" | null;
type TransitionSource = "provider_template" | "provider_webhook" | "manual" | "system";

export type OutboundLifecycleInput = {
  conversation: Doc<"conversations">;
  messageId: Id<"messages">;
  content: string;
  templateName?: string;
  providerMessageId?: string;
  csKey: string;
  detectedStage: FollowUpStage | null;
  createdAt: number;
  source: "provider_template" | "provider_webhook" | "system";
};

type LifecycleResult = {
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  cycleId?: string;
};

function preview(content: string): string {
  return content.slice(0, 180);
}

function bucketFor(conversation: Doc<"conversations">): CounterBucket {
  if (["sending", "unknown", "failed", "review"].includes(conversation.followUpState ?? "")) {
    return "review";
  }
  if (conversation.followUpState === "waiting") return conversation.followUpNextStage ?? null;
  return null;
}

function counterField(bucket: Exclude<CounterBucket, null>): "h1" | "h2" | "h3" | "review" {
  if (bucket === "review") return "review";
  return `h${bucket}` as "h1" | "h2" | "h3";
}

async function updateCounter(
  ctx: LifecycleCtx,
  orgId: Id<"organizations">,
  csKey: string,
  decrement: CounterBucket,
  increment: CounterBucket,
  updatedAt: number,
): Promise<void> {
  if (!csKey || decrement === increment || (decrement === null && increment === null)) return;
  const existing = await ctx.db.query("followUpCounters")
    .withIndex("by_org_csKey", (q) => q.eq("orgId", orgId).eq("csKey", csKey))
    .unique();
  const values = {
    h1: existing?.h1 ?? 0,
    h2: existing?.h2 ?? 0,
    h3: existing?.h3 ?? 0,
    review: existing?.review ?? 0,
  };
  if (decrement !== null) {
    const field = counterField(decrement);
    values[field] = Math.max(0, values[field] - 1);
  }
  if (increment !== null) {
    const field = counterField(increment);
    values[field] += 1;
  }
  if (existing) {
    await ctx.db.patch(existing._id, { ...values, updatedAt });
  } else {
    await ctx.db.insert("followUpCounters", { orgId, csKey, ...values, updatedAt });
  }
}

async function moveCounter(
  ctx: LifecycleCtx,
  conversation: Doc<"conversations">,
  nextCsKey: string,
  nextBucket: CounterBucket,
  updatedAt: number,
): Promise<void> {
  const previousBucket = bucketFor(conversation);
  const previousCsKey = conversation.followUpCsKey ?? nextCsKey;
  if (previousCsKey === nextCsKey) {
    await updateCounter(ctx, conversation.orgId, nextCsKey, previousBucket, nextBucket, updatedAt);
    return;
  }
  await updateCounter(ctx, conversation.orgId, previousCsKey, previousBucket, null, updatedAt);
  await updateCounter(ctx, conversation.orgId, nextCsKey, null, nextBucket, updatedAt);
}

async function existingTransition(ctx: LifecycleCtx, orgId: Id<"organizations">, eventKey: string) {
  return ctx.db.query("followUpTransitions")
    .withIndex("by_org_eventKey", (q) => q.eq("orgId", orgId).eq("eventKey", eventKey))
    .unique();
}

function outboundEventKey(input: OutboundLifecycleInput): string {
  return input.providerMessageId
    ? `provider:${input.providerMessageId}`
    : `message:${String(input.messageId)}`;
}

function cycleIdForMessage(conversationId: Id<"conversations">, messageId: Id<"messages">): string {
  return `cycle:${String(conversationId)}:${String(messageId)}`;
}

async function currentConversation(ctx: LifecycleCtx, supplied: Doc<"conversations">) {
  const current = await ctx.db.get(supplied._id);
  if (!current || String(current.orgId) !== String(supplied.orgId)) {
    throw new Error("Percakapan Follow-up tidak ditemukan.");
  }
  return current;
}

export async function applyOutboundLifecycle(
  ctx: LifecycleCtx,
  input: OutboundLifecycleInput,
): Promise<LifecycleResult> {
  const eventKey = outboundEventKey(input);
  if (await existingTransition(ctx, input.conversation.orgId, eventKey)) {
    return { applied: false, duplicate: true, stale: false };
  }
  const conversation = await currentConversation(ctx, input.conversation);
  if (conversation.status === "closed"
    || conversation.followUpState === "complete"
    || conversation.followUpState === "archived") {
    return {
      applied: false,
      duplicate: false,
      stale: true,
      cycleId: conversation.followUpCycleId,
    };
  }
  const activeStage = conversation.followUpNextStage;
  const activeCycle = conversation.followUpCycleId
    && activeStage !== undefined
    && bucketFor(conversation) !== null;

  if (!activeCycle) {
    const cycleId = cycleIdForMessage(conversation._id, input.messageId);
    await moveCounter(ctx, conversation, input.csKey, 1, input.createdAt);
    await ctx.db.patch(conversation._id, {
      followUpCsKey: input.csKey,
      followUpCycleInboundAt: conversation.followUpLastInboundAt ?? input.createdAt,
      followUpCycleId: cycleId,
      followUpCycleStartedAt: input.createdAt,
      followUpNextStage: 1,
      followUpDueAt: nextJakartaDueAt(input.createdAt),
      followUpState: "waiting",
      followUpLastTransitionAt: input.createdAt,
      followUpLastOutboundPreview: preview(input.content),
      followUpLastOutboundAt: input.createdAt,
      followUpLastDetectedStage: undefined,
      followUpLastDetectedTemplate: undefined,
      followUpOutcome: undefined,
      followUpReviewReason: undefined,
      followUpArchivedAt: undefined,
      updatedAt: input.createdAt,
    });
    await ctx.db.insert("followUpTransitions", {
      orgId: conversation.orgId,
      conversationId: conversation._id,
      cycleId,
      eventKey,
      kind: "cycle_armed",
      source: input.source,
      toStage: 1,
      providerMessageId: input.providerMessageId,
      templateName: input.templateName,
      createdAt: input.createdAt,
    });
    return { applied: true, duplicate: false, stale: false, cycleId };
  }

  if (input.detectedStage === null || input.detectedStage < activeStage) {
    await ctx.db.patch(conversation._id, {
      followUpCsKey: input.csKey,
      followUpLastOutboundPreview: preview(input.content),
      followUpLastOutboundAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    return { applied: false, duplicate: false, stale: false, cycleId: conversation.followUpCycleId };
  }

  const next = nextStageAfterDetected(activeStage, input.detectedStage, input.createdAt);
  if (!next) return { applied: false, duplicate: false, stale: true, cycleId: conversation.followUpCycleId };
  const nextBucket = next.state === "waiting" ? next.nextStage : null;
  await moveCounter(ctx, conversation, input.csKey, nextBucket, input.createdAt);
  await ctx.db.patch(conversation._id, {
    followUpCsKey: input.csKey,
    followUpStage: input.detectedStage,
    followUpStageAt: input.createdAt,
    followUpStageOverride: undefined,
    followUpNextStage: next.nextStage ?? undefined,
    followUpDueAt: next.dueAt ?? undefined,
    followUpState: next.state,
    followUpLastTransitionAt: input.createdAt,
    followUpLastOutboundPreview: preview(input.content),
    followUpLastOutboundAt: input.createdAt,
    followUpLastDetectedStage: input.detectedStage,
    followUpLastDetectedTemplate: input.templateName,
    followUpOutcome: next.state === "archived" ? "h3_complete" : undefined,
    followUpArchivedAt: next.state === "archived" ? input.createdAt : undefined,
    followUpReviewReason: undefined,
    updatedAt: input.createdAt,
  });
  await ctx.db.insert("followUpTransitions", {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    cycleId: conversation.followUpCycleId!,
    eventKey,
    kind: "stage_completed",
    source: input.source,
    fromStage: activeStage,
    toStage: next.nextStage ?? undefined,
    providerMessageId: input.providerMessageId,
    templateName: input.templateName,
    createdAt: input.createdAt,
  });
  return { applied: true, duplicate: false, stale: false, cycleId: conversation.followUpCycleId };
}

export async function applyInboundReset(
  ctx: LifecycleCtx,
  input: {
    conversation: Doc<"conversations">;
    messageId: Id<"messages">;
    content: string;
    createdAt: number;
  },
): Promise<LifecycleResult> {
  const eventKey = `message:${String(input.messageId)}`;
  if (await existingTransition(ctx, input.conversation.orgId, eventKey)) {
    return { applied: false, duplicate: true, stale: false };
  }
  const conversation = await currentConversation(ctx, input.conversation);
  const cycleId = conversation.followUpCycleId;
  const previousBucket = bucketFor(conversation);
  if (!cycleId) {
    await ctx.db.patch(conversation._id, {
      followUpLastInboundPreview: preview(input.content),
      followUpLastInboundAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    return { applied: false, duplicate: false, stale: false };
  }

  const ownerKey = conversation.followUpCsKey ?? normalizeCsKey(conversation.assignedCsName);
  await moveCounter(ctx, conversation, ownerKey, null, input.createdAt);
  await ctx.db.patch(conversation._id, {
    followUpStage: undefined,
    followUpStageAt: undefined,
    followUpStageOverride: undefined,
    followUpCycleInboundAt: input.createdAt,
    followUpCycleId: undefined,
    followUpCycleStartedAt: undefined,
    followUpNextStage: undefined,
    followUpDueAt: undefined,
    followUpState: undefined,
    followUpRequestId: undefined,
    followUpProviderMessageId: undefined,
    followUpLastError: undefined,
    followUpLastTransitionAt: input.createdAt,
    followUpLastInboundPreview: preview(input.content),
    followUpLastInboundAt: input.createdAt,
    followUpOutcome: undefined,
    followUpReviewReason: undefined,
    followUpArchivedAt: undefined,
    updatedAt: input.createdAt,
  });
  await ctx.db.insert("followUpTransitions", {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    cycleId,
    eventKey,
    kind: "customer_replied",
    source: "system",
    fromStage: conversation.followUpNextStage,
    createdAt: input.createdAt,
  });
  return { applied: true, duplicate: false, stale: false, cycleId };
}

export async function confirmCurrentStage(
  ctx: LifecycleCtx,
  input: {
    conversation: Doc<"conversations">;
    expectedCycleId?: string;
    requestId: string;
    createdAt: number;
    source?: TransitionSource;
    providerMessageId?: string;
    templateName?: string;
    actorUserId?: Id<"users">;
    actorName?: string;
  },
): Promise<LifecycleResult> {
  const eventKey = input.providerMessageId
    ? `provider:${input.providerMessageId}`
    : `confirmation:${input.requestId}`;
  if (await existingTransition(ctx, input.conversation.orgId, eventKey)) {
    return { applied: false, duplicate: true, stale: false };
  }
  const conversation = await currentConversation(ctx, input.conversation);
  const currentStage = conversation.followUpNextStage;
  if (!conversation.followUpCycleId
    || currentStage === undefined
    || bucketFor(conversation) === null
    || (input.expectedCycleId !== undefined && input.expectedCycleId !== conversation.followUpCycleId)) {
    return { applied: false, duplicate: false, stale: true };
  }
  const next = nextStageAfterDetected(currentStage, currentStage, input.createdAt);
  if (!next) return { applied: false, duplicate: false, stale: true };
  const ownerKey = conversation.followUpCsKey ?? normalizeCsKey(conversation.assignedCsName);
  await moveCounter(ctx, conversation, ownerKey, next.state === "waiting" ? next.nextStage : null, input.createdAt);
  await ctx.db.patch(conversation._id, {
    followUpStage: currentStage,
    followUpStageAt: input.createdAt,
    followUpStageOverride: undefined,
    followUpNextStage: next.nextStage ?? undefined,
    followUpDueAt: next.dueAt ?? undefined,
    followUpState: next.state,
    followUpLastTransitionAt: input.createdAt,
    followUpLastDetectedStage: currentStage,
    followUpLastDetectedTemplate: input.templateName,
    followUpProviderMessageId: input.providerMessageId,
    followUpOutcome: next.state === "archived" ? "h3_complete" : undefined,
    followUpArchivedAt: next.state === "archived" ? input.createdAt : undefined,
    followUpReviewReason: undefined,
    updatedAt: input.createdAt,
  });
  await ctx.db.insert("followUpTransitions", {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    cycleId: conversation.followUpCycleId,
    eventKey,
    kind: "stage_completed",
    source: input.source ?? "manual",
    fromStage: currentStage,
    toStage: next.nextStage ?? undefined,
    providerMessageId: input.providerMessageId,
    templateName: input.templateName,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    createdAt: input.createdAt,
  });
  return { applied: true, duplicate: false, stale: false, cycleId: conversation.followUpCycleId };
}

export async function correctCurrentStage(
  ctx: LifecycleCtx,
  input: {
    conversation: Doc<"conversations">;
    targetStage: FollowUpStage;
    requestId: string;
    actorUserId?: Id<"users">;
    actorName?: string;
  },
): Promise<LifecycleResult> {
  const eventKey = `correction:${input.requestId}`;
  if (await existingTransition(ctx, input.conversation.orgId, eventKey)) {
    return { applied: false, duplicate: true, stale: false };
  }
  const conversation = await currentConversation(ctx, input.conversation);
  const now = Date.now();
  const ownerKey = conversation.followUpCsKey ?? normalizeCsKey(conversation.assignedCsName);
  const cycleId = conversation.followUpCycleId
    ?? `cycle:${String(conversation._id)}:manual:${input.requestId}`;
  await moveCounter(ctx, conversation, ownerKey, input.targetStage, now);
  await ctx.db.patch(conversation._id, {
    followUpCsKey: ownerKey,
    followUpCycleInboundAt: conversation.followUpCycleInboundAt ?? now,
    followUpCycleId: cycleId,
    followUpCycleStartedAt: conversation.followUpCycleStartedAt ?? now,
    followUpNextStage: input.targetStage,
    followUpDueAt: now,
    followUpState: "waiting",
    followUpStageOverride: input.targetStage,
    followUpLastTransitionAt: now,
    followUpOutcome: undefined,
    followUpReviewReason: undefined,
    followUpArchivedAt: undefined,
    updatedAt: now,
  });
  await ctx.db.insert("followUpTransitions", {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    cycleId,
    eventKey,
    kind: "stage_corrected",
    source: "manual",
    fromStage: conversation.followUpNextStage,
    toStage: input.targetStage,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    createdAt: now,
  });
  return { applied: true, duplicate: false, stale: false, cycleId };
}

export async function terminateCycle(
  ctx: LifecycleCtx,
  input: {
    conversation: Doc<"conversations">;
    eventKey: string;
    kind: "closing" | "cancelled" | "archived";
    createdAt: number;
    actorUserId?: Id<"users">;
    actorName?: string;
    source?: "manual" | "system";
  },
): Promise<LifecycleResult> {
  if (await existingTransition(ctx, input.conversation.orgId, input.eventKey)) {
    return { applied: false, duplicate: true, stale: false };
  }
  const conversation = await currentConversation(ctx, input.conversation);
  if (!conversation.followUpCycleId || bucketFor(conversation) === null) {
    return { applied: false, duplicate: false, stale: true };
  }
  const ownerKey = conversation.followUpCsKey ?? normalizeCsKey(conversation.assignedCsName);
  await moveCounter(ctx, conversation, ownerKey, null, input.createdAt);
  const archived = input.kind === "archived";
  await ctx.db.patch(conversation._id, {
    followUpNextStage: undefined,
    followUpDueAt: undefined,
    followUpState: archived ? "archived" : "complete",
    followUpLastTransitionAt: input.createdAt,
    followUpOutcome: input.kind === "closing"
      ? "closing"
      : input.kind === "cancelled"
        ? "cancelled"
        : "manual_archive",
    followUpArchivedAt: archived ? input.createdAt : undefined,
    followUpReviewReason: undefined,
    updatedAt: input.createdAt,
  });
  await ctx.db.insert("followUpTransitions", {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    cycleId: conversation.followUpCycleId,
    eventKey: input.eventKey,
    kind: input.kind,
    source: input.source ?? "system",
    fromStage: conversation.followUpNextStage,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    createdAt: input.createdAt,
  });
  return { applied: true, duplicate: false, stale: false, cycleId: conversation.followUpCycleId };
}
