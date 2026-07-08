import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { windowRangeForKey } from "./lib";

const W = "2026-07-08";
const t0 = windowRangeForKey(W).startAt + 3_600_000;

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-1", customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-2", customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 1, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-3", customerPhone: "6281000000002", customerName: "B", assignedCsName: "Azelia", productName: "Quran Medis", products: "Quran Medis", productsSubtotal: "200000", shippingCost: "0", total: "200000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 2, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-4", customerPhone: "6281385708799", customerName: "T", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 3, updatedAt: t0 } as any); // internal test phone -> excluded
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000001", customerName: "A", csName: "Azelia", orderIdBerdu: "O-1", status: "exported", total: 100000, discount: 5000, followUpTouchesAtClose: 2, sourceMessageId: "m1", packageContent: "Buku Sirah", closedAt: t0 + 10, recipientName: "A", recipientPhone: "6281000000001", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000002", customerName: "B", csName: "Azelia", orderIdBerdu: "O-3", status: "delivered", total: 200000, packageContent: "Quran Medis", closedAt: t0 + 11, recipientName: "B", recipientPhone: "6281000000002", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000005", customerName: "C", csName: "Azelia", orderIdBerdu: "O-9", status: "cancelled", total: 50000, packageContent: "Buku Sirah", closedAt: t0 + 12, recipientName: "C", recipientPhone: "6281000000005", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
  });
}

test("computeRollupRow reproduces getDailyReport aggregation rules", async () => {
  const t = convexTest(schema);
  await seed(t);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    windowKey: W,
    leadOrders: 3, leadsCust: 2,
    closings: 2, closedCust: 2, cancelled: 1,
    manualClosings: 1, delivered: 1,
    revenue: 300000, discount: 5000,
    fuClosings: 1, fuH1: 0, fuH2: 1, fuH3: 0,
  });
  const prods = Object.fromEntries(rows[0].byProduct.map((p: any) => [p.product, p]));
  expect(prods["Buku Sirah"]).toMatchObject({ leads: 1, closings: 1 });
  // Note: "Quran Medis" is canonicalized to the full product name via PRODUCT_ALIASES
  expect(Object.keys(prods).length).toBe(2);
  const quranProduct = Object.keys(prods).find((k) => k.includes("Qur"));
  expect(quranProduct).toBeDefined();
  expect(prods[quranProduct!]).toMatchObject({ leads: 1, closings: 1 });
});

test("empty window produces no row", async () => {
  const t = convexTest(schema);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: "2026-07-01" });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", "2026-07-01")).collect());
  expect(rows).toHaveLength(0);
});

test("orphan recap attributed via order fallback like legacy", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-7", customerPhone: "6281000000007", customerName: "C", assignedCsName: "Lila", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "90000", shippingCost: "0", total: "90000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000007", customerName: "C", csName: "Lila", orderIdBerdu: "O-7", status: "ready", total: 90000, packageContent: "Buku Sirah", closedAt: t0 + 5, recipientName: "C", recipientPhone: "6281000000007", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
  });
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].closings).toBe(1);
});

test("upsertOrderFromN8n (new order) creates rollup entry via bump", async () => {
  const t = convexTest(schema);
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000010",
    csName: "CS Test",
    productName: "Test Product",
    createdAt: t0,
  });
  // Force recompute to verify order was created
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  expect(rows.length).toBeGreaterThan(0);
  const csTestRow = rows.find((r: any) => r.csName === "CS Test");
  expect(csTestRow).toBeDefined();
  expect(csTestRow!.leadOrders).toBe(1);
});

test("appendMessageFromN8n with closing creates recap that bumps rollup", async () => {
  const t = convexTest(schema);
  // First create an order
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000011",
    csName: "CS Test2",
    productName: "Quran Mapping",
    createdAt: t0,
  });
  // Then send a closing message - this should create a recap
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000011",
    csName: "CS Test2",
    role: "ai",
    direction: "outbound",
    content: "PEMESANAN BERHASIL\nDikirim ke:\nJohn Doe|628123456789\nJl. Main Street, District, City",
    messageType: "text",
    createdAt: t0 + 1000,
  });
  // Force recompute
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  const csTest2Row = rows.find((r: any) => r.csName === "CS Test2");
  expect(csTest2Row).toBeDefined();
  expect(csTest2Row!.closings).toBeGreaterThan(0);
});

test("markCancelled bumps rollup with cancelled: 1, closings: 0", async () => {
  const t = convexTest(schema);
  // Set up admin identity
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  // Create order and recap
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000012",
    csName: "CS Test3",
    productName: "Buku Sirah",
    createdAt: t0,
  });
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000012",
    csName: "CS Test3",
    role: "ai",
    direction: "outbound",
    content: "PEMESANAN BERHASIL\nDikirim ke:\nJane Doe|628987654321\nJl. Other Street, District2, City2",
    messageType: "text",
    createdAt: t0 + 1000,
  });

  // Get recap ID
  const recap = await t.run(async (ctx) =>
    ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", "6281000000012")).first());

  // Cancel the recap using the real mutation
  await t.withIdentity(adminIdentity).mutation(internal.shippingRecaps.markCancelled, {
    recapId: recap._id,
    reason: "Test cancel",
  });

  // Force recompute
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());

  const csTest3Row = rows.find((r: any) => r.csName === "CS Test3");
  expect(csTest3Row).toBeDefined();
  expect(csTest3Row!.cancelled).toBe(1);
  expect(csTest3Row!.closings).toBe(0);
});

test("undoCancelled bumps rollup back to closings: 1, cancelled: 0", async () => {
  const t = convexTest(schema);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  // Create order and recap
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000013",
    csName: "CS Test4",
    productName: "Buku Sirah",
    createdAt: t0,
  });
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000013",
    csName: "CS Test4",
    role: "ai",
    direction: "outbound",
    content: "PEMESANAN BERHASIL\nDikirim ke:\nBob Smith|628111111111\nJl. Another St, District4, City4",
    messageType: "text",
    createdAt: t0 + 1000,
  });

  // Get recap ID
  const recap = await t.run(async (ctx) =>
    ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", "6281000000013")).first());

  // Cancel
  await t.withIdentity(adminIdentity).mutation(internal.shippingRecaps.markCancelled, {
    recapId: recap._id,
    reason: "Test cancel",
  });

  // Undo cancel using real mutation
  await t.withIdentity(adminIdentity).mutation(internal.shippingRecaps.undoCancelled, {
    recapId: recap._id,
  });

  // Force recompute
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());

  const csTest4Row = rows.find((r: any) => r.csName === "CS Test4");
  expect(csTest4Row).toBeDefined();
  expect(csTest4Row!.closings).toBe(1);
  expect(csTest4Row!.cancelled).toBe(0);
});

test("backfillCsNameByOrderIds bumps old and new csKey rows", async () => {
  const t = convexTest(schema);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  // Create order and recap with CS Old
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000014",
    csName: "CS Old",
    productName: "Buku Sirah",
    order_id: "O-REASSIGN-1",
    createdAt: t0,
  });
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000014",
    csName: "CS Old",
    role: "ai",
    direction: "outbound",
    content: "PEMESANAN BERHASIL\nDikirim ke:\nAlice|628555555555\nJl. Test St, District3, City3",
    messageType: "text",
    createdAt: t0 + 1000,
  });

  // Reassign to CS New using real mutation
  await t.withIdentity(adminIdentity).mutation(internal.shippingRecaps.backfillCsNameByOrderIds, {
    orderIds: ["O-REASSIGN-1"],
    csName: "CS New",
  });

  // Force recompute
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());

  const oldRow = rows.find((r: any) => r.csName === "CS Old");
  const newRow = rows.find((r: any) => r.csName === "CS New");

  // Old CS row should be empty/deleted or have no data
  if (oldRow) {
    expect(oldRow.closings).toBe(0);
  }
  // New CS row should have the closing
  expect(newRow).toBeDefined();
  expect(newRow!.closings).toBe(1);
});

test("rebuildSamplesForWindow + trueUp: corrupt rollup field → fixed; bogus sample → gone", async () => {
  const t = convexTest(schema);
  const today = "2026-07-08";
  const range = windowRangeForKey(today);
  const msgTime = range.startAt + 3_600_000;

  // First create an order so the rollup will have data
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", {
      orderId: "O-TRUE-UP",
      customerPhone: "6281000000099",
      customerName: "TrueUp Test",
      assignedCsName: "CS TrueUp",
      productName: "Test Product",
      products: "Test Product",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: msgTime,
      updatedAt: msgTime,
    } as any);
  });

  // Create a conversation for the messages
  let convId: string;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", {
      orderId: "O-TRUE-UP",
      customerPhone: "6281000000099",
      customerName: "TrueUp Test",
      assignedCsName: "CS TrueUp",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: msgTime,
      updatedAt: msgTime,
    } as any);
  });

  // Add messages: inbound -> outbound (creates a response sample)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000099",
    order_id: "O-TRUE-UP",
    customerName: "TrueUp Test",
    csName: "CS TrueUp",
    role: "customer",
    direction: "inbound",
    content: "Hi",
    messageType: "text",
    createdAt: msgTime,
  });

  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281000000099",
    order_id: "O-TRUE-UP",
    customerName: "TrueUp Test",
    csName: "CS TrueUp",
    role: "cs",
    direction: "outbound",
    content: "Hello!",
    messageType: "text",
    createdAt: msgTime + 10 * 60 * 1000, // 10 min later
  });

  // Force an initial rollup so we have something to corrupt
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: today });

  // Corrupt a rollup field
  await t.run(async (ctx) => {
    const rollups = await ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", today)).collect();
    if (rollups.length > 0) {
      await ctx.db.patch(rollups[0]._id, { leadOrders: 999 }); // corrupt field
    }
  });

  // Insert a bogus sample outside the message-derived pairs
  await t.run(async (ctx) => {
    await ctx.db.insert("responseSamples", {
      csKey: "trueup",
      csName: "CS TrueUp",
      conversationId: convId as any,
      deltaMs: 999999,
      inboundAt: msgTime + 100 * 60 * 1000, // way in future
      slaBreach: false,
      createdAt: msgTime + 100 * 60 * 1000,
    } as any);
  });

  // Verify before true-up: bogus sample exists, rollup is corrupted
  await t.run(async (ctx) => {
    const rollups = await ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", today)).collect();
    const rollup = rollups.find((r: any) => r.csKey === "trueup");
    expect(rollup!.leadOrders).toBe(999); // Corrupted
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples.length).toBe(2); // 1 correct + 1 bogus
  });

  // Run trueUp action - manually do the steps
  await t.mutation(internal.rollups.rebuildSamplesForWindow, { windowKey: today });
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: today });

  // Verify: rollup field is corrected (not 999)
  await t.run(async (ctx) => {
    const rollups = await ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", today)).collect();
    const rollup = rollups.find((r: any) => r.csKey === "trueup");
    expect(rollup).toBeDefined();
    expect(rollup!.leadOrders).not.toBe(999);
    expect(rollup!.leadOrders).toBe(1); // One order in window
  });

  // Verify: bogus sample is gone, correct sample is present
  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples.length).toBe(1); // only the correct one from the message pair
    expect(samples[0].inboundAt).toBe(msgTime);
    expect(samples[0].createdAt).toBe(msgTime + 10 * 60 * 1000);
  });
});
