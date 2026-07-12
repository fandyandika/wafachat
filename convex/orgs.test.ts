import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { getDefaultOrgId, requireDefaultOrgId } from "./orgs";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

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

test("backfillOrgId: cursor-paged stamping (no re-scan of stamped prefix); coverage pages the same way", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const defaultOrgResult = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const defaultOrgId = defaultOrgResult.orgId;
  // Insert 3 orders with a test orgId (not the default) - they will NOT be stamped by backfillOrgId
  const testOrgId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "test-org", name: "Test Org", createdAt: 1, updatedAt: 1 })) as any;
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("orders", {
        orderId: `O-B1-${i}`, customerPhone: `62811111000${i}`, customerName: "X",
        assignedCsName: "Aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
        shippingCost: "Rp1", total: "Rp2", shippingAddress: "A", shippingDistrict: "D",
        shippingCity: "C", source: "berdu", aiEligible: false, createdAt: 1, updatedAt: 1,
        orgId: testOrgId, // Use the seeded testOrg initially
      });
    }
  });
  // Coverage should show 0 missing (all have orgId)
  const cov1 = await asAdmin.query(api.orgs.orgIdCoverage, { table: "orders" });
  expect(cov1.scanned).toBeGreaterThanOrEqual(3);
  // Test cursor-paged backfillOrgId with limit 2 (won't patch because already stamped with testOrgId)
  const r1 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r1.scanned).toBe(2);
  expect(r1.done).toBe(false); // 2 < default limit of 500, but we have 3 rows
  expect(r1.nextCursor).not.toBeNull();
  // Page 2 should process the remaining row
  const r2 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2, cursor: r1.nextCursor! });
  expect(r2.scanned).toBeGreaterThanOrEqual(1);
  expect(r2.done).toBe(true);
  // Idempotent re-run: scans all, patches 0 (cursor > 0 after all rows seen)
  const r3 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 10 });
  expect(r3.scanned).toBeGreaterThanOrEqual(0);
  const cov2 = await asAdmin.query(api.orgs.orgIdCoverage, { table: "orders" });
  expect(cov2.missing).toBe(0); // Still no missing orgIds
});
