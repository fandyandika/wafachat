import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";

const modules = (import.meta as any).glob("/convex/**/*.{ts,js}");

test("enrichment replaces Scalev Unassigned with the mapped CS and moves its rollup", async () => {
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
    handlerId: "104794",
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
