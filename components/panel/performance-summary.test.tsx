import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { PerformanceReport } from "@/lib/performance-report";
import { PerformanceSummary, PerformanceSummarySkeleton } from "./performance-summary";

(globalThis as any).React = React;

const summary: PerformanceReport["summary"] = {
  leads: 1733, closings: 1231, cr: 71, revenue: 244_682_091,
  cod: 840, transfer: 391, codPct: 68.2, transferPct: 31.8,
  delivered: 1200, cancelled: 31, discount: 649_000,
  responseMedianMs: 60_000,
  deltaLeads: 190, deltaClosings: 177, deltaCr: 2.7, deltaRevenue: 33_703_258,
};

test("renders one ruled metric matrix with complete operational context", () => {
  const html = renderToStaticMarkup(<PerformanceSummary summary={summary} />);
  for (const label of ["Leads", "Closing", "Conversion Rate", "Omzet", "Respons CS", "Diskon", "COD", "Transfer", "Rasio pembayaran", "Terkirim", "Dibatalkan"]) {
    expect(html).toContain(label);
  }
  expect(html).toContain("tracking-[0.12em]");
  expect(html).toContain("tabular-nums");
  expect(html).toContain("Rp244.682.091");
  expect(html).toContain("↑ Rp33.703.258");
  expect(html).toContain("↑ 2,7 poin");
  expect(html.match(/shadow-sm/g)).toBeNull();
});

test("renders six stable ruled skeleton cells for first load", () => {
  const html = renderToStaticMarkup(<PerformanceSummarySkeleton />);
  expect(html).toContain('aria-label="Menyiapkan ringkasan laporan"');
  expect(html.match(/data-summary-skeleton-cell/g)).toHaveLength(6);
  expect(html).toContain("border-ledger-rule");
});
