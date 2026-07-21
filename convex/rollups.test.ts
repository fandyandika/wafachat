import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { windowRangeForKey, windowKeyFor, csKey } from "./lib";
import { requireDefaultOrgId } from "./orgs";

const W = "2026-07-08";
const t0 = windowRangeForKey(W).startAt + 3_600_000;

// Test seeds insert orders/recaps raw (bypassing the write-path that stamps csKey), so
// mirror the prod invariant: every doc carries csKey = csKey(rawName). computeRollupValues
// reads by the by_csKey_* index, so a seed without csKey would be invisible. Idempotent.
async function seedDefaultOrg(t: ReturnType<typeof convexTest>) {
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  return await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
}

async function stampCsKeys(ctx: any) {
  for (const o of await ctx.db.query("orders").collect())
    if (o.csKey === undefined) await ctx.db.patch(o._id, { csKey: csKey(o.assignedCsName) });
  for (const r of await ctx.db.query("shippingRecaps").collect())
    if (r.csKey === undefined) await ctx.db.patch(r._id, { csKey: csKey(r.csName) });
}

async function getDefaultOrgId(t: ReturnType<typeof convexTest>): Promise<string> {
  let orgId: string = "";
  await t.run(async (ctx) => {
    orgId = String(await requireDefaultOrgId(ctx));
  });
  return orgId;
}

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", { orderId: "O-1", orgId, customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-2", orgId, customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 1, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-3", orgId, customerPhone: "6281000000002", customerName: "B", assignedCsName: "Azelia", productName: "Quran Medis", products: "Quran Medis", productsSubtotal: "200000", shippingCost: "0", total: "200000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 2, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-4", orgId, customerPhone: "6281385708799", customerName: "T", assignedCsName: "Azelia", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + 3, updatedAt: t0 } as any); // internal test phone -> excluded
    await ctx.db.insert("shippingRecaps", { orgId, customerPhone: "6281000000001", customerName: "A", csName: "Azelia", orderIdBerdu: "O-1", status: "exported", total: 100000, discount: 5000, followUpTouchesAtClose: 2, sourceMessageId: "m1", packageContent: "Buku Sirah", closedAt: t0 + 10, recipientName: "A", recipientPhone: "6281000000001", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { orgId, customerPhone: "6281000000002", customerName: "B", csName: "Azelia", orderIdBerdu: "O-3", status: "delivered", total: 200000, packageContent: "Quran Medis", closedAt: t0 + 11, recipientName: "B", recipientPhone: "6281000000002", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { orgId, customerPhone: "6281000000005", customerName: "C", csName: "Azelia", orderIdBerdu: "O-9", status: "cancelled", total: 50000, packageContent: "Buku Sirah", closedAt: t0 + 12, recipientName: "C", recipientPhone: "6281000000005", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await stampCsKeys(ctx);
  });
}

test("computeRollupRow reproduces getDailyReport aggregation rules", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  await seed(t);
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));
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
  expect(prods["Buku Sirah"]).toMatchObject({ leadOrders: 2, revenue: 100000, discount: 5000, cod: 0, transfer: 0 });
  // Note: "Quran Medis" is canonicalized to the full product name via PRODUCT_ALIASES
  expect(Object.keys(prods).length).toBe(2);
  const quranProduct = Object.keys(prods).find((k) => k.includes("Qur"));
  expect(quranProduct).toBeDefined();
  expect(prods[quranProduct!]).toMatchObject({ leads: 1, closings: 1 });
  expect(prods[quranProduct!]).toMatchObject({ leadOrders: 1, revenue: 200000, cod: 0, transfer: 0 });
  expect(rows[0]).toMatchObject({ cod: 0, transfer: 0 });
});

test("empty window produces no row", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: "2026-07-01" });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === "2026-07-01"));
  expect(rows).toHaveLength(0);
});

test("backfillCsKey paginates only the authenticated organization", async () => {
  const t = convexTest(schema);
  const orgA = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "cskey-a", name: "CS Key A", createdAt: 1, updatedAt: 1,
  }));
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "cskey-b", name: "CS Key B", createdAt: 2, updatedAt: 2,
  }));
  const userA = await t.run((ctx: any) => ctx.db.insert("users", {
    orgId: orgA, email: "cskey-admin@example.test", name: "CS Key Admin", passwordHash: "test",
    role: "admin", isActive: true, createdAt: 1, updatedAt: 1,
  }));
  const insertOrder = (ctx: any, orgId: any, orderId: string, createdAt: number) => ctx.db.insert("orders", {
    orgId, orderId, customerPhone: `6281000${createdAt}`, customerName: orderId,
    assignedCsName: "Agent Name", productName: "Book", products: "Book", productsSubtotal: "1",
    shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
    source: "berdu", aiEligible: false, createdAt, updatedAt: createdAt,
  } as any);
  const [a1, a2, b1] = await t.run(async (ctx: any) => Promise.all([
    insertOrder(ctx, orgA, "A-1", 10), insertOrder(ctx, orgA, "A-2", 11),
    insertOrder(ctx, orgB, "B-1", 12),
  ]));
  const asA = t.withIdentity({
    subject: String(userA), role: "admin", name: "CS Key Admin", email: "cskey-admin@example.test",
    orgId: String(orgA),
  });

  let cursor: string | undefined;
  let done = false;
  let patched = 0;
  for (let page = 0; page < 4 && !done; page++) {
    const result = await asA.mutation(api.rollups.backfillCsKey, {
      table: "orders", limit: 1, cursor,
    });
    patched += result.patched;
    cursor = result.continueCursor;
    done = result.done;
  }

  expect(done).toBe(true);
  expect(patched).toBe(2);
  await t.run(async (ctx: any) => {
    expect((await ctx.db.get(a1))?.csKey).toBe("agentname");
    expect((await ctx.db.get(a2))?.csKey).toBe("agentname");
    expect((await ctx.db.get(b1))?.csKey).toBeUndefined();
  });
});

test("cancelled payment methods remain in top-level COD and transfer facts", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("shippingRecaps", { orgId, csKey: "azelia", customerPhone: "6281000000091", customerName: "C", csName: "Azelia", orderIdBerdu: "PAY-COD", status: "cancelled", total: 10, packageContent: "Buku", closedAt: t0 + 10, recipientName: "C", recipientPhone: "6281000000091", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "cod", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { orgId, csKey: "azelia", customerPhone: "6281000000092", customerName: "T", csName: "Azelia", orderIdBerdu: "PAY-TRANSFER", status: "cancelled_after_export", total: 20, packageContent: "Buku", closedAt: t0 + 20, recipientName: "T", recipientPhone: "6281000000092", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "transfer", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
  });
  const orgId = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  const row = await t.run(async (ctx) => (ctx.db.query("dailyRollups") as any).withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", W)).first());
  expect(row).toMatchObject({ closings: 0, cancelled: 2, cod: 1, transfer: 1 });
});

test("orphan recap attributed via order fallback like legacy", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", { orderId: "O-7", orgId, customerPhone: "6281000000007", customerName: "C", assignedCsName: "Lila", productName: "Buku Sirah", products: "Buku Sirah", productsSubtotal: "90000", shippingCost: "0", total: "90000", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("shippingRecaps", { orgId, customerPhone: "6281000000007", customerName: "C", csName: "Lila", orderIdBerdu: "O-7", status: "ready", total: 90000, packageContent: "Buku Sirah", closedAt: t0 + 5, recipientName: "C", recipientPhone: "6281000000007", recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "", flags: [], createdAt: t0, updatedAt: t0, version: 1 } as any);
    await stampCsKeys(ctx);
  });
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));
  expect(rows).toHaveLength(1);
  expect(rows[0].closings).toBe(1);
});

test("upsertOrderFromN8n (new order) creates rollup entry via bump", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6281000000010",
    csName: "CS Test",
    productName: "Test Product",
    createdAt: t0,
  });
  // Force recompute to verify order was created
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));
  expect(rows.length).toBeGreaterThan(0);
  const csTestRow = rows.find((r: any) => r.csName === "CS Test");
  expect(csTestRow).toBeDefined();
  expect(csTestRow!.leadOrders).toBe(1);
});

test("appendMessageFromN8n with closing creates recap that bumps rollup", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
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
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));
  const csTest2Row = rows.find((r: any) => r.csName === "CS Test2");
  expect(csTest2Row).toBeDefined();
  expect(csTest2Row!.closings).toBeGreaterThan(0);
});

test("markCancelled bumps rollup with cancelled: 1, closings: 0", async () => {
  const t = convexTest(schema);
  const result = await seedDefaultOrg(t);
  const orgId = result.orgId;
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
    ctx.db.query("shippingRecaps").withIndex("by_org_customerPhone", (q) => q.eq("orgId", orgId).eq("customerPhone", "6281000000012")).first());

  if (!recap) throw new Error("recap not found");

  // Cancel the recap using the real mutation
  await t.withIdentity(adminIdentity).mutation(api.shippingRecaps.markCancelled, {
    recapId: recap._id,
    reason: "Test cancel",
  });

  // Force recompute
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));

  const csTest3Row = rows.find((r: any) => r.csName === "CS Test3");
  expect(csTest3Row).toBeDefined();
  expect(csTest3Row!.cancelled).toBe(1);
  expect(csTest3Row!.closings).toBe(0);
});

test("undoCancelled bumps rollup back to closings: 1, cancelled: 0", async () => {
  const t = convexTest(schema);
  const result = await seedDefaultOrg(t);
  const orgId = result.orgId;
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
    ctx.db.query("shippingRecaps").withIndex("by_org_customerPhone", (q) => q.eq("orgId", orgId).eq("customerPhone", "6281000000013")).first());

  if (!recap) throw new Error("recap not found");

  // Cancel
  await t.withIdentity(adminIdentity).mutation(api.shippingRecaps.markCancelled, {
    recapId: recap._id,
    reason: "Test cancel",
  });

  // Undo cancel using real mutation
  await t.withIdentity(adminIdentity).mutation(api.shippingRecaps.undoCancelled, {
    recapId: recap._id,
  });

  // Force recompute
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));

  const csTest4Row = rows.find((r: any) => r.csName === "CS Test4");
  expect(csTest4Row).toBeDefined();
  expect(csTest4Row!.closings).toBe(1);
  expect(csTest4Row!.cancelled).toBe(0);
});

test("backfillCsNameByOrderIds bumps old and new csKey rows", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
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
  await t.withIdentity(adminIdentity).mutation(api.shippingRecaps.backfillCsNameByOrderIds, {
    orderIds: ["O-REASSIGN-1"],
    csName: "CS New",
  });

  // Force recompute
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W));

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
  await seedDefaultOrg(t);
  const today = "2026-07-08";
  const range = windowRangeForKey(today);
  const msgTime = range.startAt + 3_600_000;

  // First create an order so the rollup will have data
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", {
      orderId: "O-TRUE-UP", orgId,
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

  await t.run(stampCsKeys);

  // Create a conversation for the messages
  let convId: string;
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    convId = await ctx.db.insert("conversations", {
      orgId,
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
  const defaultOrg = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: today });

  // Corrupt a rollup field
  await t.run(async (ctx) => {
    const rollups = (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === today);
    if (rollups.length > 0) {
      await ctx.db.patch(rollups[0]._id, { leadOrders: 999 }); // corrupt field
    }
  });

  // Insert a bogus sample outside the message-derived pairs
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("responseSamples", {
      orgId,
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
    const rollups = (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === today);
    const rollup = rollups.find((r: any) => r.csKey === "trueup");
    expect(rollup!.leadOrders).toBe(999); // Corrupted
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples.length).toBe(2); // 1 correct + 1 bogus
  });

  // Run trueUp action - manually do the steps
  await t.mutation(internal.rollups.rebuildSamplesForWindow, { orgId: defaultOrg, windowKey: today });
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: today });

  // Verify: rollup field is corrected (not 999)
  await t.run(async (ctx) => {
    const rollups = (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === today);
    const rollup = rollups.find((r: any) => r.csKey === "trueup");
    expect(rollup).toBeDefined();
    expect(rollup!.leadOrders).not.toBe(999);
    expect(rollup!.leadOrders).toBe(1); // One order in window
  });

  // Verify: the newly published generation hides the bogus legacy sample and
  // exposes only the correctly rebuilt pair.
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", today)).unique();
    expect(marker?.sampleRunId).toBeDefined();
    const samples = await ctx.db.query("rollupMigrationSamples")
      .withIndex("by_run_createdAt", (q) => q.eq("runId", marker!.sampleRunId!)).collect();
    expect(samples.length).toBe(1);
    expect(samples[0].inboundAt).toBe(msgTime);
    expect(samples[0].createdAt).toBe(msgTime + 10 * 60 * 1000);
  });
});

test("oldestWindowKey: returns correct window or null when empty", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  // Empty case
  const emptyResult = await t.withIdentity(adminIdentity).query(api.rollups.oldestWindowKey);
  expect(emptyResult).toBeNull();

  // Seed some orders
  const windowA = "2026-07-05";
  const windowB = "2026-07-08";
  const rangeA = windowRangeForKey(windowA);
  const rangeB = windowRangeForKey(windowB);

  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    // Insert order in window B first
    await ctx.db.insert("orders", {
      orderId: "O-B1", orgId,
      customerPhone: "6281000000100",
      customerName: "B",
      assignedCsName: "Azelia",
      productName: "Buku",
      products: "Buku",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: rangeB.startAt + 3600000,
      updatedAt: rangeB.startAt,
    } as any);

    // Insert order in window A (earlier)
    await ctx.db.insert("orders", {
      orderId: "O-A1", orgId,
      customerPhone: "6281000000101",
      customerName: "A",
      assignedCsName: "Azelia",
      productName: "Quran",
      products: "Quran",
      productsSubtotal: "200000",
      shippingCost: "0",
      total: "200000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: rangeA.startAt + 3600000,
      updatedAt: rangeA.startAt,
    } as any);
  });

  // Query should return window A
  const result = await t.withIdentity(adminIdentity).query(api.rollups.oldestWindowKey);
  expect(result).toBe(windowA);
});

test("oldestWindowKey: rejects non-admin", async () => {
  const t = convexTest(schema);
  const csIdentity = { subject: "u1", role: "cs" as const, name: "CS", email: "cs@w", csName: "Azelia" };

  await expect(
    t.withIdentity(csIdentity).query(api.rollups.oldestWindowKey)
  ).rejects.toThrow(/unauthorized|admin/);
});

test("backfillRange: resumes one bounded window at a time, including empty intervening windows", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  const windowA = "2026-07-05";
  const windowB = "2026-07-07";
  const rangeA = windowRangeForKey(windowA);
  const rangeB = windowRangeForKey(windowB);

  // Seed data in both windows
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", {
      orderId: "O-A", orgId,
      customerPhone: "6281000000102",
      customerName: "A",
      assignedCsName: "Azelia",
      productName: "Buku",
      products: "Buku",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: rangeA.startAt + 3600000,
      updatedAt: rangeA.startAt,
    } as any);

    await ctx.db.insert("orders", {
      orderId: "O-B", orgId,
      customerPhone: "6281000000103",
      customerName: "B",
      assignedCsName: "Azelia",
      productName: "Quran",
      products: "Quran",
      productsSubtotal: "200000",
      shippingCost: "0",
      total: "200000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: rangeB.startAt + 3600000,
      updatedAt: rangeB.startAt,
    } as any);
  });

  await t.run(stampCsKeys);
  const processed: string[] = [];
  let nextFromKey: string | null = windowA;
  for (let call = 0; call < 10 && nextFromKey; call++) {
    const result: any = await t.withIdentity(adminIdentity).mutation(api.rollups.backfillRange, {
      fromKey: nextFromKey, toKey: windowB,
    });
    processed.push(...result.processed);
    nextFromKey = result.nextFromKey;
  }

  expect(processed).toEqual(["2026-07-05", "2026-07-06", "2026-07-07"]);
  expect(nextFromKey).toBeNull();

  // Verify rollups were created
  const rollups = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === windowA)
  );
  expect(rollups.length).toBeGreaterThan(0);
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const emptyMarker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", "2026-07-06"))
      .unique();
    expect(emptyMarker?.schemaVersion).toBe(2);
  });
});

test("backfillRange bounds each call to one tenant window", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };

  // Seed data across 50 windows (starting from 2026-01-01)
  const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
  const windows: string[] = [];

  for (let i = 0; i < 50; i++) {
    const ts = baseDate + i * 86_400_000; // Each day
    const key = windowKeyFor(ts);
    if (!windows.includes(key)) {
      windows.push(key);
    }
  }

  // Take the first 50 unique window keys
  const windowsToUse = windows.slice(0, 50);
  const firstWindow = windowsToUse[0];
  const lastWindow = windowsToUse[windowsToUse.length - 1];

  // Seed one order per window to ensure they have data
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    for (let i = 0; i < windowsToUse.length; i++) {
      const range = windowRangeForKey(windowsToUse[i]);
      await ctx.db.insert("orders", {
        orderId: `O-${i}`, orgId,
        customerPhone: `628100000010${String(i).padStart(2, "0")}`,
        customerName: `Cust${i}`,
        assignedCsName: "Azelia",
        productName: "Buku",
        products: "Buku",
        productsSubtotal: "100000",
        shippingCost: "0",
        total: "100000",
        shippingAddress: "",
        shippingDistrict: "",
        shippingCity: "",
        source: "berdu",
        aiEligible: false,
        createdAt: range.startAt + 3600000,
        updatedAt: range.startAt,
      } as any);
    }
  });

  // A call advances exactly one window; the returned key is the durable range cursor.
  const result = await t.withIdentity(adminIdentity).mutation(api.rollups.backfillRange, {
    fromKey: firstWindow,
    toKey: lastWindow,
  });

  expect(result.processed).toEqual([firstWindow]);
  expect(result.nextFromKey).toBe(windowsToUse[1]);
});

test("backfillRange: rejects non-admin", async () => {
  const t = convexTest(schema);
  const csIdentity = { subject: "u1", role: "cs" as const, name: "CS", email: "cs@w", csName: "Azelia" };

  await expect(
    t.withIdentity(csIdentity).mutation(api.rollups.backfillRange, {
      fromKey: "2026-07-05",
      toKey: "2026-07-08",
    })
  ).rejects.toThrow(/unauthorized|admin/);
});

test("importBerduVerifiedRows: batch import of 3 recaps same CS+window yields single correct rollup row", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };
  const defaultOrg = await getDefaultOrgId(t);

  const W = "2026-07-08";
  const range = windowRangeForKey(W);
  const closedAt = range.startAt + 3_600_000;

  // Import 3 recaps all for the same CS and window (Azelia, W)
  await t.mutation(internal.shippingRecaps.importBerduVerifiedRows, {
    importBatchId: "batch-dedup-test",
    rows: [
      {
        orderIdBerdu: "O-BATCH-1",
        customerName: "Cust1",
        customerPhone: "6281000000301",
        csName: "Azelia",
        orderedAt: range.startAt + 1000,
        closedAt,
        recipientName: "Rec1",
        recipientPhone: "6281000000301",
        recipientAddress: "Addr1",
        recipientDistrict: "Dist1",
        recipientCity: "City1",
        packageContent: "Prod1",
        paymentMethod: "cod" as const,
        total: 100000,
        sourceMessageText: "Test 1",
      },
      {
        orderIdBerdu: "O-BATCH-2",
        customerName: "Cust2",
        customerPhone: "6281000000302",
        csName: "Azelia",
        orderedAt: range.startAt + 1000,
        closedAt,
        recipientName: "Rec2",
        recipientPhone: "6281000000302",
        recipientAddress: "Addr2",
        recipientDistrict: "Dist2",
        recipientCity: "City2",
        packageContent: "Prod2",
        paymentMethod: "transfer" as const,
        itemPrice: 150000,
        total: 150000,
        sourceMessageText: "Test 2",
      },
      {
        orderIdBerdu: "O-BATCH-3",
        customerName: "Cust3",
        customerPhone: "6281000000303",
        csName: "Azelia",
        orderedAt: range.startAt + 1000,
        closedAt,
        recipientName: "Rec3",
        recipientPhone: "6281000000303",
        recipientAddress: "Addr3",
        recipientDistrict: "Dist3",
        recipientCity: "City3",
        packageContent: "Prod3",
        paymentMethod: "cod" as const,
        total: 200000,
        sourceMessageText: "Test 3",
      },
    ],
  });

  // Force recompute
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });

  // Verify rollup is correct and reflects all 3 recaps
  const rows = await t.run(async (ctx) =>
    (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W && r.csKey === "azelia")
  );

  expect(rows.length).toBe(1); // Single row for azelia in this window
  const rollupRow = rows[0];

  // Verify aggregations are correct
  expect(rollupRow.closings).toBe(3); // Three recaps
  expect(rollupRow.closedCust).toBe(3); // Three distinct customers
  expect(rollupRow.revenue).toBe(100000 + 150000 + 200000); // Sum of totals
  expect(rollupRow.csName).toBe("Azelia");
  expect(rollupRow.windowKey).toBe(W);
});

test("debugRollupParity: detects when rollup data matches fresh computation", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };
  const defaultOrg = await getDefaultOrgId(t);

  const W = "2026-07-08";
  const range = windowRangeForKey(W);
  const t0 = range.startAt + 3_600_000;

  // Create minimal data with one order
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", {
      orderId: "O-PARITY", orgId,
      customerPhone: "6281000000200",
      customerName: "Parity Test",
      assignedCsName: "Tester",
      productName: "Test",
      products: "Test",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: t0,
      updatedAt: t0,
    } as any);
  });

  await t.run(stampCsKeys);
  // Compute rollup
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });

  // Check parity - should return valid results without crashing
  const result = await t.withIdentity(adminIdentity).query(api.rollups.debugRollupParity, { windowKey: W });

  expect(result.windowKey).toBe(W);
  expect(Array.isArray(result.mismatches)).toBe(true);
  expect(result.storedRows).toBeGreaterThan(0);
  expect(result.freshRows).toBeGreaterThan(0);
});

test("debugRollupParity: detects corrupted rollup field", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };
  const defaultOrg = await getDefaultOrgId(t);

  const W = "2026-07-08";
  const range = windowRangeForKey(W);
  const t0 = range.startAt + 3_600_000;

  // Create minimal data
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", {
      orderId: "O-CORRUPT", orgId,
      customerPhone: "6281000000201",
      customerName: "Corrupt Test",
      assignedCsName: "Tester2",
      productName: "Test2",
      products: "Test2",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: t0,
      updatedAt: t0,
    } as any);
  });

  await t.run(stampCsKeys);
  // Compute rollup
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });

  // Corrupt a field
  await t.run(async (ctx) => {
    const rollups = await (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W);
    const testerRollup = rollups.find((r: any) => r.csName === "Tester2");
    if (testerRollup) {
      await ctx.db.patch(testerRollup._id, { leadOrders: 999 });
    }
  });

  // Check parity - should detect the corruption
  const result = await t.withIdentity(adminIdentity).query(api.rollups.debugRollupParity, { windowKey: W });

  expect(result.mismatches.length).toBeGreaterThan(0);
  const leadOrdersMismatch = result.mismatches.find((m: any) => m.field === "leadOrders");
  expect(leadOrdersMismatch).toBeDefined();
  expect(leadOrdersMismatch!.stored).toBe(999);
  expect(leadOrdersMismatch!.fresh).toBe(1);
});

test("debugRollupParity: detects corrupted csName field", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const adminIdentity = { subject: "a1", role: "admin" as const, name: "Admin", email: "a@w" };
  const defaultOrg = await getDefaultOrgId(t);

  const W = "2026-07-08";
  const range = windowRangeForKey(W);
  const t0 = range.startAt + 3_600_000;

  // Create minimal data with a specific CS name
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("orders", {
      orderId: "O-CSNAME", orgId,
      customerPhone: "6281000000202",
      customerName: "CSName Test",
      assignedCsName: "OriginalCS",
      productName: "Test3",
      products: "Test3",
      productsSubtotal: "100000",
      shippingCost: "0",
      total: "100000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu",
      aiEligible: false,
      createdAt: t0,
      updatedAt: t0,
    } as any);
  });

  await t.run(stampCsKeys);
  // Compute rollup
  await t.mutation(internal.rollups.recomputeWindow, { orgId: defaultOrg, windowKey: W });

  // Corrupt csName field
  await t.run(async (ctx) => {
    const rollups = await (await ctx.db.query("dailyRollups").collect()).filter((r: any) => r.windowKey === W);
    const csRollup = rollups.find((r: any) => r.csName === "OriginalCS");
    if (csRollup) {
      await ctx.db.patch(csRollup._id, { csName: "CorruptedCS" });
    }
  });

  // Check parity - should detect the csName corruption
  const result = await t.withIdentity(adminIdentity).query(api.rollups.debugRollupParity, { windowKey: W });

  expect(result.mismatches.length).toBeGreaterThan(0);
  const csNameMismatch = result.mismatches.find((m: any) => m.field === "csName");
  expect(csNameMismatch).toBeDefined();
  expect(csNameMismatch!.stored).toBe("CorruptedCS");
  expect(csNameMismatch!.fresh).toBe("OriginalCS");
});

test("debugRollupParity paginates every expected and stored row", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const orgId = await getDefaultOrgId(t);
  await t.run(async (ctx) => {
    for (let index = 0; index < 30; index++) {
      const suffix = `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
      await ctx.db.insert("orders", {
        orgId, orderId: `PARITY-PAGE-${index}`, customerPhone: `6281998${String(index).padStart(6, "0")}`,
        customerName: `Parity ${index}`, assignedCsName: `Parity Agent ${suffix}`,
        productName: "Book", products: "Book", productsSubtotal: "1", shippingCost: "0", total: "1",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false,
        createdAt: t0 + index, updatedAt: t0 + index,
      } as any);
    }
  });
  let migration: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    migration = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
    if (migration.done) break;
  }
  expect(migration.done).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("dailyRollups")
      .withIndex("by_org_window_cs", (q) => q
        .eq("orgId", orgId as any).eq("windowKey", W).eq("csKey", "parityagentaa"))
      .first();
    // Add a stored-only row to exercise the second audit phase.
    await ctx.db.insert("dailyRollups", {
      orgId: orgId as any, windowKey: W, csKey: "storedextra", csName: "Stored Extra",
      leadOrders: 1, leadsCust: 1, closings: 0, closedCust: 0, cancelled: 0,
      manualClosings: 0, delivered: 0, revenue: 0, discount: 0, cod: 0, transfer: 0,
      fuClosings: 0, fuH1: 0, fuH2: 0, fuH3: 0, byProduct: [], updatedAt: Date.now(),
    });
    expect(row).toBeDefined();
  });

  const admin = t.withIdentity({ subject: "paged-parity", role: "admin", name: "Admin", email: "paged@w" });
  let source: "expected" | "stored" = "expected";
  let cursor: string | undefined;
  let expectedPages = 0;
  let done = false;
  const mismatches: Array<{ csKey: string }> = [];
  for (let pageNumber = 0; pageNumber < 10 && !done; pageNumber++) {
    const page: any = await admin.query(api.rollups.debugRollupParity, { windowKey: W, source, cursor });
    if (source === "expected") expectedPages++;
    mismatches.push(...page.mismatches);
    done = page.done;
    source = page.nextSource ?? source;
    cursor = page.nextCursor;
  }
  expect(expectedPages).toBeGreaterThan(1);
  expect(done).toBe(true);
  expect(mismatches.some((row) => row.csKey === "storedextra")).toBe(true);
});

test("debugRollupParity: rejects non-admin", async () => {
  const t = convexTest(schema);
  const csIdentity = { subject: "u1", role: "cs" as const, name: "CS", email: "cs@w", csName: "Azelia" };

  await expect(
    t.withIdentity(csIdentity).query(api.rollups.debugRollupParity, { windowKey: "2026-07-08" })
  ).rejects.toThrow(/unauthorized|admin/);
});

test("oldestWindowKey includes recap-only history", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const recapWindow = "2026-06-15";
  const closedAt = windowRangeForKey(recapWindow).startAt + 1;
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.insert("shippingRecaps", {
      orgId, customerPhone: "6281888000001", customerName: "Recap Only", csName: "Azelia",
      orderIdBerdu: "RECAP-ONLY", status: "exported", total: 1, packageContent: "Book",
      closedAt, recipientName: "Recap Only", recipientPhone: "6281888000001", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", paymentMethod: "unknown", sourceMessageText: "",
      flags: [], createdAt: closedAt, updatedAt: closedAt, version: 1,
    } as any);
  });

  const result = await t.withIdentity({ subject: "oldest-admin", role: "admin", name: "Admin", email: "oldest@w" })
    .query(api.rollups.oldestWindowKey, {});
  expect(result).toBe(recapWindow);
});

test("rollup migration resumes high-cardinality windows without publishing a partial marker", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const orgId = await getDefaultOrgId(t);
  await t.run(async (ctx) => {
    for (let index = 0; index < 80; index++) {
      await ctx.db.insert("orders", {
        orgId, orderId: `BOUNDED-${index}`, customerPhone: `6281777${String(index).padStart(6, "0")}`,
        customerName: `Bounded ${index}`, assignedCsName: "Bounded Agent", productName: `Product ${index % 3}`,
        products: `Product ${index % 3}`, productsSubtotal: "1", shippingCost: "0", total: "1",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false,
        createdAt: t0 + index, updatedAt: t0 + index,
      } as any);
    }
  });

  let result: any = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  expect(result.done).toBe(false);
  expect(result.documentsProcessed).toBeLessThanOrEqual(64);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId as any).eq("windowKey", W)).unique()).toBeNull();
  });
  for (let attempt = 0; attempt < 20 && !result.done; attempt++) {
    result = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
    expect(result.documentsProcessed).toBeLessThanOrEqual(64);
  }
  expect(result.done).toBe(true);
  await t.run(async (ctx) => {
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId as any).eq("windowKey", W)).unique();
    expect(marker?.sampleRunId).toBeDefined();
    const row = await ctx.db.query("dailyRollups")
      .withIndex("by_org_window_cs", (q) => q.eq("orgId", orgId as any).eq("windowKey", W).eq("csKey", "boundedagent"))
      .unique();
    expect(row?.leadOrders).toBe(80);
  });
});

test("rollup migration retry keeps its cursor and tenant boundary", async () => {
  const t = convexTest(schema);
  const seededA = await seedDefaultOrg(t);
  const orgA = seededA.orgId;
  const orgB = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "rollup-tenant-b", name: "Rollup Tenant B", createdAt: 2, updatedAt: 2,
  }));
  await t.run(async (ctx) => {
    for (let index = 0; index < 70; index++) {
      await ctx.db.insert("orders", {
        orgId: orgA, orderId: `RETRY-${index}`, customerPhone: `6281666${String(index).padStart(6, "0")}`,
        customerName: "Retry", assignedCsName: "Retry Agent", productName: "Book", products: "Book",
        productsSubtotal: "1", shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "",
        shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + index, updatedAt: t0 + index,
      } as any);
    }
    await ctx.db.insert("orders", {
      orgId: orgB, orderId: "TENANT-B", customerPhone: "6281999000009", customerName: "Tenant B",
      assignedCsName: "Tenant B", productName: "Book", products: "Book", productsSubtotal: "1",
      shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: false, createdAt: t0, updatedAt: t0,
    } as any);
  });

  const first: any = await t.mutation(internal.rollups.recomputeWindow, {
    orgId: String(orgA), windowKey: W,
  });
  expect(first.done).toBe(false);
  const second: any = await t.mutation(internal.rollups.recomputeWindow, {
    orgId: String(orgA), windowKey: W,
  });
  expect(second.runId).toBe(first.runId);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("rollupMigrationRuns")
      .withIndex("by_org_window", (q) => q.eq("orgId", orgB).eq("windowKey", W)).first()).toBeNull();
    expect(await ctx.db.query("dailyRollups")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgB).eq("windowKey", W)).first()).toBeNull();
  });
});

test("rollup migration failure retries from the last committed page", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const orgId = await getDefaultOrgId(t);
  let duplicateToDelete: any;
  await t.run(async (ctx) => {
    for (let index = 0; index < 70; index++) {
      await ctx.db.insert("orders", {
        orgId, orderId: `PAGE-${index}`, customerPhone: `6281444${String(index).padStart(6, "0")}`,
        customerName: "Page", assignedCsName: "Page Agent", productName: "Book", products: "Book",
        productsSubtotal: "1", shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "",
        shippingCity: "", source: "berdu", aiEligible: false, createdAt: t0 + index, updatedAt: t0 + index,
      } as any);
    }
    await ctx.db.insert("orders", {
      orgId, orderId: "AMBIGUOUS", customerPhone: "6281333000001", customerName: "One",
      assignedCsName: "Other", productName: "One", products: "One", productsSubtotal: "1",
      shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: false, createdAt: t0 + 71, updatedAt: t0 + 71,
    } as any);
    duplicateToDelete = await ctx.db.insert("orders", {
      orgId, orderId: "AMBIGUOUS", customerPhone: "6281333000002", customerName: "Two",
      assignedCsName: "Other", productName: "Two", products: "Two", productsSubtotal: "1",
      shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: false, createdAt: t0 + 72, updatedAt: t0 + 72,
    } as any);
    await ctx.db.insert("shippingRecaps", {
      orgId, customerPhone: "6281333999999", customerName: "Retry", csName: "Page Agent",
      orderIdBerdu: "AMBIGUOUS", status: "exported", total: 1, packageContent: "",
      closedAt: t0 + 100, recipientName: "Retry", recipientPhone: "6281333999999",
      recipientAddress: "", recipientDistrict: "", recipientCity: "", paymentMethod: "unknown",
      sourceMessageText: "", flags: [], createdAt: t0 + 100, updatedAt: t0 + 100, version: 1,
    } as any);
  });

  const first: any = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  expect(first.done).toBe(false);
  const beforeFailure: any = await t.run((ctx) => ctx.db.get(first.runId as any));
  await expect(t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W }))
    .rejects.toThrow(/unique/i);
  const afterFailure: any = await t.run((ctx) => ctx.db.get(first.runId as any));
  expect(afterFailure?.cursor).toBe(beforeFailure?.cursor);
  expect(afterFailure?.documentsProcessed).toBe(beforeFailure?.documentsProcessed);

  await t.run((ctx) => ctx.db.delete(duplicateToDelete));
  let result: any = first;
  for (let attempt = 0; attempt < 20 && !result.done; attempt++) {
    result = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  }
  expect(result.done).toBe(true);
});

test("response samples publish only after a multi-page generation is complete", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const orgId = await getDefaultOrgId(t);
  await t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("conversations", {
      orgId: orgId as any, orderId: "SAMPLE-PAGES", customerPhone: "6281222000001", customerName: "Samples",
      assignedCsName: "Sample Agent", status: "active", aiEnabled: false, note: "",
      createdAt: t0, updatedAt: t0,
    });
    for (let index = 0; index < 40; index++) {
      const inboundAt = t0 + index * 2_000;
      await ctx.db.insert("messages", {
        orgId: orgId as any, conversationId, orderId: "SAMPLE-PAGES", customerPhone: "6281222000001",
        direction: "inbound", role: "customer", content: "in", messageType: "text", source: "n8n",
        createdAt: inboundAt,
      });
      await ctx.db.insert("messages", {
        orgId: orgId as any, conversationId, orderId: "SAMPLE-PAGES", customerPhone: "6281222000001",
        direction: "outbound", role: "cs", content: "out", messageType: "text", source: "n8n",
        createdAt: inboundAt + 1_000,
      });
    }
  });

  let result: any = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  expect(result.done).toBe(false);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId as any).eq("windowKey", W)).unique()).toBeNull();
  });
  for (let attempt = 0; attempt < 10 && !result.done; attempt++) {
    result = await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  }
  expect(result.done).toBe(true);
  const response = await t.withIdentity({ subject: "sample-admin", role: "admin", name: "Admin", email: "sample@w" })
    .query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 100_000 });
  expect(response.overall.firstReplyCount).toBe(1);
  expect(response.cs[0].ongoingCount).toBe(40);

  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281222000001", order_id: "SAMPLE-PAGES", customerName: "Samples",
    csName: "Sample Agent", role: "customer", direction: "inbound", content: "live in",
    messageType: "text", createdAt: t0 + 90_000,
  });
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "6281222000001", order_id: "SAMPLE-PAGES", customerName: "Samples",
    csName: "Sample Agent", role: "cs", direction: "outbound", content: "live out",
    messageType: "text", createdAt: t0 + 91_000,
  });
  const liveResponse = await t.withIdentity({ subject: "sample-admin", role: "admin", name: "Admin", email: "sample@w" })
    .query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 100_000 });
  expect(liveResponse.cs[0].ongoingCount).toBe(41);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("responseSamples").collect()).toHaveLength(0);
  });
});

async function parityFixture() {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  await seed(t);
  const orgId = await getDefaultOrgId(t);
  await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  const admin = t.withIdentity({ subject: "parity-admin", role: "admin" as const, name: "Admin", email: "parity@w" });
  return { t, orgId, admin };
}

const TOP_LEVEL_V2_FACTS = [
  "leadOrders", "leadsCust", "closings", "closedCust", "cancelled", "manualClosings",
  "delivered", "revenue", "discount", "cod", "transfer", "fuClosings", "fuH1", "fuH2", "fuH3",
] as const;

test.each(TOP_LEVEL_V2_FACTS)("debugRollupParity independently detects corrupted top-level v2 fact %s", async (field) => {
  const { t, admin } = await parityFixture();
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const row = await ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", W)).first();
    if (!row) throw new Error("missing parity row");
    await ctx.db.patch(row._id, { [field]: (row[field] ?? 0) + 1 });
  });
  const result = await admin.query(api.rollups.debugRollupParity, { windowKey: W });
  expect(result.mismatches.some((m) => m.field === field)).toBe(true);
});

const PRODUCT_V2_FACTS = ["leads", "closings", "leadOrders", "revenue", "discount", "cod", "transfer"] as const;

test.each(PRODUCT_V2_FACTS)("debugRollupParity independently detects corrupted byProduct v2 fact %s", async (field) => {
  const { t, admin } = await parityFixture();
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const row = await ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", W)).first();
    if (!row?.byProduct[0]) throw new Error("missing parity product row");
    const byProduct = row.byProduct.map((product, index) => index === 0
      ? { ...product, [field]: (product[field] ?? 0) + 1 }
      : product);
    await ctx.db.patch(row._id, { byProduct });
  });
  const result = await admin.query(api.rollups.debugRollupParity, { windowKey: W });
  expect(result.mismatches.some((m) => m.field === "byProduct")).toBe(true);
});

test("debugRollupParity rejects a missing v2 completeness marker", async () => {
  const { t, admin } = await parityFixture();
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const marker = await ctx.db.query("rollupWindows").withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", W)).unique();
    if (!marker) throw new Error("missing marker fixture");
    await ctx.db.delete(marker._id);
  });
  const result = await admin.query(api.rollups.debugRollupParity, { windowKey: W });
  expect(result.mismatches.some((m) => m.field === "completenessMarker")).toBe(true);
});

test("debugRollupParity rejects a non-v2 completeness marker", async () => {
  const { t, admin } = await parityFixture();
  await t.run(async (ctx) => {
    const orgId = await requireDefaultOrgId(ctx);
    const marker = await ctx.db.query("rollupWindows").withIndex("by_org_windowKey", (q) => q.eq("orgId", orgId).eq("windowKey", W)).unique();
    if (!marker) throw new Error("missing marker fixture");
    await ctx.db.patch(marker._id, { schemaVersion: 1 });
  });
  const result = await admin.query(api.rollups.debugRollupParity, { windowKey: W });
  expect(result.mismatches.some((m) => m.field === "completenessMarker")).toBe(true);
});

test("debugRollupParity key discovery uses the same half-open end as recompute", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const orgId = await getDefaultOrgId(t);
  const range = windowRangeForKey(W);
  await t.run(async (ctx) => ctx.db.insert("orders", {
    orgId, orderId: "NEXT-WINDOW", customerPhone: "6281777999000", customerName: "Next",
    assignedCsName: "Next CS", csKey: "next", productName: "Book", products: "Book", productsSubtotal: "1",
    shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "",
    source: "berdu", aiEligible: false, createdAt: range.endAt, updatedAt: range.endAt,
  } as any));
  await t.mutation(internal.rollups.recomputeWindow, { orgId, windowKey: W });
  const result = await t.withIdentity({ subject: "boundary-admin", role: "admin", name: "Admin", email: "boundary@w" })
    .query(api.rollups.debugRollupParity, { windowKey: W });
  expect(result.freshRows).toBe(0);
  expect(result.mismatches).toEqual([]);
});
