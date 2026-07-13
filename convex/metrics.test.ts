import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { windowKeyFor } from "./lib";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const DAY = 86_400_000;
const t0 = 1_750_000_000_000; // fixed ms within a single day

test("getPerformance: leads=distinct customer, closing=distinct order, CR, cancelled excluded", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // Same customer, 2 orders -> 1 lead (distinct phone)
    for (const orderId of ["O-1", "O-2"]) {
      await ctx.db.insert("orders", {
        orgId, orderId, customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
        productName: "Quran", products: "Quran", productsSubtotal: "", shippingCost: "", total: "",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: true,
        createdAt: t0, updatedAt: t0,
      });
    }
    // One closing (valid) + one cancelled (excluded)
    await ctx.db.insert("shippingRecaps", {
      orgId, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 100000, total: 100000,
      status: "ready", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId, orderIdBerdu: "O-2", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 50000, total: 50000,
      status: "cancelled", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
  });

  const perf = await asAdmin.query(api.shippingRecaps.getPerformance, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(perf.totalLeads).toBe(1);      // distinct customer
  expect(perf.totalClosing).toBe(1);    // cancelled excluded
  expect(perf.overallCr).toBe(100);     // 1/1
});

test("getDashboardSummary: leads/closings/cr from records, handovers from events", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orgId, orderId: "O-1", customerPhone: "62811", customerName: "A",
      assignedCsName: "CS Aisyah", productName: "Quran", products: "Quran", productsSubtotal: "",
      shippingCost: "", total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A",
      csName: "CS Aisyah", closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", packageContent: "Quran", paymentMethod: "cod",
      codValue: 100000, total: 100000, status: "ready", flags: [], sourceMessageText: "", version: 1,
      createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("events", { orgId, type: "handover", actor: "n8n", orderId: "O-1",
      customerPhone: "62811", metadata: {}, createdAt: t0 });
  });

  // Populate rollups for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });

  const s = await asAdmin.query(api.metrics.getDashboardSummary, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(s.leads).toBe(1);
  expect(s.closings).toBe(1);
  expect(s.cr).toBe(100);
  expect(s.handovers).toBe(1);
});

test("getTrend: buckets leads by order-date and closings by closing-date", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orgId, orderId: "O-1", customerPhone: "62811", customerName: "A",
      assignedCsName: "CS Aisyah", productName: "Q", products: "Q", productsSubtotal: "", shippingCost: "",
      total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu",
      aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orgId, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A",
      csName: "CS Aisyah", closedAt: t0 + DAY, recipientName: "A", recipientPhone: "62811",
      recipientAddress: "", recipientDistrict: "", recipientCity: "", packageContent: "Q",
      paymentMethod: "cod", codValue: 1, total: 1, status: "ready", flags: [], sourceMessageText: "",
      version: 1, createdAt: t0, updatedAt: t0 });
  });

  // Populate rollups for windows touched by seeded data
  const windowKeys = new Set([windowKeyFor(t0), windowKeyFor(t0 + DAY)]);
  for (const windowKey of windowKeys) {
    await t.mutation(internal.rollups.recomputeWindow, { orgId: orgId, windowKey });
  }

  const trend = await asAdmin.query(api.metrics.getTrend, { startAt: t0 - DAY, endAt: t0 + 2 * DAY, bucket: "day" });
  const leadDay = trend.find((b) => b.leads === 1);
  const closeDay = trend.find((b) => b.closings === 1);
  expect(leadDay).toBeDefined();
  expect(closeDay).toBeDefined();
  expect(leadDay!.bucket).not.toBe(closeDay!.bucket); // lead day != closing day
});

test("getDuplicateOrders: groups repeat phones, flags accidental, excludes test+single+other-cs", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const base = {
    customerName: "A", products: "", productsSubtotal: "", shippingCost: "", total: "Rp1",
    shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const,
    aiEligible: true, updatedAt: t0,
  };
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // same phone + same product + consecutive ids -> accidental
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-260619000146", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-260619000147", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran", createdAt: t0 + 1 });
    // same phone, different product, far-apart ids -> NOT accidental
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-260619000200", customerPhone: "62822", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-260619000900", customerPhone: "62822", assignedCsName: "CS A", productName: "Medis", createdAt: t0 + 1 });
    // single order -> not returned
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-260619000999", customerPhone: "62833", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    // test phone -> excluded
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-T1", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { orgId, ...base, orderId: "O-T2", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran", createdAt: t0 + 1 });
  });

  const dups = await asAdmin.query(api.metrics.getDuplicateOrders, { startAt: t0 - 1, endAt: t0 + DAY });
  expect(dups.length).toBe(2);
  const acc = dups.find((d) => d.phone === "62811")!;
  const non = dups.find((d) => d.phone === "62822")!;
  expect(acc.likelyAccidental).toBe(true);   // same product + consecutive
  expect(acc.count).toBe(2);
  expect(non.likelyAccidental).toBe(false);  // diff product + far apart

  // csName filter: no orders for "CS B"
  const none = await asAdmin.query(api.metrics.getDuplicateOrders, { startAt: t0 - 1, endAt: t0 + DAY, csName: "CS B" });
  expect(none.length).toBe(0);
});
