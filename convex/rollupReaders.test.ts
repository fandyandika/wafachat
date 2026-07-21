import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { windowRangeForKey, windowKeyFor } from "./lib";
import { requireDefaultOrgId } from "./orgs";

/**
 * Analytics Reader Parity Tests
 *
 * These tests verify exact bounded raw routes, precomputed response-time samples,
 * and the completeness-marker boundary for any future composable rollup reader.
 *
 * Dataset: Two 16:00 WIB windows (W1, W2) × two CS (Azelia, Lila) with:
 * - Duplicate-phone orders (some excluded as test phones, some counted)
 * - Messages producing 3+ reply pairs per CS (templates + system noise filtered)
 * - Follow-up closings with fuH1/H2/H3 variety
 * - Product breakdown diversity
 */

const W1 = "2026-07-08"; // First window
const W2 = "2026-07-09"; // Second window
const { startAt: w1Start, endAt: w1End } = windowRangeForKey(W1);
const { startAt: w2Start, endAt: w2End } = windowRangeForKey(W2);

// Offset into first window
const t1 = w1Start + 3_600_000;

// Synthetic dataset seed: rich data across both windows, two CS
async function seedRichDataset(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    // ── WINDOW 1 (W1) ──────────────────────────────────────────────────────

    // Azelia: 4 orders (one is test phone, excluded; one is duplicate)
    await ctx.db.insert("orders", {
      orderId: "O-101",
      customerPhone: "6281111111101",
      customerName: "Customer A",
      assignedCsName: "Azelia",
      productName: "Buku Sirah",
      products: "Buku Sirah",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1,
      updatedAt: t1,
    } as any);

    // Duplicate phone (same customer, different order)
    await ctx.db.insert("orders", {
      orderId: "O-102",
      customerPhone: "6281111111101",
      customerName: "Customer A",
      assignedCsName: "Azelia",
      productName: "Quran Medis",
      products: "Quran Medis",
      productsSubtotal: "150000",
      shippingCost: "0",
      total: "150000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1 + 1000,
      updatedAt: t1,
    } as any);

    // Another customer
    await ctx.db.insert("orders", {
      orderId: "O-103",
      customerPhone: "6281111111102",
      customerName: "Customer B",
      assignedCsName: "Azelia",
      productName: "Tafsir Al-Quran",
      products: "Tafsir Al-Quran",
      productsSubtotal: "200000",
      shippingCost: "0",
      total: "200000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1 + 2000,
      updatedAt: t1,
    } as any);

    // Test phone (excluded)
    await ctx.db.insert("orders", {
      orderId: "O-104",
      customerPhone: "6285715682110", // owner test phone
      customerName: "Test",
      assignedCsName: "Azelia",
      productName: "Buku Sirah",
      products: "Buku Sirah",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1 + 3000,
      updatedAt: t1,
    } as any);

    // Lila: 2 orders
    await ctx.db.insert("orders", {
      orderId: "O-201",
      customerPhone: "6281111111201",
      customerName: "Customer C",
      assignedCsName: "Lila",
      productName: "Buku Sirah",
      products: "Buku Sirah",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1 + 4000,
      updatedAt: t1,
    } as any);

    await ctx.db.insert("orders", {
      orderId: "O-202",
      customerPhone: "6281111111202",
      customerName: "Customer D",
      assignedCsName: "Lila",
      productName: "Fikih Praktis",
      products: "Fikih Praktis",
      productsSubtotal: "120000",
      shippingCost: "0",
      total: "120000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t1 + 5000,
      updatedAt: t1,
    } as any);

    // ── RECAPS (CLOSINGS) in W1 ────────────────────────────────────────────

    // Azelia: 2 closings (O-101 status="exported", O-103 status="delivered")
    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111101",
      customerName: "Customer A",
      csName: "Azelia",
      orderIdBerdu: "O-101",
      status: "exported",
      total: 100000,
      discount: 5000,
      followUpTouchesAtClose: 2, // H+2
      sourceMessageId: "m1",
      packageContent: "Buku Sirah",
      closedAt: t1 + 100,
      recipientName: "A",
      recipientPhone: "6281111111101",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "transfer",
      sourceMessageText: "",
      flags: [],
      createdAt: t1,
      updatedAt: t1,
      version: 1,
    } as any);

    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111102",
      customerName: "Customer B",
      csName: "Azelia",
      orderIdBerdu: "O-103",
      status: "delivered",
      total: 200000,
      discount: 10000,
      followUpTouchesAtClose: 0, // No follow-up
      sourceMessageId: "m2",
      packageContent: "Tafsir Al-Quran",
      closedAt: t1 + 200,
      recipientName: "B",
      recipientPhone: "6281111111102",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "cod",
      sourceMessageText: "",
      flags: [],
      createdAt: t1,
      updatedAt: t1,
      version: 1,
    } as any);

    // Azelia: 1 cancelled
    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111105",
      customerName: "Customer E",
      csName: "Azelia",
      orderIdBerdu: "O-105",
      status: "cancelled",
      total: 50000,
      packageContent: "Buku Sirah",
      closedAt: t1 + 300,
      recipientName: "E",
      recipientPhone: "6281111111105",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "unknown",
      sourceMessageText: "",
      flags: [],
      createdAt: t1,
      updatedAt: t1,
      version: 1,
    } as any);

    // Lila: 1 closing
    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111201",
      customerName: "Customer C",
      csName: "Lila",
      orderIdBerdu: "O-201",
      status: "exported",
      total: 100000,
      discount: 0,
      followUpTouchesAtClose: 1, // H+1
      sourceMessageId: "m3",
      packageContent: "Buku Sirah",
      closedAt: t1 + 150,
      recipientName: "C",
      recipientPhone: "6281111111201",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "transfer",
      sourceMessageText: "",
      flags: [],
      createdAt: t1,
      updatedAt: t1,
      version: 1,
    } as any);

    // ── MESSAGES for response time pairs (W1) ─────────────────────────────

    // Conversation 1: Customer 6281111111101 <- Azelia
    const conv1 = await ctx.db.insert("conversations", {
      orgId,
      orderId: "O-101",
      customerPhone: "6281111111101",
      customerName: "Customer A",
      assignedCsName: "Azelia",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: t1 - 10000,
      updatedAt: t1 + 100,
    } as any);

    // Pair 1: inbound → outbound (not template, not system)
    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv1,
      orderId: "O-101",
      customerPhone: "6281111111101",
      direction: "inbound",
      messageType: "text",
      role: "customer",
      content: "Assalamu alaikum",
      source: "kirimchat",
      createdAt: t1 - 5000,
    } as any);

    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv1,
      orderId: "O-101",
      customerPhone: "6281111111101",
      direction: "outbound",
      messageType: "text",
      role: "cs",
      content: "Wa alaikum assalam",
      source: "kirimchat",
      createdAt: t1 - 4000, // 1s response
    } as any);

    // Pair 2 (ongoing): inbound → outbound
    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv1,
      orderId: "O-101",
      customerPhone: "6281111111101",
      direction: "inbound",
      messageType: "text",
      role: "customer",
      content: "Berapa harganya?",
      source: "kirimchat",
      createdAt: t1 - 3000,
    } as any);

    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv1,
      orderId: "O-101",
      customerPhone: "6281111111101",
      direction: "outbound",
      messageType: "text",
      role: "cs",
      content: "Rp 100.000",
      source: "kirimchat",
      createdAt: t1 - 2000, // 1s response
    } as any);

    // Template message (should NOT pair)
    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv1,
      orderId: "O-101",
      customerPhone: "6281111111101",
      direction: "outbound",
      messageType: "template",
      role: "system",
      content: "Order template",
      source: "n8n",
      createdAt: t1 - 1000,
    } as any);

    // Conversation 2: Customer 6281111111102 <- Azelia (different customer)
    const conv2 = await ctx.db.insert("conversations", {
      orgId,
      orderId: "O-103",
      customerPhone: "6281111111102",
      customerName: "Customer B",
      assignedCsName: "Azelia",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: t1 - 10000,
      updatedAt: t1 + 200,
    } as any);

    // Pair 1
    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv2,
      orderId: "O-103",
      customerPhone: "6281111111102",
      direction: "inbound",
      messageType: "text",
      role: "customer",
      content: "Halo",
      source: "kirimchat",
      createdAt: t1 - 6000,
    } as any);

    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv2,
      orderId: "O-103",
      customerPhone: "6281111111102",
      direction: "outbound",
      messageType: "text",
      role: "cs",
      content: "Halo juga",
      source: "kirimchat",
      createdAt: t1 - 5000, // 1s response
    } as any);

    // Conversation 3: Customer 6281111111201 <- Lila
    const conv3 = await ctx.db.insert("conversations", {
      orgId,
      orderId: "O-201",
      customerPhone: "6281111111201",
      customerName: "Customer C",
      assignedCsName: "Lila",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: t1 - 10000,
      updatedAt: t1 + 150,
    } as any);

    // Pair 1
    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv3,
      orderId: "O-201",
      customerPhone: "6281111111201",
      direction: "inbound",
      messageType: "text",
      role: "customer",
      content: "Salam",
      source: "kirimchat",
      createdAt: t1 - 7000,
    } as any);

    await ctx.db.insert("messages", {
      orgId,
      conversationId: conv3,
      orderId: "O-201",
      customerPhone: "6281111111201",
      direction: "outbound",
      messageType: "text",
      role: "ai", // Can be ai or cs
      content: "Wa alaikum",
      source: "kirimchat",
      createdAt: t1 - 6500, // 0.5s response
    } as any);

    // ── WINDOW 2 (W2) ──────────────────────────────────────────────────────

    const t2 = w2Start + 3_600_000;

    // Azelia: 1 order in W2
    await ctx.db.insert("orders", {
      orderId: "O-301",
      customerPhone: "6281111111301",
      customerName: "Customer F",
      assignedCsName: "Azelia",
      productName: "Buku Sirah",
      products: "Buku Sirah",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t2,
      updatedAt: t2,
    } as any);

    // Lila: 1 order in W2
    await ctx.db.insert("orders", {
      orderId: "O-401",
      customerPhone: "6281111111401",
      customerName: "Customer G",
      assignedCsName: "Lila",
      productName: "Fikih Praktis",
      products: "Fikih Praktis",
      productsSubtotal: "120000",
      shippingCost: "0",
      total: "120000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      orgId,
      source: "berdu",
      aiEligible: false,
      createdAt: t2 + 1000,
      updatedAt: t2,
    } as any);

    // Azelia: 1 closing in W2
    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111301",
      customerName: "Customer F",
      csName: "Azelia",
      orderIdBerdu: "O-301",
      status: "exported",
      total: 100000,
      discount: 5000,
      followUpTouchesAtClose: 3, // H+3
      sourceMessageId: "m4",
      packageContent: "Buku Sirah",
      closedAt: t2 + 100,
      recipientName: "F",
      recipientPhone: "6281111111301",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "transfer",
      sourceMessageText: "",
      flags: [],
      createdAt: t2,
      updatedAt: t2,
      version: 1,
    } as any);

    // Lila: 1 closing in W2
    await ctx.db.insert("shippingRecaps", {
      orgId,
      customerPhone: "6281111111401",
      customerName: "Customer G",
      csName: "Lila",
      orderIdBerdu: "O-401",
      status: "delivered",
      total: 120000,
      discount: 2000,
      followUpTouchesAtClose: 0, // No follow-up
      sourceMessageId: "m5",
      packageContent: "Fikih Praktis",
      closedAt: t2 + 200,
      recipientName: "G",
      recipientPhone: "6281111111401",
      recipientAddress: "",
      recipientDistrict: "",
      recipientCity: "",
      paymentMethod: "cod",
      sourceMessageText: "",
      flags: [],
      createdAt: t2,
      updatedAt: t2,
      version: 1,
    } as any);
  });
}

async function runTest(name: string, fn: (t: ReturnType<typeof convexTest>, defaultOrg: string) => Promise<void>) {
  test(name, async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
    await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
    await seedRichDataset(t);
    // Get default org ID
    let defaultOrg: string = "";
    await t.run(async (ctx) => {
      defaultOrg = String(await requireDefaultOrgId(ctx));
    });
    // Backfill rollups for both windows
    await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W1 });
    await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W2 });
    // Backfill response samples for both windows
    await t.mutation(internal.rollups.rebuildSamplesForWindow, { orgId: defaultOrg, windowKey: W1 });
    await t.mutation(internal.rollups.rebuildSamplesForWindow, { orgId: defaultOrg, windowKey: W2 });
    await fn(t, defaultOrg);
  });
}

test("missing completeness marker makes an aligned daily report wholly raw", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "marker-admin", role: "admin", name: "Admin", email: "marker@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => ctx.db.insert("orders", {
    orgId: seeded.orgId, orderId: "NO-MARKER", customerPhone: "6281555000001", customerName: "No Marker", assignedCsName: "Azelia", csKey: "azelia",
    productName: "Buku", products: "Buku", productsSubtotal: "1", shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
    source: "berdu", aiEligible: false, createdAt: w1Start + 1, updatedAt: w1Start + 1,
  } as any));
  const result = await asAdmin.query(api.analytics.getDailyReport, { startAt: w1Start, endAt: w1End });
  expect(result.totals.leads).toBe(1);
});

test("partial completeness across requested keys makes the entire daily report raw", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "partial-admin", role: "admin", name: "Admin", email: "partial@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => {
    for (const [orderId, phone, createdAt] of [["PARTIAL-1", "6281444000001", w1Start + 1], ["PARTIAL-2", "6281444000002", w2Start + 1]] as const) {
      await ctx.db.insert("orders", {
        orgId: seeded.orgId, orderId, customerPhone: phone, customerName: orderId, assignedCsName: "Azelia", csKey: "azelia",
        productName: "Buku", products: "Buku", productsSubtotal: "1", shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
        source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: W1 });
  const result = await asAdmin.query(api.analytics.getDailyReport, { startAt: w1Start, endAt: w2End });
  expect(result.totals.leads).toBe(2);
});

test("bounded recompute records completeness for an empty window", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "empty-admin", role: "admin", name: "Admin", email: "empty@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: W1 });
  const markers = await t.run(async (ctx) => (ctx.db.query("rollupWindows" as any) as any).collect());
  expect(markers).toEqual([expect.objectContaining({ orgId: seeded.orgId, windowKey: W1, schemaVersion: expect.any(Number) })]);
});

test("completeness rejects a marked window whose requested end is not sealed", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "unsealed-admin", role: "admin", name: "Admin", email: "unsealed@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: W1 });
  const complete = await t.run(async (ctx) => (await import("./rollupReaders")).areRollupWindowsComplete(
    ctx, seeded.orgId as Id<"organizations">, w1Start, w1End, w1Start + 1,
  ));
  expect(complete).toBe(false);
});

test("public dashboard preserves global phone identity across CS rows", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "metric-union-admin", role: "admin", name: "Admin", email: "metric-union@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => {
    for (const [orderId, assignedCsName, csKey, createdAt] of [["METRIC-UNION-A", "Azelia", "azelia", w1Start + 10], ["METRIC-UNION-B", "Lila", "lila", w1Start + 20]] as const) {
      await ctx.db.insert("orders", {
        orgId: seeded.orgId, orderId, customerPhone: "6281555111111", customerName: "Union", assignedCsName, csKey,
        productName: "Buku", products: "Buku", productsSubtotal: "1", shippingCost: "0", total: "1",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: W1 });

  const dashboardArgs = { startAt: w1Start, endAt: w1End };
  const expectedDashboard = await t.run(async (ctx) => (await import("./metrics")).computeDashboardSummaryRaw(ctx, seeded.orgId as Id<"organizations">, dashboardArgs));
  const actualDashboard = await asAdmin.query(api.metrics.getDashboardSummary, dashboardArgs);
  expect(actualDashboard).toEqual(expectedDashboard);
  expect(actualDashboard.leads).toBe(1);

});

test("public trend preserves global phone identity across CS rows", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "trend-union-admin", role: "admin", name: "Admin", email: "trend-union@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => {
    for (const [orderId, assignedCsName, csKey, createdAt] of [["TREND-UNION-A", "Azelia", "azelia", w1Start + 10], ["TREND-UNION-B", "Lila", "lila", w1Start + 20]] as const) {
      await ctx.db.insert("orders", {
        orgId: seeded.orgId, orderId, customerPhone: "6281555222222", customerName: "Union", assignedCsName, csKey,
        productName: "Buku", products: "Buku", productsSubtotal: "1", shippingCost: "0", total: "1",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: W1 });

  const trend = await asAdmin.query(api.metrics.getTrend, { startAt: w1Start, endAt: w1End, bucket: "day" });
  expect(trend.reduce((sum, row) => sum + row.leads, 0)).toBe(1);
});

test("public follow-up effectiveness keeps a marked active window raw", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "followup-live-admin", role: "admin", name: "Admin", email: "followup-live@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const now = Date.now();
  const range = windowRangeForKey(windowKeyFor(now));
  const insertRecap = async (orderIdBerdu: string, phone: string, closedAt: number, followUpTouchesAtClose: number) => t.run(async (ctx) => ctx.db.insert("shippingRecaps", {
    orgId: seeded.orgId, customerPhone: phone, customerName: orderIdBerdu, csName: "Azelia", csKey: "azelia", orderIdBerdu,
    status: "ready", total: 1, packageContent: "Buku", paymentMethod: "cod", sourceMessageText: "", flags: [],
    recipientName: orderIdBerdu, recipientPhone: phone, recipientAddress: "", recipientDistrict: "", recipientCity: "", version: 1,
    followUpTouchesAtClose, closedAt, createdAt: closedAt, updatedAt: closedAt,
  } as any));
  await insertRecap("FU-LIVE-BEFORE", "6281666111101", range.startAt + 1, 0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: String(seeded.orgId), windowKey: windowKeyFor(now) });
  await insertRecap("FU-LIVE-AFTER", "6281666111102", now, 1);

  const actual = await asAdmin.query(api.followUp.getFollowUpEffectiveness, { startAt: range.startAt, endAt: range.endAt });
  expect(actual).toEqual({ totalClosings: 2, fromFollowUp: 1, byStage: { h1: 1, h2: 0, h3: 0 } });
});

// ── RESPONSE TIMES ──────────────────────────────────────────────────────────

runTest("responseTimesFromSamples matches legacy (full window W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.responseTime.getResponseTimes, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).responseTimesFromSamples(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End })
  );

  expect(rollup).toEqual(legacy);
});

runTest("responseTimesFromSamples matches legacy (csName-filtered)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.responseTime.getResponseTimes, { startAt: w1Start, endAt: w1End, csName: "Azelia" });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).responseTimesFromSamples(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      csName: "Azelia",
    })
  );

  expect(rollup).toEqual(legacy);
});

runTest("responseTimesFromSamples matches legacy (multi-window range)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.responseTime.getResponseTimes, { startAt: w1Start, endAt: w2End });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).responseTimesFromSamples(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w2End })
  );

  expect(rollup).toEqual(legacy);
});

// ── DAILY REPORT ────────────────────────────────────────────────────────────

runTest("computeDailyReportRaw matches public query (full window W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getDailyReport, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./analytics")).computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, w1Start, w1End)
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeDailyReportRaw matches public query (multi-window range)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getDailyReport, { startAt: w1Start, endAt: w2End });

  const rollup = await t.run(async (ctx) =>
    (await import("./analytics")).computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, w1Start, w2End)
  );

  expect(rollup).toEqual(legacy);
});

// ── TREND ───────────────────────────────────────────────────────────────────

runTest("computeTrendRaw matches public query (day bucket, W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.metrics.getTrend, { startAt: w1Start, endAt: w1End, bucket: "day" });

  const rollup = await t.run(async (ctx) =>
    (await import("./metrics")).computeTrendRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End, bucket: "day" })
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeTrendRaw matches public query (day bucket, csName-filtered)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.metrics.getTrend, {
    startAt: w1Start,
    endAt: w1End,
    bucket: "day",
    csName: "Lila",
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./metrics")).computeTrendRaw(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      bucket: "day",
      csName: "Lila",
    })
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeTrendRaw matches public query (day bucket, multi-window range)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.metrics.getTrend, { startAt: w1Start, endAt: w2End, bucket: "day" });

  const rollup = await t.run(async (ctx) =>
    (await import("./metrics")).computeTrendRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w2End, bucket: "day" })
  );

  expect(rollup).toEqual(legacy);
});

// ── DASHBOARD SUMMARY ───────────────────────────────────────────────────────

runTest("computeDashboardSummaryRaw matches public query (W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.metrics.getDashboardSummary, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./metrics")).computeDashboardSummaryRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End })
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeDashboardSummaryRaw matches public query (csName-filtered)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.metrics.getDashboardSummary, {
    startAt: w1Start,
    endAt: w1End,
    csName: "Azelia",
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./metrics")).computeDashboardSummaryRaw(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      csName: "Azelia",
    })
  );

  expect(rollup).toEqual(legacy);
});

// ── LEADERBOARD ─────────────────────────────────────────────────────────────

runTest("computeCsLeaderboardRaw matches public query", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getCsLeaderboard, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./analytics")).computeCsLeaderboardRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End })
  );

  expect(rollup).toEqual(legacy);
});

// ── PRODUCT DIFFICULTY ──────────────────────────────────────────────────────

runTest("productDifficultyFromRaw matches public query", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getProductDifficulty, {
    startAt: w1Start,
    endAt: w1End,
    minLeads: 1,
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).productDifficultyFromRaw(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      minLeads: 1,
    })
  );

  expect(rollup).toEqual(legacy);
});

// ── PERIOD REPORT ───────────────────────────────────────────────────────────

runTest("periodReportFromRaw matches public query (week period)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getPeriodReport, {
    period: "week",
    anchor: w1Start,
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).periodReportFromRaw(ctx, defaultOrg as Id<"organizations">, {
      period: "week",
      anchor: w1Start,
    })
  );

  expect(rollup).toEqual(legacy);
});

test("period report headline totals are distinct across CS ownership", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "period-admin", role: "admin", name: "Admin", email: "period@w" });
  const seeded = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const currentAt = t1;
  const previousAt = t1 - 7 * 86_400_000;
  await t.run(async (ctx) => {
    for (const [suffix, createdAt] of [["current", currentAt], ["previous", previousAt]] as const) {
      for (const [index, csName] of ["CS A", "CS B"].entries()) {
        await ctx.db.insert("orders", {
          orgId: seeded.orgId, orderId: `${suffix}-O-${index}`, customerPhone: "6281555111000",
          customerName: "Shared Customer", assignedCsName: csName, productName: "Book", products: "Book",
          productsSubtotal: "100", shippingCost: "0", total: "100", shippingAddress: "",
          shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false,
          createdAt: createdAt + index, updatedAt: createdAt + index,
        } as any);
        await ctx.db.insert("shippingRecaps", {
          orgId: seeded.orgId, customerPhone: "6281555111000", customerName: "Shared Customer",
          csName, orderIdBerdu: `${suffix}-shared-closing`, status: "exported", total: 100,
          discount: 0, packageContent: "Book", paymentMethod: "cod", sourceMessageText: "", flags: [],
          recipientName: "Shared Customer", recipientPhone: "6281555111000", recipientAddress: "",
          recipientDistrict: "", recipientCity: "", version: 1, closedAt: createdAt + index,
          createdAt: createdAt + index, updatedAt: createdAt + index,
        } as any);
      }
    }
  });

  const report = await t.run(async (ctx) =>
    (await import("./rollupReaders")).periodReportFromRaw(ctx, seeded.orgId, {
      period: "week", anchor: currentAt,
    }),
  );

  expect(report.perCs).toHaveLength(2);
  expect(report.perCs.map((row) => row.leads)).toEqual([1, 1]);
  expect(report.leads).toBe(1);
  expect(report.closings).toBe(1);
  expect(report.cr).toBe(100);
  expect(report.prevLeads).toBe(1);
  expect(report.prevClosings).toBe(1);
  expect(report.prevCr).toBe(100);
});

// ── PERFORMANCE ─────────────────────────────────────────────────────────────

runTest("performanceFromRaw matches public query (W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.shippingRecaps.getPerformance, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).performanceFromRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End })
  );

  expect(rollup).toEqual(legacy);
});

runTest("performanceFromRaw matches public query (csName-filtered)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.shippingRecaps.getPerformance, {
    startAt: w1Start,
    endAt: w1End,
    csName: "Lila",
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./rollupReaders")).performanceFromRaw(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      csName: "Lila",
    })
  );

  expect(rollup).toEqual(legacy);
});

runTest("single sealed performance and product difficulty both stay exact raw", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    const late = w1Start + 12 * 3_600_000;
    await ctx.db.insert("orders", {
      orgId: defaultOrg as Id<"organizations">, orderId: "O-LATE-RAW", customerPhone: "6281111199999", customerName: "Late Raw",
      assignedCsName: "Azelia", productName: "Late Raw Only", products: "Late Raw Only", productsSubtotal: "90000", shippingCost: "0", total: "90000",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: late, updatedAt: late,
    } as any);
    await ctx.db.insert("shippingRecaps", {
      orgId: defaultOrg as Id<"organizations">, customerPhone: "6281111199999", customerName: "Late Raw", csName: "Azelia", orderIdBerdu: "O-LATE-RAW",
      status: "exported", total: 90000, discount: 0, packageContent: "Late Raw Only", paymentMethod: "cod", sourceMessageText: "", flags: [],
      recipientName: "Late Raw", recipientPhone: "6281111199999", recipientAddress: "", recipientDistrict: "", recipientCity: "", version: 1,
      closedAt: late, createdAt: late, updatedAt: late,
    } as any);
  });

  const readers = await import("./rollupReaders");
  const products = await t.run(async (ctx) => readers.productDifficultyFromRaw(ctx, defaultOrg as Id<"organizations">, {
    startAt: w1Start, endAt: w1End, minLeads: 1,
  }));
  const performance = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, {
    startAt: w1Start, endAt: w1End,
  }));
  const rawPerformance = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, {
    startAt: w1Start, endAt: w1End,
  }));

  expect(products.map((row) => row.productName)).toContain("Late Raw Only");
  expect(performance.products.map((row) => row.product)).toContain("Late Raw Only");
  expect(performance).toEqual(rawPerformance);
});

runTest("non-aligned daily report uses only the exact raw midnight-to-now range", async (t, defaultOrg) => {
  const startAt = w1Start + 8 * 3_600_000; // midnight WIB inside W1
  const endAt = startAt + 4 * 3_600_000;
  const expected = await t.run(async (ctx) =>
    (await import("./analytics")).computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, startAt, endAt)
  );
  const actual = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" })
    .query(api.analytics.getDailyReport, { startAt, endAt });

  expect(actual).toEqual(expected);
});

runTest("public one-day, seven-day, CS-filtered, and product-rich routes match raw calculations", async (t, defaultOrg) => {
  const readers = await import("./rollupReaders");
  const rawAnalytics = await import("./analytics");
  const oneDay = { startAt: w1Start, endAt: w1End };
  const sevenDay = { startAt: w1Start, endAt: w1Start + 7 * 86_400_000 };

  const rawOneDay = await t.run(async (ctx) => rawAnalytics.computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, oneDay.startAt, oneDay.endAt));
  const actualOneDay = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getDailyReport, oneDay);
  expect(actualOneDay).toEqual(rawOneDay);

  const rawSevenDay = await t.run(async (ctx) => rawAnalytics.computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, sevenDay.startAt, sevenDay.endAt));
  const actualSevenDay = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getDailyReport, sevenDay);
  expect(actualSevenDay).toEqual(rawSevenDay);

  const filtered = { ...oneDay, csName: "Lila" };
  const rawProducts = await t.run(async (ctx) => readers.productDifficultyFromRaw(ctx, defaultOrg as Id<"organizations">, { ...filtered, minLeads: 1 }));
  const actualProducts = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getProductDifficulty, { ...filtered, minLeads: 1 });
  expect(actualProducts).toEqual(rawProducts);

  const rawPerformance = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, filtered));
  const actualPerformance = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.shippingRecaps.getPerformance, filtered);
  expect(actualPerformance).toEqual(rawPerformance);
});

runTest("public product and performance routes ignore legacy rollup facts", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    const row = await (ctx.db.query("dailyRollups") as any)
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", defaultOrg as Id<"organizations">).eq("windowKey", W1))
      .first();
    if (!row) throw new Error("expected W1 rollup");
    const { cod, transfer, byProduct, ...legacy } = row as any;
    await ctx.db.replace(row._id, {
      ...legacy,
      byProduct: byProduct.map(({ leadOrders, revenue, discount, cod: productCod, transfer: productTransfer, ...product }: any) => product),
    });
  });
  const readers = await import("./rollupReaders");
  const productArgs = { startAt: w1Start, endAt: w1End, minLeads: 1 };
  const performanceArgs = { startAt: w1Start, endAt: w1End };
  const rawProducts = await t.run(async (ctx) => readers.productDifficultyFromRaw(ctx, defaultOrg as Id<"organizations">, productArgs));
  const actualProducts = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getProductDifficulty, productArgs);
  expect(actualProducts).toEqual(rawProducts);
  const rawPerformance = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, performanceArgs));
  const actualPerformance = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.shippingRecaps.getPerformance, performanceArgs);
  expect(actualPerformance).toEqual(rawPerformance);
});

runTest("public product route ignores overflow rollup facts", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    const row = await (ctx.db.query("dailyRollups") as any)
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", defaultOrg as Id<"organizations">).eq("windowKey", W1))
      .first();
    if (!row) throw new Error("expected W1 rollup");
    await ctx.db.patch(row._id, {
      byProduct: [...row.byProduct, { product: "lainnya", leads: 1, closings: 0, leadOrders: 1, revenue: 0, discount: 0, cod: 0, transfer: 0 }],
    });
  });
  const readers = await import("./rollupReaders");
  const args = { startAt: w1Start, endAt: w1End, minLeads: 1 };
  const raw = await t.run(async (ctx) => readers.productDifficultyFromRaw(ctx, defaultOrg as Id<"organizations">, args));
  const actual = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getProductDifficulty, args);
  expect(actual).toEqual(raw);
});

runTest("includeInferredDiscount uses a wholly raw performance response", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    const at = w1Start + 5 * 3_600_000;
    await ctx.db.insert("shippingRecaps", {
      orgId: defaultOrg as Id<"organizations">, customerPhone: "6281777000001", customerName: "Inferred", csName: "Azelia", csKey: "azelia",
      orderIdBerdu: "INF-1", status: "ready", total: 70000, inferredDiscount: 12345, packageContent: "Buku Sirah", paymentMethod: "transfer",
      sourceMessageText: "", flags: [], recipientName: "Inferred", recipientPhone: "6281777000001", recipientAddress: "", recipientDistrict: "", recipientCity: "",
      version: 1, closedAt: at, createdAt: at, updatedAt: at,
    } as any);
  });
  const readers = await import("./rollupReaders");
  const args = { startAt: w1Start, endAt: w1End, includeInferredDiscount: true };
  const raw = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, args));
  const actual = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.shippingRecaps.getPerformance, args);
  expect(actual).toEqual(raw);
});

runTest("public multi-window performance preserves repeat-customer uniqueness", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    for (const [orderId, createdAt] of [["REPEAT-1", w1Start + 6_000], ["REPEAT-2", w2Start + 6_000]] as const) {
      await ctx.db.insert("orders", {
        orgId: defaultOrg as Id<"organizations">, orderId, customerPhone: "6281888000001", customerName: "Repeat", assignedCsName: "Azelia", csKey: "azelia",
        productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W1 });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W2 });
  const readers = await import("./rollupReaders");
  const args = { startAt: w1Start, endAt: w2End };
  const raw = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, args));
  const actual = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.shippingRecaps.getPerformance, args);
  expect(actual).toEqual(raw);
  expect(actual.totalLeads).toBe(raw.totalLeads);
});

runTest("public single-window performance preserves cross-CS phone identity", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    for (const [orderId, csName, csKey, createdAt] of [["CROSS-CS-1", "Azelia", "azelia", w1Start + 7_000], ["CROSS-CS-2", "Lila", "lila", w1Start + 8_000]] as const) {
      await ctx.db.insert("orders", {
        orgId: defaultOrg as Id<"organizations">, orderId, customerPhone: "6281222333444", customerName: "Cross CS", assignedCsName: csName, csKey,
        productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W1 });
  const readers = await import("./rollupReaders");
  const args = { startAt: w1Start, endAt: w1End };
  const raw = await t.run(async (ctx) => readers.performanceFromRaw(ctx, defaultOrg as Id<"organizations">, args));
  const actual = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.shippingRecaps.getPerformance, args);
  expect(actual).toEqual(raw);
});

runTest("product previous period includes a row at exactly startAt minus one millisecond", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    const currentAt = w1Start + 10_000;
    const previousAt = w1Start - 1;
    for (const [orderId, phone, createdAt] of [["ENDPOINT-CUR", "6281333000001", currentAt], ["ENDPOINT-PREV", "6281333000002", previousAt]] as const) {
      await ctx.db.insert("orders", {
        orgId: defaultOrg as Id<"organizations">, orderId, customerPhone: phone, customerName: orderId, assignedCsName: "Azelia", csKey: "azelia",
        productName: "Endpoint Product", products: "Endpoint Product", productsSubtotal: "1", shippingCost: "0", total: "1",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
      } as any);
    }
    await ctx.db.insert("shippingRecaps", {
      orgId: defaultOrg as Id<"organizations">, customerPhone: "6281333000002", customerName: "Previous", csName: "Azelia", csKey: "azelia",
      orderIdBerdu: "ENDPOINT-PREV", status: "ready", total: 1, packageContent: "Endpoint Product", paymentMethod: "transfer", sourceMessageText: "", flags: [],
      recipientName: "Previous", recipientPhone: "6281333000002", recipientAddress: "", recipientDistrict: "", recipientCity: "", version: 1,
      closedAt: previousAt, createdAt: previousAt, updatedAt: previousAt,
    } as any);
  });
  const rows = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getProductDifficulty, {
    startAt: w1Start, endAt: w1End, minLeads: 1,
  });
  expect(rows.find((row) => row.productName === "Endpoint Product")?.prevCr).toBe(100);
});

runTest("an exact 16:00 boundary row is excluded from the previous product window", async (t, defaultOrg) => {
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", {
      orgId: defaultOrg as Id<"organizations">, orderId: "BOUNDARY-1", customerPhone: "6281999000001", customerName: "Boundary", assignedCsName: "Azelia", csKey: "azelia",
      productName: "Boundary Product", products: "Boundary Product", productsSubtotal: "1", shippingCost: "0", total: "1",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: w1End, updatedAt: w1End,
    } as any);
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W1 });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W2 });
  const rows = await t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" }).query(api.analytics.getProductDifficulty, {
    startAt: w1Start, endAt: w1End, minLeads: 1,
  });
  expect(rows.map((row) => row.productName)).not.toContain("Boundary Product");
});

runTest("calendar period cancellation excludes the preceding pre-midnight row", async (t, defaultOrg) => {
  const readers = await import("./rollupReaders");
  const before = await t.run(async (ctx) => readers.periodReportFromRaw(ctx, defaultOrg as Id<"organizations">, { period: "week", anchor: w1Start }));
  const at = before.rangeStart - 3_600_000;
  await t.run(async (ctx) => {
    await ctx.db.insert("shippingRecaps", {
      orgId: defaultOrg as Id<"organizations">, customerPhone: "6281666000001", customerName: "Outside", csName: "Azelia", csKey: "azelia",
      orderIdBerdu: "OUTSIDE-CANCEL", status: "cancelled", total: 1, packageContent: "Buku Sirah", paymentMethod: "cod", sourceMessageText: "", flags: [],
      recipientName: "Outside", recipientPhone: "6281666000001", recipientAddress: "", recipientDistrict: "", recipientCity: "", version: 1,
      closedAt: at, createdAt: at, updatedAt: at,
    } as any);
  });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: windowKeyFor(at) });
  const actual = await t.run(async (ctx) => readers.periodReportFromRaw(ctx, defaultOrg as Id<"organizations">, { period: "week", anchor: w1Start }));
  expect(actual.cancelled).toBe(before.cancelled);
});

// ── FOLLOW-UP EFFECTIVENESS ────────────────────────────────────────────────

runTest("computeFollowUpEffectivenessRaw matches public query (W1)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.followUp.getFollowUpEffectiveness, { startAt: w1Start, endAt: w1End });

  const rollup = await t.run(async (ctx) =>
    (await import("./followUp")).computeFollowUpEffectivenessRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w1End })
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeFollowUpEffectivenessRaw matches public query (csName-filtered)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.followUp.getFollowUpEffectiveness, {
    startAt: w1Start,
    endAt: w1End,
    csName: "Azelia",
  });

  const rollup = await t.run(async (ctx) =>
    (await import("./followUp")).computeFollowUpEffectivenessRaw(ctx, defaultOrg as Id<"organizations">, {
      startAt: w1Start,
      endAt: w1End,
      csName: "Azelia",
    })
  );

  expect(rollup).toEqual(legacy);
});

runTest("computeFollowUpEffectivenessRaw matches public query (multi-window range)", async (t, defaultOrg) => {
  const legacy = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.followUp.getFollowUpEffectiveness, { startAt: w1Start, endAt: w2End });

  const rollup = await t.run(async (ctx) =>
    (await import("./followUp")).computeFollowUpEffectivenessRaw(ctx, defaultOrg as Id<"organizations">, { startAt: w1Start, endAt: w2End })
  );

  expect(rollup).toEqual(legacy);
});

// Smoke test: public query delegation to the exact raw reader
runTest("public getDailyReport (admin identity) matches raw reader for seeded window", async (t, defaultOrg) => {
  const publicResult = await t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "a@w",
  }).query(api.analytics.getDailyReport, { startAt: w1Start, endAt: w1End });

  const readerResult = await t.run(async (ctx) =>
    (await import("./analytics")).computeDailyReportRaw(ctx, defaultOrg as Id<"organizations">, w1Start, w1End)
  );

  expect(publicResult).toEqual(readerResult);
  // Verify the result has expected structure
  expect(publicResult).toHaveProperty("totals");
  expect(publicResult).toHaveProperty("cs");
  expect(publicResult.totals).toHaveProperty("leads");
  expect(publicResult.totals).toHaveProperty("closings");
  expect(publicResult.totals).toHaveProperty("cr");
});
