import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { MetricRow, PerformanceReport } from "@/lib/performance-report";
import {
  nextPerformanceTab,
  PerformanceBreakdownContent,
  PerformancePanel,
} from "./performance-panel";

(globalThis as any).React = React;

const metrics: MetricRow = {
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
};

const report: PerformanceReport = {
  period: "month",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  effectiveEndDate: "2026-08-05",
  status: "running",
  generatedAt: Date.parse("2026-08-05T10:00:00Z"),
  summary: {
    ...metrics,
    cr: 67.2,
    deltaLeads: 5,
    deltaClosings: 2,
    deltaCr: 3.1,
    deltaRevenue: 500_000,
  },
  cs: [{ ...metrics, csKey: "aisyah", csName: "Aisyah", responseMedianMs: 60_000, deltaCr: 2.5 }],
  products: [{ ...metrics, product: "Quran Mapping" }],
  weeks: [
    { startDate: "2026-08-01", endDate: "2026-08-02", partial: true, status: "complete", metrics },
    { startDate: "2026-08-03", endDate: "2026-08-09", partial: false, status: "running", metrics },
    { startDate: "2026-08-31", endDate: "2026-08-31", partial: true, status: "running", metrics: { ...metrics, leads: 0, closings: 0 } },
  ],
};

test("shows the running summary and clipped monthly weeks", () => {
  const html = renderToStaticMarkup(
    <PerformancePanel report={report} scopeLabel="Semua CS" />,
  );

  expect(html).toContain("1–31 Agu");
  expect(html).toContain("Semua CS");
  expect(html).toContain("Berjalan");
  expect(html).toContain("Data sampai 5 Agu");
  expect(html).toContain('aria-label="Status laporan"');
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("min-h-11");
  expect(html).toContain("Ringkasan periode");
  expect(html).toContain("Rincian pekanan");
  expect(html).toContain('aria-label="Metrik utama"');
  expect(html).toContain('aria-label="Metrik pendukung"');
  expect(html).toContain("Berjalan");
  expect(html).toContain("67,2%");
  expect(html).toContain("↑ 3,1 poin");
  expect(html).toContain("↑ Rp500.000");
  expect(html).not.toContain("↑ 3,1%");
  expect(html).not.toContain("33703258");
  expect(html).toContain("COD 60%");
  expect(html).toContain("Transfer 40%");
  expect(html).toContain("1–2 Agu");
  expect(html).toContain("Pekan parsial");
  expect(html).toContain("31 Agu");
});

test("formats large revenue deltas in Indonesian Rupiah", () => {
  const html = renderToStaticMarkup(
    <PerformancePanel
      report={{
        ...report,
        summary: { ...report.summary, deltaRevenue: 33_703_258 },
      }}
      scopeLabel="Semua CS"
    />,
  );

  expect(html).toContain("↑ Rp33.703.258");
});

test.each([
  ["summary", "ArrowRight", "cs"],
  ["summary", "ArrowLeft", "product"],
  ["product", "ArrowRight", "summary"],
  ["cs", "Home", "summary"],
  ["cs", "End", "product"],
  ["summary", "Enter", null],
] as const)("moves from %s with %s to %s", (current, key, expected) => {
  expect(nextPerformanceTab(current, key)).toBe(expected);
});

test.each([
  ["cs", "Performa per CS", "Aisyah", "1 mnt"],
  ["product", "Performa per produk", "Quran Mapping", "15 closing"],
] as const)("mounts the extracted %s breakdown for the selected panel tab", (tab, title, rowLabel, metric) => {
  const html = renderToStaticMarkup(
    <PerformanceBreakdownContent tab={tab} report={report} />,
  );

  expect(html).toContain(title);
  expect(html).toContain(rowLabel);
  expect(html).toContain(metric);
  expect(html).toContain('data-layout="desktop-table"');
  expect(html).toContain('data-layout="mobile-ledger"');
});

test("keeps core metrics visible when response samples are limited", () => {
  const html = renderToStaticMarkup(
    <PerformancePanel
      report={{
        ...report,
        responseNotice: "Response time membutuhkan rentang lebih pendek",
      }}
      scopeLabel="Semua CS"
    />,
  );

  expect(html).toContain("Response time membutuhkan rentang lebih pendek");
  expect(html).toContain("Rp3.000.000");
});
