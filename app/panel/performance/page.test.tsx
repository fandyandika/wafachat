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
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
import PerformancePage from "./page";
import {
  associatePerformanceResult,
  PerformanceRefreshAction,
  PerformanceResultRegion,
  submitPerformanceRequest,
} from "@/components/panel/performance-panel";
import * as performancePageModule from "./page";
import { api } from "@/convex/_generated/api";
import type { PerformanceReport } from "@/lib/performance-report";

const reportFixture: PerformanceReport = {
  period: "week",
  basis: "work",
  startDate: "2026-08-03",
  endDate: "2026-08-09",
  effectiveEndDate: "2026-08-08",
  status: "running",
  generatedAt: Date.parse("2026-08-08T14:00:00Z"),
  summary: {
    responseMedianMs: null,
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

test("exports only the default component from the Next.js page module", () => {
  expect(Object.keys(performancePageModule)).toEqual(["default"]);
});

test("performance stays idle until the owner submits a period", () => {
  const html = renderToStaticMarkup(<PerformancePage />);

  expect(snapshotMock).toHaveBeenCalledTimes(1);
  expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, "skip");
  expect(html).toContain('aria-label="Filter laporan kinerja"');
  expect(html).toContain('data-testid="performance-filter-grid"');
  expect(html).toContain("Pekan ini");
  expect(html).toContain("Periode laporan");
  expect(html).toContain("min-h-11");
  expect(html).not.toContain("<h1");
  expect(html).toContain("Pilih periode lalu tampilkan laporan");
  expect(html).toContain("Semua CS");
  expect(html).not.toContain(">all<");
});

test("keeps a stable loading region before the first result", () => {
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", basis: "work", startDate: "2026-08-03", endDate: "2026-08-09" }}
      report={{ data: undefined, loading: true, error: null, refresh: vi.fn() }}
    />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain("Menyiapkan laporan");
  expect(html).toContain("min-h-40");
});

test("keeps a stable loading region while the first submitted request is pending its loading update", () => {
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", basis: "work", startDate: "2026-08-03", endDate: "2026-08-09" }}
      report={{ data: undefined, loading: false, error: null, refresh: vi.fn() }}
    />,
  );

  expect(html).toContain('role="status"');
  expect(html).toContain("Menyiapkan laporan");
  expect(html).toContain("min-h-40");
});

test("keeps the prior result visible while refreshing", () => {
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", basis: "work", startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" }}
      report={{ data: reportFixture, loading: true, error: null, refresh: vi.fn() }}
    />,
  );
  expect(html).toContain("Aisyah");
  expect(html).not.toContain("Menyiapkan laporan</p>");
});

test("keeps retained data associated with its submitted scope until replacement data arrives", () => {
  const aisyahRequest = { period: "week" as const, basis: "work" as const, startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" };
  const bungaRequest = { period: "week" as const, basis: "work" as const, startDate: "2026-08-10", endDate: "2026-08-16", csName: "CS Bunga" };
  const aisyahResult = associatePerformanceResult(null, aisyahRequest, reportFixture);
  const retainedResult = associatePerformanceResult(aisyahResult, bungaRequest, reportFixture);

  expect(retainedResult).toBe(aisyahResult);

  const retainedHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={bungaRequest}
      report={{ data: reportFixture, loading: true, error: null, refresh: vi.fn() }}
      displayed={retainedResult}
    />,
  );
  expect(retainedHtml).toContain("Aisyah");
  expect(retainedHtml).not.toContain("Bunga");

  const bungaReport = {
    ...reportFixture,
    startDate: "2026-08-10",
    endDate: "2026-08-16",
    generatedAt: Date.parse("2026-08-15T14:00:00Z"),
  };
  const bungaResult = associatePerformanceResult(retainedResult, bungaRequest, bungaReport);
  expect(bungaResult).toEqual({ data: bungaReport, submitted: bungaRequest });
  const replacedHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={bungaRequest}
      report={{ data: bungaReport, loading: false, error: null, refresh: vi.fn() }}
      displayed={bungaResult}
    />,
  );
  expect(replacedHtml).toContain("Bunga");
  expect(replacedHtml).not.toContain("Aisyah");
});

test("an identical explicit submission refreshes exactly once instead of replacing submitted args", () => {
  const submitted = { period: "week" as const, basis: "work" as const, startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" };
  const next = Object.freeze({ ...submitted });
  const replaceSubmitted = vi.fn();
  const refresh = vi.fn();

  expect(submitPerformanceRequest({ submitted, next, replaceSubmitted, refresh })).toBe("refresh");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(replaceSubmitted).not.toHaveBeenCalled();
});

test("a changed explicit submission replaces submitted args without refreshing", () => {
  const submitted = { period: "week" as const, basis: "work" as const, startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" };
  const next = Object.freeze({ ...submitted, startDate: "2026-08-10", endDate: "2026-08-16" });
  const replaceSubmitted = vi.fn();
  const refresh = vi.fn();

  expect(submitPerformanceRequest({ submitted, next, replaceSubmitted, refresh })).toBe("replace");
  expect(replaceSubmitted).toHaveBeenCalledTimes(1);
  expect(replaceSubmitted).toHaveBeenCalledWith(next);
  expect(refresh).not.toHaveBeenCalled();
});

test("shows the header refresh action only for a retained success without an error retry", () => {
  const displayed = {
    data: reportFixture,
    submitted: { period: "week" as const, basis: "work" as const, startDate: "2026-08-03", endDate: "2026-08-09" },
  };
  const state = { data: undefined, loading: false, error: null, refresh: vi.fn() };
  const firstLoadHtml = renderToStaticMarkup(
    <PerformanceRefreshAction displayed={null} report={state} />,
  );
  const successHtml = renderToStaticMarkup(
    <PerformanceRefreshAction displayed={displayed} report={state} />,
  );
  const retainedErrorHtml = renderToStaticMarkup(
    <PerformanceRefreshAction displayed={displayed} report={{ ...state, error: "Server error" }} />,
  );

  expect(firstLoadHtml).not.toContain("Refresh laporan");
  expect(successHtml).toContain('aria-label="Refresh laporan"');
  expect(retainedErrorHtml).not.toContain("Refresh laporan");
});

test("shows a retryable error without hiding the retained result", () => {
  const aisyahRequest = { period: "week" as const, basis: "work" as const, startDate: "2026-08-03", endDate: "2026-08-09", csName: "CS Aisyah" };
  const displayed = associatePerformanceResult(null, aisyahRequest, reportFixture);
  const html = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ ...aisyahRequest, csName: "CS Bunga" }}
      report={{ data: reportFixture, loading: false, error: "Server error", refresh: vi.fn() }}
      displayed={displayed}
    />,
  );

  expect(html).toContain("Laporan gagal dimuat");
  expect(html).toContain("Coba lagi");
  expect(html).toContain("Aisyah");
  expect(html).not.toContain("Bunga");
});

test("shows scoped empty and retryable error states", () => {
  const emptyHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", basis: "work", startDate: "2026-08-03", endDate: "2026-08-09", csName: "Aisyah" }}
      report={{ data: { ...reportFixture, summary: { ...reportFixture.summary, leads: 0, closings: 0 } }, loading: false, error: null, refresh: vi.fn() }}
    />,
  );
  expect(emptyHtml).toContain("Belum ada data untuk Aisyah pada periode ini");
  expect(emptyHtml).toContain('aria-label="Status laporan"');
  expect(emptyHtml).toContain("3–9 Agu");
  expect(emptyHtml).toContain("Aisyah");
  expect(emptyHtml).toContain("Berjalan");
  expect(emptyHtml).toContain("Data sampai 8 Agu");

  const errorHtml = renderToStaticMarkup(
    <PerformanceResultRegion
      submitted={{ period: "week", basis: "work", startDate: "2026-08-03", endDate: "2026-08-09" }}
      report={{ data: undefined, loading: false, error: "Server error", refresh: vi.fn() }}
    />,
  );
  expect(errorHtml).toContain("Laporan gagal dimuat");
  expect(errorHtml).toContain("Coba lagi");
});
