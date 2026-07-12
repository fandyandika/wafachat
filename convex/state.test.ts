import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { startOfJakartaDayMs, csKey } from "./lib";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const base = { orgId, customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "H", customerPhone: "62812", status: "handover", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CO", customerPhone: "62814", status: "closed", updatedAt: now - 2 * DAY });
  });

  const rows = await t.query(internal.state.listConversations, { includeClosed: true });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811"); // active
  expect(phones).toContain("62812"); // handover
  expect(phones).toContain("62813"); // closed TODAY
  expect(phones).not.toContain("62814"); // closed 2 days ago -> excluded by DB bound
});

test("listConversations: includeClosed=false omits closed entirely", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const base = { orgId, customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
  });
  const rows = await t.query(internal.state.listConversations, { includeClosed: false });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811");
  expect(phones).not.toContain("62813");
});

test("listOrderCountersByPrefix returns sorted present counters for the date prefix only", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const base = { orgId, customerPhone: "62811", customerName: "X", productName: "P", products: "P", productsSubtotal: "1", shippingCost: "0", total: "1", shippingAddress: "", shippingDistrict: "", shippingCity: "", assignedCsName: "Risma", source: "berdu" as const, aiEligible: false, updatedAt: now, createdAt: now };
    await ctx.db.insert("orders", { ...base, orderId: "O-260624000009" });
    await ctx.db.insert("orders", { ...base, orderId: "O-260624000010" });
    await ctx.db.insert("orders", { ...base, orderId: "O-260624000012" }); // gap at 11
    await ctx.db.insert("orders", { ...base, orderId: "O-260623000005" }); // different day -> excluded
  });
  const res = await t.query(internal.state.listOrderCountersByPrefix, { datePrefix: "260624" });
  expect(res.counters).toEqual([9, 10, 12]);
  expect(res.min).toBe(9);
  expect(res.max).toBe(12);
  expect(res.count).toBe(3);
});

test("upsertOrderFromN8n honors explicit createdAt on insert (reconciler backfill keeps real order time)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const backdated = Date.UTC(2026, 5, 23, 18, 10, 43); // real Berdu order time, not now
  await t.mutation(internal.state.upsertOrderFromN8n, { phone: "6285735647633", csName: "Risma", order_id: "O-260624000009", createdAt: backdated });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-260624000009")).unique());
  expect(order?.createdAt).toBe(backdated);
});

test("upsertOrderCore stores csKey = csKey(assignedCsName) for a raw name variant", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.mutation(internal.state.upsertOrderFromN8n, { phone: "6285735647634", csName: "CS Aisyah", order_id: "O-CSKEY-1", createdAt: Date.UTC(2026, 6, 7, 10, 0, 0) });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-CSKEY-1")).unique());
  expect(order?.csKey).toBe(csKey("CS Aisyah"));
  // the csKey index returns this order for its csKey slice
  const viaIndex = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_csKey_createdAt", (q) => q.eq("csKey", csKey("CS Aisyah"))).collect());
  expect(viaIndex.some((o) => o.orderId === "O-CSKEY-1")).toBe(true);
});

test("upsertOrderFromN8n updates explicit createdAt on existing order", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const replayedAt = Date.parse("2026-07-07T14:15:45.000Z");
  const orderedAt = Date.parse("2026-07-07T12:45:04.316Z");
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647633",
    csName: "Nabila",
    order_id: "O-260707000251",
    createdAt: replayedAt,
  });
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647633",
    csName: "Nabila",
    order_id: "O-260707000251",
    createdAt: orderedAt,
  });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-260707000251")).unique());
  const conversation = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_orderId", (q) => q.eq("orderId", "O-260707000251")).unique());
  expect(order?.createdAt).toBe(orderedAt);
  expect(conversation?.createdAt).toBe(orderedAt);
});

test("orgId stamping: created rows carry orgId when org seeded", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });

  // Seed the default org
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(orgId).not.toBeNull();

  // Create a conversation via createTestConversation — should stamp orgId
  const result = await asAdmin.mutation(api.state.createTestConversation, { phone: "6281234567890" });
  const createdConversation = await t.run(async (ctx) =>
    ctx.db.get(result.conversationId));
  expect(createdConversation?.orgId).toBe(orgId);
});

test("canonical stamp: upsertOrderCore via alias resolves to canonical csName + immutable key", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  // Seed registry: Aisyah with key "aisyah", alias "CS Aisyah"
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: ["CS Aisyah"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  // Create order via upsertOrderFromN8n with alias form "CS Aisyah"
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647635", csName: "CS Aisyah", order_id: "O-CANONICAL-1", createdAt: Date.UTC(2026, 6, 7, 10, 0, 0),
  });
  // Verify: stored order has canonical csName "Aisyah" and immutable key "aisyah"
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-CANONICAL-1")).unique());
  expect(order?.assignedCsName).toBe("Aisyah");
  expect(order?.csKey).toBe("aisyah");
});
