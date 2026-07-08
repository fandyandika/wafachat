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
