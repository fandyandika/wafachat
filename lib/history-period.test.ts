import { describe, expect, test } from "vitest";

import {
  parsePerformanceDeepLink,
  resolveDashboardDay,
  resolvePerformanceSelection,
} from "./history-period";

describe("resolveDashboardDay", () => {
  test("uses an exact Jakarta calendar day", () => {
    expect(resolveDashboardDay(
      "2026-08-07",
      "calendar",
      Date.parse("2026-08-08T12:00:00+07:00"),
    )).toEqual({
      date: "2026-08-07",
      basis: "calendar",
      startAt: Date.parse("2026-08-07T00:00:00+07:00"),
      endAt: Date.parse("2026-08-08T00:00:00+07:00"),
      running: false,
    });
  });

  test("uses the selected date as the opening date of a CS work window", () => {
    expect(resolveDashboardDay(
      "2026-08-07",
      "work",
      Date.parse("2026-08-08T17:00:00+07:00"),
    )).toEqual({
      date: "2026-08-07",
      basis: "work",
      startAt: Date.parse("2026-08-07T16:00:00+07:00"),
      endAt: Date.parse("2026-08-08T16:00:00+07:00"),
      running: false,
    });
  });

  test("rejects invalid and not-yet-open dates", () => {
    expect(() => resolveDashboardDay("2026-02-30", "calendar")).toThrow("Tanggal tidak valid");
    expect(() => resolveDashboardDay(
      "2026-08-08",
      "work",
      Date.parse("2026-08-08T11:00:00+07:00"),
    )).toThrow("Tanggal belum dimulai");
  });
});

describe("resolvePerformanceSelection", () => {
  const now = Date.parse("2026-08-08T11:00:00+07:00");

  test("resolves calendar today and yesterday as one-day reports", () => {
    expect(resolvePerformanceSelection(
      { preset: "today", basis: "calendar" },
      "2026-08-08",
      now,
    )).toEqual({ period: "day", basis: "calendar", startDate: "2026-08-08", endDate: "2026-08-08" });
    expect(resolvePerformanceSelection(
      { preset: "yesterday", basis: "calendar" },
      "2026-08-08",
      now,
    )).toEqual({ period: "day", basis: "calendar", startDate: "2026-08-07", endDate: "2026-08-07" });
  });

  test("resolves the last seven calendar dates as a bounded custom report", () => {
    expect(resolvePerformanceSelection(
      { preset: "last_7", basis: "work" },
      "2026-08-09",
      Date.parse("2026-08-09T12:00:00+07:00"),
    )).toEqual({
      period: "custom",
      basis: "work",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
  });

  test("resolves work today to the currently open work-window date", () => {
    expect(resolvePerformanceSelection(
      { preset: "today", basis: "work" },
      "2026-08-08",
      now,
    )).toEqual({ period: "day", basis: "work", startDate: "2026-08-07", endDate: "2026-08-07" });
    expect(resolvePerformanceSelection(
      { preset: "yesterday", basis: "work" },
      "2026-08-08",
      now,
    )).toEqual({ period: "day", basis: "work", startDate: "2026-08-06", endDate: "2026-08-06" });
  });

  test("uses a chosen date directly and forces longer reports to work basis", () => {
    expect(resolvePerformanceSelection(
      { preset: "date", basis: "work", date: "2026-08-03" },
      "2026-08-08",
      now,
    )).toEqual({ period: "day", basis: "work", startDate: "2026-08-03", endDate: "2026-08-03" });
    expect(resolvePerformanceSelection(
      { preset: "last_week", basis: "calendar" },
      "2026-08-08",
      now,
    )).toEqual({ period: "week", basis: "work", startDate: "2026-07-27", endDate: "2026-08-02" });
    expect(resolvePerformanceSelection(
      { preset: "last_month", basis: "calendar" },
      "2026-08-08",
      now,
    )).toEqual({ period: "month", basis: "work", startDate: "2026-07-01", endDate: "2026-07-31" });
  });

  test("rejects a custom range longer than 35 days", () => {
    expect(() => resolvePerformanceSelection({
      preset: "custom",
      basis: "work",
      startDate: "2026-06-01",
      endDate: "2026-08-08",
    }, "2026-08-08", now)).toThrow("Maksimal 35 hari");
  });
});

describe("parsePerformanceDeepLink", () => {
  test("accepts a valid Dashboard daily handoff", () => {
    expect(parsePerformanceDeepLink(
      new URLSearchParams("period=day&date=2026-08-07&basis=calendar"),
      "2026-08-08",
    )).toEqual({ preset: "date", basis: "calendar", date: "2026-08-07" });
  });

  test("falls back safely for invalid dates and bases", () => {
    expect(parsePerformanceDeepLink(
      new URLSearchParams("period=day&date=bad&basis=oops"),
      "2026-08-08",
    )).toEqual({ preset: "this_week", basis: "work", anchorDate: "2026-08-08" });
  });
});
