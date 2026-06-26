// convex/followUp.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 5, 26, 5, 0, 0); // fixed reference
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

test("getFollowUpCandidates: ghosted >24h, not closed -> stage1", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "outbound", now - 29 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toContain("O-1");
  expect(r.stage2.length).toBe(0);
});

test("getFollowUpCandidates: closed (shippingRecap) excluded", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "outbound", now - 29 * HOUR));
    await ctx.db.insert("shippingRecaps", {
      customerPhone: "62812", customerName: "Budi", csName: "Nabila", closedAt: now - 20 * HOUR,
      recipientName: "Budi", recipientPhone: "62812", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
      createdAt: now - 20 * HOUR, updatedAt: now - 20 * HOUR,
    });
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.length).toBe(0);
});

test("getFollowUpCandidates: csName scope filters to that CS", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const c1 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    const c2 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    for (const [c, o, p] of [[c1, "O-3", "62813"], [c2, "O-4", "62814"]] as const) {
      await ctx.db.insert("messages", msg(c, o, p, "inbound", now - 30 * HOUR));
      await ctx.db.insert("messages", msg(c, o, p, "outbound", now - 29 * HOUR));
    }
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { csName: "Nabila", nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toEqual(["O-3"]);
});

test("getFollowUpCandidates: stage-2 (H+2) after stage-1 sent and 20h elapsed", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", {
      ...convBase, orderId: "O-5", customerPhone: "62815",
      followUpStage: 1, followUpStageAt: now - 26 * HOUR, // H+1 sent 26h ago
    });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-5", customerPhone: "62815" });
    // Last inbound: 30h ago (before H+1 stamp, so still silent since H+1).
    await ctx.db.insert("messages", msg(conv, "O-5", "62815", "inbound", now - 30 * HOUR));
    // Later outbound (after H+1 stamp): last message is outbound → ghosted.
    await ctx.db.insert("messages", msg(conv, "O-5", "62815", "outbound", now - 25 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage2.map((c) => c.orderId)).toContain("O-5");
  expect(r.stage1.length).toBe(0);
});
