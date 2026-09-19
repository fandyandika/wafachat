import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";

const modules = (import.meta as any).glob("/convex/**/*.{ts,js}");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.SCALEV_API_KEY;
  delete process.env.PANEL_AUTH_SECRET;
});

test.each(["missing-handler", "rate-limit", "server-error", "network-error", "timeout"])("enrichment recovers from %s", async (failure) => {
  vi.useFakeTimers();
  process.env.SCALEV_API_KEY = "test-key";
  const request = vi.fn();
  if (failure === "network-error") request.mockRejectedValueOnce(new TypeError("fetch failed"));
  else if (failure === "timeout") request.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
  else request.mockResolvedValueOnce(new Response(JSON.stringify({ id: "order-retry", handler: null }), {
    status: failure === "rate-limit" ? 429 : failure === "server-error" ? 503 : 200,
  }));
  request.mockResolvedValueOnce(new Response(JSON.stringify({
      id: "order-retry",
      handler: { id: 104794, fullname: "Aisyah" },
    }), { status: 200 }));
  vi.stubGlobal("fetch", request);

  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx: any) => {
    const id = await ctx.db.insert("organizations", {
      slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId: id, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah",
      scalevHandlerIds: ["104794"], orderAutomationEnabled: true, aiAssistantEnabled: false,
      reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("orders", {
      orgId: id, orderId: "scalev:order-retry", externalOrderId: "260907001", providerRecordId: "order-retry",
      customerPhone: "6285550000099", customerName: "Customer", assignedCsName: "Scalev Unassigned",
      csKey: "scalevunassigned", productName: "Paket Lengkap Seri Aduh!", products: "Paket Lengkap Seri Aduh! (1x)",
      productsSubtotal: "Rp179.000", shippingCost: "Rp10.000", total: "Rp189.000",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "scalev",
      aiEligible: false, createdAt: 1, updatedAt: 1,
    });
    return id;
  });

  const first = await t.action((internal as any).ingest.scalevEnrichmentActions.enrichOrder, {
    orgId, orderId: "scalev:order-retry", providerRecordId: "order-retry",
  });
  expect(first.status).toBe(failure === "missing-handler" ? "unassigned" : "retrying");

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const order = await t.run((ctx: any) => ctx.db
    .query("orders")
    .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "scalev:order-retry"))
    .unique());
  expect(request).toHaveBeenCalledTimes(2);
  expect(order).toMatchObject({ assignedCsName: "Aisyah", csKey: "aisyah" });
});

test("authorized maintenance action backfills existing unassigned orders", async () => {
  process.env.PANEL_AUTH_SECRET = "maintenance-secret";
  process.env.SCALEV_API_KEY = "test-key";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    id: "order-backfill",
    handler: { id: 104794, fullname: "Aisyah" },
  }), { status: 200 })));

  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx: any) => {
    const id = await ctx.db.insert("organizations", {
      slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId: id, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah",
      scalevHandlerIds: ["104794"], orderAutomationEnabled: true, aiAssistantEnabled: false,
      reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("orders", {
      orgId: id, orderId: "scalev:order-backfill", providerRecordId: "order-backfill",
      customerPhone: "6285550000088", customerName: "Customer", assignedCsName: "Scalev Unassigned",
      csKey: "scalevunassigned", productName: "Paket Lengkap Seri Aduh!", products: "Paket Lengkap Seri Aduh! (1x)",
      productsSubtotal: "Rp179.000", shippingCost: "Rp10.000", total: "Rp189.000",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "scalev",
      aiEligible: false, createdAt: 1, updatedAt: 1,
    });
    return id;
  });

  await expect(t.action((api as any).ingest.scalevEnrichmentActions.backfillUnassignedAdmin, {
    authSecret: "wrong", orgId, limit: 10,
  })).rejects.toThrow("unauthorized");

  const result = await t.action((api as any).ingest.scalevEnrichmentActions.backfillUnassignedAdmin, {
    authSecret: "maintenance-secret", orgId, limit: 10,
  });
  expect(result).toMatchObject({ scanned: 1, updated: 1 });
});

test("authorized maintenance action renames an agent, preserves its identity, maps the new handler, and backfills", async () => {
  process.env.PANEL_AUTH_SECRET = "maintenance-secret";
  process.env.SCALEV_API_KEY = "test-key";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    id: "order-safa",
    handler: { id: 581746, fullname: "Safa" },
  }), { status: 200 })));

  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx: any) => {
    const id = await ctx.db.insert("organizations", {
      slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId: id, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: [],
      scalevHandlerIds: ["104794"], orderAutomationEnabled: true, aiAssistantEnabled: false,
      reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("orders", {
      orgId: id, orderId: "scalev:order-safa", providerRecordId: "order-safa",
      customerPhone: "6285550000077", customerName: "Customer", assignedCsName: "Scalev Unassigned",
      csKey: "scalevunassigned", productName: "Quran Mapping", products: "Quran Mapping (1x)",
      productsSubtotal: "Rp179.000", shippingCost: "Rp10.000", total: "Rp189.000",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "scalev",
      aiEligible: false, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId: id, orderIdBerdu: "scalev:order-safa", customerPhone: "6285550000077", customerName: "Customer",
      csName: "Scalev Unassigned", csKey: "scalevunassigned", closedAt: 2,
      recipientName: "Customer", recipientPhone: "6285550000077", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod",
      total: 189000, status: "ready", closingBucket: "counted", flags: [], sourceMessageText: "",
      version: 1, createdAt: 2, updatedAt: 2,
    });
    return id;
  });

  const result = await t.action((api as any).ingest.scalevEnrichmentActions.configureAgentAndBackfillAdmin, {
    authSecret: "maintenance-secret", orgId, fromCsName: "Aisyah", toCsName: "Safa",
    scalevHandlerIds: ["104794", "581746"], limit: 100,
  });
  expect(result).toMatchObject({ csName: "Safa", stableKey: "aisyah", scanned: 1, updated: 1 });

  const state = await t.run(async (ctx: any) => ({
    config: await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "safa")).unique(),
    order: await ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "scalev:order-safa")).unique(),
    recap: await ctx.db.query("shippingRecaps").withIndex("by_org_orderIdBerdu", (q: any) => q.eq("orgId", orgId).eq("orderIdBerdu", "scalev:order-safa")).unique(),
  }));
  expect(state.config).toMatchObject({
    csName: "Safa", key: "aisyah", nameAliases: ["Aisyah"], scalevHandlerIds: ["104794", "581746"],
  });
  expect(state.order).toMatchObject({ assignedCsName: "Safa", csKey: "aisyah" });
  expect(state.recap).toMatchObject({ csName: "Safa", csKey: "aisyah" });
});

test("enrichment falls back to the Scalev handler name when its API id is not mapped", async () => {
  const t = convexTest(schema, modules);
  const at = Date.parse("2026-08-30T09:00:00+07:00");
  const orgId = await t.run(async (ctx: any) => {
    const id = await ctx.db.insert("organizations", {
      slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId: id, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah",
      scalevHandlerIds: ["104794"], orderAutomationEnabled: true, aiAssistantEnabled: false,
      reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("orders", {
      orgId: id, orderId: "scalev:order-1", externalOrderId: "260830001", providerRecordId: "order-1",
      customerPhone: "6285550000001", customerName: "Customer", assignedCsName: "Scalev Unassigned",
      csKey: "scalevunassigned", productName: "Quran Mapping", products: "Quran Mapping (1x)",
      productsSubtotal: "Rp179.000", shippingCost: "Rp10.000", total: "Rp189.000",
      shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "scalev",
      aiEligible: false, createdAt: at, updatedAt: at,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId: id, orderIdBerdu: "scalev:order-1", customerPhone: "6285550000001", customerName: "Customer",
      csName: "Scalev Unassigned", csKey: "scalevunassigned", closedAt: at + 1_000,
      recipientName: "Customer", recipientPhone: "6285550000001", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod",
      total: 189000, status: "ready", closingBucket: "counted", flags: [], sourceMessageText: "",
      version: 1, createdAt: at + 1_000, updatedAt: at + 1_000,
    });
    return id;
  });

  await t.mutation((internal as any).ingest.scalevEnrichment.applyEnrichedHandler, {
    orgId,
    orderId: "scalev:order-1",
    handlerId: "581746",
    handlerName: "Aisyah",
  });

  const state = await t.run(async (ctx: any) => ({
    order: await ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "scalev:order-1")).unique(),
    conversations: await ctx.db.query("conversations").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "scalev:order-1")).collect(),
    recaps: await ctx.db.query("shippingRecaps").withIndex("by_org_orderIdBerdu", (q: any) => q.eq("orgId", orgId).eq("orderIdBerdu", "scalev:order-1")).collect(),
    rollups: await ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId)).collect(),
  }));

  expect(state.order).toMatchObject({ assignedCsName: "Aisyah", csKey: "aisyah" });
  expect(state.conversations).toHaveLength(1);
  expect(state.conversations[0]).toMatchObject({ assignedCsName: "Aisyah" });
  expect(state.recaps[0]).toMatchObject({ csName: "Aisyah", csKey: "aisyah", orderSource: "scalev" });
  expect(state.rollups.some((row: any) => row.csKey === "aisyah" && row.leadsCust === 1)).toBe(true);
  expect(state.rollups.some((row: any) => row.csKey === "scalevunassigned" && row.leadsCust > 0)).toBe(false);
});
