import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
const { snapshotMock } = vi.hoisted(() => ({ snapshotMock: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: () => [{ key: "aisyah", csName: "Aisyah", avatarUrl: null }],
}));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: any[]) => {
    snapshotMock(...args);
    return { data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() };
  },
}));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ startAt: 1, endAt: 2, csName: undefined }),
}));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/performance-panel", () => ({
  PerformancePanel: ({ scopeLabel }: { scopeLabel: string }) => <div>Report loaded for {scopeLabel}</div>,
}));

import PerformancePage, { PerformanceResultRegion } from "./page";
import { api } from "@/convex/_generated/api";
import type { PerformanceReport } from "@/lib/performance-report";

const reportFixture: PerformanceReport = {
  period: "week",
  startDate: "2026-08-03",
  endDate: "2026-08-09",
  effectiveEndDate: "2026-08-08",
  status: "running",
  generatedAt: Date.parse("2026-08-08T14:00:00Z"),
  summary: {
    leads: 30,
    closings: 15,
    cr: 50,
    revenue: 3_000_000,
    cod: 9,
    transfer: 6,
    codPct: 60,
    transferPct: 40,
    delivered: 12,
    cancelled: 1,
    discount: 50_000,
    deltaLeads: 5,
    deltaClosings: 2,
    deltaCr: 3.1,
    deltaRevenue: 500_000,
  },
  cs: [],
  products: [],
  weeks: [],
};

test("performance stays idle until the owner submits a period", () => {
  const html = renderToStaticMarkup(<PerformancePage />);

  expect(snapshotMock).toHaveBeenCalledTimes(1);
  expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, "skip");
  expect(html).toContain('aria-label="Filter laporan kinerja"');
  expect(html).toContain('data-testid="performance-filter-grid"');
  expect(html).toContain("md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto]");
  expect(html).toContain("grid gap-1.5 text-sm font-medium");
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("min-h-11");
  expect(html).toContain('type="date" class="min-h-11');
  expect(html).not.toContain("<h1");
  expect(html).toContain("Pilih periode lalu tampilkan laporan");
  expect(html).toContain("Semua CS");
  expect(html).not.toContain(">all<");
});

test("keeps a stable loading region before the first result", () => {
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", startDate: "2026-08-03", endDate: "2026-08-09" }}
      report={{ data: undefined, loading: true, error: null, refresh: vi.fn() }}
    />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain("Menyiapkan laporan");
  expect(html).toContain("min-h-40");
});

test("keeps the prior result visible while refreshing", () => {
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" }}
      report={{ data: reportFixture, loading: true, error: null, refresh: vi.fn() }}
    />,
  );
  expect(html).toContain("Report loaded for Aisyah");
  expect(html).not.toContain("Menyiapkan laporan</p>");
});

test("shows scoped empty and retryable error states", () => {
  const emptyHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", startDate: "2026-08-03", endDate: "2026-08-09", csName: "Aisyah" }}
      report={{ data: { ...reportFixture, summary: { ...reportFixture.summary, leads: 0, closings: 0 } }, loading: false, error: null, refresh: vi.fn() }}
    />,
  );
  expect(emptyHtml).toContain("Belum ada data untuk Aisyah pada periode ini");

  const errorHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", startDate: "2026-08-03", endDate: "2026-08-09" }}
      report={{ data: undefined, loading: false, error: "Server error", refresh: vi.fn() }}
    />,
  );
  expect(errorHtml).toContain("Laporan gagal dimuat");
  expect(errorHtml).toContain("Coba lagi");
});
