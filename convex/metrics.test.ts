import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const DAY = 86_400_000;
const t0 = 1_750_000_000_000; // fixed ms within a single day

test("getPerformance: leads=distinct customer, closing=distinct order, CR, cancelled excluded", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // Same customer, 2 orders -> 1 lead (distinct phone)
    for (const orderId of ["O-1", "O-2"]) {
      await ctx.db.insert("orders", {
        orderId, customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
        productName: "Quran", products: "Quran", productsSubtotal: "", shippingCost: "", total: "",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: true,
        createdAt: t0, updatedAt: t0,
      });
    }
    // One closing (valid) + one cancelled (excluded)
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 100000, total: 100000,
      status: "ready", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-2", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 50000, total: 50000,
      status: "cancelled", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
  });

  const perf = await t.query(api.shippingRecaps.getPerformance, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(perf.totalLeads).toBe(1);      // distinct customer
  expect(perf.totalClosing).toBe(1);    // cancelled excluded
  expect(perf.overallCr).toBe(100);     // 1/1
});

test("getDashboardSummary: leads/closings/cr from records, handovers from events", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-1", customerPhone: "62811", customerName: "A",
      assignedCsName: "CS Aisyah", productName: "Quran", products: "Quran", productsSubtotal: "",
      shippingCost: "", total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A",
      csName: "CS Aisyah", closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", packageContent: "Quran", paymentMethod: "cod",
      codValue: 100000, total: 100000, status: "ready", flags: [], sourceMessageText: "", version: 1,
      createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("events", { type: "handover", actor: "n8n", orderId: "O-1",
      customerPhone: "62811", metadata: {}, createdAt: t0 });
  });
  const s = await t.query(api.metrics.getDashboardSummary, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(s.leads).toBe(1);
  expect(s.closings).toBe(1);
  expect(s.cr).toBe(100);
  expect(s.handovers).toBe(1);
});
