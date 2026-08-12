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
type QueueTestRow = {
  conversationId: unknown;
  orderId: string;
  dueState: "overdue" | "due_today" | "scheduled";
  [key: string]: unknown;
};
type QueueTestPage = {
  page: QueueTestRow[];
  isDone: boolean;
  continueCursor: string;
};
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

test("listFollowUpQueue paginates all 901 snapshot rows in oldest-due 30-row pages", async () => {
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

  const rows: QueueTestRow[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const result: QueueTestPage = await asAdmin.query(api.followUp.listFollowUpQueue, {
      stage: 1,
      now,
      paginationOpts: { numItems: 100, cursor },
    });
    expect(result.page.length).toBeLessThanOrEqual(30);
    rows.push(...result.page);
    cursor = result.continueCursor || null;
    isDone = result.isDone;
  }
  expect(rows).toHaveLength(901);
  expect(rows.map((row) => row.orderId)).toEqual(
    Array.from({ length: 901 }, (_, i) => `QUEUE-${i}`),
  );
  expect(new Set(rows.map((row) => String(row.conversationId))).size).toBe(901);
});

test("listFollowUpQueue keeps old, due-today, and future rows ordered from conversation snapshots", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "context-admin", role: "admin", name: "Admin", email: "context@wafachat.test" });
  const orgId = await seedOrg(t);
  const DAY = 24 * HOUR;
  const conversationId = await t.run(async (ctx) => {
    let oldId: any;
    for (const [orderId, dueAt, suffix] of [
      ["CONTEXT-OLD", now - 60 * DAY, "1111"],
      ["CONTEXT-TODAY", now - HOUR, "2222"],
      ["CONTEXT-FUTURE", now + DAY, "3333"],
    ] as const) {
      const id = await ctx.db.insert("conversations", {
        orgId,
        ...convBase,
        orderId,
        customerPhone: `6289000${suffix}`,
        followUpProductName: "Quran Mapping",
        followUpCsKey: "nabila",
        followUpCycleInboundAt: now - 61 * DAY,
        followUpCycleId: `cycle-${suffix}`,
        followUpNextStage: 1,
        followUpDueAt: dueAt,
        followUpState: "waiting",
        followUpLastInboundPreview: "Masih ada kak?",
        followUpLastInboundAt: now - 62 * DAY,
        followUpLastOutboundPreview: "Kami tunggu kabarnya",
        followUpLastOutboundAt: now - 61 * DAY,
        followUpLastDetectedStage: 1,
        followUpLastDetectedTemplate: "follow_up_h1",
      });
      if (orderId === "CONTEXT-OLD") oldId = id;
    }
    return oldId;
  });

  const result: QueueTestPage = await asAdmin.query(api.followUp.listFollowUpQueue, {
    stage: 1,
    now,
    paginationOpts: { numItems: 30, cursor: null },
  });
  expect(result.page.map((row) => row.orderId)).toEqual([
    "CONTEXT-OLD",
    "CONTEXT-TODAY",
    "CONTEXT-FUTURE",
  ]);
  expect(result.page.map((row) => row.dueState)).toEqual([
    "overdue",
    "due_today",
    "scheduled",
  ]);
  expect(result.page[0]).toMatchObject({
    conversationId,
    stage: 1,
    dueState: "overdue",
    overdueDays: 60,
    productName: "Quran Mapping",
    lastInboundPreview: "Masih ada kak?",
    lastOutboundPreview: "Kami tunggu kabarnya",
    lastDetectedStage: 1,
    lastDetectedTemplate: "follow_up_h1",
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

test("listDueFollowUps compatibility query no longer expires old waiting cycles", async () => {
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

  const result: QueueTestPage = await asAdmin.query(api.followUp.listDueFollowUps, {
    now,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(result.page.map((row) => row.orderId)).toEqual(["STALE-CYCLE"]);
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
  const csPage: QueueTestPage = await asCs.query(api.followUp.listDueFollowUps, {
    csName: "Lila",
    stage: 1,
    now,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(csPage.page.map((row) => row.orderId)).toEqual(["SCOPE-AISYAH"]);

  const asAdmin = t.withIdentity({ subject: "scope-admin", role: "admin", name: "Scope Admin", email: "scope-admin@wafachat.test" });
  const adminPage: QueueTestPage = await asAdmin.query(api.followUp.listDueFollowUps, {
    stage: 2,
    now,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(adminPage.page.map((row) => row.orderId)).toEqual(["SCOPE-AISYAH-H2"]);
});

test("getFollowUpCounts reads an exact CS counter and sums bounded owner counters", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "counts-admin", role: "admin", name: "Counts Admin", email: "counts@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "nabila", h1: 11, h2: 7, h3: 3, review: 2, updatedAt: now,
    });
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "lila", h1: 5, h2: 4, h3: 2, review: 1, updatedAt: now,
    });
  });

  await expect(asAdmin.query(api.followUp.getFollowUpCounts, { csName: "Nabila" }))
    .resolves.toEqual({ h1: 11, h2: 7, h3: 3, review: 2 });
  await expect(asAdmin.query(api.followUp.getFollowUpCounts, {}))
    .resolves.toEqual({ h1: 16, h2: 11, h3: 5, review: 3 });
});

test("getFollowUpCounts rejects an owner total above 100 CS rows", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "bounded-counts-admin", role: "admin", name: "Counts Admin", email: "bounded-counts@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++) {
      await ctx.db.insert("followUpCounters", {
        orgId,
        csKey: `cs-${String(i).padStart(3, "0")}`,
        h1: 1,
        h2: 0,
        h3: 0,
        review: 0,
        updatedAt: now,
      });
    }
  });

  await expect(asAdmin.query(api.followUp.getFollowUpCounts, {}))
    .rejects.toThrow(/more than 100 CS rows/i);
});

test("review and archive views paginate newest-first through lifecycle state indexes", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "state-pages-admin", role: "admin", name: "State Admin", email: "state-pages@wafachat.test" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 35; i++) {
      for (const state of ["review", "archived"] as const) {
        await ctx.db.insert("conversations", {
          orgId,
          ...convBase,
          orderId: `${state.toUpperCase()}-${i}`,
          customerPhone: `62881${state === "review" ? "1" : "2"}${String(i).padStart(3, "0")}`,
          followUpCsKey: "nabila",
          followUpCycleId: `${state}-cycle-${i}`,
          followUpCycleInboundAt: now - 10 * HOUR,
          followUpNextStage: 2,
          followUpState: state,
          followUpReviewReason: state === "review" ? `Periksa ${i}` : undefined,
          followUpOutcome: state === "archived" ? "h3_complete" : undefined,
          followUpArchivedAt: state === "archived" ? now - i : undefined,
          followUpLastInboundPreview: `Inbound ${i}`,
          followUpLastInboundAt: now - 2 * HOUR,
          followUpLastOutboundPreview: `Outbound ${i}`,
          followUpLastOutboundAt: now - HOUR,
          followUpProductName: "Quran Mapping",
          updatedAt: now - i,
        });
      }
    }
  });

  const reviewFirst = await asAdmin.query(api.followUp.listFollowUpAttentionPage, {
    paginationOpts: { numItems: 100, cursor: null },
  });
  const reviewSecond = await asAdmin.query(api.followUp.listFollowUpAttentionPage, {
    paginationOpts: { numItems: 100, cursor: reviewFirst.continueCursor },
  });
  expect(reviewFirst.page).toHaveLength(30);
  expect(reviewSecond.page).toHaveLength(5);
  expect(reviewFirst.page[0]).toMatchObject({
    orderId: "REVIEW-0",
    state: "review",
    reviewReason: "Periksa 0",
    lastInboundPreview: "Inbound 0",
    lastOutboundPreview: "Outbound 0",
    csKey: "nabila",
    stage: 2,
    productName: "Quran Mapping",
  });

  const archivedFirst = await asAdmin.query(api.followUp.listArchivedFollowUpsPage, {
    paginationOpts: { numItems: 100, cursor: null },
  });
  const archivedSecond = await asAdmin.query(api.followUp.listArchivedFollowUpsPage, {
    paginationOpts: { numItems: 100, cursor: archivedFirst.continueCursor },
  });
  expect(archivedFirst.page).toHaveLength(30);
  expect(archivedSecond.page).toHaveLength(5);
  expect(archivedFirst.page[0]).toMatchObject({
    orderId: "ARCHIVED-0",
    outcome: "h3_complete",
    archivedAt: now,
    csKey: "nabila",
    productName: "Quran Mapping",
    lastInboundPreview: "Inbound 0",
    lastOutboundPreview: "Outbound 0",
  });
});

test('assigned CS can close or cancel its follow-up while cross-CS and cross-org actions are rejected', async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const otherOrgId = await t.run((ctx) => ctx.db.insert('organizations', { slug: 'other-action-org', name: 'Other', createdAt: 1, updatedAt: 1 }));
  const userId = await t.run((ctx) => ctx.db.insert('users', {
    orgId, email: 'siti.nur+fu@wafachat.test', name: 'Siti Nur Aulia', passwordHash: 'x', role: 'cs', csName: 'Siti Nur Aulia', isActive: true, createdAt: 1, updatedAt: 1,
  }));
  const ids = await t.run(async (ctx) => ({
    closing: await ctx.db.insert('conversations', { orgId, ...convBase, assignedCsName: 'Siti Nur Aulia', customerPhone: '628111', orderId: 'CS-CLOSE', followUpCsKey: 'sitinuraulia', followUpCycleId: 'cycle-close', followUpCycleInboundAt: now - HOUR, followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting' }),
    cancel: await ctx.db.insert('conversations', { orgId, ...convBase, assignedCsName: 'Siti Nur Aulia', customerPhone: '628112', orderId: 'CS-CANCEL', followUpCsKey: 'sitinuraulia', followUpCycleId: 'cycle-cancel', followUpCycleInboundAt: now - HOUR, followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting' }),
    otherCs: await ctx.db.insert('conversations', { orgId, ...convBase, assignedCsName: 'Lila', customerPhone: '628113', orderId: 'OTHER-CS-ACTION', followUpCsKey: 'lila', followUpCycleId: 'cycle-other', followUpCycleInboundAt: now - HOUR, followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting' }),
    otherOrg: await ctx.db.insert('conversations', { orgId: otherOrgId, ...convBase, assignedCsName: 'Siti Nur Aulia', customerPhone: '628114', orderId: 'OTHER-ORG-ACTION', followUpCsKey: 'sitinuraulia', followUpCycleId: 'cycle-other-org', followUpCycleInboundAt: now - HOUR, followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting' }),
  }));
  const asCs = t.withIdentity({ subject: String(userId), role: 'cs', name: 'Siti Nur Aulia', email: 'siti.nur+fu@wafachat.test', csName: 'Siti Nur Aulia' });
  await expect(asCs.mutation(api.followUp.markFollowUpClosing, { conversationId: ids.closing, expectedCycleId: 'cycle-close' })).resolves.toMatchObject({ success: true });
  await expect(asCs.mutation(api.followUp.markFollowUpCancelled, { conversationId: ids.cancel, expectedCycleId: 'cycle-cancel', reason: 'Customer membatalkan pesanan' })).resolves.toMatchObject({ success: true });
  await expect(asCs.mutation(api.followUp.markFollowUpClosing, { conversationId: ids.otherCs, expectedCycleId: 'cycle-other' })).rejects.toThrow(/scope mismatch|unauthorized/i);
  await expect(asCs.mutation(api.followUp.markFollowUpCancelled, { conversationId: ids.otherOrg, expectedCycleId: 'cycle-other-org', reason: 'Batal' })).rejects.toThrow(/tidak ditemukan|unauthorized/i);
});

test('terminal ownership follows the active cycle owner rather than stale assigned CS', async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const userId = await t.run((ctx) => ctx.db.insert('users', {
    orgId, email: 'cycle-owner@wafachat.test', name: 'Aisyah', passwordHash: 'x', role: 'cs', csName: 'Aisyah', isActive: true, createdAt: 1, updatedAt: 1,
  }));
  const asAisyah = t.withIdentity({ subject: String(userId), role: 'cs', name: 'Aisyah', email: 'cycle-owner@wafachat.test', csName: 'Aisyah' });
  const owned = await t.run((ctx) => ctx.db.insert('conversations', {
    orgId, ...convBase, orderId: 'OWN-1', customerPhone: '628-own-1', assignedCsName: 'Lila', followUpCsKey: 'aisyah', followUpCycleId: 'owned-cycle', followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting',
  }));
  const staleAssigned = await t.run((ctx) => ctx.db.insert('conversations', {
    orgId, ...convBase, customerPhone: '628-own-2', orderId: 'OWN-2', assignedCsName: 'Aisyah', followUpCsKey: 'lila', followUpCycleId: 'lila-cycle', followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting',
  }));
  await expect(asAisyah.mutation(api.followUp.markFollowUpClosing, { conversationId: owned, expectedCycleId: 'owned-cycle' })).resolves.toMatchObject({ success: true });
  await expect(asAisyah.mutation(api.followUp.markFollowUpClosing, { conversationId: staleAssigned, expectedCycleId: 'lila-cycle' })).rejects.toThrow(/scope mismatch/i);
});

test.each([
  ['idle', { followUpCycleId: undefined, followUpNextStage: undefined, followUpState: undefined }],
  ['replied', { followUpCycleId: undefined, followUpNextStage: undefined, followUpState: undefined, followUpLastInboundAt: now + 1 }],
  ['archived', { followUpCycleId: 'archived-cycle', followUpNextStage: undefined, followUpState: 'archived' }],
  ['replacement', { followUpCycleId: 'replacement-cycle', followUpNextStage: 1, followUpDueAt: now, followUpState: 'waiting' }],
] as const)('terminal action rejects %s lifecycle without writing sales state', async (_name, lifecycle) => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const conversationId = await t.run((ctx) => ctx.db.insert('conversations', {
    orgId, ...convBase, orderId: `TERMINAL-${_name}`, customerPhone: `628-terminal-${_name}`, followUpCsKey: 'nabila', ...lifecycle,
  }));
  const admin = t.withIdentity({ subject: 'terminal-admin', role: 'admin', name: 'Admin', email: 'terminal@wafachat' });
  await expect(admin.mutation(api.followUp.markFollowUpClosing, { conversationId, expectedCycleId: 'expected-cycle' })).rejects.toThrow(/sudah berubah|tidak aktif/i);
  await expect(admin.mutation(api.followUp.markFollowUpCancelled, { conversationId, expectedCycleId: 'expected-cycle', reason: 'Customer membatalkan' })).rejects.toThrow(/sudah berubah|tidak aktif/i);
  await t.run(async (ctx) => {
    expect(await ctx.db.query('events').collect()).toHaveLength(0);
    expect(await ctx.db.query('dailyStats').collect()).toHaveLength(0);
  });
});

test("closing view paginates one interleaved counted stream despite newer cancellations", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "closed-pages-admin", role: "admin", name: "Closed Admin", email: "closed-pages@wafachat.test" });
  const orgId = await seedOrg(t);
  const otherOrgId = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "other-closing-pages", name: "Other Org", createdAt: 1, updatedAt: 1,
  }));
  await t.run(async (ctx) => {
    for (let i = 0; i < 31; i++) {
      await ctx.db.insert("shippingRecaps", {
        orgId,
        orderIdBerdu: `CANCELLED-${i}`,
        customerPhone: `6288299${String(i).padStart(3, "0")}`,
        customerName: `Cancelled ${i}`,
        csName: "Nabila",
        csKey: "nabila",
        closedAt: now + 1_000 - i,
        recipientName: `Cancelled ${i}`,
        recipientPhone: `6288299${String(i).padStart(3, "0")}`,
        recipientAddress: "",
        recipientDistrict: "",
        recipientCity: "",
        packageContent: "Quran Mapping",
        paymentMethod: "cod",
        status: "cancelled",
        flags: [],
        sourceMessageText: "",
        version: 1,
        createdAt: now + 1_000 - i,
        updatedAt: now + 1_000 - i,
      });
    }
    for (let i = 0; i < 35; i++) {
      const status = (["ready", "needs_review", "exported", "delivered"] as const)[i % 4];
      await ctx.db.insert("shippingRecaps", {
        orgId,
        orderIdBerdu: `CLOSED-${i}`,
        customerPhone: `6288200${String(i).padStart(3, "0")}`,
        customerName: `Closed ${i}`,
        csName: "Nabila",
        csKey: "nabila",
        closedAt: now - i,
        recipientName: `Closed ${i}`,
        recipientPhone: `6288200${String(i).padStart(3, "0")}`,
        recipientAddress: "",
        recipientDistrict: "",
        recipientCity: "",
        packageContent: "Quran Mapping",
        paymentMethod: "cod",
        status,
        closingBucket: "counted",
        flags: [],
        sourceMessageText: "",
        version: 1,
        followUpTouchesAtClose: i % 4,
        followUpCsKey: i <= 1 ? "nabila" : undefined,
        followUpStage: i === 0 ? 3 : undefined,
        followUpProductName: i === 0 ? "Quran Mapping Snapshot" : undefined,
        followUpLastInboundPreview: i === 0 ? "Customer closing context" : undefined,
        followUpLastInboundAt: i === 0 ? now - 2 * HOUR : undefined,
        followUpLastOutboundPreview: i === 0 ? "CS closing context" : undefined,
        followUpLastOutboundAt: i === 0 ? now - HOUR : undefined,
        followUpLastDetectedStage: i === 0 ? 3 : undefined,
        followUpLastDetectedTemplate: i === 0 ? "follow_up_h3" : undefined,
        createdAt: now - i,
        updatedAt: now - i,
      });
    }
    await ctx.db.insert("shippingRecaps", {
      orgId,
      orderIdBerdu: "OTHER-CS",
      customerPhone: "6288200888",
      customerName: "Other CS",
      csName: "Lila",
      csKey: "lila",
      closedAt: now + 2_000,
      recipientName: "Other CS",
      recipientPhone: "6288200888",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      packageContent: "Quran Mapping",
      paymentMethod: "cod",
      status: "ready",
      closingBucket: "counted",
      flags: [],
      sourceMessageText: "",
      version: 1,
      createdAt: now + 2_000,
      updatedAt: now + 2_000,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId: otherOrgId,
      orderIdBerdu: "OTHER-ORG",
      customerPhone: "6288200777",
      customerName: "Other Org",
      csName: "Nabila",
      csKey: "nabila",
      closedAt: now + 3_000,
      recipientName: "Other Org",
      recipientPhone: "6288200777",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      packageContent: "Quran Mapping",
      paymentMethod: "cod",
      status: "delivered",
      closingBucket: "counted",
      flags: [],
      sourceMessageText: "",
      version: 1,
      createdAt: now + 3_000,
      updatedAt: now + 3_000,
    });
  });

  const first = await asAdmin.query(api.followUp.listClosedFollowUpsPage, {
    csName: "Nabila",
    paginationOpts: { numItems: 100, cursor: null },
  });
  const second = await asAdmin.query(api.followUp.listClosedFollowUpsPage, {
    csName: "Nabila",
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });
  expect(first.page).toHaveLength(30);
  expect(second.page).toHaveLength(5);
  expect(first.page.every((row) => row.orderId.startsWith("CLOSED-"))).toBe(true);
  expect(first.page.slice(0, 4).map((row) => row.orderId)).toEqual([
    "CLOSED-0", "CLOSED-1", "CLOSED-2", "CLOSED-3",
  ]);
  expect(second.isDone).toBe(true);
  expect(first.page[0]).toMatchObject({
    orderId: "CLOSED-0",
    product: "Quran Mapping",
    csKey: "nabila",
    contextAvailable: true,
    stage: 3,
    productName: "Quran Mapping Snapshot",
    lastInboundPreview: "Customer closing context",
    lastOutboundPreview: "CS closing context",
    lastDetectedTemplate: "follow_up_h3",
    touches: 0,
    fromFollowUp: false,
  });
  expect(first.page[1]).toMatchObject({ orderId: "CLOSED-1", touches: 1, fromFollowUp: true });
  expect(first.page[1]).toMatchObject({ contextAvailable: false });
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
      followUpCycleId: `cycle-manual-${suffix}`,
      followUpCycleStartedAt: Date.now() - 29 * HOUR,
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
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "nabila", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: now,
  }));
  const args = {
    conversationId,
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
      cycleId: "cycle-manual-08",
      stage: 1,
      method: "manual_confirmation",
      status: "accepted",
      actorName: "Confirm Admin",
    });
    expect(await ctx.db.query("followUpTransitions")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect()).toContainEqual(expect.objectContaining({
        eventKey: `confirmation:${args.requestId}`,
        kind: "stage_completed",
        fromStage: 1,
        toStage: 2,
      }));
    expect(await ctx.db.query("followUpCounters").unique())
      .toMatchObject({ h1: 0, h2: 1, h3: 0, review: 0 });
  });
});

test("an H+3 manual confirmation remains idempotent after it archives the lifecycle", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "h3-confirm-admin", role: "admin", name: "H3 Confirm", email: "h3-confirm@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "h3-confirm", 3);
  const args = {
    conversationId,
    requestId: "77777777-8888-4777-8777-777777777777",
  };

  expect(await asAdmin.mutation(api.followUp.confirmManualContact, args))
    .toEqual({ ok: true, duplicate: false });
  expect(await asAdmin.mutation(api.followUp.confirmManualContact, args))
    .toEqual({ ok: true, duplicate: true });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      status: "active",
      followUpStage: 3,
      followUpState: "archived",
      followUpOutcome: "h3_complete",
    });
    expect(await ctx.db.query("followUpAttempts")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect()).toHaveLength(1);
  });
});

test("manual confirmation honors an accepted pre-ledger request without advancing twice", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "legacy-confirm-admin", role: "admin", name: "Legacy Confirm", email: "legacy-confirm@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "legacy-confirm", 2);
  const requestId = "aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa";
  await t.run(async (ctx) => {
    await ctx.db.patch(conversationId, { followUpStage: 1, followUpStageAt: now - HOUR });
    const conversation = await ctx.db.get(conversationId) as Doc<"conversations">;
    await ctx.db.insert("followUpAttempts", {
      orgId,
      conversationId,
      csKey: "nabila",
      cycleInboundAt: conversation.followUpCycleInboundAt!,
      stage: 1,
      method: "manual_confirmation",
      status: "accepted",
      bucket: "sent",
      attemptKey: `${String(conversationId)}:${conversation.followUpCycleInboundAt}:1:manual_confirmation:${requestId}`,
      requestId,
      actorName: "Legacy Confirm",
      acceptedAt: now - HOUR,
      createdAt: now - HOUR,
      updatedAt: now - HOUR,
    });
  });

  expect(await asAdmin.mutation(api.followUp.confirmManualContact, { conversationId, requestId }))
    .toEqual({ ok: true, duplicate: true });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      followUpNextStage: 2,
      followUpState: "waiting",
    });
    expect(await ctx.db.query("followUpTransitions").collect()).toHaveLength(0);
  });
});

test("confirmManualContact uses the server stage and permits both early and long-overdue manual contact", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "timing-admin", role: "admin", name: "Timing Admin", email: "timing@wafachat" });
  const orgId = await seedOrg(t);
  const earlyId = await seedDueManualFollowUp(t, orgId, "early", 2);
  const overdueId = await seedDueManualFollowUp(t, orgId, "overdue", 1);
  await t.run(async (ctx) => {
    await ctx.db.patch(earlyId, { followUpDueAt: Date.now() + 3 * 24 * HOUR });
    await ctx.db.patch(overdueId, {
      followUpCycleInboundAt: Date.now() - 30 * 24 * HOUR,
      followUpDueAt: Date.now() - 29 * 24 * HOUR,
    });
  });

  await expect(asAdmin.mutation(api.followUp.confirmManualContact, {
    conversationId: earlyId,
    requestId: "11111111-2222-4111-8111-111111111111",
  })).resolves.toEqual({ ok: true, duplicate: false });
  await expect(asAdmin.mutation(api.followUp.confirmManualContact, {
    conversationId: overdueId,
    requestId: "22222222-3333-4222-8222-222222222222",
  })).resolves.toEqual({ ok: true, duplicate: false });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(earlyId)).toMatchObject({ followUpStage: 2, followUpNextStage: 3 });
    expect(await ctx.db.get(overdueId)).toMatchObject({ followUpStage: 1, followUpNextStage: 2 });
  });
});

test("correctFollowUpStage makes H+3 immediately actionable, audited, and idempotent", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "correct-admin", role: "admin", name: "Correct Admin", email: "correct@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "correct", 1);
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "nabila", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: now,
  }));
  const requestId = "33333333-4444-4333-8333-333333333333";
  const before = Date.now();

  expect(await asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId,
    targetStage: 3,
    requestId,
  })).toEqual({ ok: true, duplicate: false });
  expect(await asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId,
    targetStage: 3,
    requestId,
  })).toEqual({ ok: true, duplicate: true });

  await t.run(async (ctx) => {
    const corrected = await ctx.db.get(conversationId) as Doc<"conversations"> | null;
    expect(corrected).toMatchObject({ followUpNextStage: 3, followUpState: "waiting" });
    expect(corrected!.followUpDueAt).toBeGreaterThanOrEqual(before);
    expect(corrected!.followUpDueAt).toBeLessThanOrEqual(Date.now());
    expect(await ctx.db.query("followUpTransitions")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect()).toContainEqual(expect.objectContaining({
        eventKey: `correction:${requestId}`,
        kind: "stage_corrected",
        fromStage: 1,
        toStage: 3,
        actorName: "Correct Admin",
      }));
  });

  const templateId = await t.run(async (ctx) => (await ctx.db.query("followUpTemplates")
    .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", 3))
    .unique())!._id);
  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 3,
    templateId,
    requestId: "44444444-5555-4444-8444-444444444444",
  })).resolves.toMatchObject({ shouldSend: true, templateName: "follow_up_h3" });
});

test("correction request IDs bind conversation and target-stage intent", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "intent-admin", role: "admin", name: "Intent Admin", email: "intent@wafachat" });
  const orgId = await seedOrg(t);
  const firstId = await seedDueManualFollowUp(t, orgId, "intent-a", 1);
  const secondId = await seedDueManualFollowUp(t, orgId, "intent-b", 1);
  const requestId = "bbbbbbbb-cccc-4bbb-8bbb-bbbbbbbbbbbb";

  await expect(asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId: firstId, targetStage: 2, requestId,
  })).resolves.toEqual({ ok: true, duplicate: false });
  await expect(asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId: firstId, targetStage: 2, requestId,
  })).resolves.toEqual({ ok: true, duplicate: true });
  await expect(asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId: firstId, targetStage: 3, requestId,
  })).rejects.toThrow(/request id.*digunakan/i);
  await expect(asAdmin.mutation(api.followUp.correctFollowUpStage, {
    conversationId: secondId, targetStage: 2, requestId,
  })).rejects.toThrow(/request id.*digunakan/i);
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

test.each([
  ["early", { followUpDueAt: Date.now() + 3 * 24 * HOUR }],
  ["long-overdue", {
    followUpCycleInboundAt: Date.now() - 30 * 24 * HOUR,
    followUpDueAt: Date.now() - 29 * 24 * HOUR,
  }],
] as const)("reservation permits an otherwise-current %s manual template send", async (suffix, patch) => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: `${suffix}-admin`, role: "admin", name: "Admin", email: `${suffix}@wafachat` });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, suffix);
  await t.run((ctx) => ctx.db.patch(conversationId, patch));

  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    requestId: suffix === "early"
      ? "88888888-9999-4888-8888-888888888888"
      : "99999999-aaaa-4999-8999-999999999999",
  })).resolves.toMatchObject({ shouldSend: true, stage: 1 });
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
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "nabila", h1: 2, h2: 0, h3: 0, review: 0, updatedAt: now,
  }));

  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId: unknownConversationId,
    stage: 1,
    requestId: "22222222-2222-4222-8222-222222222222",
  });
  await asAdmin.mutation(internal.followUp.finalizeDueFollowUp, {
    conversationId: unknownConversationId,
    requestId: "22222222-2222-4222-8222-222222222222",
    expectedCycleId: "cycle-manual-02",
    stage: 1,
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
    expectedCycleId: "cycle-manual-03",
    stage: 1,
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
    expect(await ctx.db.query("followUpCounters").unique())
      .toMatchObject({ h1: 0, h2: 1, h3: 0, review: 1 });
  });
});

test("unknown delivery cannot be archived and reopened to bypass the blind-retry block", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "unknown-archive-admin", role: "admin", name: "Unknown Admin", email: "unknown-archive@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "unknown-archive");
  const sendRequestId = "cccccccc-dddd-4ccc-8ccc-cccccccccccc";
  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId, stage: 1, requestId: sendRequestId,
  });
  await asAdmin.mutation(internal.followUp.finalizeDueFollowUp, {
    conversationId,
    requestId: sendRequestId,
    expectedCycleId: "cycle-manual-unknown-archive",
    stage: 1,
    outcome: "unknown",
    error: "Timeout provider",
  });

  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId,
    requestId: "dddddddd-eeee-4ddd-8ddd-dddddddddddd",
  })).rejects.toThrow(/belum diketahui.*KirimDev/i);
  await expect(asAdmin.mutation(api.followUp.unarchiveFollowUp, { conversationId }))
    .rejects.toThrow(/belum diketahui.*KirimDev/i);
  await expect(asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 1,
    requestId: "eeeeeeee-ffff-4eee-8eee-eeeeeeeeeeee",
  })).rejects.toThrow(/belum diketahui/i);

  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      followUpState: "unknown",
      followUpRequestId: sendRequestId,
      followUpLastError: "Timeout provider",
    });
  });
});

test("accepted H+3 archives only the lifecycle and never invents a sales closing", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "h3-admin", role: "admin", name: "H3 Admin", email: "h3@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "h3", 3);
  const requestId = "55555555-6666-4555-8555-555555555555";
  await asAdmin.mutation(internal.followUp.reserveDueFollowUp, {
    conversationId,
    stage: 3,
    requestId,
  });
  await asAdmin.mutation(internal.followUp.finalizeDueFollowUp, {
    conversationId,
    requestId,
    expectedCycleId: "cycle-manual-h3",
    stage: 3,
    outcome: "accepted",
    providerMessageId: "wamid.manual.h3",
    acceptedAt: Date.now(),
  });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      status: "active",
      followUpStage: 3,
      followUpState: "archived",
      followUpOutcome: "h3_complete",
    });
    expect(await ctx.db.query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", "MANUAL-h3"))
      .collect()).toHaveLength(0);
  });
});

test("provider acceptance for an old cycle is audited without advancing its replacement", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "race-admin", role: "admin", name: "Race Admin", email: "race@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "race", 1);
  const requestId = "66666666-7777-4666-8666-666666666666";
  process.env.KIRIMDEV_API_KEY = "k_test";
  process.env.KIRIMDEV_BASE_URL = "https://api.test/v1";
  vi.stubGlobal("fetch", vi.fn(async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(conversationId, {
        followUpCycleId: "cycle-replacement",
        followUpCycleInboundAt: Date.now(),
        followUpCycleStartedAt: Date.now(),
        followUpNextStage: 1,
        followUpDueAt: Date.now(),
        followUpState: "waiting",
        followUpRequestId: undefined,
        followUpProviderMessageId: undefined,
      });
    });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.old-cycle" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

  const templateId = await t.run(async (ctx) => (await ctx.db.query("followUpTemplates")
    .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", 1))
    .unique())!._id);
  await expect(asAdmin.action(api.followUp.sendDueFollowUp, {
    conversationId,
    stage: 1,
    templateId,
    requestId,
  })).resolves.toMatchObject({ ok: true, status: "accepted", providerMessageId: "wamid.old-cycle" });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({
      followUpCycleId: "cycle-replacement",
      followUpNextStage: 1,
      followUpState: "waiting",
    });
    expect(await ctx.db.query("followUpEventReceipts")
      .withIndex("by_org_eventKey", (q) => q.eq("orgId", orgId).eq("eventKey", "provider:wamid.old-cycle"))
      .unique()).toMatchObject({ cycleId: "cycle-manual-race" });
  });
  vi.unstubAllGlobals();
});

test("archiveFollowUp: anonymous caller is rejected and status is unchanged", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-13", customerPhone: "62813b" });
  });
  await expect(t.mutation(api.followUp.archiveFollowUp, {
    conversationId: convId,
    requestId: "66666666-8888-4666-8666-666666666666",
  }))
    .rejects.toThrow(/requires a logged-in user/);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c!.status).toBe("active"); // should not change
  });
});

test("archiveFollowUp: signed admin can archive an own-tenant conversation", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const convId = await seedDueManualFollowUp(t, orgId, "archive");
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "nabila", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: now,
  }));
  const res = await asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId: convId,
    requestId: "ffffffff-1111-4fff-8fff-ffffffffffff",
  });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c).toMatchObject({
      status: "active",
      followUpState: "archived",
      followUpOutcome: "manual_archive",
    });
    expect(c!.followUpArchivedAt).toBeDefined();
    expect(await ctx.db.query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", "MANUAL-archive"))
      .collect()).toHaveLength(0);
    expect(await ctx.db.query("followUpTransitions")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", convId))
      .collect()).toContainEqual(expect.objectContaining({ kind: "archived", source: "manual" }));
    expect(await ctx.db.query("followUpCounters").unique())
      .toMatchObject({ h1: 0, h2: 0, h3: 0, review: 0 });
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

  await expect(asAisyah.mutation(api.followUp.archiveFollowUp, {
    conversationId,
    requestId: "11111111-3333-4111-8111-111111111111",
  }))
    .rejects.toThrow(/conversation scope/);
});

test("unarchiveFollowUp enters review without changing sales status or creating a recap", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const convId = await seedDueManualFollowUp(t, orgId, "unarchive");
  await t.run((ctx) => ctx.db.insert("followUpCounters", {
    orgId, csKey: "nabila", h1: 1, h2: 0, h3: 0, review: 0, updatedAt: now,
  }));
  await asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId: convId,
    requestId: "22222222-4444-4222-8222-222222222222",
  });
  const res = await asAdmin.mutation(api.followUp.unarchiveFollowUp, { conversationId: convId });
  expect(res.ok).toBe(true);
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(convId)) as Doc<"conversations"> | undefined;
    expect(c).toMatchObject({
      status: "active",
      followUpState: "review",
      followUpReviewReason: "Dibuka kembali; pilih tahap yang benar",
    });
    expect(c!.followUpArchivedAt).toBeUndefined();
    expect(c!.followUpOutcome).toBeUndefined();
    expect(await ctx.db.query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", "MANUAL-unarchive"))
      .collect()).toHaveLength(0);
    expect(await ctx.db.query("followUpCounters").unique())
      .toMatchObject({ h1: 0, h2: 0, h3: 0, review: 1 });
  });
});

test("archive can be repeated after unarchive as a distinct audited action", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "rearchive-admin", role: "admin", name: "Rearchive Admin", email: "rearchive@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "rearchive");

  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId, requestId: "33333333-5555-4333-8333-333333333333",
  })).resolves.toEqual({ ok: true, duplicate: false });
  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId, requestId: "33333333-5555-4333-8333-333333333333",
  })).resolves.toEqual({ ok: true, duplicate: true });
  await asAdmin.mutation(api.followUp.unarchiveFollowUp, { conversationId });
  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId, requestId: "33333333-5555-4333-8333-333333333333",
  })).rejects.toThrow(/request id.*tidak lagi|sudah berubah/i);
  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId, requestId: "44444444-6666-4444-8444-444444444444",
  })).resolves.toEqual({ ok: true, duplicate: false });
  await expect(asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId, requestId: "44444444-6666-4444-8444-444444444444",
  })).resolves.toEqual({ ok: true, duplicate: true });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toMatchObject({ followUpState: "archived" });
    expect(await ctx.db.query("followUpTransitions")
      .withIndex("by_org_conversation_createdAt", (q) => q.eq("orgId", orgId).eq("conversationId", conversationId))
      .collect()).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventKey: "archive:33333333-5555-4333-8333-333333333333" }),
        expect.objectContaining({ eventKey: "archive:44444444-6666-4444-8444-444444444444" }),
      ]));
  });
});

test("unarchiveFollowUp reports a stale action after inbound already left the lifecycle idle", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "idle-admin", role: "admin", name: "Idle Admin", email: "idle@wafachat" });
  const orgId = await seedOrg(t);
  const conversationId = await seedDueManualFollowUp(t, orgId, "idle");
  await asAdmin.mutation(api.followUp.archiveFollowUp, {
    conversationId,
    requestId: "55555555-7777-4555-8555-555555555555",
  });
  await t.run((ctx) => ctx.db.patch(conversationId, {
    followUpCycleId: undefined,
    followUpNextStage: undefined,
    followUpDueAt: undefined,
    followUpState: undefined,
    followUpArchivedAt: undefined,
    followUpOutcome: undefined,
    followUpLastInboundAt: Date.now(),
  }));

  await expect(asAdmin.mutation(api.followUp.unarchiveFollowUp, { conversationId }))
    .rejects.toThrow(/belum diarsipkan|sudah berubah/i);
  await t.run(async (ctx) => {
    const conversation = await ctx.db.get(conversationId) as Doc<"conversations"> | null;
    expect(conversation!.followUpState).toBeUndefined();
    expect(conversation!.followUpReviewReason).toBeUndefined();
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
      status: "active", followUpCsKey: "nabila", followUpState: "archived", followUpArchivedAt: now - 1 * HOUR
    });
    convId2 = await ctx.db.insert("conversations", {
      orgId, ...convBase, orderId: "O-20", customerPhone: "62820", assignedCsName: "Lila",
      status: "active", followUpCsKey: "lila", followUpState: "archived", followUpArchivedAt: now - 2 * HOUR
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
      status: "active",
      followUpCsKey: "aisyah",
      followUpState: "archived",
      followUpArchivedAt: now - HOUR,
    });
    await ctx.db.insert("conversations", {
      orgId,
      ...convBase,
      orderId: "ARCHIVED-LILA",
      customerPhone: "628182",
      assignedCsName: "Lila",
      status: "active",
      followUpCsKey: "lila",
      followUpState: "archived",
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
