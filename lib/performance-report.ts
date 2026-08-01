export type PerformancePeriod = "week" | "month" | "custom";
export type DateRange = { startDate: string; endDate: string };
export type PerformanceRangeInput = {
  anchorDate?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
};

export type MetricRow = {
  leads: number;
  closings: number;
  cr: number;
  revenue: number;
  cod: number;
  transfer: number;
  codPct: number;
  transferPct: number;
  delivered: number;
  cancelled: number;
  discount: number;
};

export type CsMetricRow = MetricRow & {
  csKey: string;
  csName: string;
  responseMedianMs: number | null;
  deltaCr: number;
};

export type ProductMetricRow = MetricRow & { product: string };

export type PerformanceReport = {
  period: PerformancePeriod;
  startDate: string;
  endDate: string;
  effectiveEndDate: string;
  status: "running" | "complete";
  generatedAt: number;
  responseNotice?: string;
  summary: MetricRow & {
    deltaLeads: number;
    deltaClosings: number;
    deltaCr: number;
    deltaRevenue: number;
  };
  cs: CsMetricRow[];
  products: ProductMetricRow[];
  weeks: Array<DateRange & {
    partial: boolean;
    status: "running" | "complete";
    metrics: MetricRow;
  }>;
};

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateMs(value: string): number {
  if (!ISO_DATE.test(value)) throw new Error("Tanggal harus berformat YYYY-MM-DD");
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error("Tanggal tidak valid");
  }
  return ms;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDate(dateMs(value) + days * DAY_MS);
}

export function inclusiveDateCount(range: DateRange): number {
  const count = Math.floor((dateMs(range.endDate) - dateMs(range.startDate)) / DAY_MS) + 1;
  if (count < 1) throw new Error("Tanggal akhir harus sama atau setelah tanggal awal");
  return count;
}

export function resolvePerformanceRange(
  period: PerformancePeriod,
  input: PerformanceRangeInput,
): DateRange {
  if (period === "custom") {
    if (!input.startDate || !input.endDate) throw new Error("Lengkapi rentang tanggal");
    const range = { startDate: input.startDate, endDate: input.endDate };
    inclusiveDateCount(range);
    return range;
  }
  if (period === "week") {
    if (!input.anchorDate) throw new Error("Pilih tanggal pekan");
    const day = new Date(dateMs(input.anchorDate)).getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startDate = addDays(input.anchorDate, mondayOffset);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  if (!input.month || !/^\d{4}-\d{2}$/.test(input.month)) throw new Error("Pilih bulan");
  const startDate = `${input.month}-01`;
  dateMs(startDate);
  return {
    startDate,
    endDate: isoDate(Date.UTC(+input.month.slice(0, 4), +input.month.slice(5, 7), 0)),
  };
}

export function effectivePerformanceRange(selected: DateRange, today: string): DateRange {
  dateMs(today);
  if (dateMs(selected.startDate) > dateMs(today)) throw new Error("Periode belum dimulai");
  return {
    ...selected,
    endDate: dateMs(selected.endDate) > dateMs(today) ? today : selected.endDate,
  };
}

export function previousPerformanceRange(
  period: PerformancePeriod,
  selected: DateRange,
  effective: DateRange,
): DateRange {
  const elapsed = inclusiveDateCount(effective);
  if (period !== "month") {
    const endDate = addDays(selected.startDate, -1);
    return { startDate: addDays(endDate, 1 - elapsed), endDate };
  }
  const year = +selected.startDate.slice(0, 4);
  const monthIndex = +selected.startDate.slice(5, 7) - 1;
  const startDate = isoDate(Date.UTC(year, monthIndex - 1, 1));
  const fullPrevious = resolvePerformanceRange("month", { month: startDate.slice(0, 7) });
  if (effective.endDate === selected.endDate) return fullPrevious;
  const elapsedEnd = addDays(startDate, elapsed - 1);
  return {
    startDate,
    endDate: dateMs(elapsedEnd) > dateMs(fullPrevious.endDate)
      ? fullPrevious.endDate
      : elapsedEnd,
  };
}

export function splitMonthIntoCalendarWeeks(
  month: string,
): Array<DateRange & { partial: boolean }> {
  const monthRange = resolvePerformanceRange("month", { month });
  const rows: Array<DateRange & { partial: boolean }> = [];
  let startDate = monthRange.startDate;
  while (dateMs(startDate) <= dateMs(monthRange.endDate)) {
    const day = new Date(dateMs(startDate)).getUTCDay();
    const daysToSunday = day === 0 ? 0 : 7 - day;
    const naturalEnd = addDays(startDate, daysToSunday);
    const endDate = dateMs(naturalEnd) > dateMs(monthRange.endDate)
      ? monthRange.endDate
      : naturalEnd;
    const naturalStart = addDays(startDate, day === 0 ? -6 : 1 - day);
    rows.push({
      startDate,
      endDate,
      partial: naturalStart < monthRange.startDate || naturalEnd > monthRange.endDate,
    });
    startDate = addDays(endDate, 1);
  }
  return rows;
}
