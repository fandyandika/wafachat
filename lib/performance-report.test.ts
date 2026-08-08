import { describe, expect, it } from "vitest";
import {
  effectivePerformanceRange,
  inclusiveDateCount,
  previousPerformanceRange,
  resolvePerformanceRange,
  splitMonthIntoCalendarWeeks,
} from "./performance-report";

describe("performance report periods", () => {
  it("resolves a one-day report and compares it with the preceding day", () => {
    const selected = resolvePerformanceRange("day", { startDate: "2026-08-07", endDate: "2026-08-07" });
    expect(selected).toEqual({ startDate: "2026-08-07", endDate: "2026-08-07" });
    expect(previousPerformanceRange("day", selected, selected)).toEqual({
      startDate: "2026-08-06",
      endDate: "2026-08-06",
    });
  });

  it("rejects a multi-date daily report", () => {
    expect(() => resolvePerformanceRange("day", {
      startDate: "2026-08-07",
      endDate: "2026-08-08",
    })).toThrow("Laporan harian hanya untuk satu tanggal");
  });

  it("resolves a week across a year boundary", () => {
    expect(resolvePerformanceRange("week", { anchorDate: "2027-01-01" })).toEqual({
      startDate: "2026-12-28",
      endDate: "2027-01-03",
    });
  });

  it("splits August 2026 into clipped Monday-Sunday rows", () => {
    expect(splitMonthIntoCalendarWeeks("2026-08")).toEqual([
      { startDate: "2026-08-01", endDate: "2026-08-02", partial: true },
      { startDate: "2026-08-03", endDate: "2026-08-09", partial: false },
      { startDate: "2026-08-10", endDate: "2026-08-16", partial: false },
      { startDate: "2026-08-17", endDate: "2026-08-23", partial: false },
      { startDate: "2026-08-24", endDate: "2026-08-30", partial: false },
      { startDate: "2026-08-31", endDate: "2026-08-31", partial: true },
    ]);
  });

  it("compares a running month with the same elapsed days", () => {
    const selected = resolvePerformanceRange("month", { month: "2026-08" });
    const effective = effectivePerformanceRange(selected, "2026-08-05");
    expect(previousPerformanceRange("month", selected, effective)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-05",
    });
  });

  it("compares a completed month with the complete preceding month", () => {
    const selected = resolvePerformanceRange("month", { month: "2026-03" });
    expect(previousPerformanceRange("month", selected, selected)).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("uses the immediately adjacent equal-length custom range", () => {
    expect(previousPerformanceRange(
      "custom",
      { startDate: "2026-07-10", endDate: "2026-07-14" },
      { startDate: "2026-07-10", endDate: "2026-07-14" },
    )).toEqual({ startDate: "2026-07-05", endDate: "2026-07-09" });
  });

  it("counts inclusive dates at the 35-day boundary", () => {
    expect(inclusiveDateCount({ startDate: "2026-07-01", endDate: "2026-08-04" })).toBe(35);
    expect(inclusiveDateCount({ startDate: "2026-07-01", endDate: "2026-08-05" })).toBe(36);
  });

  it("rejects invalid, reversed, and future periods", () => {
    expect(() => resolvePerformanceRange("custom", {
      startDate: "2026-02-30", endDate: "2026-03-01",
    })).toThrow("Tanggal tidak valid");
    expect(() => inclusiveDateCount({
      startDate: "2026-08-02", endDate: "2026-08-01",
    })).toThrow("Tanggal akhir");
    expect(() => effectivePerformanceRange(
      { startDate: "2026-08-02", endDate: "2026-08-08" },
      "2026-08-01",
    )).toThrow("Periode belum dimulai");
  });
});
