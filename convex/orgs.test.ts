import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { getDefaultOrgId, requireDefaultOrgId } from "./orgs";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("legacy cron organization listing fails loudly above its hard cap", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (let index = 0; index < 101; index++) {
      await ctx.db.insert("organizations", {
        slug: `org-${index}`, name: `Org ${index}`, createdAt: index, updatedAt: index,
      });
    }
  });
  await expect(t.query(internal.orgs.listOrgsInternal, {})).rejects.toThrow(/organization cap 100/i);
});

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

// NOTE: post-required-flip (B1), the schema REJECTS any orgId-less insert, so the
// undefined->default patch behaviour of backfillOrgId is no longer reproducible at the
// unit level — it was exercised once, for real, against prod at GATE A (218k rows,
// coverage 0). What stays testable (and gets reused by B2 migrations) is the cursor-
// paging CONTRACT: bounded per-page scan, monotonic cursor, correct done flag, and
// patched=0 idempotency over already-stamped rows.
test("backfillOrgId/orgIdCoverage: cursor-paging contract over already-stamped rows", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const orgId = (await asAdmin.mutation(api.orgs.seedDefaultOrg, {})).orgId;
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("orders", {
        orderId: `O-B1-${i}`, customerPhone: `62811111000${i}`, customerName: "X",
        assignedCsName: "Aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
        shippingCost: "Rp1", total: "Rp2", shippingAddress: "A", shippingDistrict: "D",
        shippingCity: "C", source: "berdu", aiEligible: false, createdAt: 1, updatedAt: 1,
        orgId,
      });
    }
  });
  // Coverage: all 3 stamped -> 0 missing, and 3 < default page so done in one call.
  const cov = await asAdmin.query(api.orgs.orgIdCoverage, { table: "orders" });
  expect(cov.missing).toBe(0);
  expect(cov.scanned).toBe(3);
  expect(cov.done).toBe(true);
  // Backfill page 1: scans exactly `limit`, patches 0 (already stamped), hands a cursor.
  const r1 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r1.scanned).toBe(2);
  expect(r1.patched).toBe(0);
  expect(r1.done).toBe(false);
  expect(r1.nextCursor).not.toBeNull();
  // Page 2 resumes AFTER the cursor — the prefix is never re-scanned — and finishes.
  const r2 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2, cursor: r1.nextCursor! });
  expect(r2.scanned).toBe(1);
  expect(r2.patched).toBe(0);
  expect(r2.done).toBe(true);
});

test("legacy B1 orgId tools reject tables whose schema already requires orgId", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});

  await expect(asAdmin.mutation(api.orgs.backfillOrgId, {
    table: "providerNumberBackfillRuns" as any,
  })).rejects.toThrow();
  await expect(asAdmin.query(api.orgs.orgIdCoverage, {
    table: "providerNumberBackfillClaims" as any,
  })).rejects.toThrow();
});
