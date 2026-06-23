import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const t0 = Date.now() - 86_400_000;

test("listCs unions data CS + config CS and dedupes via csKey", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O1", customerPhone: "62811", customerName: "A", productName: "X", products: "X", assignedCsName: "Aisyah", productsSubtotal: "100", shippingCost: "10", total: "110", shippingAddress: "Addr", shippingDistrict: "Dist", shippingCity: "City", source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { orderId: "O2", customerPhone: "62822", customerName: "B", productName: "X", products: "X", assignedCsName: "Risma", productsSubtotal: "100", shippingCost: "10", total: "110", shippingAddress: "Addr", shippingDistrict: "Dist", shippingCity: "City", source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("csConfigs", {
      normalizedName: "csaisyah", csName: "CS Aisyah",
      orderAutomationEnabled: true, aiAssistantEnabled: true, reportingEnabled: true, isActive: true,
      createdAt: t0, updatedAt: t0,
    });
  });
  const rows = await t.query(api.cs.listCs, {});
  expect(rows.map((r) => r.key).sort()).toEqual(["aisyah", "risma"]);
  const aisyah = rows.find((r) => r.key === "aisyah")!;
  expect(aisyah.orderAutomationEnabled).toBe(true);
  expect(aisyah.avatarUrl).toBeNull();
});

test("setCsAvatar stores avatarStorageId and replacing removes the old file", async () => {
  const t = convexTest(schema);
  const id1 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await t.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id1 as Id<"_storage"> });
  let cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id1);

  const id2 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await t.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id2 as Id<"_storage"> });
  cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id2);
  expect(await t.run(async (ctx) => await ctx.storage.getUrl(id1 as Id<"_storage">))).toBeNull();
});

test("clearCsAvatar removes the photo and deletes the storage object", async () => {
  const t = convexTest(schema);
  const id1 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await t.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id1 as Id<"_storage"> });
  await t.mutation(api.cs.clearCsAvatar, { csName: "Aisyah" });
  const cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBeUndefined();
  expect(await t.run(async (ctx) => await ctx.storage.getUrl(id1 as Id<"_storage">))).toBeNull();
});
