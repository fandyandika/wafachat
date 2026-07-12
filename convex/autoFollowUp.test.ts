// convex/autoFollowUp.test.ts
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { AUTO_DAILY_CAP } from "./autoFollowUp";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WIB_OFFSET = 7 * HOUR;

// Fixed reference: 2026-06-26 05:00:00 UTC = 2026-06-26 12:00:00 WIB (noon)
const now = Date.UTC(2026, 5, 26, 5, 0, 0);

// Helper to compute WIB day number
const wibDay = (timestamp: number) => Math.floor((timestamp + WIB_OFFSET) / DAY);

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

const csCfg = (csName: string, autoFollowUpEnabled: boolean = false) => ({
  normalizedName: csName.toLowerCase().replace(/[^a-z]/g, ""), csName, providerNumberId: "PHONE123",
  orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
  autoFollowUpEnabled, isActive: true, createdAt: now, updatedAt: now,
});

test("autoFollowUpSweep: outside hours (02:00 WIB) -> skipped, no send", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-1", "62811", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-1", "62811", "outbound", now - 29 * HOUR) });
    await ctx.db.insert("csConfigs", { orgId, ...csCfg("Nabila", true) });
  });

  process.env.PANEL_AUTH_SECRET = "s3cret";
  process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  // 22:00 UTC = 05:00 WIB (outside hours: before 08:00 WIB)
  const outsideHour = Date.UTC(2026, 5, 25, 22, 0, 0);
  const res = await t.action(internal.autoFollowUp.autoFollowUpSweep, { nowOverride: outsideHour });
  expect(res.sent).toBe(0);
  expect(res.skipped).toBe("outside-hours");
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("autoFollowUpSweep: within hours, enabled CS, one ghosted H+1 lead -> sends + bumps count", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-2", customerPhone: "62812" });
    // Inbound 30h ago, outbound (in-window reply) 29h ago → eligible for H+1
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-2", "62812", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-2", "62812", "outbound", now - 29 * HOUR) });
    await ctx.db.insert("csConfigs", { orgId, ...csCfg("Nabila", true) });
  });

  process.env.PANEL_AUTH_SECRET = "s3cret";
  process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "wamid.1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(internal.autoFollowUp.autoFollowUpSweep, { nowOverride: now });
  expect(res.sent).toBe(1);
  expect(fetchMock).toHaveBeenCalledOnce();

  // Verify count was bumped
  await t.run(async (ctx) => {
    const cfg = (await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", "nabila"))
      .unique()) as Doc<"csConfigs"> | undefined;
    expect(cfg).toBeDefined();
    expect(cfg!.autoSentDay).toBe(wibDay(now));
    expect(cfg!.autoSentCount).toBe(1);
  });

  vi.unstubAllGlobals();
});

test("autoFollowUpSweep: cap reached (autoSentCount = AUTO_DAILY_CAP) -> no send", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-3", customerPhone: "62813" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-3", customerPhone: "62813" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-3", "62813", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-3", "62813", "outbound", now - 29 * HOUR) });
    // Create config with cap already reached
    await ctx.db.insert("csConfigs", {
      orgId,
      ...csCfg("Nabila", true),
      autoSentDay: wibDay(now),
      autoSentCount: AUTO_DAILY_CAP,
    });
  });

  process.env.PANEL_AUTH_SECRET = "s3cret";
  process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(internal.autoFollowUp.autoFollowUpSweep, { nowOverride: now });
  expect(res.sent).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("autoFollowUpSweep: disabled CS (autoFollowUpEnabled false) -> no send", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-4", customerPhone: "62814" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-4", customerPhone: "62814" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-4", "62814", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-4", "62814", "outbound", now - 29 * HOUR) });
    await ctx.db.insert("csConfigs", { orgId, ...csCfg("Nabila", false) }); // disabled
  });

  process.env.PANEL_AUTH_SECRET = "s3cret";
  process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(internal.autoFollowUp.autoFollowUpSweep, { nowOverride: now });
  expect(res.sent).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("autoFollowUpSweep: disabled CS (autoFollowUpEnabled undefined) -> no send", async () => {
  const t = convexTest(schema);
  let convId: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...convBase, orderId: "O-5", customerPhone: "62815" });
    await ctx.db.insert("orders", { orgId, ...orderBase, orderId: "O-5", customerPhone: "62815" });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-5", "62815", "inbound", now - 30 * HOUR) });
    await ctx.db.insert("messages", { orgId, ...msg(convId, "O-5", "62815", "outbound", now - 29 * HOUR) });
    // Create config without autoFollowUpEnabled field (defaults to undefined/false)
    const cfg = csCfg("Nabila", false);
    const { autoFollowUpEnabled, ...rest } = cfg;
    await ctx.db.insert("csConfigs", { orgId, ...rest });
  });

  process.env.PANEL_AUTH_SECRET = "s3cret";
  process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(internal.autoFollowUp.autoFollowUpSweep, { nowOverride: now });
  expect(res.sent).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
