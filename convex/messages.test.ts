import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { appendMessageCore } from "./messages";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

test("new inbound clears the old cycle, stores its preview, and decrements the ledger", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let conversationId: any;
  await t.run(async (ctx) => {
    conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "FU-INBOUND",
      customerPhone: "628801",
      customerName: "Inbound",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpCsKey: "aisyah",
      followUpCycleInboundAt: 1_000,
      followUpCycleId: "cycle:inbound-reset",
      followUpCycleStartedAt: 1_500,
      followUpNextStage: 2,
      followUpDueAt: 2_000,
      followUpState: "waiting",
      createdAt: 1_000,
      updatedAt: 2_000,
    });
    await ctx.db.insert("followUpCounters", {
      orgId,
      csKey: "aisyah",
      h1: 0,
      h2: 1,
      h3: 0,
      review: 0,
      updatedAt: 2_000,
    });
  });

  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "628801",
    order_id: "FU-INBOUND",
    role: "customer",
    direction: "inbound",
    content: `Saya balas ya kak ${"x".repeat(200)}`,
    createdAt: 5_000,
  });

  const conversation = await t.run(async (ctx) => (await ctx.db.get(conversationId)) as Doc<"conversations"> | null);
  expect(conversation).toMatchObject({
    followUpCycleInboundAt: 5_000,
    followUpLastInboundAt: 5_000,
    followUpLastInboundPreview: `Saya balas ya kak ${"x".repeat(162)}`,
  });
  expect(conversation?.followUpCycleId).toBeUndefined();
  expect(conversation?.followUpNextStage).toBeUndefined();
  expect(conversation?.followUpDueAt).toBeUndefined();
  expect(conversation?.followUpState).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 0, h2: 0, h3: 0, review: 0 }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({
      cycleId: "cycle:inbound-reset",
      kind: "customer_replied",
      fromStage: 2,
    }),
  ]);
});

test("CS outbound without a prior inbound arms H+1 and records one lifecycle transition", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const outboundAt = 11_000;
  const result = await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "628802",
    order_id: "FU-OUTBOUND",
    customerName: "Outbound",
    csName: "CS Aisyah",
    role: "cs",
    direction: "outbound",
    content: "Halo juga",
    createdAt: outboundAt,
  }));

  const conversation = await t.run(async (ctx) => (await ctx.db.get(result.conversationId)) as Doc<"conversations"> | null);
  expect(conversation).toMatchObject({
    followUpCsKey: "aisyah",
    followUpCycleInboundAt: outboundAt,
    followUpCycleStartedAt: outboundAt,
    followUpNextStage: 1,
    followUpDueAt: 90_000_000,
    followUpState: "waiting",
    followUpLastOutboundPreview: "Halo juga",
  });
  expect(conversation?.followUpCycleId).toBe(`cycle:${String(result.conversationId)}:${String(result.messageId)}`);
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0 }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({ kind: "cycle_armed", toStage: 1, source: "system" }),
  ]);
});

test("system order-notification outbound never arms manual follow-up", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const inbound = await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "628803",
    order_id: "FU-SYSTEM",
    customerName: "System",
    csName: "Aisyah",
    role: "customer",
    direction: "inbound",
    content: "Halo",
    createdAt: 20_000,
  });
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "628803",
    order_id: "FU-SYSTEM",
    role: "system",
    direction: "outbound",
    content: "ORDER BARU",
    messageType: "template",
    createdAt: 21_000,
  });

  const conversation = await t.run(async (ctx) => (await ctx.db.get(inbound.conversationId)) as Doc<"conversations"> | null);
  expect(conversation?.followUpNextStage).toBeUndefined();
  expect(conversation?.followUpDueAt).toBeUndefined();
});

test("configured H+1 text advances to H+2 before the due time", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const dueAt = 300_000;
  let conversationId: any;
  await t.run(async (ctx) => {
    conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "FU-CONFIGURED-H1",
      customerPhone: "628804",
      customerName: "Configured H1",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpCsKey: "aisyah",
      followUpCycleInboundAt: 30_000,
      followUpCycleId: "cycle:configured-h1",
      followUpCycleStartedAt: 31_000,
      followUpNextStage: 1,
      followUpDueAt: dueAt,
      followUpState: "waiting",
      createdAt: 30_000,
      updatedAt: 31_000,
    });
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: 31_000,
    });
    await ctx.db.insert("followUpTemplates", {
      orgId,
      stage: 1,
      label: "H+1",
      templateName: "follow_up_h1",
      language: "id",
      variables: [],
      matchPatterns: ["masih berminat kak"],
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const h1At = dueAt - 1;
  await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "628804",
    order_id: "FU-CONFIGURED-H1",
    csName: "Aisyah",
    role: "cs",
    direction: "outbound",
    content: "Masih berminat kak!",
    source: "n8n",
    createdAt: h1At,
  }));

  const conversation = await t.run(async (ctx) => (await ctx.db.get(conversationId)) as Doc<"conversations"> | null);
  expect(conversation).toMatchObject({
    followUpStage: 1,
    followUpNextStage: 2,
    followUpDueAt: 90_000_000,
    followUpState: "waiting",
    followUpLastDetectedStage: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 0, h2: 1, h3: 0, review: 0 }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({
      cycleId: "cycle:configured-h1",
      kind: "stage_completed",
      fromStage: 1,
      toStage: 2,
    }),
  ]);
});

test("a KirimDev outbound before due time does not consume the stage", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const dueAt = 200_000;
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    orderId: "FU-EARLY",
    customerPhone: "6288041",
    customerName: "Early",
    assignedCsName: "Aisyah",
    status: "active",
    aiEnabled: false,
    note: "",
    followUpCsKey: "aisyah",
    followUpCycleInboundAt: 30_000,
    followUpCycleId: "cycle:ordinary-outbound",
    followUpCycleStartedAt: 31_000,
    followUpNextStage: 1,
    followUpDueAt: dueAt,
    followUpState: "waiting",
    createdAt: 30_000,
    updatedAt: 30_000,
  }));
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: 30_000,
  }));

  await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "6288041",
    order_id: "FU-EARLY",
    csName: "Aisyah",
    role: "cs",
    direction: "outbound",
    content: `Belum waktunya ${"x".repeat(200)}`,
    externalMessageId: "wamid.phone.early",
    source: "ingest",
    createdAt: dueAt - 1,
  }));

  expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
    followUpNextStage: 1,
    followUpDueAt: dueAt,
    followUpState: "waiting",
    followUpLastOutboundPreview: `Belum waktunya ${"x".repeat(165)}`,
  });
  expect(await t.run((ctx) => ctx.db.query("followUpAttempts").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0 }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toHaveLength(0);
});

test("configured H+2 provider template catches up directly from H+1", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const dueAt = 300_000;
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    orderId: "FU-H2-CATCHUP",
    customerPhone: "6288042",
    customerName: "Catchup",
    assignedCsName: "Aisyah",
    status: "active",
    aiEnabled: false,
    note: "",
    followUpCsKey: "aisyah",
    followUpCycleInboundAt: 40_000,
    followUpCycleId: "cycle:h2-catchup",
    followUpCycleStartedAt: 41_000,
    followUpNextStage: 1,
    followUpDueAt: dueAt,
    followUpState: "waiting",
    createdAt: 40_000,
    updatedAt: 40_000,
  }));
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: 40_000,
    });
    await ctx.db.insert("followUpTemplates", {
      orgId,
      stage: 2,
      label: "H+2",
      templateName: "follow_up_h2",
      language: "id",
      variables: [],
      matchPatterns: [],
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const outbound = {
    orgId,
    phone: "6288042",
    order_id: "FU-H2-CATCHUP",
    csName: "Aisyah",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Template H+2",
    messageType: "template" as const,
    providerTemplateName: "follow_up_h2",
    externalMessageId: "wamid.phone.h2-catchup",
    source: "ingest",
    createdAt: dueAt - 1,
  };

  await t.run((ctx) => appendMessageCore(ctx, outbound));

  expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
    followUpStage: 2,
    followUpNextStage: 3,
    followUpLastDetectedStage: 2,
    followUpLastDetectedTemplate: "follow_up_h2",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 0, h2: 0, h3: 1, review: 0 }),
  ]);
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({
      cycleId: "cycle:h2-catchup",
      kind: "stage_completed",
      source: "provider_webhook",
      fromStage: 1,
      toStage: 3,
      providerMessageId: "wamid.phone.h2-catchup",
      templateName: "follow_up_h2",
    }),
  ]);
});

test("configured H+3 archives lifecycle without changing the sales status", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const dueAt = 400_000;
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    orderId: "FU-H3",
    customerPhone: "6288043",
    customerName: "Final",
    assignedCsName: "Aisyah",
    status: "active",
    aiEnabled: false,
    note: "",
    followUpCsKey: "aisyah",
    followUpCycleInboundAt: 50_000,
    followUpCycleId: "cycle:h3-archive",
    followUpCycleStartedAt: 51_000,
    followUpNextStage: 3,
    followUpDueAt: dueAt,
    followUpState: "waiting",
    createdAt: 50_000,
    updatedAt: 50_000,
  }));
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 0, h2: 0, h3: 1, review: 0, updatedAt: 50_000,
    });
    await ctx.db.insert("followUpTemplates", {
      orgId,
      stage: 3,
      label: "H+3",
      templateName: "follow_up_h3",
      language: "id",
      variables: [],
      matchPatterns: [],
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "6288043",
    order_id: "FU-H3",
    csName: "Aisyah",
    role: "cs",
    direction: "outbound",
    content: "Follow-up terakhir",
    messageType: "template",
    providerTemplateName: "follow_up_h3",
    externalMessageId: "wamid.phone.h3",
    source: "ingest",
    createdAt: dueAt,
  }));

  const conversation = await t.run((ctx) => ctx.db.get(conversationId));
  expect(conversation?.followUpStage).toBe(3);
  expect(conversation?.followUpState).toBe("archived");
  expect(conversation?.followUpOutcome).toBe("h3_complete");
  expect(conversation?.status).toBe("active");
  expect(conversation?.followUpNextStage).toBeUndefined();
  expect(conversation?.followUpDueAt).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 0, h2: 0, h3: 0, review: 0 }),
  ]);
});

test("inbound done marker takes terminal precedence and closes the active cycle once", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let conversationId: any;
  await t.run(async (ctx) => {
    conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "FU-INBOUND-DONE",
      customerPhone: "6288044",
      customerName: "Inbound Done",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpCsKey: "aisyah",
      followUpCycleInboundAt: 50_000,
      followUpCycleId: "cycle:inbound-done",
      followUpCycleStartedAt: 50_001,
      followUpNextStage: 2,
      followUpDueAt: 60_000,
      followUpState: "waiting",
      createdAt: 50_000,
      updatedAt: 50_001,
    });
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 0, h2: 1, h3: 0, review: 0, updatedAt: 50_001,
    });
  });

  await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "6288044",
    order_id: "FU-INBOUND-DONE",
    role: "customer",
    direction: "inbound",
    content: "Saya checkout di shopee ya kak",
    createdAt: 70_000,
  }));

  expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
    status: "closed",
    followUpState: "complete",
    followUpOutcome: "closing",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0, review: 0 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({
      cycleId: "cycle:inbound-done",
      kind: "closing",
      source: "system",
    }),
  ]);
});

test("configured H+3 terminal collision records closing once with existing sales closure semantics", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let conversationId: any;
  await t.run(async (ctx) => {
    conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "FU-H3-TERMINAL",
      customerPhone: "6288045",
      customerName: "H3 Terminal",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpCsKey: "aisyah",
      followUpCycleInboundAt: 80_000,
      followUpCycleId: "cycle:h3-terminal",
      followUpCycleStartedAt: 80_001,
      followUpNextStage: 3,
      followUpDueAt: 90_000,
      followUpState: "waiting",
      createdAt: 80_000,
      updatedAt: 80_001,
    });
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 0, h2: 0, h3: 1, review: 0, updatedAt: 80_001,
    });
    await ctx.db.insert("followUpTemplates", {
      orgId,
      stage: 3,
      label: "H+3",
      templateName: "follow_up_h3_terminal",
      language: "id",
      variables: [],
      matchPatterns: ["silakan checkout di shopee"],
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  await t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "6288045",
    order_id: "FU-H3-TERMINAL",
    csName: "Aisyah",
    role: "cs",
    direction: "outbound",
    content: "Silakan checkout di shopee",
    createdAt: 100_000,
  }));

  expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
    status: "closed",
    followUpState: "complete",
    followUpOutcome: "closing",
  });
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").unique()))
    .toMatchObject({ h1: 0, h2: 0, h3: 0, review: 0 });
  expect(await t.run((ctx) => ctx.db.query("followUpTransitions").collect())).toEqual([
    expect.objectContaining({
      cycleId: "cycle:h3-terminal",
      kind: "closing",
      source: "system",
    }),
  ]);
});

test("message trigger rule loading rejects more than three active stage rows", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const [index, stage] of [1, 2, 3, 3].entries()) {
      await ctx.db.insert("followUpTemplates", {
        orgId,
        stage: stage as 1 | 2 | 3,
        label: `Rule ${index}`,
        templateName: `follow_up_rule_${index}`,
        language: "id",
        variables: [],
        matchPatterns: [],
        isActive: true,
        createdAt: index,
        updatedAt: index,
      });
    }
  });

  await expect(t.run((ctx) => appendMessageCore(ctx, {
    orgId,
    phone: "6288046",
    order_id: "FU-RULE-CORRUPTION",
    csName: "Aisyah",
    role: "cs",
    direction: "outbound",
    content: "Pesan biasa",
    createdAt: 110_000,
  }))).rejects.toThrow(/konfigurasi trigger follow-up tidak valid/i);
});

test("message history rejects anonymous callers", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    orderId: "HISTORY-ANON",
    customerPhone: "628805",
    customerName: "Anonymous",
    assignedCsName: "Aisyah",
    status: "active",
    aiEnabled: false,
    note: "",
    createdAt: 1,
    updatedAt: 1,
  }));

  await expect(t.query(api.messages.listMessages, { conversationId, limit: 50 }))
    .rejects.toThrow(/requires a logged-in user/);
});

test("message history rejects a CS reading another CS conversation", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const csUserId = await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: "history-aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "test",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  const lilaConversation = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    orderId: "HISTORY-LILA",
    customerPhone: "628806",
    customerName: "Lila Customer",
    assignedCsName: "Lila",
    status: "active",
    aiEnabled: false,
    note: "",
    createdAt: 1,
    updatedAt: 1,
  }));
  const asAisyah = t.withIdentity({
    subject: String(csUserId),
    role: "cs",
    name: "Aisyah",
    email: "history-aisyah@wafachat.test",
    csName: "Aisyah",
  });

  await expect(asAisyah.query(api.messages.listMessages, {
    conversationId: lilaConversation,
    limit: 50,
  })).rejects.toThrow(/conversation scope/);
});

test("appendMessageFromN8n: same externalMessageId twice -> one row", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const args = {
    phone: "62811", order_id: "O-1", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const, content: "halo",
    messageType: "text" as const, externalMessageId: "msg_ABC", createdAt: 1000,
  };
  const first = await t.mutation(internal.messages.appendMessageFromN8n, args);
  const second = await t.mutation(internal.messages.appendMessageFromN8n, args);
  expect(second.deduped).toBe(true);
  expect(second.messageId).toBe(first.messageId);
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("messages").collect()).filter((m) => m.externalMessageId === "msg_ABC"));
  expect(rows.length).toBe(1);
});

test("appendMessageFromN8n: outbound closing phrase -> exactly one recap + closing_detected event", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const base = {
    phone: "62811", order_id: "O-9", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const,
    content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
    messageType: "text" as const,
  };
  const r1 = await t.mutation(internal.messages.appendMessageFromN8n, { ...base, externalMessageId: "m1", createdAt: 2000 });
  expect(r1.closingRecapId).toBeDefined();
  // Same order, phrase again (different message id) -> still ONE recap (dedup per order)
  await t.mutation(internal.messages.appendMessageFromN8n, { ...base, externalMessageId: "m2", createdAt: 3000 });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  const events = await t.run(async (ctx) =>
    (await ctx.db.query("events").collect()).filter((e) => e.type === "closing_detected"));
  expect(events.length).toBeGreaterThanOrEqual(1);
  const conversation = await t.run(async (ctx) => (await ctx.db.get(r1.conversationId)) as Doc<"conversations"> | null);
  expect(conversation).toMatchObject({ status: "closed", followUpState: "complete" });
  expect(conversation?.followUpDueAt).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([]);
  const lifecycleClosings = await t.run(async (ctx) => (await ctx.db
    .query("followUpTransitions")
    .collect()).filter((transition) => transition.kind === "closing"));
  expect(lifecycleClosings).toHaveLength(0);
});

test("appendMessageFromN8n: inbound with phrase -> NO recap", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62822", order_id: "O-10", role: "customer", direction: "inbound",
    content: "PEMESANAN BERHASIL?", messageType: "text", externalMessageId: "in1", createdAt: 2000,
  });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(0);
});

test("appendMessageFromN8n: outbound 'cod diproses' marker -> conversation closed LIVE", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62844", order_id: "O-44", customerName: "A", csName: "CS Aisyah",
    role: "cs", direction: "outbound", content: "*PESANAN COD DIPROSES* ya kak",
    messageType: "text", externalMessageId: "mk1", createdAt: 5000,
  });
  const conv = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", "62844")).first());
  expect(conv?.status).toBe("closed");
});

test("appendMessageFromN8n: ordinary inbound -> conversation NOT closed", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62845", order_id: "O-45", role: "customer", direction: "inbound",
    content: "halo kak mau tanya", messageType: "text", externalMessageId: "ord1", createdAt: 5000,
  });
  const conv = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", "62845")).first());
  expect(conv?.status).not.toBe("closed");
});

test("appendMessageFromN8n: heals 'Unknown' conversation csName when a known CS arrives", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  // 1. Inbound with no csName -> fallback conversation assignedCsName "Unknown"
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62833", role: "customer", direction: "inbound",
    content: "halo kak", messageType: "text", externalMessageId: "h1", createdAt: 1000,
  });
  const before = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", "62833")).first());
  expect(before?.assignedCsName).toBe("Unknown");
  // 2. Outbound with a known csName -> conversation healed to that CS
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62833", csName: "Risma", role: "cs", direction: "outbound",
    content: "siap kak", messageType: "text", externalMessageId: "h2", createdAt: 2000,
  });
  const after = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", "62833")).first());
  expect(after?.assignedCsName).toBe("Risma");
  // 3. A later message with "Unknown" csName must NOT clobber the real CS
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62833", csName: "Unknown", role: "cs", direction: "outbound",
    content: "oke", messageType: "text", externalMessageId: "h3", createdAt: 3000,
  });
  const after2 = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_customerPhone_updatedAt", (q) => q.eq("orgId", orgId).eq("customerPhone", "62833")).first());
  expect(after2?.assignedCsName).toBe("Risma");
});

// Feature #8: override cleared on inbound
test("appendMessageFromN8n: inbound message clears followUpStageOverride", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();

  // Create conversation with override set
  const orgId = await seedOrg(t);
  const convId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("conversations", {
      orgId,
      orderId: "O-ovr1", customerPhone: "62851", customerName: "Test", assignedCsName: "CS Test",
      status: "active", aiEnabled: false, note: "",
      followUpStageOverride: 2, createdAt: now, updatedAt: now,
    });
    return id;
  });

  // Inbound message arrives
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62851", order_id: "O-ovr1", role: "customer", direction: "inbound",
    content: "Iya pak siap", messageType: "text", externalMessageId: "ovr1", createdAt: now,
  });

  // Override should be cleared
  await t.run(async (ctx) => {
    const c = await ctx.db.get(convId);
    expect(c?.followUpStageOverride).toBeUndefined();
  });
});

// Feature #10: KPI recording on closing
test("appendMessageFromN8n: outbound closing phrase -> records followUpTouchesAtClose", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const HOUR = 3_600_000;

  // Create conversation with messages
  const orgId = await seedOrg(t);
  const convId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("conversations", {
      orgId,
      orderId: "O-kpi1", customerPhone: "62852", customerName: "Test", assignedCsName: "CS Test",
      status: "active", aiEnabled: false, note: "", createdAt: now - 50 * HOUR, updatedAt: now - 50 * HOUR,
    });
    // Inbound 50h ago
    await ctx.db.insert("messages", {
      orgId, conversationId: id, orderId: "O-kpi1", customerPhone: "62852",
      role: "customer", direction: "inbound", content: "Berapa harga?", messageType: "text",
      source: "n8n", createdAt: now - 50 * HOUR,
    });
    // In-window outbound (not a touch)
    await ctx.db.insert("messages", {
      orgId, conversationId: id, orderId: "O-kpi1", customerPhone: "62852",
      role: "cs", direction: "outbound", content: "Harga Rp50rb", messageType: "text",
      source: "n8n", createdAt: now - 49 * HOUR,
    });
    // Post-window touch 1 (25h ago)
    await ctx.db.insert("messages", {
      orgId, conversationId: id, orderId: "O-kpi1", customerPhone: "62852",
      role: "cs", direction: "outbound", content: "Kirim template H+1", messageType: "template",
      source: "panel", createdAt: now - 25 * HOUR,
    });
    // Post-window touch 2 (20h ago)
    await ctx.db.insert("messages", {
      orgId, conversationId: id, orderId: "O-kpi1", customerPhone: "62852",
      role: "cs", direction: "outbound", content: "Follow-up H+2", messageType: "template",
      source: "panel", createdAt: now - 20 * HOUR,
    });
    return id;
  });

  // Outbound closing phrase
  const res = await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62852", order_id: "O-kpi1", csName: "CS Test", role: "cs", direction: "outbound",
    content: "PEMESANAN BERHASIL\nProduk: Test\nTotal: Rp50.000",
    messageType: "text", externalMessageId: "kpi1", createdAt: now - 1 * HOUR,
  });

  // Recap should have followUpTouchesAtClose = 2
  expect(res.closingRecapId).toBeDefined();
  await t.run(async (ctx) => {
    const recap = await ctx.db.get(res.closingRecapId!);
    expect(recap?.followUpTouchesAtClose).toBe(2);
  });
});

test("org isolation: same externalMessageId in two orgs = TWO message rows; org-B append never dedup-patches org-A", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  let orgB: any;
  await t.run(async (ctx: any) => {
    orgB = await ctx.db.insert("organizations", { slug: "org-b", name: "B", createdAt: 1, updatedAt: 1 });
  });
  await t.run(async (ctx: any) => {
    const { appendMessageCore } = await import("./messages");
    const baseArgs = {
      order_id: "O-COLLIDE", phone: "62811", role: "cs" as const,
      direction: "inbound" as const, content: "msg", messageType: "text" as const,
      source: "n8n" as const, externalMessageId: "msg_COLLIDE", createdAt: 5000,
    };
    // appendMessageCore creates/finds conversations internally, so just call with different orgs
    await appendMessageCore(ctx, { ...baseArgs, orgId: orgA });
    await appendMessageCore(ctx, { ...baseArgs, orgId: orgB });
    const rows = (await ctx.db.query("messages").collect()).filter((m: any) => m.externalMessageId === "msg_COLLIDE");
    expect(rows.length).toBe(2); // NOT a dedup across orgs
    const a = rows.find((r: any) => String(r.orgId) === String(orgA));
    const b = rows.find((r: any) => String(r.orgId) === String(orgB));
    expect(a?.orgId).toBeDefined();
    expect(b?.orgId).toBeDefined();
    expect(String(a?.orgId)).not.toEqual(String(b?.orgId));
  });
});
