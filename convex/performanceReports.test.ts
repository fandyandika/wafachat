import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { windowKeyForBusinessDate } from "./lib";
import { windowRangeForKey } from "./lib";

const modules = (import.meta as any).glob("./**/*.{ts,js}");

afterEach(() => vi.useRealTimers());

async function seed(t: any) {
  const orgId = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "pustakaislam", name: "Org A", createdAt: 1, updatedAt: 1,
  }));
  const otherOrgId = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "other", name: "Org B", createdAt: 1, updatedAt: 1,
  }));

  const insert = async (
    targetOrgId: any,
    businessDate: string,
    csKey: string,
    csName: string,
    values: { leads: number; closings: number; revenue: number; cod: number; transfer: number },
  ) => t.run((ctx: any) => ctx.db.insert("dailyRollups", {
    orgId: targetOrgId,
    windowKey: windowKeyForBusinessDate(businessDate),
    csKey,
    csName,
    leadOrders: values.leads,
    leadsCust: values.leads,
    closings: values.closings,
    closedCust: values.closings,
    cancelled: 1,
    manualClosings: 0,
    delivered: values.closings - 1,
    revenue: values.revenue,
    discount: 100,
    cod: values.cod,
    transfer: values.transfer,
    fuClosings: 0,
    fuH1: 0,
    fuH2: 0,
    fuH3: 0,
    byProduct: [{
      product: "Quran Mapping",
      leads: values.leads,
      closings: values.closings,
      leadOrders: values.leads,
      revenue: values.revenue,
      discount: 100,
      cod: values.cod,
      transfer: values.transfer,
    }],
    updatedAt: 1,
  }));

  await insert(orgId, "2026-07-01", "aisyah", "Aisyah", { leads: 10, closings: 5, revenue: 1_000_000, cod: 3, transfer: 2 });
  await insert(orgId, "2026-07-01", "lila", "Lila", { leads: 5, closings: 2, revenue: 400_000, cod: 1, transfer: 1 });
  await insert(orgId, "2026-07-02", "aisyah", "Aisyah", { leads: 10, closings: 6, revenue: 1_200_000, cod: 4, transfer: 2 });
  await insert(orgId, "2026-07-02", "lila", "Lila", { leads: 5, closings: 2, revenue: 400_000, cod: 1, transfer: 1 });
  await insert(orgId, "2026-06-29", "aisyah", "Aisyah", { leads: 10, closings: 4, revenue: 800_000, cod: 2, transfer: 2 });
  await insert(orgId, "2026-06-30", "lila", "Lila", { leads: 10, closings: 4, revenue: 800_000, cod: 2, transfer: 2 });
  await insert(otherOrgId, "2026-07-01", "other", "Other", { leads: 999, closings: 999, revenue: 999, cod: 999, transfer: 0 });
  return orgId;
}

test("aggregates additive rollups and excludes another organization", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });

  const report = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "custom", startDate: "2026-07-01", endDate: "2026-07-02",
  });

  expect(report.summary).toMatchObject({
    leads: 30, closings: 15, cr: 50, revenue: 3_000_000,
    cod: 9, transfer: 6, codPct: 60, transferPct: 40,
    deltaLeads: 10, deltaClosings: 7, deltaRevenue: 1_400_000,
  });
  expect(report.cs.map((row: any) => row.csName)).toEqual(["Aisyah", "Lila"]);
  expect(report.products[0]).toMatchObject({ product: "Quran Mapping", leads: 30, closings: 15 });
  expect(report.summary.leads).not.toBe(1029);
  expect(report).toMatchObject({ basis: "work" });
  expect(report.summary.responseMedianMs).toBeNull();
});

test("daily work reports use the selected opening-window date", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });

  const report = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "day",
    basis: "work",
    startDate: "2026-06-30",
    endDate: "2026-06-30",
  });

  expect(report).toMatchObject({
    period: "day",
    basis: "work",
    startDate: "2026-06-30",
    endDate: "2026-06-30",
    summary: { leads: 15, closings: 7, cod: 4, transfer: 3 },
  });
});

test("daily calendar reports use exact Jakarta midnight bounds and exclude another organization", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  const orgId = await seed(t);
  const otherOrgId = await t.run((ctx: any) => ctx.db
    .query("organizations")
    .withIndex("by_slug", (q: any) => q.eq("slug", "other"))
    .unique()
    .then((row: any) => row._id));
  const inside = [
    Date.parse("2026-08-07T00:30:00+07:00"),
    Date.parse("2026-08-07T15:59:00+07:00"),
  ];
  const insertPair = async (targetOrgId: any, index: number, at: number, paymentMethod: "cod" | "transfer") => t.run(async (ctx: any) => {
    const orderId = `CAL-${index}-${String(targetOrgId)}`;
    const phone = `6285550000${index}${targetOrgId === orgId ? "1" : "9"}`;
    await ctx.db.insert("orders", {
      orgId: targetOrgId, orderId, customerPhone: phone, customerName: `Customer ${index}`,
      assignedCsName: "Aisyah", csKey: "aisyah", productName: "Quran Mapping", products: "Quran Mapping",
      productsSubtotal: "100000", shippingCost: "0", total: "100000", shippingAddress: "",
      shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: false, createdAt: at, updatedAt: at,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId: targetOrgId, orderIdBerdu: orderId, customerPhone: phone, customerName: `Customer ${index}`,
      csName: "Aisyah", csKey: "aisyah", closedAt: at, recipientName: `Customer ${index}`,
      recipientPhone: phone, recipientAddress: "", recipientDistrict: "", recipientCity: "",
      packageContent: "Quran Mapping", paymentMethod, total: 100000, status: "ready", flags: [],
      sourceMessageText: "", version: 1, createdAt: at, updatedAt: at,
    });
  });
  await insertPair(orgId, 1, inside[0], "cod");
  await insertPair(orgId, 2, inside[1], "transfer");
  await insertPair(orgId, 3, Date.parse("2026-08-08T00:01:00+07:00"), "cod");
  await insertPair(otherOrgId, 4, inside[0], "cod");

  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });
  const report = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "day",
    basis: "calendar",
    startDate: "2026-08-07",
    endDate: "2026-08-07",
  });

  expect(report).toMatchObject({
    period: "day",
    basis: "calendar",
    summary: { leads: 2, closings: 2, cod: 1, transfer: 1, revenue: 200000 },
  });
  expect(report.products).toEqual([
    expect.objectContaining({ product: "Quran Mapping", leads: 2, closings: 2, cod: 1, transfer: 1 }),
  ]);
});

test("scopes every report section to one CS", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });

  const report = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "custom", startDate: "2026-07-01", endDate: "2026-07-02", csName: "Aisyah",
  });

  expect(report.summary).toMatchObject({ leads: 20, closings: 11, revenue: 2_200_000 });
  expect(report.cs).toHaveLength(1);
  expect(report.cs[0].csName).toBe("Aisyah");
  expect(report.products[0]).toMatchObject({ leads: 20, closings: 11 });
});

test("monthly breakdown is clipped and sums to the monthly total", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });

  const report = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "month", startDate: "2026-08-01", endDate: "2026-08-31",
  });

  expect(report.weeks.map((week: any) => [week.startDate, week.endDate, week.partial])).toEqual([
    ["2026-08-01", "2026-08-02", true],
    ["2026-08-03", "2026-08-09", false],
    ["2026-08-10", "2026-08-16", false],
    ["2026-08-17", "2026-08-23", false],
    ["2026-08-24", "2026-08-30", false],
    ["2026-08-31", "2026-08-31", true],
  ]);
  expect(report.weeks.reduce((sum: number, week: any) => sum + week.metrics.leads, 0)).toBe(report.summary.leads);
});

test("enforces range and owner authorization boundaries", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-10T12:00:00.000Z") });
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });
  const cs = t.withIdentity({ subject: "cs", role: "cs", name: "CS", email: "cs@wafachat" });

  await expect(admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "custom", startDate: "2026-07-01", endDate: "2026-08-05",
  })).rejects.toThrow("Maksimal 35 hari");
  await expect(cs.query((api as any).performanceReports.getPerformanceReport, {
    period: "custom", startDate: "2026-07-01", endDate: "2026-07-02",
  })).rejects.toThrow(/admin/i);
  await expect(admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "week", basis: "calendar", startDate: "2026-07-06", endDate: "2026-07-12",
  })).rejects.toThrow("Basis kalender hanya tersedia untuk laporan harian");
});

test("response sample overflow degrades only the performance response metric", async () => {
  const { startAt, endAt } = windowRangeForKey("2026-07-01");
  const fakeCtx = {
    db: {
      query(table: string) {
        return {
          withIndex() {
            if (table === "rollupWindows") return { unique: async () => null };
            return {
              take: async (limit: number) => Array.from({ length: limit }, (_, index) => ({
                conversationId: `conversation-${index}`,
                csKey: "aisyah",
                csName: "Aisyah",
                deltaMs: 60_000,
                slaBreach: false,
                createdAt: startAt + index,
              })),
            };
          },
        };
      },
    },
  };
  const readers = await import("./rollupReaders");

  await expect(readers.responseTimesFromSamples(fakeCtx, "org" as any, { startAt, endAt }))
    .rejects.toThrow("exact row cap 3000 exceeded");
  await expect((readers as any).responseTimesForPerformanceReport(
    fakeCtx, "org", { startAt, endAt },
  )).resolves.toEqual({ data: null, limited: true });
});

test("marks the active business-date week running and later month weeks upcoming", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-01T12:00:00.000Z") }); // 19:00 WIB; business date 2 Aug is active.
  const t = convexTest(schema, modules);
  await seed(t);
  const admin = t.withIdentity({ subject: "admin", role: "admin", name: "Admin", email: "admin@wafachat" });

  const week = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "week", startDate: "2026-07-27", endDate: "2026-08-02",
  });
  const month = await admin.query((api as any).performanceReports.getPerformanceReport, {
    period: "month", startDate: "2026-08-01", endDate: "2026-08-31",
  });

  expect(week.status).toBe("running");
  expect(month.weeks.map((row: any) => row.status)).toEqual([
    "running", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming",
  ]);
});
