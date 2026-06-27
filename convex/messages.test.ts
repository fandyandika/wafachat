import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

test("appendMessageFromN8n: same externalMessageId twice -> one row", async () => {
  const t = convexTest(schema);
  const args = {
    phone: "62811", order_id: "O-1", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const, content: "halo",
    messageType: "text" as const, externalMessageId: "msg_ABC", createdAt: 1000,
  };
  const first = await t.mutation(api.messages.appendMessageFromN8n, args);
  const second = await t.mutation(api.messages.appendMessageFromN8n, args);
  expect(second.deduped).toBe(true);
  expect(second.messageId).toBe(first.messageId);
  const rows = await t.run(async (ctx) =>
    ctx.db.query("messages").withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", "msg_ABC")).collect());
  expect(rows.length).toBe(1);
});

test("appendMessageFromN8n: outbound closing phrase -> exactly one recap + closing_detected event", async () => {
  const t = convexTest(schema);
  const base = {
    phone: "62811", order_id: "O-9", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const,
    content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
    messageType: "text" as const,
  };
  const r1 = await t.mutation(api.messages.appendMessageFromN8n, { ...base, externalMessageId: "m1", createdAt: 2000 });
  expect(r1.closingRecapId).toBeDefined();
  // Same order, phrase again (different message id) -> still ONE recap (dedup per order)
  await t.mutation(api.messages.appendMessageFromN8n, { ...base, externalMessageId: "m2", createdAt: 3000 });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  const events = await t.run(async (ctx) =>
    ctx.db.query("events").withIndex("by_type_createdAt", (q) => q.eq("type", "closing_detected")).collect());
  expect(events.length).toBeGreaterThanOrEqual(1);
});

test("appendMessageFromN8n: inbound with phrase -> NO recap", async () => {
  const t = convexTest(schema);
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62822", order_id: "O-10", role: "customer", direction: "inbound",
    content: "PEMESANAN BERHASIL?", messageType: "text", externalMessageId: "in1", createdAt: 2000,
  });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(0);
});

test("appendMessageFromN8n: outbound 'cod diproses' marker -> conversation closed LIVE", async () => {
  const t = convexTest(schema);
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62844", order_id: "O-44", customerName: "A", csName: "CS Aisyah",
    role: "cs", direction: "outbound", content: "*PESANAN COD DIPROSES* ya kak",
    messageType: "text", externalMessageId: "mk1", createdAt: 5000,
  });
  const conv = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", "62844")).first());
  expect(conv?.status).toBe("closed");
});

test("appendMessageFromN8n: ordinary inbound -> conversation NOT closed", async () => {
  const t = convexTest(schema);
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62845", order_id: "O-45", role: "customer", direction: "inbound",
    content: "halo kak mau tanya", messageType: "text", externalMessageId: "ord1", createdAt: 5000,
  });
  const conv = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", "62845")).first());
  expect(conv?.status).not.toBe("closed");
});

test("appendMessageFromN8n: heals 'Unknown' conversation csName when a known CS arrives", async () => {
  const t = convexTest(schema);
  // 1. Inbound with no csName -> fallback conversation assignedCsName "Unknown"
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62833", role: "customer", direction: "inbound",
    content: "halo kak", messageType: "text", externalMessageId: "h1", createdAt: 1000,
  });
  const before = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", "62833")).first());
  expect(before?.assignedCsName).toBe("Unknown");
  // 2. Outbound with a known csName -> conversation healed to that CS
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62833", csName: "Risma", role: "cs", direction: "outbound",
    content: "siap kak", messageType: "text", externalMessageId: "h2", createdAt: 2000,
  });
  const after = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", "62833")).first());
  expect(after?.assignedCsName).toBe("Risma");
  // 3. A later message with "Unknown" csName must NOT clobber the real CS
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62833", csName: "Unknown", role: "cs", direction: "outbound",
    content: "oke", messageType: "text", externalMessageId: "h3", createdAt: 3000,
  });
  const after2 = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_customerPhone_updatedAt", (q) => q.eq("customerPhone", "62833")).first());
  expect(after2?.assignedCsName).toBe("Risma");
});
