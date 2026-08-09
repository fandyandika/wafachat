import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  dashboardPerformanceHref,
  DashboardHistoryFilter,
  formatDashboardBoundary,
  isHistoricalDashboardRange,
} from "./dashboard-history-filter";

(globalThis as any).React = React;

describe("DashboardHistoryFilter", () => {
  test("renders a labeled, touch-safe one-day filter without expanding analytics controls", () => {
    const html = renderToStaticMarkup(
      <DashboardHistoryFilter
        today="2026-08-08"
        currentWorkDate="2026-08-07"
        applied={{ date: "2026-08-07", basis: "calendar" }}
        onApply={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Pilih tanggal Dashboard"');
    expect(html).toContain('type="date"');
    expect(html).toContain('max="2026-08-08"');
    expect(html).toContain("Hari kalender");
    expect(html).toContain("Cutoff CS · 16.00");
    expect(html).toContain("Sudah diterapkan");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("Pekanan");
    expect(html).not.toContain("Bulanan");
  });

  test("builds a validated daily Performance handoff", () => {
    expect(dashboardPerformanceHref({ date: "2026-08-07", basis: "calendar" })).toBe(
      "/panel/performance?period=day&date=2026-08-07&basis=calendar",
    );
    expect(dashboardPerformanceHref({ date: "2026-08-07", basis: "work" })).toBe(
      "/panel/performance?period=day&date=2026-08-07&basis=work",
    );
  });

  test("uses range completion rather than the opening date to identify history", () => {
    expect(isHistoricalDashboardRange({ running: true })).toBe(false);
    expect(isHistoricalDashboardRange({ running: false })).toBe(true);
  });

  test("names the exact Jakarta boundary instead of an ambiguous date", () => {
    expect(formatDashboardBoundary({
      date: "2026-08-07",
      basis: "work",
      startAt: Date.parse("2026-08-07T16:00:00+07:00"),
      endAt: Date.parse("2026-08-08T16:00:00+07:00"),
      running: false,
    })).toBe("7 Agu 16.00–8 Agu 16.00 WIB");
  });
});
