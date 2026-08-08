import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { CsMetricRow, ProductMetricRow } from "@/lib/performance-report";
import {
  CsPerformanceBreakdown,
  ProductPerformanceBreakdown,
  sortProductRows,
} from "./performance-breakdowns";

(globalThis as any).React = React;

const product = (name: string, leads: number, closings: number, cr: number): ProductMetricRow => ({
  product: name,
  leads,
  closings,
  cr,
  revenue: closings * 100_000,
  cod: closings,
  transfer: 0,
  codPct: 100,
  transferPct: 0,
  delivered: 0,
  cancelled: 0,
  discount: 0,
});

test("sorts product rows locally without mutating report data", () => {
  const rows = [product("B", 10, 9, 90), product("A", 20, 8, 40)];
  expect(sortProductRows(rows, "closing").map((row) => row.product)).toEqual(["B", "A"]);
  expect(sortProductRows(rows, "cr").map((row) => row.product)).toEqual(["A", "B"]);
  expect(rows.map((row) => row.product)).toEqual(["B", "A"]);
});

const csRow: CsMetricRow = {
  ...product("unused", 488, 368, 75.4),
  csKey: "nabila",
  csName: "Nabila",
  responseMedianMs: 55_000,
  deltaCr: 5.8,
};

test("renders Per CS as a desktop table and a no-scroll mobile ledger", () => {
  const html = renderToStaticMarkup(
    <CsPerformanceBreakdown rows={[csRow]} />,
  );
  expect(html).toContain('data-layout="desktop-table"');
  expect(html).toContain('data-layout="mobile-ledger"');
  expect(html).toContain("hidden md:block");
  expect(html).toContain("md:hidden");
  expect(html).toContain("Nabila");
  expect(html).toContain("368 closing");
  expect(html).toContain("75,4%");
  expect(html).toContain("55 dtk");
  expect(html.match(/75,4%/g)).toHaveLength(2);
  expect(html.match(/55 dtk/g)).toHaveLength(2);
  expect(html.match(/Rp36\.800\.000/g)).toHaveLength(2);
});

test("wraps long product names and exposes the same metrics on mobile", () => {
  const row = product("Al Qur'an Medis dengan Hadis Medis dan Jurnal Kesehatan", 120, 84, 70);
  const html = renderToStaticMarkup(<ProductPerformanceBreakdown rows={[row]} />);
  expect(html).toContain('title="Al Qur&#x27;an Medis dengan Hadis Medis dan Jurnal Kesehatan"');
  expect(html).toContain("line-clamp-2");
  expect(html).toContain("84 closing");
  expect(html).toContain("Rp8.400.000");
  expect(html).toContain("COD 100%");
  expect(html.match(/Rp8\.400\.000/g)).toHaveLength(2);
  expect(html.match(/CR 70%|>70%</g)).toHaveLength(2);
});
