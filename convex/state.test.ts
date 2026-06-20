import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { startOfJakartaDayMs } from "./lib";

const DAY = 86_400_000;

test("startOfJakartaDayMs: Jakarta midnight <= now and within today", () => {
  const now = Date.now();
  const start = startOfJakartaDayMs(now);
  expect(start).toBeLessThanOrEqual(now);
  expect(now - start).toBeLessThan(DAY);
  // (start + 7h) is exactly a UTC day boundary -> Jakarta 00:00
  expect((start + 7 * 60 * 60 * 1000) % DAY).toBe(0);
});

test("listConversations: closed bounded to today (Jakarta); active+handover always", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  await t.run(async (ctx) => {
    const base = { customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "H", customerPhone: "62812", status: "handover", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CO", customerPhone: "62814", status: "closed", updatedAt: now - 2 * DAY });
  });

  const rows = await t.query(api.state.listConversations, { includeClosed: true });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811"); // active
  expect(phones).toContain("62812"); // handover
  expect(phones).toContain("62813"); // closed TODAY
  expect(phones).not.toContain("62814"); // closed 2 days ago -> excluded by DB bound
});

test("listConversations: includeClosed=false omits closed entirely", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  await t.run(async (ctx) => {
    const base = { customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
  });
  const rows = await t.query(api.state.listConversations, { includeClosed: false });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811");
  expect(phones).not.toContain("62813");
});
