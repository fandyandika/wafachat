import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const DAY = 86_400_000;
const t0 = 1_750_000_000_000;
const ordBase = {
  customerName: "A", products: "", productsSubtotal: "", shippingCost: "", total: "",
  shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const, aiEligible: true,
};
const recBase = {
  recipientName: "A", recipientPhone: "x", recipientAddress: "", recipientDistrict: "", recipientCity: "",
  packageContent: "Q", paymentMethod: "cod" as const, flags: [], sourceMessageText: "", version: 1,
};

test("getCsLeaderboard: per-CS metrics + delta vs prior window, ranked", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // current window [t0, t0+DAY]: CS A = 2 leads 1 closing; CS B = 1 lead 0 closing
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
    // prior window [t0-DAY, t0-1]: CS A = 1 lead 0 closing
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-0", customerPhone: "62810", assignedCsName: "CS A", productName: "Q", createdAt: t0 - DAY / 2, updatedAt: t0 });
  });

  const rows = await t.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
  expect(rows[0].csName).toBe("CS A"); // most closings first
  const a = rows.find((r) => r.csName === "CS A")!;
  expect(a.leads).toBe(2);
  expect(a.closings).toBe(1);
  expect(a.cr).toBe(50);
  expect(a.revenue).toBe(100000);
  expect(a.deltaLeads).toBe(1);    // 2 - 1
  expect(a.deltaClosings).toBe(1); // 1 - 0
});

test("getProductDifficulty: per-product CR asc, minLeads filter", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // "Hard": 4 leads, 0 closing -> CR 0 (hardest)
    for (let i = 0; i < 4; i++) await ctx.db.insert("orders", { ...ordBase, orderId: `H${i}`, customerPhone: `6280${i}`, assignedCsName: "CS A", productName: "Hard", createdAt: t0, updatedAt: t0 });
    // "Easy": 4 leads, 4 closings -> CR 100
    for (let i = 0; i < 4; i++) {
      await ctx.db.insert("orders", { ...ordBase, orderId: `E${i}`, customerPhone: `6281${i}`, assignedCsName: "CS A", productName: "Easy", createdAt: t0, updatedAt: t0 });
      await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: `E${i}`, customerPhone: `6281${i}`, customerName: "A", csName: "CS A", closedAt: t0, packageContent: "Easy", total: 1, status: "ready", createdAt: t0, updatedAt: t0 });
    }
    // "Rare": 2 leads -> filtered out (minLeads default 3)
    for (let i = 0; i < 2; i++) await ctx.db.insert("orders", { ...ordBase, orderId: `R${i}`, customerPhone: `6282${i}`, assignedCsName: "CS A", productName: "Rare", createdAt: t0, updatedAt: t0 });
  });
  const rows = await t.query(api.analytics.getProductDifficulty, { startAt: t0 - 1, endAt: t0 + DAY });
  expect(rows.length).toBe(2);               // Hard + Easy (Rare filtered)
  expect(rows[0].productName).toBe("Hard");  // CR asc -> hardest first
  expect(rows[0].cr).toBe(0);
  expect(rows[1].productName).toBe("Easy");
  expect(rows[1].cr).toBe(100);
});

test("getPeriodReport: week period, current vs prior week + per-CS", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // current week (anchor day): CS A = 2 leads, 1 closing, revenue 50000
    await ctx.db.insert("orders", { ...ordBase, orderId: "C1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "C2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "C1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 50000, status: "ready", createdAt: t0, updatedAt: t0 });
    // prior week (anchor - 7 days): 1 lead
    await ctx.db.insert("orders", { ...ordBase, orderId: "P1", customerPhone: "62820", assignedCsName: "CS A", productName: "Q", createdAt: t0 - 7 * DAY, updatedAt: t0 });
  });
  const r = await t.query(api.analytics.getPeriodReport, { period: "week", anchor: t0 });
  expect(r.leads).toBe(2);
  expect(r.closings).toBe(1);
  expect(r.revenue).toBe(50000);
  expect(r.prevLeads).toBe(1);
  expect(r.perCs[0].csName).toBe("CS A");
  expect(r.perCs[0].closings).toBe(1);
  expect(r.label).toMatch(/^Pekan /);
});

test("getDailyReport: per-CS×product, discount, CP diskon, duplicates", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // CS A: 3 leads on product Q (one is a duplicate phone), 2 closings, discount 40000 total
    await ctx.db.insert("orders", { ...ordBase, orderId: "A1", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "A2", customerPhone: "62812", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "A3", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0 + 1, updatedAt: t0 }); // dup phone of A1
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A1", customerPhone: "62811", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 25000, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A2", customerPhone: "62812", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 15000, status: "ready", createdAt: t0, updatedAt: t0 });
    // an internal/test phone lead must be excluded
    await ctx.db.insert("orders", { ...ordBase, orderId: "X1", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    // a cancelled closing must be excluded
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A9", customerPhone: "62899", customerName: "A", csName: "CS A", packageContent: "Quran Mapping", closedAt: t0, total: 100000, status: "cancelled", createdAt: t0, updatedAt: t0 });
  });

  const r = await t.query(api.analytics.getDailyReport, { startAt: t0 - 1, endAt: t0 + DAY });
  const a = r.cs.find((c) => c.csName === "CS A")!;
  expect(a.leads).toBe(2);          // 62811 (deduped) + 62812; internal phone excluded
  expect(a.duplicates).toBe(1);     // A3 shares 62811 with A1
  expect(a.closings).toBe(2);       // A1 + A2; cancelled excluded
  expect(a.cr).toBe(100);           // 2/2
  expect(a.discount).toBe(40000);   // 25000 + 15000
  expect(a.cpDiscount).toBe(20000); // 40000 / 2
  // product grouped under the canonical order name, not the SKU packageContent
  expect(a.products).toEqual([{ product: "Quran Mapping", leads: 2, closings: 2, cr: 100 }]);
  // grand totals
  expect(r.totals.leads).toBe(2);
  expect(r.totals.closings).toBe(2);
  expect(r.totals.discount).toBe(40000);
  expect(r.totals.cpDiscount).toBe(20000);
});

test("getDailyReport: per-CS totals match getCsLeaderboard (no drift)", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
  });
  const report = await t.query(api.analytics.getDailyReport, { startAt: t0, endAt: t0 + DAY });
  const board = await t.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
  for (const row of board) {
    if (row.leads === 0 && row.closings === 0) continue; // omitted in the report
    const card = report.cs.find((c) => c.csName === row.csName);
    expect(card, `card for ${row.csName}`).toBeDefined();
    expect(card!.leads).toBe(row.leads);
    expect(card!.closings).toBe(row.closings);
    expect(card!.cr).toBe(row.cr);
  }
});

test("getDailyReport: cross-window closing canonicalizes product via order (no SKU fragment)", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // lead created BEFORE the window; canonical product "Quran Mapping"
    await ctx.db.insert("orders", { ...ordBase, orderId: "OW1", customerPhone: "62830", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0 - DAY, updatedAt: t0 });
    // closing INSIDE the window; packageContent uses the SKU name; linked via orderIdBerdu
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "OW1", customerPhone: "62830", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0 + 1000, total: 50000, status: "ready", createdAt: t0, updatedAt: t0 });
  });
  const r = await t.query(api.analytics.getDailyReport, { startAt: t0, endAt: t0 + DAY });
  const a = r.cs.find((c) => c.csName === "CS A")!;
  expect(a.products).toHaveLength(1);
  expect(a.products[0].product).toBe("Quran Mapping"); // canonical, NOT "QURAN MAPPING 1 PCS"
  expect(a.products[0].closings).toBe(1);
  expect(a.products[0].leads).toBe(0); // lead is out-of-window
  expect(a.leads).toBe(0);
  expect(a.closings).toBe(1);
});
