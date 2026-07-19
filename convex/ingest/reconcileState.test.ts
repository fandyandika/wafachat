import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";

async function seedOrg(t: any) {
  return t.run((ctx: any) =>
    ctx.db.insert("organizations", {
      slug: "reconcile-test",
      name: "Reconcile Test",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function insertOrder(t: any, orgId: any, counter: number) {
  await t.run((ctx: any) =>
    ctx.db.insert("orders", {
      orgId,
      orderId: `O-260719${String(counter).padStart(6, "0")}`,
      customerPhone: "628111111111",
      customerName: "Customer",
      assignedCsName: "Risma",
      productName: "Product",
      products: "Product",
      productsSubtotal: "1000",
      shippingCost: "0",
      total: "1000",
      shippingAddress: "",
      shippingDistrict: "",
      shippingCity: "",
      source: "berdu" as const,
      aiEligible: false,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

test("prepareReconcileRun advances through new tails and heals a late order", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await insertOrder(t, orgId, 1);
  await insertOrder(t, orgId, 2);
  await insertOrder(t, orgId, 4);

  const first = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(first).toEqual({ gaps: [3], nextCounter: 5 });

  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId,
    datePrefix: "260719",
    nextCounter: first.nextCounter,
    unresolvedCounters: first.gaps,
  });
  await insertOrder(t, orgId, 5);
  await insertOrder(t, orgId, 6);

  const incremental = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(incremental).toEqual({ gaps: [3], nextCounter: 7 });

  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId,
    datePrefix: "260719",
    nextCounter: incremental.nextCounter,
    unresolvedCounters: incremental.gaps,
  });
  await insertOrder(t, orgId, 3);

  const healed = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(healed).toEqual({ gaps: [], nextCounter: 7 });
  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId,
    datePrefix: "260719",
    nextCounter: healed.nextCounter,
    unresolvedCounters: healed.gaps,
  });
  const state: any = await t.run((ctx: any) =>
    ctx.db
      .query("reconcileStates")
      .withIndex("by_org_datePrefix", (q: any) => q.eq("orgId", orgId).eq("datePrefix", "260719"))
      .unique(),
  );
  expect(state?.unresolvedCounters).toEqual([]);
});
