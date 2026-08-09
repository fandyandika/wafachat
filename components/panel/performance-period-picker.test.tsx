import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  buildCalendarMonth,
  formatPerformancePeriodLabel,
  PerformancePeriodPicker,
  type PerformancePeriodDraft,
} from "./performance-period-picker";

(globalThis as any).React = React;

const weeklyDraft: PerformancePeriodDraft = {
  preset: "this_week",
  basis: "work",
  date: "2026-08-09",
  anchorDate: "2026-08-09",
  month: "2026-08",
  startDate: "2026-08-09",
  endDate: "2026-08-09",
};

describe("PerformancePeriodPicker", () => {
  test("formats the active preset and exact range in Indonesian", () => {
    expect(formatPerformancePeriodLabel(weeklyDraft, "2026-08-09")).toBe(
      "Pekan ini · 3–9 Agu 2026",
    );
    expect(formatPerformancePeriodLabel({
      ...weeklyDraft,
      preset: "custom",
      startDate: "2026-07-30",
      endDate: "2026-08-09",
    }, "2026-08-09")).toBe("30 Jul–9 Agu 2026");
  });

  test("labels a cutoff-based today using the active work date before 16.00 WIB", () => {
    expect(formatPerformancePeriodLabel({
      ...weeklyDraft,
      preset: "today",
      basis: "work",
    }, "2026-08-09", Date.parse("2026-08-09T11:00:00+07:00"))).toBe(
      "Hari ini · 8 Agu 2026",
    );
  });

  test("builds a Monday-first calendar grid with adjacent-month days", () => {
    const days = buildCalendarMonth("2026-08");

    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ date: "2026-07-27", day: 27, inMonth: false });
    expect(days[5]).toEqual({ date: "2026-08-01", day: 1, inMonth: true });
    expect(days[41]).toEqual({ date: "2026-09-06", day: 6, inMonth: false });
  });

  test("renders a single discoverable period trigger instead of a long select", () => {
    const html = renderToStaticMarkup(
      <PerformancePeriodPicker
        today="2026-08-09"
        value={weeklyDraft}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Pilih periode laporan"');
    expect(html).toContain("Pekan ini · 3–9 Agu 2026");
    expect(html).toContain("Buka kalender");
    expect(html).not.toContain("Pilih bulan</option>");
  });
});
