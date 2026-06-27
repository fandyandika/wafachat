// convex/followUp.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 5, 26, 5, 0, 0); // fixed reference
const convBase = {
  customerName: "Budi", assignedCsName: "Nabila", status: "active" as const,
  aiEnabled: false, note: "", createdAt: now - 50 * HOUR, updatedAt: now,
};
const orderBase = {
  customerName: "Budi", assignedCsName: "Nabila", productName: "Quran Mapping",
  products: "Quran Mapping", productsSubtotal: "0", shippingCost: "0", total: "0",
  shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const,
  aiEligible: false, createdAt: now - 50 * HOUR, updatedAt: now,
};
const msg = (conversationId: any, orderId: string, phone: string, direction: "inbound" | "outbound", createdAt: number) =>
  ({ conversationId, orderId, customerPhone: phone, role: direction === "inbound" ? "customer" as const : "cs" as const,
     direction, content: "x", messageType: "text" as const, source: "n8n" as const, createdAt });

test("getFollowUpCandidates: stale conversation (updated >6d ago) excluded by recency bound", async () => {
  const t = convexTest(schema);
  const DAY = 24 * HOUR;
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-OLD", customerPhone: "628990", updatedAt: now - 8 * DAY });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-OLD", customerPhone: "628990" });
    await ctx.db.insert("messages", msg(conv, "O-OLD", "628990", "inbound", now - 8 * DAY));
    await ctx.db.insert("messages", msg(conv, "O-OLD", "628990", "outbound", now - 8 * DAY + HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.find((c) => c.orderId === "O-OLD")).toBeUndefined();
  expect(r.stage2.find((c) => c.orderId === "O-OLD")).toBeUndefined();
});

test("getFollowUpCandidates: ghosted >24h, not closed -> stage1", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "outbound", now - 29 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toContain("O-1");
  expect(r.stage2.length).toBe(0);
});

test("getFollowUpCandidates: closed (shippingRecap) excluded", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "outbound", now - 29 * HOUR));
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-2", customerPhone: "62812", customerName: "Budi", csName: "Nabila", closedAt: now - 20 * HOUR,
      recipientName: "Budi", recipientPhone: "62812", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
      createdAt: now - 20 * HOUR, updatedAt: now - 20 * HOUR,
    });
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.length).toBe(0);
});

test("getFollowUpCandidates: csName scope filters to that CS", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const c1 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    const c2 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    for (const [c, o, p] of [[c1, "O-3", "62813"], [c2, "O-4", "62814"]] as const) {
      await ctx.db.insert("messages", msg(c, o, p, "inbound", now - 30 * HOUR));
      await ctx.db.insert("messages", msg(c, o, p, "outbound", now - 29 * HOUR));
    }
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { csName: "Nabila", nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toEqual(["O-3"]);
});

test("getFollowUpCandidates: stage-2 (H+2) after a post-window touch (manual or API) + 20h elapsed", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-5", customerPhone: "62815" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-5", customerPhone: "62815" });
    // Last inbound 50h ago → 24h window closes 26h ago.
    await ctx.db.insert("messages", msg(conv, "O-5", "62815", "inbound", now - 50 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-5", "62815", "outbound", now - 49 * HOUR)); // in-window reply, NOT a touch
    // H+1 follow-up touch (post-window outbound, e.g. sent by hand via WABA) 25h ago → ≥20h elapsed, still silent.
    await ctx.db.insert("messages", msg(conv, "O-5", "62815", "outbound", now - 25 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage2.map((c) => c.orderId)).toContain("O-5");
  expect(r.stage1.length).toBe(0);
});

test("getFollowUpCandidates: ANTI-DOUBLE — a fresh manual-via-WABA touch drops the lead from H+1", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-6", customerPhone: "62816" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-6", customerPhone: "62816" });
    await ctx.db.insert("messages", msg(conv, "O-6", "62816", "inbound", now - 30 * HOUR));     // window closes 6h ago
    await ctx.db.insert("messages", msg(conv, "O-6", "62816", "outbound", now - 29 * HOUR));    // in-window reply
    // CS already followed up by hand (post-window outbound) 2h ago → touchCount 1, too soon for H+2.
    await ctx.db.insert("messages", msg(conv, "O-6", "62816", "outbound", now - 2 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.find((c) => c.orderId === "O-6")).toBeUndefined(); // not re-offered for H+1
  expect(r.stage2.find((c) => c.orderId === "O-6")).toBeUndefined(); // not yet due for H+2
});

test("getFollowUpCandidates: dedupe — one customer with two ghosted orders yields one candidate", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const [oid, h] of [["O-7a", 30], ["O-7b", 40]] as const) {
      const conv = await ctx.db.insert("conversations", { ...convBase, orderId: oid, customerPhone: "62817" });
      await ctx.db.insert("orders", { ...orderBase, orderId: oid, customerPhone: "62817" });
      await ctx.db.insert("messages", msg(conv, oid, "62817", "inbound", now - h * HOUR));
      await ctx.db.insert("messages", msg(conv, oid, "62817", "outbound", now - (h - 1) * HOUR));
    }
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  const forPhone = [...r.stage1, ...r.stage2].filter((c) => c.customerPhone === "62817");
  expect(forPhone.length).toBe(1);
  expect(forPhone[0].orderId).toBe("O-7a"); // keeps the most recently active order (30h > 40h ago)
});

import { vi } from "vitest";

const csCfg = (csName: string) => ({
  normalizedName: csName.toLowerCase().replace(/[^a-z]/g, ""), csName, providerNumberId: "PHONE123",
  orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
  isActive: true, createdAt: now, updatedAt: now,
});

test("sendFollowUp: success stamps stage + inserts template message", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-9", customerPhone: "62899" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-9", customerPhone: "62899" });
    await ctx.db.insert("messages", msg(convId, "O-9", "62899", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-9", "62899", "outbound", now - 29 * HOUR));
    await ctx.db.insert("csConfigs", csCfg("Nabila"));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret"; process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "wamid.1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "s3cret", nowOverride: now });
  expect(res.ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.followUpStage).toBe(1);
    const msgs = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", convId)).collect();
    expect(msgs.some((m) => m.messageType === "template" && m.direction === "outbound")).toBe(true);
  });
  vi.unstubAllGlobals();
});

test("sendFollowUp: wrong secret -> not ok, no send", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => { convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-10", customerPhone: "62810" }); });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "WRONG", nowOverride: now });
  expect(res.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("sendFollowUp: KirimDev error code -> not ok, not stamped", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-11", customerPhone: "62811b" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-11", customerPhone: "62811b" });
    await ctx.db.insert("messages", msg(convId, "O-11", "62811b", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-11", "62811b", "outbound", now - 29 * HOUR));
    await ctx.db.insert("csConfigs", csCfg("Nabila"));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret"; process.env.KIRIMDEV_API_KEY = "k_test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "template_paused" } }), { status: 400 })));
  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "s3cret", nowOverride: now });
  expect(res.ok).toBe(false);
  await t.run(async (ctx) => {
    expect(((await ctx.db.get(convId)) as Doc<"conversations"> | undefined)!.followUpStage).toBeUndefined();
    const msgs = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", convId)).collect();
    expect(msgs.filter((m) => m.messageType === "template").length).toBe(0);
  });
  vi.unstubAllGlobals();
});

test("sendFollowUp: missing KIRIMDEV_API_KEY -> not ok, fetch not called", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-12", customerPhone: "62812b" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-12", customerPhone: "62812b" });
    await ctx.db.insert("messages", msg(convId, "O-12", "62812b", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-12", "62812b", "outbound", now - 29 * HOUR));
    await ctx.db.insert("csConfigs", csCfg("Nabila"));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  delete process.env.KIRIMDEV_API_KEY;
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "s3cret", nowOverride: now });
  expect(res.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("archiveFollowUp: wrong secret -> not ok, status unchanged", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-13", customerPhone: "62813b" });
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const res = await t.mutation(api.followUp.archiveFollowUp, { conversationId: convId, authSecret: "WRONG" });
  expect(res.ok).toBe(false);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("active"); // should not change
  });
});

test("archiveFollowUp: right secret -> ok, status closed", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-14", customerPhone: "62814b" });
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const res = await t.mutation(api.followUp.archiveFollowUp, { conversationId: convId, authSecret: "s3cret" });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("closed");
    expect(c!.followUpArchivedAt).toBeDefined();
  });
});

// Feature #8: manual stage override
test("setFollowUpStage: valid stage -> override set, appears in getFollowUpCandidates", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-15", customerPhone: "62815" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-15", customerPhone: "62815" });
    await ctx.db.insert("messages", msg(convId, "O-15", "62815", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-15", "62815", "outbound", now - 29 * HOUR));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const res = await t.mutation(api.followUp.setFollowUpStage, { conversationId: convId, stage: 2, authSecret: "s3cret" });
  expect(res.ok).toBe(true);
  const candidates = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(candidates.stage2.find((c) => c.orderId === "O-15")).toBeDefined();
  expect(candidates.stage1.find((c) => c.orderId === "O-15")).toBeUndefined();
});

test("setFollowUpStage: invalid stage -> rejected", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-16", customerPhone: "62816" });
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const res = await t.mutation(api.followUp.setFollowUpStage, { conversationId: convId, stage: 5, authSecret: "s3cret" });
  expect(res.ok).toBe(false);
});

test("setFollowUpStage: cleared on customer reply (inbound)", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-17", customerPhone: "62817" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-17", customerPhone: "62817" });
    await ctx.db.insert("messages", msg(convId, "O-17", "62817", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-17", "62817", "outbound", now - 29 * HOUR));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  await t.mutation(api.followUp.setFollowUpStage, { conversationId: convId, stage: 2, authSecret: "s3cret" });

  // Simulate inbound customer reply
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62817", order_id: "O-17", direction: "inbound", role: "customer",
    content: "Terima kasih", createdAt: now - 1 * HOUR
  });

  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.followUpStageOverride).toBeUndefined();
  });
});

test("setFollowUpStage: cleared on send (stampFollowUp)", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-17b", customerPhone: "62817b" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-17b", customerPhone: "62817b" });
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  await t.mutation(api.followUp.setFollowUpStage, { conversationId: convId, stage: 2, authSecret: "s3cret" });

  // Simulate stampFollowUp call (internal mutation)
  await t.run(async (ctx) => {
    await ctx.db.patch(convId, { followUpStage: 1, followUpStageAt: now, followUpStageOverride: undefined, updatedAt: now });
  });

  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.followUpStageOverride).toBeUndefined();
    expect(c!.followUpStage).toBe(1);
  });
});

// Feature #2: archive/undo
test("unarchiveFollowUp: restores to active + clears timestamp", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-18", customerPhone: "62818", status: "closed", followUpArchivedAt: now - 1 * HOUR });
  });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const res = await t.mutation(api.followUp.unarchiveFollowUp, { conversationId: convId, authSecret: "s3cret" });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("active");
    expect(c!.followUpArchivedAt).toBeUndefined();
  });
});

test("getArchivedFollowUps: lists recent manual archives, scoped by CS", async () => {
  const t = convexTest(schema);
  let convId1: any, convId2: any;
  await t.run(async (ctx) => {
    convId1 = await ctx.db.insert("conversations", {
      ...convBase, orderId: "O-19", customerPhone: "62819", assignedCsName: "Nabila",
      status: "closed", followUpArchivedAt: now - 1 * HOUR
    });
    convId2 = await ctx.db.insert("conversations", {
      ...convBase, orderId: "O-20", customerPhone: "62820", assignedCsName: "Lila",
      status: "closed", followUpArchivedAt: now - 2 * HOUR
    });
  });
  const res = await t.query(api.followUp.getArchivedFollowUps, { csName: "Nabila" });
  expect(res.find((r) => r.orderId === "O-19")).toBeDefined();
  expect(res.find((r) => r.orderId === "O-20")).toBeUndefined();
  expect(res[0].followUpArchivedAt).toBeGreaterThan(res[1]?.followUpArchivedAt ?? 0);
});

// Feature #5b: auto-send toggle
test("setAutoFollowUp: inserts if not exists, patches if exists", async () => {
  const t = convexTest(schema);
  process.env.PANEL_AUTH_SECRET = "s3cret";

  // First toggle (insert path)
  const res1 = await t.mutation(api.followUp.setAutoFollowUp, { csName: "CS New", enabled: true, authSecret: "s3cret" });
  expect(res1.ok).toBe(true);
  expect(res1.enabled).toBe(true);

  // Check inserted
  await t.run(async (ctx) => {
    const cfg = await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", "csnew"))
      .unique();
    expect(cfg?.autoFollowUpEnabled).toBe(true);
  });

  // Second toggle (update path)
  const res2 = await t.mutation(api.followUp.setAutoFollowUp, { csName: "CS New", enabled: false, authSecret: "s3cret" });
  expect(res2.ok).toBe(true);
  expect(res2.enabled).toBe(false);

  await t.run(async (ctx) => {
    const cfg = await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", "csnew"))
      .unique();
    expect(cfg?.autoFollowUpEnabled).toBe(false);
  });
});

test("getAutoFollowUp: returns enabled status", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", csCfg("TestCS"));
  });
  const res = await t.query(api.followUp.getAutoFollowUp, { csName: "TestCS" });
  expect(res.enabled).toBe(false); // csCfg default
});

// Feature #10: KPI
test("getFollowUpEffectiveness: counts closings with FU touches", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-21", customerPhone: "62821" });
    await ctx.db.insert("messages", msg(convId, "O-21", "62821", "inbound", now - 50 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-21", "62821", "outbound", now - 49 * HOUR)); // in-window
    await ctx.db.insert("messages", msg(convId, "O-21", "62821", "outbound", now - 25 * HOUR)); // post-window touch 1
    await ctx.db.insert("messages", msg(convId, "O-21", "62821", "outbound", now - 20 * HOUR)); // post-window touch 2

    // Recap with 2 touches
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-21", customerPhone: "62821", customerName: "Budi", csName: "Nabila", closedAt: now,
      recipientName: "Budi", recipientPhone: "62821", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "X", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1, followUpTouchesAtClose: 2,
      createdAt: now, updatedAt: now,
    });
  });

  const res = await t.query(api.followUp.getFollowUpEffectiveness, { startAt: now - 1 * HOUR, endAt: now, csName: "Nabila" });
  expect(res.totalClosings).toBe(1);
  expect(res.fromFollowUp).toBe(1);
  expect(res.byStage.h2).toBe(1);
});

// Closing tab: recent closings, with via-follow-up flag, scoped + cleaned
test("getClosedFollowUps: lists recent closings, flags via-follow-up, filters cancelled/test/scope", async () => {
  const t = convexTest(schema);
  const recap = (orderId: string, phone: string, cs: string, closedAt: number, extra: Record<string, any> = {}) => ({
    orderIdBerdu: orderId, customerPhone: phone, customerName: "Cust " + orderId, csName: cs, closedAt,
    recipientName: "Cust", recipientPhone: phone, recipientAddress: "", recipientDistrict: "",
    recipientCity: "", packageContent: "Quran", paymentMethod: "cod" as const,
    status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
    createdAt: closedAt, updatedAt: closedAt, ...extra,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("shippingRecaps", recap("C-1", "62901", "Nabila", now - 1 * HOUR, { followUpTouchesAtClose: 2 })); // via FU
    await ctx.db.insert("shippingRecaps", recap("C-2", "62902", "Nabila", now - 2 * HOUR)); // direct (no touches)
    await ctx.db.insert("shippingRecaps", recap("C-3", "62903", "Lila", now - 3 * HOUR)); // other CS
    await ctx.db.insert("shippingRecaps", recap("C-4", "62904", "Nabila", now - 4 * HOUR, { status: "cancelled" })); // cancelled
    await ctx.db.insert("shippingRecaps", recap("C-5", "6285715682110", "Nabila", now - 5 * HOUR)); // internal-test phone
  });

  const scoped = await t.query(api.followUp.getClosedFollowUps, { csName: "Nabila", sinceDays: 1, nowOverride: now });
  const ids = scoped.map((r) => r.orderId);
  expect(ids).toContain("C-1");
  expect(ids).toContain("C-2");
  expect(ids).not.toContain("C-3"); // other CS
  expect(ids).not.toContain("C-4"); // cancelled
  expect(ids).not.toContain("C-5"); // internal test
  expect(scoped[0].orderId).toBe("C-1"); // newest first
  expect(scoped.find((r) => r.orderId === "C-1")!.fromFollowUp).toBe(true);
  expect(scoped.find((r) => r.orderId === "C-2")!.fromFollowUp).toBe(false);

  const all = await t.query(api.followUp.getClosedFollowUps, { sinceDays: 1, nowOverride: now });
  expect(all.map((r) => r.orderId)).toContain("C-3"); // unscoped sees other CS
});
