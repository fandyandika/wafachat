import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const t0 = Date.now() - 86_400_000;

test("listCs derives from csConfigs + DEFAULT_CONFIGS, NOT from orders (no 90-day scan)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    // An order whose CS has no config: must NOT appear (order-scan discovery is removed).
    await ctx.db.insert("orders", { orgId, orderId: "O1", customerPhone: "62811", customerName: "A", productName: "X", products: "X", assignedCsName: "Ghost", productsSubtotal: "100", shippingCost: "10", total: "110", shippingAddress: "Addr", shippingDistrict: "Dist", shippingCity: "City", source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    // A stored config that isn't a built-in default.
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "nabila", csName: "Nabila",
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
      createdAt: t0, updatedAt: t0,
    });
  });
  const rows = await asAdmin.query(api.cs.listCs, {});
  const keys = rows.map((r) => r.key);
  // Built-in defaults always present:
  expect(keys).toContain("aisyah");
  expect(keys).toContain("risma");
  // Stored extra present:
  expect(keys).toContain("nabila");
  // Order-only CS is NOT discovered anymore:
  expect(keys).not.toContain("ghost");
  // Default flags surface for a default-only CS (CS Aisyah default orderAutomationEnabled = true):
  expect(rows.find((r) => r.key === "aisyah")!.orderAutomationEnabled).toBe(true);
  expect(rows.find((r) => r.key === "aisyah")!.avatarUrl).toBeNull();
});

test("setCsAvatar stores avatarStorageId and replacing removes the old file", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const id1 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await asAdmin.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id1 as Id<"_storage"> });
  let cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id1);

  const id2 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await asAdmin.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id2 as Id<"_storage"> });
  cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id2);
  expect(await t.run(async (ctx) => await ctx.storage.getUrl(id1 as Id<"_storage">))).toBeNull();
});

test("clearCsAvatar removes the photo and deletes the storage object", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  const id1 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await asAdmin.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id1 as Id<"_storage"> });
  await asAdmin.mutation(api.cs.clearCsAvatar, { csName: "Aisyah" });
  const cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBeUndefined();
  expect(await t.run(async (ctx) => await ctx.storage.getUrl(id1 as Id<"_storage">))).toBeNull();
});
