import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { windowKeyFor, windowRangeForKey } from "./lib";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  // Use window-aligned ranges to ensure proper period separation
  const curWindow = windowRangeForKey(windowKeyFor(t0));
  const priorWindow = windowRangeForKey(windowKeyFor(t0 - DAY)); // Exactly 1 window back (DAY = window duration)
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // current window: CS A = 2 leads 1 closing; CS B = 1 lead 0 closing
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: curWindow.startAt + 100, updatedAt: curWindow.startAt + 100 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: curWindow.startAt + 100, updatedAt: curWindow.startAt + 100 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: curWindow.startAt + 100, updatedAt: curWindow.startAt + 100 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: curWindow.startAt + 100, total: 100000, status: "ready", createdAt: curWindow.startAt + 100, updatedAt: curWindow.startAt + 100 });
    // prior window: CS A = 1 lead 0 closing
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-0", customerPhone: "62810", assignedCsName: "CS A", productName: "Q", createdAt: priorWindow.startAt + 100, updatedAt: priorWindow.startAt + 100 });
  });

  // Populate rollups for windows touched by seeded data
  const windowKeys = new Set([windowKeyFor(curWindow.startAt), windowKeyFor(priorWindow.startAt)]);
  for (const windowKey of windowKeys) {
    await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });
  }

  const rows = await asAdmin.query(api.analytics.getCsLeaderboard, { startAt: curWindow.startAt, endAt: curWindow.endAt });
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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // "Hard": 4 leads, 0 closing -> CR 0 (hardest)
    for (let i = 0; i < 4; i++) await ctx.db.insert("orders", { orgId, ...ordBase, orderId: `H${i}`, customerPhone: `6280${i}`, assignedCsName: "CS A", productName: "Hard", createdAt: t0, updatedAt: t0 });
    // "Easy": 4 leads, 4 closings -> CR 100
    for (let i = 0; i < 4; i++) {
      await ctx.db.insert("orders", { orgId, ...ordBase, orderId: `E${i}`, customerPhone: `6281${i}`, assignedCsName: "CS A", productName: "Easy", createdAt: t0, updatedAt: t0 });
      await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: `E${i}`, customerPhone: `6281${i}`, customerName: "A", csName: "CS A", closedAt: t0, packageContent: "Easy", total: 1, status: "ready", createdAt: t0, updatedAt: t0 });
    }
    // "Rare": 2 leads -> filtered out (minLeads default 3)
    for (let i = 0; i < 2; i++) await ctx.db.insert("orders", { orgId, ...ordBase, orderId: `R${i}`, customerPhone: `6282${i}`, assignedCsName: "CS A", productName: "Rare", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const rows = await asAdmin.query(api.analytics.getProductDifficulty, { startAt: t0 - 1, endAt: t0 + DAY });
  expect(rows.length).toBe(2);               // Hard + Easy (Rare filtered)
  expect(rows[0].productName).toBe("Hard");  // CR asc -> hardest first
  expect(rows[0].cr).toBe(0);
  expect(rows[1].productName).toBe("Easy");
  expect(rows[1].cr).toBe(100);
});

test("getPeriodReport: week period, current vs prior week + per-CS", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  // Use specific dates: June 21 (Monday) for anchor, so June 14 (previous Monday) is prior week
  const anchor = Date.parse("2026-06-21T16:01:00+07:00"); // Just after 16:00 WIB on Monday
  const curWeekStart = windowRangeForKey(windowKeyFor(anchor));

  // Place the comparison row inside the immediately preceding calendar week.
  const priorWeekStart = windowRangeForKey(windowKeyFor(anchor - 7 * DAY));

  // Populate ALL windows that might be queried
  const allWindowsNeeded = new Set<string>();
  // Current week: populate all 8 potential windows (week might span 8 16:00-WIB windows due to boundary)
  for (let i = 0; i < 8; i++) {
    allWindowsNeeded.add(windowKeyFor(curWeekStart.startAt + i * DAY));
  }
  // Prior week: populate all 8 potential windows
  for (let i = 0; i < 8; i++) {
    allWindowsNeeded.add(windowKeyFor(priorWeekStart.startAt + i * DAY));
  }

  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // current week: CS A = 2 leads, 1 closing, revenue 50000
    // Place data clearly at the start of the current week window
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "C1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: curWeekStart.startAt + 100, updatedAt: curWeekStart.startAt + 100 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "C2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: curWeekStart.startAt + 100, updatedAt: curWeekStart.startAt + 100 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "C1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: curWeekStart.startAt + 100, total: 50000, status: "ready", createdAt: curWeekStart.startAt + 100, updatedAt: curWeekStart.startAt + 100 });
    // prior week: 1 lead
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "P1", customerPhone: "62820", assignedCsName: "CS A", productName: "Q", createdAt: priorWeekStart.startAt + 100, updatedAt: priorWeekStart.startAt + 100 });
  });

  // Populate all necessary rollups
  for (const windowKey of allWindowsNeeded) {
    await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });
  }

  const r = await asAdmin.query(api.analytics.getPeriodReport, { period: "week", anchor });
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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // CS A: 3 leads on product Q (one is a duplicate phone), 2 closings, discount 40000 total
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "A1", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "A2", customerPhone: "62812", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "A3", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0 + 1, updatedAt: t0 }); // dup phone of A1
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "A1", customerPhone: "62811", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 25000, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "A2", customerPhone: "62812", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 15000, status: "ready", createdAt: t0, updatedAt: t0 });
    // an internal/test phone lead must be excluded
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "X1", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    // a cancelled closing must be excluded
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "A9", customerPhone: "62899", customerName: "A", csName: "CS A", packageContent: "Quran Mapping", closedAt: t0, total: 100000, status: "cancelled", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const r = await asAdmin.query(api.analytics.getDailyReport, { startAt: t0 - 1, endAt: t0 + DAY });
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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const report = await asAdmin.query(api.analytics.getDailyReport, { startAt: t0, endAt: t0 + DAY });
  const board = await asAdmin.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // lead created BEFORE the window; canonical product "Quran Mapping"
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "OW1", customerPhone: "62830", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0 - DAY, updatedAt: t0 });
    // closing INSIDE the window; packageContent uses the SKU name; linked via orderIdBerdu
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "OW1", customerPhone: "62830", customerName: "A", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0 + 1000, total: 50000, status: "ready", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window containing the closing (t0)
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const r = await asAdmin.query(api.analytics.getDailyReport, { startAt: t0, endAt: t0 + DAY });
  const a = r.cs.find((c) => c.csName === "CS A")!;
  expect(a.products).toHaveLength(1);
  expect(a.products[0].product).toBe("Quran Mapping"); // canonical, NOT "QURAN MAPPING 1 PCS"
  expect(a.products[0].closings).toBe(1);
  expect(a.products[0].leads).toBe(0); // lead is out-of-window
  expect(a.leads).toBe(0);
  expect(a.closings).toBe(1);
});

test("getCsLeaderboard honors csName via csKey (CS Aisyah == Aisyah)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const t0_new = Date.parse("2026-06-22T10:00:00+07:00");
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O1", customerPhone: "62811", customerName: "A", productName: "Quran Mapping", assignedCsName: "Aisyah", createdAt: t0_new, updatedAt: t0_new });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "O2", customerPhone: "62822", customerName: "B", productName: "Quran Mapping", assignedCsName: "Risma", createdAt: t0_new, updatedAt: t0_new });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0_new);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const start = Date.parse("2026-06-22T00:00:00+07:00");
  const end = Date.parse("2026-06-23T00:00:00+07:00");
  const all = await asAdmin.query(api.analytics.getCsLeaderboard, { startAt: start, endAt: end });
  expect(all.length).toBe(2);
  const filtered = await asAdmin.query(api.analytics.getCsLeaderboard, { startAt: start, endAt: end, csName: "CS Aisyah" });
  expect(filtered.length).toBe(1);
  expect(filtered[0].csName).toBe("Aisyah");
});

test("getDailyReport merges raw name variants of one CS into a single card (no fragmentation)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // Same CS, two raw name-forms: orders + main recap use "Aisyah"; one stray recap "CS Aisyah".
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "V-1", customerPhone: "62831", assignedCsName: "Aisyah", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "V-2", customerPhone: "62832", assignedCsName: "Aisyah", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "V-1", customerPhone: "62831", customerName: "A", csName: "Aisyah", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "V-9", customerPhone: "62839", customerName: "B", csName: "CS Aisyah", closedAt: t0, total: 50000, status: "ready", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const r = await asAdmin.query(api.analytics.getDailyReport, { startAt: t0 - 1, endAt: t0 + DAY });
  const aisyah = r.cs.filter((c: { csName: string }) => /aisyah/i.test(c.csName));
  expect(aisyah.length).toBe(1); // ONE merged card, not two
  expect(aisyah[0].leads).toBe(2); // unique order customers
  expect(aisyah[0].closings).toBe(2); // both recaps counted across the two name-forms
});

test("getPeriodReport honors csName via csKey (CS Aisyah == Aisyah)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const t0_new = Date.parse("2026-06-22T10:00:00+07:00");
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // current week: CS Aisyah = 2 leads, 1 closing, revenue 50000; CS Risma = 1 lead, 0 closing
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "C1", customerPhone: "62811", assignedCsName: "Aisyah", productName: "Q", createdAt: t0_new, updatedAt: t0_new });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "C2", customerPhone: "62812", assignedCsName: "Aisyah", productName: "Q", createdAt: t0_new, updatedAt: t0_new });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "C3", customerPhone: "62813", assignedCsName: "Risma", productName: "Q", createdAt: t0_new, updatedAt: t0_new });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "C1", customerPhone: "62811", customerName: "A", csName: "Aisyah", closedAt: t0_new, total: 50000, status: "ready", createdAt: t0_new, updatedAt: t0_new });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0_new);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const anchor = t0_new;
  // Query all CSs
  const allReport = await asAdmin.query(api.analytics.getPeriodReport, { period: "week", anchor });
  expect(allReport.leads).toBe(3);
  expect(allReport.closings).toBe(1);
  expect(allReport.revenue).toBe(50000);
  expect(allReport.perCs.length).toBe(2);

  // Query filtered by "CS Aisyah" (should match normalized "Aisyah")
  const aisyahReport = await asAdmin.query(api.analytics.getPeriodReport, { period: "week", anchor, csName: "CS Aisyah" });
  expect(aisyahReport.leads).toBe(2);
  expect(aisyahReport.closings).toBe(1);
  expect(aisyahReport.revenue).toBe(50000);
  expect(aisyahReport.perCs.length).toBe(1);
  expect(aisyahReport.perCs[0].csName).toBe("Aisyah");
  expect(aisyahReport.perCs[0].leads).toBe(2);
  expect(aisyahReport.perCs[0].closings).toBe(1);

  // Query filtered by "Risma" (exact match)
  const rismaReport = await asAdmin.query(api.analytics.getPeriodReport, { period: "week", anchor, csName: "Risma" });
  expect(rismaReport.leads).toBe(1);
  expect(rismaReport.closings).toBe(0);
  expect(rismaReport.revenue).toBe(0);
  expect(rismaReport.perCs.length).toBe(1);
  expect(rismaReport.perCs[0].csName).toBe("Risma");
});

test("CR uses unique CUSTOMERS: an order-double closing twice does not inflate the rate", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // CS A: 2 unique customers; customer 62811 double-orders and BOTH orders close.
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "D-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "D-2", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0 + 1000, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "D-3", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "D-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "D-2", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0 + 2000, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  // Daily report: closings stay order-level (volume: 2), CR is customer-level (1 of 2 leads = 50%).
  const daily = await asAdmin.query(api.analytics.getDailyReport, { startAt: t0 - 1, endAt: t0 + DAY });
  const a = daily.cs.find((c: { csName: string }) => c.csName === "CS A")!;
  expect(a.leads).toBe(2);
  expect(a.closings).toBe(2); // both orders count as volume + revenue
  expect(a.cr).toBe(50); // NOT 100 — one unique customer closed out of two leads
  expect(daily.totals.cr).toBe(50);

  // Leaderboard mirrors the same CR semantics.
  const rows = await asAdmin.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
  expect(rows[0].cr).toBe(50);
});

test("getCsDetail: counted closings match card semantics; cancelled + boundary surfaced; leads with double count", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const H = 3_600_000;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // Leads: 3 orders, 2 unique customers (62841 doubles)
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "W-1", customerPhone: "62841", assignedCsName: "CS A", productName: "Q", createdAt: t0 + H, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "W-2", customerPhone: "62841", assignedCsName: "CS A", productName: "Q", createdAt: t0 + 2 * H, updatedAt: t0 });
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "W-3", customerPhone: "62842", assignedCsName: "CS A", productName: "Q", createdAt: t0 + 3 * H, updatedAt: t0 });
    // Closings: 2 counted, 1 cancelled (excluded), 1 outside window (boundary after)
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "W-1", customerPhone: "62841", customerName: "A", csName: "CS A", closedAt: t0 + 4 * H, total: 100, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "W-3", customerPhone: "62842", customerName: "B", csName: "CS A", closedAt: t0 + 5 * H, total: 200, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "W-9", customerPhone: "62849", customerName: "C", csName: "CS A", closedAt: t0 + 6 * H, total: 300, status: "cancelled", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, ...recBase, orderIdBerdu: "W-8", customerPhone: "62848", customerName: "D", csName: "CS A", closedAt: t0 + DAY + H, total: 400, status: "ready", createdAt: t0, updatedAt: t0 });
    // Other CS in window must not leak in
    await ctx.db.insert("orders", { orgId, ...ordBase, orderId: "X-1", customerPhone: "62851", assignedCsName: "CS B", productName: "Q", createdAt: t0 + H, updatedAt: t0 });
  });
  const d = await asAdmin.query(api.analytics.getCsDetail, { startAt: t0, endAt: t0 + DAY, csName: "CS A" });
  expect(d.counts).toEqual({ closings: 2, leadsUnique: 2, leadOrders: 3 });
  expect(d.closings.map((c: { orderIdBerdu: string | null }) => c.orderIdBerdu)).toEqual(["W-1", "W-3"]);
  expect(d.excludedCancelled).toHaveLength(1);
  expect(d.excludedCancelled[0].customerName).toBe("C");
  expect(d.boundary).toHaveLength(1);
  expect(d.boundary[0].when).toBe("after");
  const dbl = d.leads.filter((l: { orderCount: number }) => l.orderCount === 2);
  expect(dbl).toHaveLength(2); // both rows of the doubling customer flagged
});
