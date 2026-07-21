import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { MAX_UNRESOLVED_COUNTERS } from "./reconcileState";

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

async function insertOrders(t: any, orgId: any, counters: number[]) {
  await t.run(async (ctx: any) => {
    for (const counter of counters) {
      await ctx.db.insert("orders", {
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
      });
    }
  });
}

test("bootstrap reconciliation advances in a bounded page before discovering a later gap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await insertOrders(t, orgId, [...Array.from({ length: 500 }, (_, index) => index + 1), 502]);

  const first = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId, datePrefix: "260719",
  });

  expect(first).toEqual({ gaps: [], nextCounter: 501 });
});

async function seedState(t: any, orgId: any, nextCounter: number, unresolvedCounters: number[]) {
  await t.run((ctx: any) =>
    ctx.db.insert("reconcileStates", {
      orgId,
      datePrefix: "260719",
      nextCounter,
      unresolvedCounters,
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

test("source tail exposes trailing orders that never reached the webhook", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await insertOrders(t, orgId, [1, 2]);
  await seedState(t, orgId, 3, []);

  const run = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
    observedMaxCounter: 5,
  });

  expect(run).toEqual({ gaps: [3, 4, 5], nextCounter: 6 });
});

test("bootstrap stops the cursor at the first gap that does not fit in durable state", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await insertOrder(t, orgId, 1);
  await insertOrder(t, orgId, 1_001);

  const run = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });

  expect(run.gaps).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 2));
  expect(run.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 2);
});

test("incremental sparse tail stops before gaps beyond remaining durable capacity", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedState(t, orgId, 1, []);
  await insertOrder(t, orgId, 1_001);

  const run = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });

  expect(run.gaps).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 1));
  expect(run.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 1);
});

test("a full unresolved set only advances after a healed gap makes room", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedState(t, orgId, MAX_UNRESOLVED_COUNTERS + 1, Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 1));
  await insertOrder(t, orgId, 1_001);

  const blocked = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(blocked.gaps).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 1));
  expect(blocked.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 1);

  await insertOrder(t, orgId, 1);
  const progressed = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(progressed.gaps).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 2));
  expect(progressed.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 2);
});

test("commit retains an unparseable fetched gap until its order is actually present", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);

  const committed = await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId,
    datePrefix: "260719",
    nextCounter: 4,
    unresolvedCounters: [3],
  });
  expect(committed.unresolvedCounters).toEqual([3]);

  const absent = await t.run((ctx: any) =>
    ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "O-260719000003"))
      .unique(),
  );
  expect(absent).toBeNull();

  const retry = await t.query(internal.ingest.reconcileState.prepareReconcileRun, {
    orgId,
    datePrefix: "260719",
  });
  expect(retry).toEqual({ gaps: [3], nextCounter: 4 });
});

test("stale commits do not resurrect resolved gaps or skip the first over-capacity gap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const initial = Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 1);
  await seedState(t, orgId, MAX_UNRESOLVED_COUNTERS + 1, initial);
  const stale = { orgId, datePrefix: "260719", nextCounter: MAX_UNRESOLVED_COUNTERS + 1, unresolvedCounters: initial };

  // A newer run sees 1 arrive, fills the released slot with 501, and advances.
  await insertOrder(t, orgId, 1);
  const fresh = await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId,
    datePrefix: "260719",
    nextCounter: MAX_UNRESOLVED_COUNTERS + 2,
    unresolvedCounters: Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 2),
  });
  expect(fresh.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 2);
  expect(fresh.unresolvedCounters).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 2));

  const retryAfterFresh = await t.mutation(internal.ingest.reconcileState.commitReconcileRun, stale);
  expect(retryAfterFresh.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 2);
  expect(retryAfterFresh.unresolvedCounters).toEqual(Array.from({ length: MAX_UNRESOLVED_COUNTERS }, (_, i) => i + 2));

  // If that resolved row is later deleted, the stale retry must clamp at the
  // first non-durable gap instead of advancing past 501.
  await t.run(async (ctx: any) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "O-260719000001"))
      .unique();
    await ctx.db.delete(order._id);
  });
  const safeAfterDelete = await t.mutation(internal.ingest.reconcileState.commitReconcileRun, stale);
  expect(safeAfterDelete.nextCounter).toBe(MAX_UNRESOLVED_COUNTERS + 1);
  expect(safeAfterDelete.unresolvedCounters).toEqual(initial);
});

test("durable rotation attempts gaps after the first 50 and exposes later tail gaps", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedState(t, orgId, 121, Array.from({ length: 120 }, (_, index) => index + 1));

  const first = await t.query(internal.ingest.reconcileState.prepareReconcileRun, { orgId, datePrefix: "260719" });
  expect(first.gaps.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId, datePrefix: "260719", nextCounter: first.nextCounter,
    unresolvedCounters: first.gaps, probeCursor: 51,
  });

  const second = await t.query(internal.ingest.reconcileState.prepareReconcileRun, { orgId, datePrefix: "260719" });
  expect(second.gaps.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, index) => index + 51));
  for (let counter = 51; counter <= 100; counter++) await insertOrder(t, orgId, counter);
  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId, datePrefix: "260719", nextCounter: second.nextCounter,
    unresolvedCounters: second.gaps, probeCursor: 101,
  });

  const third = await t.query(internal.ingest.reconcileState.prepareReconcileRun, { orgId, datePrefix: "260719" });
  expect(third.gaps.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, index) => index + 101));
  for (let counter = 101; counter <= 120; counter++) await insertOrder(t, orgId, counter);
  await t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
    orgId, datePrefix: "260719", nextCounter: third.nextCounter,
    unresolvedCounters: third.gaps, probeCursor: 31,
  });

  await insertOrder(t, orgId, 125);
  const tail = await t.query(internal.ingest.reconcileState.prepareReconcileRun, { orgId, datePrefix: "260719" });
  expect(tail.nextCounter).toBe(126);
  expect(tail.gaps.slice(0, 50)).toEqual([
    ...Array.from({ length: 20 }, (_, index) => index + 31),
    121, 122, 123, 124,
    ...Array.from({ length: 26 }, (_, index) => index + 1),
  ]);
});
