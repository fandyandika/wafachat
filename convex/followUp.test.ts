// convex/followUp.test.ts
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { windowKeyFor, windowRangeForKey } from "./lib";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";
import { nextJakartaDueAt } from "./followUpModel";

const modules = (import.meta as any).glob("./**/*.{ts,js}");

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

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

test("listDueFollowUps caps high-volume pages at 30 rows", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "queue-admin", role: "admin", name: "Queue Admin", email: "queue@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 901; i++) {
      await ctx.db.insert("conversations", {
        orgId,
        ...convBase,
        orderId: `QUEUE-${i}`,
        customerPhone: `6289000${String(i).padStart(4, "0")}`,
        followUpCsKey: "nabila",
        followUpCycleInboundAt: now - 30 * HOUR,
        followUpNextStage: 1,
        followUpDueAt: now - HOUR + i,
        followUpState: "waiting",
      });
    }
  });

  const first = await asAdmin.query(api.followUp.listDueFollowUps, {
    now,
    paginationOpts: { numItems: 100, cursor: null },
  });
  const second = await asAdmin.query(api.followUp.listDueFollowUps, {
    now,
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });
  expect(first.page).toHaveLength(30);
  expect(second.page).toHaveLength(30);
  expect(first.isDone).toBe(false);
  expect(new Set([...first.page, ...second.page].map((row) => String(row.conversationId))).size).toBe(60);
});

test("listDueFollowUps enriches only the selected page with decision context", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "context-admin", role: "admin", name: "Admin", email: "context@wafachat.test" });
  const orgId = await seedOrg(t);
  const conversationId = await t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      ...convBase,
      orderId: "CONTEXT-1",
      customerPhone: "62890001111",
      followUpProductName: "Quran Mapping",
      followUpCsKey: "nabila",
      followUpCycleInboundAt: now - 30 * HOUR,
      followUpNextStage: 1,
      followUpDueAt: now - HOUR,
      followUpState: "waiting",
    });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "CONTEXT-1", customerPhone: "62890001111" });
    await ctx.db.insert("messages", {
      orgId,
      ...msg(conversationId, "CONTEXT-1", "62890001111", "outbound", now - 25 * HOUR),
      content: "Baik kak, kami tunggu kabarnya.",
    });
    return conversationId;
  });

  const result = await asAdmin.query(api.followUp.listDueFollowUps, {
    now,
    paginationOpts: { numItems: 30, cursor: null },
  });
  expect(result.page[0]).toMatchObject({
    conversationId,
    productName: "Quran Mapping",
    lastMessagePreview: "Baik kak, kami tunggu kabarnya.",
    lastMessageAt: now - 25 * HOUR,
    reason: "CS terakhir membalas, customer belum merespons",
  });
});

test("searchFollowUpCustomers is on-demand, scoped, and capped", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "search-admin", role: "admin", name: "Admin", email: "search@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 25; i++) {
      await ctx.db.insert("conversations", {
        orgId,
        ...convBase,
        orderId: `SEARCH-${i}`,
        customerPhone: `628571568${String(i).padStart(2, "0")}`,
        customerName: `Hasna Customer ${i}`,
        updatedAt: now - i,
      });
    }
  });

  await expect(asAdmin.query(api.followUp.searchFollowUpCustomers, {
    query: "ha",
    limit: 20,
  })).rejects.toThrow(/minimal tiga/i);
  const result = await asAdmin.query(api.followUp.searchFollowUpCustomers, {
    query: "Hasna",
    limit: 50,
  });
  expect(result).toHaveLength(20);
  expect(result.every((row) => row.customerName.startsWith("Hasna"))).toBe(true);
});

test("listDueFollowUps excludes an inbound cycle older than seven days even when dueAt is recent", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "expiry-admin", role: "admin", name: "Admin", email: "expiry@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    ...convBase,
    orderId: "STALE-CYCLE",
    customerPhone: "62890009999",
    followUpCsKey: "nabila",
    followUpCycleInboundAt: now - 8 * 24 * HOUR,
    followUpNextStage: 1,
    followUpDueAt: now - HOUR,
    followUpState: "waiting",
  }));

  const result = await asAdmin.query(api.followUp.listDueFollowUps, {
    now,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(result.page).toEqual([]);
});

test("recent follow-up backfill materializes at most 25 conversations per page", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++) {
      const orderId = `BACKFILL-${i}`;
      const phone = `6289100${String(i).padStart(4, "0")}`;
      const conversationId = await ctx.db.insert("conversations", {
        orgId,
        ...convBase,
        orderId,
        customerPhone: phone,
        updatedAt: now - i,
      });
      await ctx.db.insert("messages", {
        orgId,
        ...msg(conversationId, orderId, phone, "inbound", now - 30 * HOUR),
      });
      await ctx.db.insert("messages", {
        orgId,
        ...msg(conversationId, orderId, phone, "outbound", now - 29 * HOUR),
      });
    }
  });

  const first = await t.mutation(internal.followUpMigration.backfillPage, {
    orgId,
    status: "active",
    now,
    scheduleNext: false,
  });
  expect(first.processed).toBe(25);
  expect(first.done).toBe(false);
  expect(await t.run(async (ctx) => (await ctx.db
    .query("conversations")
    .withIndex("by_org_followUpState_dueAt", (q) => q.eq("orgId", orgId).eq("followUpState", "waiting"))
    .collect()).length)).toBe(25);

  const second = await t.mutation(internal.followUpMigration.backfillPage, {
    orgId,
    status: "active",
    now,
    cursor: first.continueCursor,
    scheduleNext: false,
  });
  expect(second.processed).toBe(5);
  expect(second.done).toBe(true);
  expect(await t.run(async (ctx) => (await ctx.db
    .query("conversations")
    .withIndex("by_org_followUpState_dueAt", (q) => q.eq("orgId", orgId).eq("followUpState", "waiting"))
    .collect()).length)).toBe(30);
});

test("listDueFollowUps enforces tenant, CS, and stage scope before pagination", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const otherOrgId = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "other-follow-up",
    name: "Other Follow-up",
    createdAt: 1,
    updatedAt: 1,
  }));
  const csUserId = await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: "queue-aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "test",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  await t.run(async (ctx) => {
    for (const [targetOrgId, orderId, csName, key, stage] of [
      [orgId, "SCOPE-AISYAH", "Aisyah", "aisyah", 1],
      [orgId, "SCOPE-LILA", "Lila", "lila", 1],
      [orgId, "SCOPE-AISYAH-H2", "Aisyah", "aisyah", 2],
      [otherOrgId, "SCOPE-OTHER", "Aisyah", "aisyah", 1],
    ] as const) {
      await ctx.db.insert("conversations", {
        orgId: targetOrgId,
        ...convBase,
        orderId,
        customerPhone: `62892${orderId}`,
        assignedCsName: csName,
        followUpCsKey: key,
        followUpCycleInboundAt: now - 48 * HOUR,
        followUpNextStage: stage,
        followUpDueAt: now - HOUR,
        followUpState: "waiting",
      });
    }
  });

  const asCs = t.withIdentity({
    subject: String(csUserId),
    role: "cs",
    name: "Aisyah",
    email: "queue-aisyah@wafachat.test",
    csName: "Aisyah",
  });
  const csPage = await asCs.query(api.followUp.listDueFollowUps, {
    csName: "Lila",
    stage: 1,
    now,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(csPage.page.map((row) => row.orderId)).toEqual(["SCOPE-AISYAH"]);

  const asAdmin = t.withIdentity({ subject: "scope-admin", role: "admin", name: "Scope Admin", email: "scope-admin@wafachat.test" });
  const adminPage = await asAdmin.query(api.followUp.listDueFollowUps, {
    stage: 2,
    now,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(adminPage.page.map((row) => row.orderId)).toEqual(["SCOPE-AISYAH-H2"]);
});

test("getFollowUpCandidates: stale conversation (updated >6d ago) excluded by recency bound", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const DAY = 24 * HOUR;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-OLD", customerPhone: "628990", updatedAt: now - 8 * DAY });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-OLD", customerPhone: "628990" });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-OLD", "628990", "inbound", now - 8 * DAY) });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-OLD", "628990", "outbound", now - 8 * DAY + HOUR) });
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(r.stage1.find((c) => c.orderId === "O-OLD")).toBeUndefined();
  expect(r.stage2.find((c) => c.orderId === "O-OLD")).toBeUndefined();
});

test("getFollowUpCandidates: ghosted >24h, not closed -> stage1", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-1", "62811", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-1", "62811", "outbound", now - 29 * HOUR) });
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toContain("O-1");
  expect(r.stage2.length).toBe(0);
});

test("internal follow-up candidate diagnostic accepts an explicit CS scope", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const csUserId = await t.run((ctx: any) => ctx.db.insert("users", {
    orgId,
    email: "aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "x",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  const asCs = t.withIdentity({
    subject: String(csUserId),
    role: "cs",
    name: "Aisyah",
    email: "aisyah@wafachat.test",
    csName: "Aisyah",
  });
  await t.run(async (ctx) => {
    for (const [orderId, phone, csName] of [
      ["O-AISYAH", "628311111111", "Aisyah"],
      ["O-LILA", "628322222222", "Lila"],
    ] as const) {
      const conversationId = await ctx.db.insert("conversations", {
        orgId, ...convBase, orderId, customerPhone: phone, assignedCsName: csName,
      });
      await ctx.db.insert("orders", {
        orgId, ...orderBase, orderId, customerPhone: phone, assignedCsName: csName,
      });
      await ctx.db.insert("messages", { orgId, ...msg(conversationId, orderId, phone, "inbound", now - 30 * HOUR) });
      await ctx.db.insert("messages", { orgId, ...msg(conversationId, orderId, phone, "outbound", now - 29 * HOUR) });
    }
  });

  const result = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, {
    orgId,
    csName: "Aisyah",
    nowOverride: now,
  });
  expect(result.stage1.map((row) => row.orderId)).toEqual(["O-AISYAH"]);
});

test("getFollowUpCandidates: closed (shippingRecap) excluded", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-2", "62812", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-2", "62812", "outbound", now - 29 * HOUR) });
    await ctx.db.insert("shippingRecaps", { orgId,
      orderIdBerdu: "O-2", customerPhone: "62812", customerName: "Budi", csName: "Nabila", closedAt: now - 20 * HOUR,
      recipientName: "Budi", recipientPhone: "62812", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
      createdAt: now - 20 * HOUR, updatedAt: now - 20 * HOUR,
    });
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(r.stage1.length).toBe(0);
});

test("getFollowUpCandidates: csName scope filters to that CS", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const c1 = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    const c2 = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    for (const [c, o, p] of [[c1, "O-3", "62813"], [c2, "O-4", "62814"]] as const) {
      await ctx.db.insert("messages", { orgId, ...msg(c, o, p, "inbound", now - 30 * HOUR) });
      await ctx.db.insert("messages", { orgId, ...msg(c, o, p, "outbound", now - 29 * HOUR) });
    }
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, csName: "Nabila", nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toEqual(["O-3"]);
});

test("getFollowUpCandidates: stage-2 (H+2) after a post-window touch (manual or API) + 20h elapsed", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-5", customerPhone: "62815" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-5", customerPhone: "62815" });
    // Last inbound 50h ago → 24h window closes 26h ago.
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-5", "62815", "inbound", now - 50 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-5", "62815", "outbound", now - 49 * HOUR) }); // in-window reply, NOT a touch
    // H+1 follow-up touch (post-window outbound, e.g. sent by hand via WABA) 25h ago → ≥20h elapsed, still silent.
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-5", "62815", "outbound", now - 25 * HOUR) });
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(r.stage2.map((c) => c.orderId)).toContain("O-5");
  expect(r.stage1.length).toBe(0);
});

test("long alternating history keeps the latest inbound, post-window outbound touch, and H+2 candidacy", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  let convId: any;
  const orderId = "O-LONG-HISTORY";
  const phone = "628155";
  const lastInboundAt = now - 50 * HOUR;
  const touchAt = now - 25 * HOUR;

  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId, customerPhone: phone });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId, customerPhone: phone });
    // This deliberately exceeds the lifecycle marker scan and the former direction-filtered reads.
    for (let i = 0; i < 122; i++) {
      const direction = i % 2 === 0 ? "inbound" as const : "outbound" as const;
      await ctx.db.insert("messages", { orgId, ...msg(convId, orderId, phone, direction, now - 200 * HOUR + i * HOUR) });
    }
    await ctx.db.insert("messages", { orgId, ...msg(convId, orderId, phone, "inbound", lastInboundAt) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, orderId, phone, "outbound", lastInboundAt + HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, orderId, phone, "outbound", touchAt) });
  });

  await t.run(async (ctx) => {
    const latestInbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", convId).eq("direction", "inbound"))
      .order("desc")
      .first();
    const touches = await ctx.db
      .query("messages")
      .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", convId).eq("direction", "outbound").gt("createdAt", lastInboundAt + 24 * HOUR))
      .collect();
    expect(latestInbound?.createdAt).toBe(lastInboundAt);
    expect(touches.map((m: any) => m.createdAt)).toEqual([touchAt]);
  });

  const candidates = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(candidates.stage2.find((c) => c.orderId === orderId)).toMatchObject({ lastInboundAt, touchAts: [touchAt] });
  const candidacy = await t.query(internal.followUp.candidacyFor, { conversationId: convId, nowOverride: now });
  expect(candidacy?.eligible).toBe(2);
});

test("getFollowUpCandidates: ANTI-DOUBLE — a fresh manual-via-WABA touch drops the lead from H+1", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-6", customerPhone: "62816" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-6", customerPhone: "62816" });
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-6", "62816", "inbound", now - 30 * HOUR) });     // window closes 6h ago
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-6", "62816", "outbound", now - 29 * HOUR) });    // in-window reply
    // CS already followed up by hand (post-window outbound) 2h ago → touchCount 1, too soon for H+2.
    await ctx.db.insert("messages", { orgId, ...msg(conv, "O-6", "62816", "outbound", now - 2 * HOUR) });
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  expect(r.stage1.find((c) => c.orderId === "O-6")).toBeUndefined(); // not re-offered for H+1
  expect(r.stage2.find((c) => c.orderId === "O-6")).toBeUndefined(); // not yet due for H+2
});

test("getFollowUpCandidates: dedupe — one customer with two ghosted orders yields one candidate", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const [oid, h] of [["O-7a", 30], ["O-7b", 40]] as const) {
      const conv = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: oid, customerPhone: "62817" });
      await ctx.db.insert("orders", { orgId, ...orderBase, orderId: oid, customerPhone: "62817" });
      await ctx.db.insert("messages", { orgId, ...msg(conv, oid, "62817", "inbound", now - h * HOUR) });
      await ctx.db.insert("messages", { orgId, ...msg(conv, oid, "62817", "outbound", now - (h - 1) * HOUR) });
    }
  });
  const r = await t.query(internal.followUp.getFollowUpCandidatesDiagnostic, { orgId, nowOverride: now });
  const forPhone = [...r.stage1, ...r.stage2].filter((c) => c.customerPhone === "62817");
  expect(forPhone.length).toBe(1);
  expect(forPhone[0].orderId).toBe("O-7a"); // keeps the most recently active order (30h > 40h ago)
});

const csCfg = (csName: string) => ({
  normalizedName: csName.toLowerCase().replace(/[^a-z]/g, ""), csName, providerNumberId: "PHONE123",
  orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
  isActive: true, createdAt: now, updatedAt: now,
});

async function seedDueManualFollowUp(t: any, orgId: any, suffix: string, stage: 1 | 2 | 3 = 1) {
  return await t.run(async (ctx: any) => {
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      ...convBase,
      orderId: `MANUAL-${suffix}`,
      customerPhone: `628777${suffix}`,
      followUpCsKey: "nabila",
      followUpCycleInboundAt: Date.now() - 30 * HOUR,
      followUpNextStage: stage,
      followUpDueAt: Date.now() - HOUR,
      followUpState: "waiting",
    });
    await ctx.db.insert("orders", {
      orgId,
      ...orderBase,
      orderId: `MANUAL-${suffix}`,
      customerPhone: `628777${suffix}`,
    });
    const existingCs = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "nabila"))
      .first();
    if (!existingCs) await ctx.db.insert("csConfigs", { orgId, ...csCfg("Nabila") });
    for (const templateStage of [1, 2, 3] as const) {
      const existingTemplate = await ctx.db
        .query("followUpTemplates")
        .withIndex("by_org_stage", (q: any) => q.eq("orgId", orgId).eq("stage", templateStage))
        .first();
      if (!existingTemplate) {
        await ctx.db.insert("followUpTemplates", {
          orgId,
          stage: templateStage,
          label: `H+${templateStage}`,
          templateName: `follow_up_h${templateStage}`,
          language: "id",
          variables: ["customer_name", "product_name", "order_id"],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return conversationId;
  });
}

test("reserveDueFollowUp atomically reserves once and returns immutable provider payload", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "manual-admin", role: "admin", name: "Manual Admin", email: "manual@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "01");

  const first = await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
  });
  const duplicate = await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
  });

  expect(first).toMatchObject({
    shouldSend: true,
    status: "sending",
    to: "62877701",
    phoneNumberId: "PHONE123",
    templateName: "follow_up_h1",
    language: "id",
    orderedValues: ["Budi", "Quran Mapping", "MANUAL-01"],
  });
  expect(first.idempotencyKey).toContain("-1-");
  expect(first.idempotencyKey).toMatch(/-1-.*-11111111-1111-4111-8111-111111111111$/);
  expect(duplicate).toEqual({ shouldSend: false, status: "sending" });
});

test("sendDueFollowUp owns provider acceptance and advances the queue", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "send-admin", role: "admin", name: "Send Admin", email: "send@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "05");
  process.env.KIRIMDEV_API_KEY = "k_test";
  process.env.KIRIMDEV_BASE_URL = "https://api.test/v1";
  const request = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.action.1" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", request);

  const result = await asAdmin.action(api.followUp.sendDueFollowUp, {
    conversationId,
    stage: 1,
    templateId: await t.run(async (ctx) => (await ctx.db.query("followUpTemplates")
      .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", 1)).unique())!._id),
    requestId: "66666666-6666-4666-8666-666666666666",
  });

  expect(result).toMatchObject({ ok: true, status: "accepted", providerMessageId: "wamid.action.1" });
  expect(request).toHaveBeenCalledOnce();
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId);
    expect(conversation).toMatchObject({ followUpState: "waiting", followUpNextStage: 2 });
    const attempts = await ctx.db.query("followUpAttempts")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect();
    expect(attempts).toContainEqual(expect.objectContaining({
      method: "provider_template",
      status: "accepted",
      bucket: "sent",
      templateName: "follow_up_h1",
      providerMessageId: "wamid.action.1",
    }));
  });
  vi.unstubAllGlobals();
});

test("confirmManualContact advances once and deduplicates the same request", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "confirm-admin", role: "admin", name: "Confirm Admin", email: "confirm@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "08");
  const args = {
    conversationId,
    stage: 1 as const,
    requestId: "99999999-9999-4999-8999-999999999999",
  };

  expect(await asAdmin.mutation(api.followUp.confirmManualContact, args))
    .toEqual({ ok: true, duplicate: false });
  expect(await asAdmin.mutation(api.followUp.confirmManualContact, args))
    .toEqual({ ok: true, duplicate: true });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      followUpStage: 1,
      followUpNextStage: 2,
      followUpState: "waiting",
    });
    const attempts = await ctx.db.query("followUpAttempts")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      method: "manual_confirmation",
      status: "accepted",
      actorName: "Confirm Admin",
    });
  });
});

test("reservation accepts one explicitly selected active template without requiring every stage", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "template-admin", role: "admin", name: "Admin", email: "template@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "06");
  await t.run(async (ctx) => {
    const template = await ctx.db
      .query("followUpTemplates")
      .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", 3))
      .unique();
    await ctx.db.delete(template!._id);
  });

  const selectedTemplateId = await t.run(async (ctx) => (await ctx.db
    .query("followUpTemplates")
    .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", 1))
    .unique())!._id);

  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    templateId: selectedTemplateId,
    requestId: "77777777-7777-4777-8777-777777777777",
  })).resolves.toMatchObject({ shouldSend: true, templateName: "follow_up_h1" });
});

test("expired sending lease becomes operator-visible unknown status", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "lease-admin", role: "admin", name: "Admin", email: "lease@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "07");
  const requestId = "88888888-8888-4888-8888-888888888888";
  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, { conversationId, stage: 1, requestId });
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId) as Doc<"conversations">;
    await ctx.db.patch(conversationId, { updatedAt: conversation.updatedAt + 1 });
  });
  expect(await t.mutation(internal.followUp.expireSendingReservation, { conversationId, requestId }))
    .toEqual({ expired: true });
  const attention = await asAdmin.query(api.followUp.listFollowUpAttention, {
    state: "unknown",
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(attention.page).toContainEqual(expect.objectContaining({
    conversationId,
    state: "unknown",
  }));
});

test("reserveDueFollowUp fails closed when a CS has no canonical sender claim", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "manual-admin", role: "admin", name: "Manual Admin", email: "manual@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "04");
  await t.run(async (ctx) => {
    const agent = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", "nabila"))
      .unique();
    await ctx.db.patch(agent!._id, { providerNumberId: undefined, providerNumberIds: ["pn-a", "pn-b"] });
  });

  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    requestId: "55555555-5555-4555-8555-555555555555",
  })).rejects.toThrow(/Nomor API CS belum dikonfigurasi/);
});

test("unknown finalization blocks a new request and accepted H+1 advances to the next Jakarta due time", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "manual-admin", role: "admin", name: "Manual Admin", email: "manual@wafachat" });
  const orgId = await seedOrg(t);
  const unknownConversationId = await seedDueManualFollowUp(t, orgId, "02");
  const acceptedConversationId = await seedDueManualFollowUp(t, orgId, "03");

  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId: unknownConversationId,
    stage: 1,
    requestId: "22222222-2222-4222-8222-222222222222",
  });
  await asAdmin.mutation(internal.followUp.finalizeDueFollowUp, {
    conversationId: unknownConversationId,
    requestId: "22222222-2222-4222-8222-222222222222",
    outcome: "unknown",
    error: "Timeout provider",
  });
  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId: unknownConversationId,
    stage: 1,
    requestId: "33333333-3333-4333-8333-333333333333",
  })).rejects.toThrow(/belum diketahui/i);

  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId: acceptedConversationId,
    stage: 1,
    requestId: "44444444-4444-4444-8444-444444444444",
  });
  const acceptedAt = Date.now();
  await asAdmin.mutation(internal.followUp.finalizeDueFollowUp, {
    conversationId: acceptedConversationId,
    requestId: "44444444-4444-4444-8444-444444444444",
    outcome: "accepted",
    providerMessageId: "wamid.manual.1",
    acceptedAt,
  });

  await t.run(async (ctx) => {
    const conversation = (await ctx.db.get(acceptedConversationId)) as Doc<"conversations">;
    expect(conversation.followUpState).toBe("waiting");
    expect(conversation.followUpNextStage).toBe(2);
    expect(conversation.followUpDueAt).toBe(nextJakartaDueAt(acceptedAt));
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", acceptedConversationId))
      .collect();
    expect(messages).toContainEqual(expect.objectContaining({
      messageType: "template",
      externalMessageId: "wamid.manual.1",
      source: "panel",
    }));
  });
});

test("archiveFollowUp: anonymous caller is rejected and status is unchanged", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-13", customerPhone: "62813b" });
  });
  await expect(t.mutation(api.followUp.archiveFollowUp, { conversationId: convId }))
    .rejects.toThrow(/requires a logged-in user/);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("active"); // should not change
  });
});

test("archiveFollowUp: signed admin can archive an own-tenant conversation", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-14", customerPhone: "62814b" });
  });
  const res = await asAdmin.mutation(api.followUp.archiveFollowUp, { conversationId: convId });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("closed");
    expect(c!.followUpArchivedAt).toBeDefined();
  });
});

test("archiveFollowUp: CS cannot archive another CS conversation", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: "archive-aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "test",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId,
    ...convBase,
    orderId: "ARCHIVE-LILA",
    customerPhone: "628149",
    assignedCsName: "Lila",
  }));
  const asAisyah = t.withIdentity({
    subject: String(userId),
    role: "cs",
    name: "Aisyah",
    email: "archive-aisyah@wafachat.test",
    csName: "Aisyah",
  });

  await expect(asAisyah.mutation(api.followUp.archiveFollowUp, { conversationId }))
    .rejects.toThrow(/conversation scope/);
});

// Feature #2: archive/undo
test("unarchiveFollowUp: restores to active + clears timestamp", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-18", customerPhone: "62818", status: "closed", followUpArchivedAt: now - 1 * HOUR });
  });
  const res = await asAdmin.mutation(api.followUp.unarchiveFollowUp, { conversationId: convId });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("active");
    expect(c!.followUpArchivedAt).toBeUndefined();
  });
});

test("getArchivedFollowUps: lists recent manual archives, scoped by CS", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  let convId1: any, convId2: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId1 = await ctx.db.insert("conversations", {
      orgId, ...convBase, orderId: "O-19", customerPhone: "62819", assignedCsName: "Nabila",
      status: "closed", followUpArchivedAt: now - 1 * HOUR
    });
    convId2 = await ctx.db.insert("conversations", {
      orgId, ...convBase, orderId: "O-20", customerPhone: "62820", assignedCsName: "Lila",
      status: "closed", followUpArchivedAt: now - 2 * HOUR
    });
  });
  const res = await asAdmin.query(api.followUp.getArchivedFollowUps, { csName: "Nabila", nowOverride: now });
  expect(res.find((r) => r.orderId === "O-19")).toBeDefined();
  expect(res.find((r) => r.orderId === "O-20")).toBeUndefined();
  expect(res[0].followUpArchivedAt).toBeGreaterThan(res[1]?.followUpArchivedAt ?? 0);
});

test("CS archived list ignores a client request for another CS", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: "archived-aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "test",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  await t.run(async (ctx) => {
    await ctx.db.insert("conversations", {
      orgId,
      ...convBase,
      orderId: "ARCHIVED-AISYAH",
      customerPhone: "628181",
      assignedCsName: "Aisyah",
      status: "closed",
      followUpArchivedAt: now - HOUR,
    });
    await ctx.db.insert("conversations", {
      orgId,
      ...convBase,
      orderId: "ARCHIVED-LILA",
      customerPhone: "628182",
      assignedCsName: "Lila",
      status: "closed",
      followUpArchivedAt: now - HOUR,
    });
  });
  const asAisyah = t.withIdentity({
    subject: String(userId),
    role: "cs",
    name: "Aisyah",
    email: "archived-aisyah@wafachat.test",
    csName: "Aisyah",
  });

  const rows = await asAisyah.query(api.followUp.getArchivedFollowUps, {
    csName: "Lila",
    nowOverride: now,
  });
  expect(rows.map((row) => row.orderId)).toEqual(["ARCHIVED-AISYAH"]);
});

// Feature #10: KPI
test("getFollowUpEffectiveness: counts closings with FU touches", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-21", customerPhone: "62821" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-21", "62821", "inbound", now - 50 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-21", "62821", "outbound", now - 49 * HOUR) }); // in-window
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-21", "62821", "outbound", now - 25 * HOUR) }); // post-window touch 1
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-21", "62821", "outbound", now - 20 * HOUR) }); // post-window touch 2

    // Recap with 2 touches
    await ctx.db.insert("shippingRecaps", { orgId,
      orderIdBerdu: "O-21", customerPhone: "62821", customerName: "Budi", csName: "Nabila", closedAt: now - 1,
      recipientName: "Budi", recipientPhone: "62821", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "X", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1, followUpTouchesAtClose: 2,
      createdAt: now, updatedAt: now,
    });
  });

  // Populate rollups for the window containing the closing
  const windowKey = windowKeyFor(now);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const res = await asAdmin.query(api.followUp.getFollowUpEffectiveness, { startAt: now - 1 * HOUR, endAt: now, csName: "Nabila" });
  expect(res.totalClosings).toBe(1);
  expect(res.fromFollowUp).toBe(1);
  expect(res.byStage.h2).toBe(1);
});

test("getFollowUpEffectiveness uses completed rollups when a 30-day KPI exceeds the raw row cap", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "volume-admin", role: "admin", name: "Admin", email: "volume@w" });
  const orgId = await seedOrg(t);
  const windowKey = windowKeyFor(now - 2 * 24 * HOUR);
  const window = windowRangeForKey(windowKey);

  await t.run(async (ctx) => {
    for (let index = 0; index < 901; index++) {
      const orderId = `FU-VOLUME-${index}`;
      const phone = `62888${String(index).padStart(7, "0")}`;
      await ctx.db.insert("shippingRecaps", {
        orgId,
        orderIdBerdu: orderId,
        customerPhone: phone,
        customerName: orderId,
        csName: "Nabila",
        csKey: "nabila",
        closedAt: window.startAt + index + 1,
        recipientName: orderId,
        recipientPhone: phone,
        recipientAddress: "",
        recipientDistrict: "",
        recipientCity: "",
        packageContent: "X",
        paymentMethod: "cod" as const,
        status: "ready" as const,
        flags: [],
        sourceMessageText: "",
        version: 1,
        followUpTouchesAtClose: index % 3,
        createdAt: window.startAt + index + 1,
        updatedAt: window.startAt + index + 1,
      });
    }
    await ctx.db.insert("dailyRollups", {
      orgId,
      windowKey,
      csKey: "nabila",
      csName: "Nabila",
      leadOrders: 0,
      leadsCust: 0,
      closings: 901,
      closedCust: 901,
      cancelled: 0,
      manualClosings: 0,
      delivered: 0,
      revenue: 0,
      discount: 0,
      cod: 901,
      transfer: 0,
      fuClosings: 600,
      fuH1: 300,
      fuH2: 300,
      fuH3: 0,
      byProduct: [],
      updatedAt: window.endAt,
    });
    await ctx.db.insert("rollupWindows", {
      orgId,
      windowKey,
      schemaVersion: ROLLUP_SCHEMA_VERSION,
      completedAt: window.endAt,
    });
  });

  const result = await asAdmin.query(api.followUp.getFollowUpEffectiveness, {
    startAt: window.startAt,
    endAt: window.endAt,
  });
  expect(result).toEqual({
    totalClosings: 901,
    fromFollowUp: 600,
    byStage: { h1: 300, h2: 300, h3: 0 },
  });
});

test("follow-up effectiveness uses half-open neighboring windows", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "boundary-admin", role: "admin", name: "Admin", email: "boundary@w" });
  const orgId = await seedOrg(t);
  await t.run((ctx) => ctx.db.insert("shippingRecaps", { orgId,
    orderIdBerdu: "FU-BOUNDARY", customerPhone: "6281777000001", customerName: "Boundary", csName: "Nabila", closedAt: now,
    recipientName: "Boundary", recipientPhone: "6281777000001", recipientAddress: "", recipientDistrict: "",
    recipientCity: "", packageContent: "X", paymentMethod: "cod" as const,
    status: "ready" as const, flags: [], sourceMessageText: "", version: 1, followUpTouchesAtClose: 1,
    createdAt: now, updatedAt: now,
  }));

  const previous = await asAdmin.query(api.followUp.getFollowUpEffectiveness, { startAt: now - HOUR, endAt: now });
  const next = await asAdmin.query(api.followUp.getFollowUpEffectiveness, { startAt: now, endAt: now + HOUR });
  expect(previous.totalClosings).toBe(0);
  expect(next.totalClosings).toBe(1);
});

// Closing tab: recent closings, with via-follow-up flag, scoped + cleaned
test("getClosedFollowUps: lists recent closings, flags via-follow-up, filters cancelled/test/scope", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const recap = (orderId: string, phone: string, cs: string, closedAt: number, extra: Record<string, any> = {}) => ({
    orderIdBerdu: orderId, customerPhone: phone, customerName: "Cust " + orderId, csName: cs, closedAt,
    recipientName: "Cust", recipientPhone: phone, recipientAddress: "", recipientDistrict: "",
    recipientCity: "", packageContent: "Quran", paymentMethod: "cod" as const,
    status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
    createdAt: closedAt, updatedAt: closedAt, ...extra,
  });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("C-1", "62901", "Nabila", now - 1 * HOUR, { followUpTouchesAtClose: 2 }) }); // via FU
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("C-2", "62902", "Nabila", now - 2 * HOUR) }); // direct (no touches)
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("C-3", "62903", "Lila", now - 3 * HOUR) }); // other CS
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("C-4", "62904", "Nabila", now - 4 * HOUR, { status: "cancelled" }) }); // cancelled
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("C-5", "6285715682110", "Nabila", now - 5 * HOUR) }); // internal-test phone
  });

  const scoped = await asAdmin.query(api.followUp.getClosedFollowUps, { csName: "Nabila", sinceDays: 1, nowOverride: now });
  const ids = scoped.map((r) => r.orderId);
  expect(ids).toContain("C-1");
  expect(ids).toContain("C-2");
  expect(ids).not.toContain("C-3"); // other CS
  expect(ids).not.toContain("C-4"); // cancelled
  expect(ids).not.toContain("C-5"); // internal test
  expect(scoped[0].orderId).toBe("C-1"); // newest first
  expect(scoped.find((r) => r.orderId === "C-1")!.fromFollowUp).toBe(true);
  expect(scoped.find((r) => r.orderId === "C-2")!.fromFollowUp).toBe(false);

  const all = await asAdmin.query(api.followUp.getClosedFollowUps, { sinceDays: 1, nowOverride: now });
  expect(all.map((r) => r.orderId)).toContain("C-3"); // unscoped sees other CS
});

test("getClosedFollowUps stays bounded above 900 recent closings", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "closing-volume-admin", role: "admin", name: "Admin", email: "closing-volume@w" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let index = 0; index < 901; index++) {
      const closedAt = now - index;
      await ctx.db.insert("shippingRecaps", {
        orgId,
        orderIdBerdu: `C-VOLUME-${index}`,
        customerPhone: `62877${String(index).padStart(7, "0")}`,
        customerName: `Customer ${index}`,
        csName: "Nabila",
        csKey: "nabila",
        closedAt,
        recipientName: `Customer ${index}`,
        recipientPhone: `62877${String(index).padStart(7, "0")}`,
        recipientAddress: "",
        recipientDistrict: "",
        recipientCity: "",
        packageContent: "Quran",
        paymentMethod: "cod" as const,
        status: "ready" as const,
        flags: [],
        sourceMessageText: "",
        version: 1,
        createdAt: closedAt,
        updatedAt: closedAt,
      });
    }
  });

  const rows = await asAdmin.query(api.followUp.getClosedFollowUps, { sinceDays: 7, nowOverride: now + 1 });
  expect(rows).toHaveLength(300);
  expect(rows[0].orderId).toBe("C-VOLUME-0");
  expect(rows[299].orderId).toBe("C-VOLUME-299");
});

// WABA number resolution must tolerate the "CS " prefix mismatch in assignedCsName.
test("candidacyFor: resolves providerNumberId by csKey even when assignedCsName lacks 'CS ' prefix", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  let convId: any;
  // Conversation named WITHOUT the "CS " prefix...
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-cfg", customerPhone: "62870", assignedCsName: "Aisyah" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-cfg", customerPhone: "62870", assignedCsName: "Aisyah" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-cfg", "62870", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-cfg", "62870", "outbound", now - 29 * HOUR) });
    // ...but the csConfig is stored WITH the prefix + a WABA number.
    await ctx.db.insert("csConfigs", { orgId,
      normalizedName: "csaisyah", csName: "CS Aisyah", providerNumberId: "PHONE_X",
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: now, updatedAt: now,
    });
  });
  const d = await t.query(internal.followUp.candidacyFor, { conversationId: convId, nowOverride: now });
  expect(d?.phoneNumberId).toBe("PHONE_X");
});

test("candidacyFor fails closed when a legacy no-key claim exceeds the active registry cap", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", {
      orgId, ...convBase, orderId: "O-capped", customerPhone: "62871", assignedCsName: "Target",
    });
    await ctx.db.insert("orders", {
      orgId, ...orderBase, orderId: "O-capped", customerPhone: "62871", assignedCsName: "Target",
    });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-capped", "62871", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-capped", "62871", "outbound", now - 29 * HOUR) });
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "not-target", csName: "CS Target", key: undefined,
      providerNumberId: "PHONE-CAPPED", nameAliases: [], berduStaffIds: [], providerNumberIds: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: now, updatedAt: now,
    });
    for (let i = 0; i < 50; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `extra-${i}`, csName: `Extra ${i}`, key: `extra-${i}`,
        nameAliases: [], berduStaffIds: [], providerNumberIds: [],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: true, createdAt: now + i + 1, updatedAt: now,
      });
    }
  });
  const result = await t.query(internal.followUp.candidacyFor, {
    conversationId: convId, nowOverride: now,
  });
  expect(result?.phoneNumberId).toBeNull();
});
