import { windowKeyToday, windowRangeForKey } from "@/lib/report-window-core";
import {
  inclusiveDateCount,
  resolvePerformanceRange,
  type PerformancePeriod,
} from "@/lib/performance-report";

export type DayBasis = "calendar" | "work";
export type PerformancePreset =
  | "today"
  | "yesterday"
  | "last_7"
  | "date"
  | "this_week"
  | "last_week"
  | "week"
  | "this_month"
  | "last_month"
  | "month"
  | "custom";

export type PerformanceSelection = {
  preset: PerformancePreset;
  basis: DayBasis;
  date?: string;
  anchorDate?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
};

export type ResolvedPerformanceSelection = {
  period: PerformancePeriod;
  basis: DayBasis;
  startDate: string;
  endDate: string;
};

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateMs(value: string): number {
  if (!ISO_DATE.test(value)) throw new Error("Tanggal tidak valid");
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error("Tanggal tidak valid");
  }
  return ms;
}

function addDays(value: string, days: number): string {
  return new Date(dateMs(value) + days * DAY_MS).toISOString().slice(0, 10);
}

function previousMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Pilih bulan");
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function resolveDashboardDay(date: string, basis: DayBasis, now = Date.now()) {
  dateMs(date);
  const range = basis === "work"
    ? windowRangeForKey(date)
    : {
        startAt: Date.parse(`${date}T00:00:00+07:00`),
        endAt: Date.parse(`${date}T00:00:00+07:00`) + DAY_MS,
      };
  if (range.startAt > now) throw new Error("Tanggal belum dimulai");
  return { date, basis, ...range, running: range.endAt > now };
}

export function resolvePerformanceSelection(
  selection: PerformanceSelection,
  today: string,
  now = Date.now(),
): ResolvedPerformanceSelection {
  dateMs(today);
  let resolved: ResolvedPerformanceSelection;

  if (selection.preset === "today" || selection.preset === "yesterday" || selection.preset === "date") {
    const date = selection.preset === "date"
      ? selection.date ?? ""
      : selection.basis === "work"
        ? addDays(windowKeyToday(now), selection.preset === "yesterday" ? -1 : 0)
        : addDays(today, selection.preset === "yesterday" ? -1 : 0);
    resolveDashboardDay(date, selection.basis, now);
    return { period: "day", basis: selection.basis, startDate: date, endDate: date };
  }

  if (selection.preset === "last_7") {
    return {
      period: "custom",
      basis: "work",
      startDate: addDays(today, -6),
      endDate: today,
    };
  }

  if (selection.preset === "this_week" || selection.preset === "last_week" || selection.preset === "week") {
    const anchorDate = selection.preset === "week"
      ? selection.anchorDate ?? ""
      : addDays(today, selection.preset === "last_week" ? -7 : 0);
    const range = resolvePerformanceRange("week", { anchorDate });
    resolved = { period: "week", basis: "work", ...range };
  } else if (selection.preset === "this_month" || selection.preset === "last_month" || selection.preset === "month") {
    const month = selection.preset === "month"
      ? selection.month ?? ""
      : selection.preset === "last_month"
        ? previousMonth(today.slice(0, 7))
        : today.slice(0, 7);
    const range = resolvePerformanceRange("month", { month });
    resolved = { period: "month", basis: "work", ...range };
  } else {
    const range = resolvePerformanceRange("custom", {
      startDate: selection.startDate,
      endDate: selection.endDate,
    });
    if (inclusiveDateCount(range) > 35) throw new Error("Maksimal 35 hari");
    resolved = { period: "custom", basis: "work", ...range };
  }

  if (dateMs(resolved.startDate) > dateMs(today)) throw new Error("Periode belum dimulai");
  return resolved;
}

export function parsePerformanceDeepLink(
  search: Pick<URLSearchParams, "get">,
  today: string,
): PerformanceSelection {
  const fallback: PerformanceSelection = {
    preset: "this_week",
    basis: "work",
    anchorDate: today,
  };
  if (search.get("period") !== "day") return fallback;
  const basis = search.get("basis");
  const date = search.get("date");
  if ((basis !== "calendar" && basis !== "work") || !date) return fallback;
  try {
    dateMs(date);
    return { preset: "date", basis, date };
  } catch {
    return fallback;
  }
}
