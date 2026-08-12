import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  applyInboundReset,
  applyOutboundLifecycle,
  confirmCurrentStage,
  correctCurrentStage,
  terminateCycle,
} from "./followUpLifecycle";

const HOUR = 60 * 60 * 1_000;
const sentAt = Date.UTC(2026, 7, 12, 13, 30);
const nextDayAtEightWib = Date.UTC(2026, 7, 13, 1);

afterEach(() => {
  vi.useRealTimers();
});

async function fixture(options: {
  stage?: 1 | 2 | 3;
  priorInboundAt?: number;
} = {}) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: `lifecycle-${Math.random()}`,
      name: "Lifecycle Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const active = options.stage !== undefined;
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "LIFECYCLE-1",
      customerPhone: "628222222222",
      customerName: "Lifecycle Customer",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpCsKey: active ? "aisyah" : undefined,
      followUpCycleInboundAt: active ? 1_000 : options.priorInboundAt,
      followUpCycleId: active ? "cycle-1" : undefined,
      followUpCycleStartedAt: active ? 1_000 : undefined,
      followUpNextStage: options.stage,
      followUpDueAt: active ? sentAt + HOUR : undefined,
      followUpState: active ? "waiting" : undefined,
      followUpLastInboundAt: options.priorInboundAt,
      createdAt: 1,
      updatedAt: 1,
    });
    if (options.stage !== undefined) {
      await ctx.db.insert("followUpCounters", {
        orgId,
        csKey: "aisyah",
        h1: options.stage === 1 ? 1 : 0,
        h2: options.stage === 2 ? 1 : 0,
        h3: options.stage === 3 ? 1 : 0,
        review: 0,
        updatedAt: 1,
      });
    }
    return { orgId, conversationId };
  });
  return { t, ...ids };
}

async function insertMessage(
  t: ReturnType<typeof convexTest>,
  orgId: Id<"organizations">,
  conversationId: Id<"conversations">,
  direction: "inbound" | "outbound",
  content: string,
  createdAt: number,
) {
  return t.run((ctx) => ctx.db.insert("messages", {
    orgId,
    conversationId,
    orderId: "LIFECYCLE-1",
    customerPhone: "628222222222",
    role: direction === "inbound" ? "customer" : "cs",
    direction,
    content,
    messageType: "text",
    source: "ingest",
    createdAt,
  }));
}

async function getConversation(t: ReturnType<typeof convexTest>, conversationId: Id<"conversations">) {
  const conversation = await t.run((ctx) => ctx.db.get(conversationId));
  if (!conversation) throw new Error("missing conversation fixture");
  return conversation;
}

test("lifecycle storage remains backward-compatible with legacy conversations", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: "legacy-lifecycle-org",
      name: "Legacy Lifecycle Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const legacyConversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "LEGACY-1",
      customerPhone: "628111111111",
      customerName: "Legacy Customer",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("providerChannelHealth", {
      orgId,
      providerNumberId: "number-1",
      csKey: "aisyah",
      channelType: "cs",
      lastInboundAt: 150,
      updatedAt: 200,
    });

    expect(await ctx.db.get(legacyConversationId)).toMatchObject({ orderId: "LEGACY-1" });
    expect(await ctx.db.query("providerChannelHealth").unique()).toMatchObject({
      providerNumberId: "number-1",
      channelType: "cs",
    });
  });
});

test.each([
  ["without prior inbound", undefined],
  ["after prior inbound", sentAt - HOUR],
] as const)("CS outbound %s arms H+1", async (_label, priorInboundAt) => {
  const { t, orgId, conversationId } = await fixture({ priorInboundAt });
  const messageId = await insertMessage(t, orgId, conversationId, "outbound", "Ada yang bisa dibantu?", sentAt);
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation,
    messageId,
    content: "Ada yang bisa dibantu?",
    csKey: "aisyah",
    detectedStage: null,
    createdAt: sentAt,
    source: "provider_webhook",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpCsKey: "aisyah",
    followUpNextStage: 1,
    followUpDueAt: nextDayAtEightWib,
    followUpState: "waiting",
    followUpLastOutboundPreview: "Ada yang bisa dibantu?",
    followUpLastOutboundAt: sentAt,
  });
  const counters = await t.run((ctx) => ctx.db.query("followUpCounters").collect());
  expect(counters).toMatchObject([{ csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0 }]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect()))
    .toMatchObject([{ kind: "cycle_armed", toStage: 1 }]);
});

test("an early H+1 trigger advances to H+2 on the next Jakarta calendar day", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 1 });
  const messageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+1", sentAt);
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation,
    messageId,
    content: "Follow up H+1",
    templateName: "follow_up_h1",
    providerMessageId: "wamid.h1",
    csKey: "aisyah",
    detectedStage: 1,
    createdAt: sentAt,
    source: "provider_template",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpNextStage: 2,
    followUpDueAt: nextDayAtEightWib,
    followUpState: "waiting",
    followUpLastDetectedStage: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 1, h3: 0 });
});

test("an H+2 trigger catches up from H+1 and schedules H+3", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 1 });
  const messageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+2", sentAt);
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation,
    messageId,
    content: "Follow up H+2",
    templateName: "follow_up_h2",
    csKey: "aisyah",
    detectedStage: 2,
    createdAt: sentAt,
    source: "provider_webhook",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpNextStage: 3,
    followUpDueAt: nextDayAtEightWib,
    followUpState: "waiting",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 1 });
});

test("an H+3 trigger archives Follow-up without closing the conversation", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 3 });
  const messageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+3", sentAt);
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation,
    messageId,
    content: "Follow up H+3",
    csKey: "aisyah",
    detectedStage: 3,
    createdAt: sentAt,
    source: "provider_webhook",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    status: "active",
    followUpState: "archived",
    followUpOutcome: "h3_complete",
  });
  expect((await getConversation(t, conversationId)).followUpNextStage).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0 });
});

test("an archived cycle cannot be rearmed until a customer replies", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 3 });
  const h3MessageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+3", sentAt);
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("missing conversation fixture");
    await applyOutboundLifecycle(ctx, {
      conversation,
      messageId: h3MessageId,
      content: "Follow up H+3",
      csKey: "aisyah",
      detectedStage: 3,
      createdAt: sentAt,
      source: "provider_webhook",
    });
  });
  const ordinaryMessageId = await insertMessage(
    t,
    orgId,
    conversationId,
    "outbound",
    "Pesan biasa setelah arsip",
    sentAt + HOUR,
  );

  const result = await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("missing conversation fixture");
    return applyOutboundLifecycle(ctx, {
      conversation,
      messageId: ordinaryMessageId,
      content: "Pesan biasa setelah arsip",
      csKey: "aisyah",
      detectedStage: null,
      createdAt: sentAt + HOUR,
      source: "provider_webhook",
    });
  });

  expect(result).toMatchObject({ applied: false, stale: true });
  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpState: "archived",
    followUpOutcome: "h3_complete",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0 });
});

test("a customer reply releases an archived cycle so a later CS outbound can arm H+1", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 3 });
  const h3MessageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+3", sentAt);
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("missing conversation fixture");
    await applyOutboundLifecycle(ctx, {
      conversation,
      messageId: h3MessageId,
      content: "Follow up H+3",
      csKey: "aisyah",
      detectedStage: 3,
      createdAt: sentAt,
      source: "provider_webhook",
    });
  });
  const inboundMessageId = await insertMessage(t, orgId, conversationId, "inbound", "Saya tertarik lagi", sentAt + HOUR);
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("missing conversation fixture");
    await applyInboundReset(ctx, {
      conversation,
      messageId: inboundMessageId,
      content: "Saya tertarik lagi",
      createdAt: sentAt + HOUR,
    });
  });
  const replyMessageId = await insertMessage(t, orgId, conversationId, "outbound", "Baik, Kak", sentAt + 2 * HOUR);
  const result = await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("missing conversation fixture");
    return applyOutboundLifecycle(ctx, {
      conversation,
      messageId: replyMessageId,
      content: "Baik, Kak",
      csKey: "aisyah",
      detectedStage: null,
      createdAt: sentAt + 2 * HOUR,
      source: "provider_webhook",
    });
  });

  expect(result.applied).toBe(true);
  const rearmed = await getConversation(t, conversationId);
  expect(rearmed).toMatchObject({
    followUpNextStage: 1,
    followUpState: "waiting",
  });
  expect(rearmed.followUpOutcome).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 1, h2: 0, h3: 0 });
});

test("customer inbound ends the active cycle and decrements its counter", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 2 });
  const messageId = await insertMessage(t, orgId, conversationId, "inbound", "Masih ada, Kak?", sentAt);
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => applyInboundReset(ctx, {
    conversation,
    messageId,
    content: "Masih ada, Kak?",
    createdAt: sentAt,
  }));

  const reset = await getConversation(t, conversationId);
  expect(reset).toMatchObject({
    followUpLastInboundPreview: "Masih ada, Kak?",
    followUpLastInboundAt: sentAt,
  });
  expect(reset.followUpCycleId).toBeUndefined();
  expect(reset.followUpNextStage).toBeUndefined();
  expect(reset.followUpState).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").unique()))
    .toMatchObject({ cycleId: "cycle-1", kind: "customer_replied" });
});

test("a duplicate provider message ID is a complete no-op", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 1 });
  const firstMessageId = await insertMessage(t, orgId, conversationId, "outbound", "Follow up H+1", sentAt);
  const original = await getConversation(t, conversationId);
  await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation: original,
    messageId: firstMessageId,
    content: "Follow up H+1",
    providerMessageId: "wamid.duplicate",
    csKey: "aisyah",
    detectedStage: 1,
    createdAt: sentAt,
    source: "provider_webhook",
  }));

  const replayMessageId = await insertMessage(t, orgId, conversationId, "outbound", "replayed payload", sentAt + HOUR);
  const result = await t.run((ctx) => applyOutboundLifecycle(ctx, {
    conversation: original,
    messageId: replayMessageId,
    content: "replayed payload",
    providerMessageId: "wamid.duplicate",
    csKey: "aisyah",
    detectedStage: 1,
    createdAt: sentAt + HOUR,
    source: "provider_webhook",
  }));

  expect(result.duplicate).toBe(true);
  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpNextStage: 2,
    followUpLastOutboundPreview: "Follow up H+1",
    followUpLastOutboundAt: sentAt,
  });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toHaveLength(1);
});

test("manual H+1 to H+3 correction is immediately actionable and records the actor", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(sentAt);
  const { t, conversationId } = await fixture({ stage: 1 });
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => correctCurrentStage(ctx, {
    conversation,
    targetStage: 3,
    requestId: "correction-1",
    actorName: "Admin Fandi",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpNextStage: 3,
    followUpDueAt: sentAt,
    followUpState: "waiting",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 1 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").unique()))
    .toMatchObject({
      kind: "stage_corrected",
      source: "manual",
      fromStage: 1,
      toStage: 3,
      actorName: "Admin Fandi",
      createdAt: sentAt,
    });
});

test("manual confirmation completes the server-side current stage", async () => {
  const { t, conversationId } = await fixture({ stage: 2 });
  const conversation = await getConversation(t, conversationId);

  await t.run((ctx) => confirmCurrentStage(ctx, {
    conversation,
    requestId: "confirmation-1",
    createdAt: sentAt,
    actorName: "CS Aisyah",
  }));

  expect(await getConversation(t, conversationId)).toMatchObject({
    followUpStage: 2,
    followUpNextStage: 3,
    followUpDueAt: nextDayAtEightWib,
    followUpState: "waiting",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 1 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").unique()))
    .toMatchObject({ kind: "stage_completed", source: "manual", fromStage: 2, toStage: 3 });
});

test("terminal lifecycle events decrement exactly once without inventing a sales close", async () => {
  const { t, conversationId } = await fixture({ stage: 2 });
  const conversation = await getConversation(t, conversationId);
  const input = {
    conversation,
    eventKey: "closing:order-1",
    kind: "closing" as const,
    createdAt: sentAt,
  };

  const first = await t.run((ctx) => terminateCycle(ctx, input));
  const duplicate = await t.run((ctx) => terminateCycle(ctx, input));

  expect(first.applied).toBe(true);
  expect(duplicate.duplicate).toBe(true);
  expect(await getConversation(t, conversationId)).toMatchObject({
    status: "active",
    followUpState: "complete",
    followUpOutcome: "closing",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toHaveLength(1);
});

test("late send confirmation after a customer reply cannot resurrect the ended cycle", async () => {
  const { t, orgId, conversationId } = await fixture({ stage: 1 });
  const staleConversation = await getConversation(t, conversationId);
  const inboundMessageId = await insertMessage(t, orgId, conversationId, "inbound", "Sudah tidak perlu", sentAt);
  await t.run((ctx) => applyInboundReset(ctx, {
    conversation: staleConversation,
    messageId: inboundMessageId,
    content: "Sudah tidak perlu",
    createdAt: sentAt,
  }));

  const result = await t.run((ctx) => confirmCurrentStage(ctx, {
    conversation: staleConversation as Doc<"conversations">,
    expectedCycleId: "cycle-1",
    requestId: "late-send-finalization",
    createdAt: sentAt + HOUR,
    source: "provider_template",
    providerMessageId: "wamid.late",
  }));

  expect(result).toMatchObject({ applied: false, stale: true });
  const ended = await getConversation(t, conversationId);
  expect(ended.followUpCycleId).toBeUndefined();
  expect(ended.followUpNextStage).toBeUndefined();
  expect(ended.followUpState).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toHaveLength(1);
});
