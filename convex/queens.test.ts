import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { windowRangeForKey } from "./lib";

const WINDOW = "2026-07-20";
const modules = (import.meta as any).glob("./**/*.{ts,js}");

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1,
  }));
}

async function seedEligibleDay(t: any, orgId: any, windowKey = WINDOW, withMarker = true) {
  const { startAt } = windowRangeForKey(windowKey);
  await t.run(async (ctx: any) => {
    if (withMarker) await ctx.db.insert("rollupWindows", { orgId, windowKey, schemaVersion: 1, completedAt: startAt + 1 });
    for (const [csKey, csName, leads, closings] of [
      ["azelia", "Azelia", 10, 8],
      ["nabila", "Nabila", 10, 5],
    ]) {
      await ctx.db.insert("dailyRollups", {
        orgId, windowKey, csKey, csName, leadOrders: leads, leadsCust: leads,
        closings, closedCust: closings, cancelled: 0, manualClosings: 0, delivered: 0,
        revenue: 0, discount: 0, fuClosings: 0, fuH1: 0, fuH2: 0, fuH3: 0,
        byProduct: [], updatedAt: startAt + 1,
      });
      for (let i = 0; i < 5; i++) {
        const conversationId = await ctx.db.insert("conversations", {
          orgId, orderId: `${csKey}-${i}`, customerPhone: `628120000${csKey === "azelia" ? "1" : "2"}${i}`,
          customerName: "Customer", assignedCsName: csName, status: "active", aiEnabled: false,
          note: "", createdAt: startAt + i, updatedAt: startAt + i,
        });
        await ctx.db.insert("responseSamples", {
          orgId, csKey, csName, conversationId, deltaMs: 60_000,
          inboundAt: startAt + i, slaBreach: false, createdAt: startAt + i,
        });
      }
    }
  });
}

test("captureWindow stores one daily Queen snapshot and stays idempotent", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  await seedEligibleDay(t, orgId);

  await t.mutation((internal as any).queens.captureWindow, { orgId: String(orgId), windowKey: WINDOW });
  await t.mutation((internal as any).queens.captureWindow, { orgId: String(orgId), windowKey: WINDOW });

  const awards: any[] = await t.run((ctx: any) => ctx.db.query("queenAwards").collect());
  expect(awards).toHaveLength(1);
  expect(awards[0]).toMatchObject({ windowKey: WINDOW, status: "won", winnerCsName: "Azelia" });
});

test("a refreshed no-winner snapshot clears a prior winner", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  await seedEligibleDay(t, orgId);
  await t.mutation((internal as any).queens.captureWindow, { orgId: String(orgId), windowKey: WINDOW });
  await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("dailyRollups").collect();
    for (const row of rows) await ctx.db.delete(row._id);
  });

  await t.mutation((internal as any).queens.captureWindow, { orgId: String(orgId), windowKey: WINDOW });

  const awards: any[] = await t.run((ctx: any) => ctx.db.query("queenAwards").collect());
  expect(awards[0]).toMatchObject({ status: "no_winner" });
  expect(awards[0].winnerCsName).toBeUndefined();
});

test("Queen setup snapshots existing daily data without requiring a rollup marker", async () => {
  vi.useFakeTimers({ now: new Date("2026-07-02T11:00:00.000Z") });
  try {
    const t = convexTest(schema, modules);
    const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });
    const orgId = await seedOrg(t);
    await seedEligibleDay(t, orgId, "2026-07-01", false);

    const queued = await admin.mutation((api as any).queens.queueMonthBackfill, { month: "2026-07" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const result = await t.run(async (ctx: any) => ({
      awards: await ctx.db.query("queenAwards").collect(),
      marker: await ctx.db.query("rollupWindows").first(),
    }));
    expect(result.marker).toBeNull();
    expect(queued).toMatchObject({ month: "2026-07", scheduled: 2 });
    expect(result.awards.find((row: any) => row.windowKey === "2026-07-01")).toMatchObject({ orgId, status: "won", winnerCsName: "Azelia" });
    expect(result.awards.some((row: any) => row.windowKey === "2026-07-02")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("month recap maps source windows to closing dates and always returns four fixed weeks", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-10T03:00:00.000Z") });
  try {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    for (const [windowKey, winnerCsKey, winnerCsName] of [
      ["2026-07-31", "azelia", "Azelia"], ["2026-08-01", "nabila", "Nabila"],
    ]) await ctx.db.insert("queenAwards", {
      orgId, windowKey, status: "won", winnerCsKey, winnerCsName, score: 80,
      leads: 10, closings: 8, cr: 80, respMedianMs: 60_000, sealedAt: 1,
    });
  });

  const recap = await admin.query((api as any).queens.getMonth, { month: "2026-08" });
  expect(recap.monthly.winners).toEqual(["Azelia", "Nabila"]);
  expect(recap.awards.map((row: any) => row.windowKey)).toEqual(["2026-08-01", "2026-08-02"]);
  expect(recap.weekly).toHaveLength(4);
  expect(recap.weekly.map((week: any) => [week.startKey, week.endKey])).toEqual([
    ["2026-08-01", "2026-08-07"], ["2026-08-08", "2026-08-14"],
    ["2026-08-15", "2026-08-21"], ["2026-08-22", "2026-08-31"],
  ]);
  expect(recap.weekly[0].winners).toEqual(["Azelia", "Nabila"]);
  expect(recap.weekly.map((week: any) => week.status)).toEqual(["complete", "running", "upcoming", "upcoming"]);
  } finally {
    vi.useRealTimers();
  }
});

test("CS cannot access the owner Queen recap", async () => {
  const t = convexTest(schema, modules);
  const cs = t.withIdentity({ subject: "cs", role: "cs", name: "CS", email: "cs@wafachat" });
  await seedOrg(t);
  await expect(cs.query((api as any).queens.getMonth, { month: "2026-07" })).rejects.toThrow(/admin/i);
  await expect(cs.mutation((api as any).queens.queueMonthBackfill, { month: "2026-07" })).rejects.toThrow(/admin/i);
});
