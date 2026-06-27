import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 5, 26, 5, 0, 0);

const conv = (orderId: string, phone: string, over: Record<string, unknown> = {}) => ({
  orderId, customerPhone: phone, customerName: "Budi", assignedCsName: "Nabila",
  status: "active" as const, aiEnabled: false, note: "", createdAt: now - 10 * DAY, updatedAt: now - 10 * DAY, ...over,
});
const order = (orderId: string, phone: string) => ({
  orderId, customerPhone: phone, customerName: "Budi", assignedCsName: "Nabila", productName: "X",
  products: "X", productsSubtotal: "0", shippingCost: "0", total: "0", shippingAddress: "", shippingDistrict: "",
  shippingCity: "", source: "berdu" as const, aiEligible: false, createdAt: now - 10 * DAY, updatedAt: now,
});
const inbound = (conversationId: any, orderId: string, phone: string, createdAt: number) => ({
  conversationId, orderId, customerPhone: phone, role: "customer" as const, direction: "inbound" as const,
  content: "x", messageType: "text" as const, source: "n8n" as const, createdAt,
});
const outbound = (conversationId: any, orderId: string, phone: string, createdAt: number, content: string) => ({
  conversationId, orderId, customerPhone: phone, role: "cs" as const, direction: "outbound" as const,
  content, messageType: "text" as const, source: "panel" as const, createdAt,
});
const recap = (orderIdBerdu: string, phone: string) => ({
  orderIdBerdu, customerPhone: phone, customerName: "Budi", csName: "Nabila", closedAt: now - DAY,
  recipientName: "Budi", recipientPhone: phone, recipientAddress: "", recipientDistrict: "", recipientCity: "",
  packageContent: "X", paymentMethod: "cod" as const, status: "ready" as const, flags: [], sourceMessageText: "",
  version: 1, createdAt: now - DAY, updatedAt: now - DAY,
});

test("resolveBatch closes WON (recap) + STALE (>5d), keeps FRESH; counts correct", async () => {
  const t = convexTest(schema);
  let won: Id<"conversations">, stale: Id<"conversations">, fresh: Id<"conversations">;
  await t.run(async (ctx) => {
    won = await ctx.db.insert("conversations", conv("O-WON", "62801"));
    await ctx.db.insert("orders", order("O-WON", "62801"));
    await ctx.db.insert("shippingRecaps", recap("O-WON", "62801"));
    await ctx.db.insert("messages", inbound(won, "O-WON", "62801", now - 6 * DAY));

    stale = await ctx.db.insert("conversations", conv("O-STALE", "62802"));
    await ctx.db.insert("orders", order("O-STALE", "62802"));
    await ctx.db.insert("messages", inbound(stale, "O-STALE", "62802", now - 6 * DAY)); // last inbound 6d ago

    fresh = await ctx.db.insert("conversations", conv("O-FRESH", "62803", { updatedAt: now - HOUR }));
    await ctx.db.insert("orders", order("O-FRESH", "62803"));
    await ctx.db.insert("messages", inbound(fresh, "O-FRESH", "62803", now - 2 * HOUR)); // recent -> in funnel
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now });
  expect(r.closedWon).toBe(1);
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(won))!.status).toBe("closed");
    expect((await ctx.db.get(stale))!.status).toBe("closed");
    expect((await ctx.db.get(fresh))!.status).toBe("active");
  });
});

test("resolveBatch dryRun reports counts but mutates nothing", async () => {
  const t = convexTest(schema);
  let stale: Id<"conversations">;
  await t.run(async (ctx) => {
    stale = await ctx.db.insert("conversations", conv("O-S", "62804"));
    await ctx.db.insert("orders", order("O-S", "62804"));
    await ctx.db.insert("messages", inbound(stale, "O-S", "62804", now - 6 * DAY));
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: true, now });
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(stale))!.status).toBe("active");
  });
});

test("resolveBatch keeps a brand-new conversation with no inbound yet (not stale)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", conv("O-NEW", "62805", { createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR }));
    await ctx.db.insert("orders", order("O-NEW", "62805"));
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now });
  expect(r.closedWon + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});

test("resolveBatch: a 'done' marker (shopee) in the chat -> closedMarker + closed", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", conv("O-MK", "62820"));
    await ctx.db.insert("orders", order("O-MK", "62820"));
    await ctx.db.insert("messages", inbound(cId, "O-MK", "62820", now - 2 * HOUR)); // fresh -> not stale
    await ctx.db.insert("messages", outbound(cId, "O-MK", "62820", now - HOUR, "Silakan checkout di shopee ya kak"));
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now });
  expect(r.closedMarker).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("resolveBatch: order-less 'manual:' thread closed by a recap on the customer's PHONE", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", conv("manual:62821", "62821"));
    await ctx.db.insert("messages", inbound(cId, "manual:62821", "62821", now - 2 * HOUR)); // fresh
    await ctx.db.insert("shippingRecaps", recap("O-REALC", "62821")); // recap under a real order, same phone
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now });
  expect(r.closedWon).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("resolveBatch: real-order lead NOT closed by an OLD recap on the same phone (repeat-safe)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", conv("O-NEWD", "62822"));
    await ctx.db.insert("orders", order("O-NEWD", "62822"));
    await ctx.db.insert("messages", inbound(cId, "O-NEWD", "62822", now - 2 * HOUR)); // fresh -> not stale
    await ctx.db.insert("shippingRecaps", recap("O-OLDD", "62822")); // OLD recap, different order, same phone
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now });
  expect(r.closedWon + r.closedMarker + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});
