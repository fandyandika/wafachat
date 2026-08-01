import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { MAX_PERFORMANCE_ROLLUPS_PER_RANGE } from "./analyticsBounds";
import { requireAdminOrg } from "./authz";
import {
  businessDateKeyForWindowKey,
  csKey as csKeyOf,
  windowKeyForBusinessDate,
  windowKeyToday,
  windowRangeForKey,
} from "./lib";
import { responseTimesForPerformanceReport } from "./rollupReaders";
import {
  effectivePerformanceRange,
  inclusiveDateCount,
  previousPerformanceRange,
  resolvePerformanceRange,
  splitMonthIntoCalendarWeeks,
  type DateRange,
  type MetricRow,
  type PerformancePeriod,
  type PerformanceReport,
} from "../lib/performance-report";

const metricFields = {
  leads: v.number(),
  closings: v.number(),
  cr: v.number(),
  revenue: v.number(),
  cod: v.number(),
  transfer: v.number(),
  codPct: v.number(),
  transferPct: v.number(),
  delivered: v.number(),
  cancelled: v.number(),
  discount: v.number(),
};

const performanceReportValidator = v.object({
  period: v.union(v.literal("week"), v.literal("month"), v.literal("custom")),
  startDate: v.string(),
  endDate: v.string(),
  effectiveEndDate: v.string(),
  status: v.union(v.literal("running"), v.literal("complete")),
  generatedAt: v.number(),
  responseNotice: v.optional(v.string()),
  summary: v.object({
    ...metricFields,
    deltaLeads: v.number(),
    deltaClosings: v.number(),
    deltaCr: v.number(),
    deltaRevenue: v.number(),
  }),
  cs: v.array(v.object({
    ...metricFields,
    csKey: v.string(),
    csName: v.string(),
    responseMedianMs: v.union(v.number(), v.null()),
    deltaCr: v.number(),
  })),
  products: v.array(v.object({ ...metricFields, product: v.string() })),
  weeks: v.array(v.object({
    startDate: v.string(),
    endDate: v.string(),
    partial: v.boolean(),
    status: v.union(v.literal("upcoming"), v.literal("running"), v.literal("complete")),
    metrics: v.object(metricFields),
  })),
});

const round1 = (value: number) => Math.round(value * 10) / 10;
const percent = (part: number, total: number) => total > 0 ? round1(part / total * 100) : 0;

function aggregateRollups(rows: Doc<"dailyRollups">[]): MetricRow {
  const totals = rows.reduce((sum, row) => ({
    leads: sum.leads + row.leadsCust,
    closings: sum.closings + row.closings,
    revenue: sum.revenue + row.revenue,
    cod: sum.cod + (row.cod ?? 0),
    transfer: sum.transfer + (row.transfer ?? 0),
    delivered: sum.delivered + row.delivered,
    cancelled: sum.cancelled + row.cancelled,
    discount: sum.discount + row.discount,
  }), { leads: 0, closings: 0, revenue: 0, cod: 0, transfer: 0, delivered: 0, cancelled: 0, discount: 0 });
  return {
    ...totals,
    cr: percent(totals.closings, totals.leads),
    codPct: percent(totals.cod, totals.cod + totals.transfer),
    transferPct: percent(totals.transfer, totals.cod + totals.transfer),
  };
}

async function readRollups(
  ctx: any,
  orgId: Id<"organizations">,
  range: DateRange,
  requestedCsKey?: string,
): Promise<Doc<"dailyRollups">[]> {
  const firstKey = windowKeyForBusinessDate(range.startDate);
  const lastKey = windowKeyForBusinessDate(range.endDate);
  const rows = await ctx.db.query("dailyRollups")
    .withIndex("by_org_windowKey", (q: any) => q
      .eq("orgId", orgId).gte("windowKey", firstKey).lte("windowKey", lastKey))
    .take(MAX_PERFORMANCE_ROLLUPS_PER_RANGE + 1);
  if (rows.length > MAX_PERFORMANCE_ROLLUPS_PER_RANGE) {
    throw new Error("Data laporan terlalu besar; persempit rentang");
  }
  return requestedCsKey ? rows.filter((row: Doc<"dailyRollups">) => row.csKey === requestedCsKey) : rows;
}

function aggregateByCs(
  current: Doc<"dailyRollups">[],
  previous: Doc<"dailyRollups">[],
  medians: Map<string, number | null>,
) {
  const keys = new Set(current.map((row) => row.csKey));
  return Array.from(keys).map((csKey) => {
    const rows = current.filter((row) => row.csKey === csKey);
    const metrics = aggregateRollups(rows);
    const previousMetrics = aggregateRollups(previous.filter((row) => row.csKey === csKey));
    return {
      ...metrics,
      csKey,
      csName: rows[0]?.csName ?? csKey,
      responseMedianMs: medians.get(csKey) ?? null,
      deltaCr: round1(metrics.cr - previousMetrics.cr),
    };
  }).sort((a, b) => b.closings - a.closings || a.csName.localeCompare(b.csName));
}

function aggregateProducts(rows: Doc<"dailyRollups">[]) {
  const products = new Map<string, MetricRow>();
  for (const row of rows) for (const product of row.byProduct) {
    const existing = products.get(product.product) ?? aggregateRollups([]);
    products.set(product.product, {
      ...existing,
      leads: existing.leads + product.leads,
      closings: existing.closings + product.closings,
      revenue: existing.revenue + (product.revenue ?? 0),
      cod: existing.cod + (product.cod ?? 0),
      transfer: existing.transfer + (product.transfer ?? 0),
      discount: existing.discount + (product.discount ?? 0),
    });
  }
  return Array.from(products, ([product, raw]) => ({
    ...raw,
    product,
    cr: percent(raw.closings, raw.leads),
    codPct: percent(raw.cod, raw.cod + raw.transfer),
    transferPct: percent(raw.transfer, raw.cod + raw.transfer),
  })).sort((a, b) => b.closings - a.closings || a.product.localeCompare(b.product));
}

function rowsWithin(rows: Doc<"dailyRollups">[], range: DateRange) {
  return rows.filter((row) => {
    const date = businessDateKeyForWindowKey(row.windowKey);
    return date >= range.startDate && date <= range.endDate;
  });
}

function exactRange(period: PerformancePeriod, startDate: string, endDate: string): DateRange {
  const resolved = resolvePerformanceRange(period, {
    startDate,
    endDate,
    anchorDate: startDate,
    month: startDate.slice(0, 7),
  });
  if (resolved.startDate !== startDate || resolved.endDate !== endDate) {
    throw new Error("Rentang tidak sesuai dengan jenis periode");
  }
  return resolved;
}

export const getPerformanceReport = query({
  args: {
    period: v.union(v.literal("week"), v.literal("month"), v.literal("custom")),
    startDate: v.string(),
    endDate: v.string(),
    csName: v.optional(v.string()),
  },
  returns: performanceReportValidator,
  handler: async (ctx, args): Promise<PerformanceReport> => {
    const { orgId } = await requireAdminOrg(ctx, "performanceReports.getPerformanceReport");
    const selected = exactRange(args.period, args.startDate, args.endDate);
    if (inclusiveDateCount(selected) > 35) throw new Error("Maksimal 35 hari");
    const today = businessDateKeyForWindowKey(windowKeyToday());
    const effective = effectivePerformanceRange(selected, today);
    const previous = previousPerformanceRange(args.period, selected, effective);
    const requestedCsKey = args.csName ? csKeyOf(args.csName) : undefined;
    const [currentRows, previousRows] = await Promise.all([
      readRollups(ctx, orgId, effective, requestedCsKey),
      readRollups(ctx, orgId, previous, requestedCsKey),
    ]);

    let responseNotice: string | undefined;
    const medians = new Map<string, number | null>();
    const firstWindow = windowRangeForKey(windowKeyForBusinessDate(effective.startDate));
    const lastWindow = windowRangeForKey(windowKeyForBusinessDate(effective.endDate));
    const response = await responseTimesForPerformanceReport(ctx, orgId, {
      startAt: firstWindow.startAt,
      endAt: lastWindow.endAt,
      csName: args.csName,
    });
    if (response.limited) {
      responseNotice = "Response time membutuhkan rentang lebih pendek";
    } else if (response.data) {
      for (const row of response.data.cs) medians.set(csKeyOf(row.csName), row.firstReplyMedianMs);
    }

    const current = aggregateRollups(currentRows);
    const prior = aggregateRollups(previousRows);
    const weeks = args.period === "month"
      ? splitMonthIntoCalendarWeeks(args.startDate.slice(0, 7)).map((week) => ({
        ...week,
        status: week.startDate > today ? "upcoming" as const
          : week.endDate >= today ? "running" as const
          : "complete" as const,
        metrics: aggregateRollups(rowsWithin(currentRows, week)),
      }))
      : [];
    return {
      period: args.period,
      startDate: selected.startDate,
      endDate: selected.endDate,
      effectiveEndDate: effective.endDate,
      status: selected.endDate >= today ? "running" : "complete",
      generatedAt: Date.now(),
      responseNotice,
      summary: {
        ...current,
        deltaLeads: current.leads - prior.leads,
        deltaClosings: current.closings - prior.closings,
        deltaCr: round1(current.cr - prior.cr),
        deltaRevenue: current.revenue - prior.revenue,
      },
      cs: aggregateByCs(currentRows, previousRows, medians),
      products: aggregateProducts(currentRows),
      weeks,
    };
  },
});
