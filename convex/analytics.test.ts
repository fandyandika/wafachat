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
