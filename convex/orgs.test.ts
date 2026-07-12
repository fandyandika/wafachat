import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { getDefaultOrgId, requireDefaultOrgId } from "./orgs";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("getDefaultOrgId: null before seed; resolves after; requireDefaultOrgId throws before", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    expect(await getDefaultOrgId(ctx)).toBeNull();
    await expect(requireDefaultOrgId(ctx)).rejects.toThrow(/org not seeded/);
  });
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(r.seeded).toBe(true);
  await t.run(async (ctx) => {
    const id = await getDefaultOrgId(ctx);
    expect(id).not.toBeNull();
    expect(await requireDefaultOrgId(ctx)).toEqual(id);
  });
});

test("seedDefaultOrg: idempotent, single row, name follows orgSettings fallback", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const first = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const second = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(first.seeded).toBe(true);
  expect(second.seeded).toBe(false);
  expect(second.orgId).toEqual(first.orgId);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("organizations").collect();
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe("pustakaislam");
    expect(rows[0].name).toBe("Pustaka Islam"); // from DEFAULT_ORG_SETTINGS fallback
  });
});

test("backfillOrgId: stamps unlabeled rows bounded per call; coverage reports missing", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("orders", {
        orderId: `O-B1-${i}`, customerPhone: `62811111000${i}`, customerName: "X",
        assignedCsName: "Aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
        shippingCost: "Rp1", total: "Rp2", shippingAddress: "A", shippingDistrict: "D",
        shippingCity: "C", source: "berdu", aiEligible: false, createdAt: 1, updatedAt: 1,
      }); // no orgId — simulates pre-B1 rows
    }
  });
  const cov1 = await asAdmin.query(api.orgs.orgIdCoverage, {});
  expect(cov1.orders).toBe(3);
  const r1 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r1.patched).toBe(2);
  expect(r1.done).toBe(false);
  const r2 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r2.patched).toBe(1);
  expect(r2.done).toBe(true);
  const cov2 = await asAdmin.query(api.orgs.orgIdCoverage, {});
  expect(cov2.orders).toBe(0);
});
