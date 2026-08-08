# Performance P2A Operational Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing on-demand Performance report faster to scan on desktop and mobile without changing its data, calculations, request count, or Convex I/O.

**Architecture:** Preserve `PerformancePage` as the owner of draft filters and the submitted snapshot request. Keep summary and period context in `PerformancePanel`, while extracting only the dense Per CS and Per Product presentations into a focused responsive breakdown module that renders a desktop table and mobile ledger from the same in-memory rows. No backend contract, hook, query, schema, or dependency changes are permitted.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, existing WaFaChat UI primitives, Vitest, React DOM server rendering.

## Global Constraints

- Keep `Pekanan`, `Bulanan`, `Rentang khusus`, the CS selector, `Tampilkan laporan`, and manual refresh behavior.
- Draft filter changes must not query Convex; only explicit generation or refresh may request a snapshot.
- Keep current period semantics, 16:00 WIB cutoff, comparison calculations, metric formulas, authorization, and product sorting rules.
- Add no Convex query, mutation, index, schema field, rollup, background job, polling, prefetch, live subscription, chart, export, saved snapshot, score, ranking, or dependency.
- Desktop uses comparison tables; mobile uses ledger rows backed by the exact same report result.
- Keep Dashboard, Laporan, Follow-up, Settings, Queen Recap, navigation, and the global shell outside this phase.
- Reuse existing UI primitives and formatting helpers; add only page-local components that remove real responsive duplication.

---

## File map

- `app/panel/performance/page.tsx`: owns draft controls, submitted arguments, snapshot loading/error/empty orchestration, and passes the submitted CS scope to the result.
- `app/panel/performance/page.test.tsx`: protects idle request behavior and the control/result state contract.
- `components/panel/performance-panel.tsx`: owns submitted-period context, summary metrics, tabs, and monthly week detail.
- `components/panel/performance-panel.test.tsx`: protects summary hierarchy, delta formatting, context, tabs, and response notices.
- `components/panel/performance-breakdowns.tsx`: new page-local module for Per CS and Per Product desktop tables/mobile ledgers plus pure local product sorting.
- `components/panel/performance-breakdowns.test.tsx`: new focused parity, responsive, semantic, long-name, and sorting tests.
- `components/panel/use-convex-snapshot-query.ts`: read-only reference; must not be edited.
- `convex/performanceReports.ts`: read-only reference; must not be edited.

---

### Task 1: Make submitted report context explicit

**Files:**
- Modify: `components/panel/performance-panel.test.tsx`
- Modify: `components/panel/performance-panel.tsx`
- Modify: `app/panel/performance/page.tsx`

**Interfaces:**
- Consumes: existing `PerformanceReport`, `DateRange`, and the submitted `csName?: string` in `PerformancePage`.
- Produces: `PerformancePanel({ report, scopeLabel }: { report: PerformanceReport; scopeLabel: string })`.

- [ ] **Step 1: Write the failing status-band test**

Update the first `PerformancePanel` test render and assertions:

```tsx
const html = renderToStaticMarkup(
  <PerformancePanel report={report} scopeLabel="Semua CS" />,
);

expect(html).toContain("1–31 Agu");
expect(html).toContain("Semua CS");
expect(html).toContain("Berjalan");
expect(html).toContain("Data sampai 5 Agu");
expect(html).toContain('aria-label="Status laporan"');
```

Update every other test render in the file to pass `scopeLabel="Semua CS"`.

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```powershell
rtk npm test -- components/panel/performance-panel.test.tsx
```

Expected: FAIL because `PerformancePanel` does not accept or render `scopeLabel` and has no `Status laporan` landmark.

- [ ] **Step 3: Implement the compact submitted-period status band**

Change the component signature and replace the existing status paragraph with a readable context row:

```tsx
export function PerformancePanel({
  report,
  scopeLabel,
}: {
  report: PerformanceReport;
  scopeLabel: string;
}) {
  // existing state remains unchanged
```

```tsx
<section
  aria-label="Status laporan"
  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
>
  <div className="min-w-0">
    <p className="font-medium">Ringkasan periode</p>
    <p className="mt-0.5 text-xs text-muted-foreground">
      {rangeLabel({ startDate: report.startDate, endDate: report.endDate })}
      {" · "}{scopeLabel}{" · Data sampai "}{dateLabel(report.effectiveEndDate)}
    </p>
  </div>
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span className="rounded-full border border-border bg-muted/40 px-2 py-1 font-medium text-foreground">
      {report.status === "running" ? "Berjalan" : "Selesai"}
    </span>
    <span>
      Dibuat {new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(report.generatedAt)}
    </span>
  </div>
</section>
```

Pass only the submitted scope from the page, not the mutable draft field:

```tsx
{report.data ? (
  <PerformancePanel
    report={report.data}
    scopeLabel={submitted.csName?.replace(/^CS\s+/i, "") || "Semua CS"}
  />
) : null}
```

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
rtk npm test -- components/panel/performance-panel.test.tsx app/panel/performance/page.test.tsx
```

Expected: both test files PASS; the page still calls the report hook with `"skip"` before submission.

- [ ] **Step 5: Commit the explicit report context**

```powershell
rtk git add components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx app/panel/performance/page.tsx
rtk git commit -m "feat: clarify Performance report context"
```

---

### Task 2: Establish primary and secondary summary hierarchy

**Files:**
- Modify: `components/panel/performance-panel.test.tsx`
- Modify: `components/panel/performance-panel.tsx`

**Interfaces:**
- Consumes: existing `report.summary` values and shared `DeltaPill` formatter callback.
- Produces: local `SummaryMetricCard` with `density: "primary" | "secondary"`; formatted comparison labels for counts, percentage points, and Rupiah.

- [ ] **Step 1: Write failing hierarchy and formatting assertions**

Add these assertions to the running-summary test:

```tsx
expect(html).toContain('aria-label="Metrik utama"');
expect(html).toContain('aria-label="Metrik pendukung"');
expect(html).toContain("↑ 3,1 poin");
expect(html).toContain("↑ Rp500.000");
expect(html).not.toContain("↑ 3,1%");
expect(html).not.toContain("33703258");
```

Add a revenue fixture with `deltaRevenue: 33_703_258` and assert:

```tsx
expect(html).toContain("↑ Rp33.703.258");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
rtk npm test -- components/panel/performance-panel.test.tsx
```

Expected: FAIL because the current summary has one flat grid and CR delta uses `%` rather than `poin`.

- [ ] **Step 3: Implement the two-level metric layout**

Rename the local card and give it an explicit density:

```tsx
function SummaryMetricCard({
  label,
  value,
  delta,
  deltaFormat,
  density,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  deltaFormat?: (value: number) => string;
  density: "primary" | "secondary";
}) {
  return (
    <div className={cn(
      "rounded-xl border border-border bg-card shadow-sm",
      density === "primary" ? "p-4" : "p-3.5",
    )}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn(
        "mt-1 flex flex-wrap items-center gap-2 font-semibold tabular-nums",
        density === "primary" ? "text-xl sm:text-2xl" : "text-lg",
      )}>
        <span>{value}</span>
        {delta !== undefined ? <DeltaPill value={delta} format={deltaFormat} /> : null}
      </div>
    </div>
  );
}

const points = (value: number) => `${number.format(value)} poin`;
```

Split the summary into two labelled groups:

```tsx
<section aria-label="Metrik utama" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <SummaryMetricCard density="primary" label="Leads" value={number.format(s.leads)} delta={s.deltaLeads} />
  <SummaryMetricCard density="primary" label="Closing" value={number.format(s.closings)} delta={s.deltaClosings} />
  <SummaryMetricCard density="primary" label="Conversion rate" value={pct(s.cr)} delta={s.deltaCr} deltaFormat={points} />
  <SummaryMetricCard density="primary" label="Omzet" value={formatRupiah(s.revenue)} delta={s.deltaRevenue} deltaFormat={formatRupiah} />
</section>

<section aria-label="Metrik pendukung" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
  <SummaryMetricCard density="secondary" label="Diskon" value={formatRupiah(s.discount)} />
  <SummaryMetricCard density="secondary" label="COD" value={number.format(s.cod)} />
  <SummaryMetricCard density="secondary" label="Transfer" value={number.format(s.transfer)} />
  <SummaryMetricCard density="secondary" label="Rasio pembayaran" value={<span className="text-sm">COD {pct(s.codPct)} · Transfer {pct(s.transferPct)}</span>} />
  <SummaryMetricCard density="secondary" label="Terkirim" value={number.format(s.delivered)} />
  <SummaryMetricCard density="secondary" label="Dibatalkan" value={number.format(s.cancelled)} />
</section>
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
rtk npm test -- components/panel/performance-panel.test.tsx
```

Expected: PASS with `poin` for conversion deltas and localized Rupiah for revenue deltas.

- [ ] **Step 5: Commit the summary hierarchy**

```powershell
rtk git add components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx
rtk git commit -m "feat: prioritize Performance summary metrics"
```

---

### Task 3: Add responsive Per CS and Per Product ledgers

**Files:**
- Create: `components/panel/performance-breakdowns.tsx`
- Create: `components/panel/performance-breakdowns.test.tsx`
- Modify: `components/panel/performance-panel.tsx`
- Modify: `components/panel/performance-panel.test.tsx`

**Interfaces:**
- Consumes: `CsMetricRow[]`, `ProductMetricRow[]`, optional `responseNotice`, shared `formatDuration`, shared `formatRupiah`, and shared `DeltaPill`.
- Produces: `CsPerformanceBreakdown`, `ProductPerformanceBreakdown`, `sortProductRows(rows, sort)`, and `ProductSort = "closing" | "cr"`.

- [ ] **Step 1: Write the failing pure sorting tests**

Create `components/panel/performance-breakdowns.test.tsx` with fixtures and exact ordering checks:

```tsx
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
  const rows = [product("B", 20, 10, 50), product("A", 10, 8, 80)];
  expect(sortProductRows(rows, "closing").map((row) => row.product)).toEqual(["B", "A"]);
  expect(sortProductRows(rows, "cr").map((row) => row.product)).toEqual(["B", "A"]);
  expect(rows.map((row) => row.product)).toEqual(["B", "A"]);
});
```

- [ ] **Step 2: Write failing responsive parity tests**

Add one CS fixture and render both breakdowns:

```tsx
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
```

- [ ] **Step 3: Run the new tests and verify the module is missing**

Run:

```powershell
rtk npm test -- components/panel/performance-breakdowns.test.tsx
```

Expected: FAIL because `performance-breakdowns.tsx` does not exist.

- [ ] **Step 4: Implement pure formatting and product sorting**

Create `components/panel/performance-breakdowns.tsx` and begin with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaPill } from "@/components/ui/metric-card";
import { formatDuration, formatRupiah } from "@/lib/format";
import type { CsMetricRow, ProductMetricRow } from "@/lib/performance-report";

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const pct = (value: number) => `${number.format(value)}%`;
export type ProductSort = "closing" | "cr";

export function sortProductRows(rows: ProductMetricRow[], sort: ProductSort): ProductMetricRow[] {
  return [...rows].sort((a, b) => sort === "cr"
    ? a.cr - b.cr || b.closings - a.closings
    : b.closings - a.closings || a.product.localeCompare(b.product));
}

function PaymentSplit({ codPct, transferPct }: { codPct: number; transferPct: number }) {
  return <span>COD {pct(codPct)} · Transfer {pct(transferPct)}</span>;
}
```

- [ ] **Step 5: Implement the Per CS desktop table and mobile ledger**

Add `CsPerformanceBreakdown` with a shared `rows` prop and no fetch logic:

```tsx
export function CsPerformanceBreakdown({
  rows,
  responseNotice,
}: {
  rows: CsMetricRow[];
  responseNotice?: string;
}) {
  const response = (row: CsMetricRow) => responseNotice
    ? "Rentang terlalu panjang"
    : formatDuration(row.responseMedianMs);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performa per CS</CardTitle>
        <CardDescription>Bandingkan closing, conversion rate, dan kecepatan respons.</CardDescription>
      </CardHeader>
      <CardContent>
        <div data-layout="desktop-table" className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Perbandingan kinerja per CS</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">CS</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Closing</th>
                <th className="pb-2 text-right font-medium">CR</th>
                <th className="pb-2 text-right font-medium">Balas pertama</th>
                <th className="pb-2 text-right font-medium">Omzet</th>
                <th className="pb-2 text-right font-medium">Pembayaran</th>
              </tr>
            </thead>
            <tbody>{rows.map((row) => (
              <tr key={row.csKey} className="border-t border-border">
                <th scope="row" className="py-3 text-left font-medium">{row.csName}</th>
                <td className="py-3 text-right tabular-nums">{number.format(row.leads)}</td>
                <td className="py-3 text-right tabular-nums">{number.format(row.closings)}</td>
                <td className="py-3 text-right tabular-nums">{pct(row.cr)} <DeltaPill value={row.deltaCr} suffix=" poin" /></td>
                <td className="py-3 text-right tabular-nums">{response(row)}</td>
                <td className="py-3 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                <td className="py-3 text-right tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div data-layout="mobile-ledger" className="divide-y divide-border md:hidden">
          {rows.map((row) => (
            <article key={row.csKey} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <h3 className="font-semibold">{row.csName}</h3>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong>{number.format(row.closings)} closing</strong>
                <span className="tabular-nums">CR {pct(row.cr)}</span>
                <DeltaPill value={row.deltaCr} suffix=" poin" />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Leads</dt><dd>{number.format(row.leads)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Balas pertama</dt><dd>{response(row)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Omzet</dt><dd>{formatRupiah(row.revenue)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Pembayaran</dt><dd><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></dd></div>
              </dl>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Implement the Per Product desktop table and mobile ledger**

Add `ProductPerformanceBreakdown`; keep sorting in local state so it never changes submitted query arguments:

```tsx
export function ProductPerformanceBreakdown({ rows }: { rows: ProductMetricRow[] }) {
  const [sort, setSort] = useState<ProductSort>("closing");
  const products = useMemo(() => sortProductRows(rows, sort), [rows, sort]);

  return (
    <Card>
      <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <CardTitle>Performa per produk</CardTitle>
          <CardDescription>Bandingkan closing, conversion rate, dan omzet produk.</CardDescription>
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Urutkan produk
          <select
            aria-label="Urutkan produk"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProductSort)}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground sm:min-h-9"
          >
            <option value="closing">Closing terbanyak</option>
            <option value="cr">CR terendah</option>
          </select>
        </label>
      </CardHeader>
      <CardContent>
        <div data-layout="desktop-table" className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Perbandingan kinerja per produk</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Produk</th>
                <th className="pb-2 text-right font-medium">Closing</th>
                <th className="pb-2 text-right font-medium">CR</th>
                <th className="pb-2 text-right font-medium">Omzet</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Pembayaran</th>
              </tr>
            </thead>
            <tbody>{products.map((row) => (
              <tr key={row.product} className="border-t border-border">
                <th scope="row" className="max-w-72 py-3 text-left font-medium"><span title={row.product} className="line-clamp-2">{row.product}</span></th>
                <td className="py-3 text-right tabular-nums">{number.format(row.closings)}</td>
                <td className="py-3 text-right tabular-nums">{pct(row.cr)}</td>
                <td className="py-3 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                <td className="py-3 text-right tabular-nums">{number.format(row.leads)}</td>
                <td className="py-3 text-right tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div data-layout="mobile-ledger" className="divide-y divide-border md:hidden">
          {products.map((row) => (
            <article key={row.product} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <h3 title={row.product} className="line-clamp-2 font-semibold">{row.product}</h3>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong>{number.format(row.closings)} closing</strong>
                <span className="tabular-nums">CR {pct(row.cr)}</span>
                <span className="font-medium tabular-nums">{formatRupiah(row.revenue)}</span>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-muted-foreground">Leads</dt><dd>{number.format(row.leads)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Pembayaran</dt><dd><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></dd></div>
              </dl>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Replace the inline breakdown tables in `PerformancePanel`**

Remove `productSort`, the product `useMemo`, and both inline Card/table blocks. Import and render the focused components:

```tsx
import {
  CsPerformanceBreakdown,
  ProductPerformanceBreakdown,
} from "@/components/panel/performance-breakdowns";
```

```tsx
{tab === "cs" ? (
  <CsPerformanceBreakdown rows={report.cs} responseNotice={report.responseNotice} />
) : null}

{tab === "product" ? (
  <ProductPerformanceBreakdown rows={report.products} />
) : null}
```

- [ ] **Step 8: Run focused breakdown and panel tests**

Run:

```powershell
rtk npm test -- components/panel/performance-breakdowns.test.tsx components/panel/performance-panel.test.tsx
```

Expected: both files PASS; desktop and mobile variants contain the same fixture values, and product sorting remains pure/local.

- [ ] **Step 9: Commit the responsive breakdowns**

```powershell
rtk git add components/panel/performance-breakdowns.tsx components/panel/performance-breakdowns.test.tsx components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx
rtk git commit -m "feat: add responsive Performance ledgers"
```

---

### Task 4: Stabilize result states and prove the I/O boundary

**Files:**
- Modify: `app/panel/performance/page.test.tsx`
- Modify: `app/panel/performance/page.tsx`
- Verify only: `components/panel/use-convex-snapshot-query.ts`
- Verify only: `convex/performanceReports.ts`

**Interfaces:**
- Consumes: existing snapshot state `{ data, loading, error, refresh }` and submitted arguments.
- Produces: exported `PerformanceResultRegion` with stable initial/loading/error/empty/success rendering and no data-fetching responsibility.

- [ ] **Step 1: Extract the result-region contract in the page test**

Mock `PerformancePanel` with visible props and import the named result component:

```tsx
vi.mock("@/components/panel/performance-panel", () => ({
  PerformancePanel: ({ scopeLabel }: { scopeLabel: string }) => <div>Report loaded for {scopeLabel}</div>,
}));

import PerformancePage, { PerformanceResultRegion } from "./page";
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
```

- [ ] **Step 2: Write failing result-state tests**

Add exact state assertions:

```tsx
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
```

- [ ] **Step 3: Run the page test and verify the named component is missing**

Run:

```powershell
rtk npm test -- app/panel/performance/page.test.tsx
```

Expected: FAIL because `PerformanceResultRegion` is not exported.

- [ ] **Step 4: Implement the stable result region without changing the snapshot hook**

Define page-local types and the exported presenter:

```tsx
type SnapshotState = {
  data: PerformanceReport | undefined;
  loading: boolean;
  error: string | null;
  refresh: () => void | Promise<void>;
};

export function PerformanceResultRegion({
  submitted,
  report,
}: {
  submitted: SubmittedArgs | null;
  report: SnapshotState;
}) {
  if (!submitted) {
    return <PanelState kind="empty" title="Pilih periode lalu tampilkan laporan" />;
  }

  if (report.error && !report.data) {
    return (
      <PanelState
        kind="error"
        title="Laporan gagal dimuat"
        description={report.error}
        action={<Button size="sm" variant="outline" onClick={() => report.refresh()}>Coba lagi</Button>}
      />
    );
  }

  if (report.loading && !report.data) {
    return (
      <div role="status" aria-live="polite" className="grid min-h-40 place-items-center rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="text-sm font-medium">Menyiapkan laporan…</p>
      </div>
    );
  }

  if (!report.data) return null;

  const scopeLabel = submitted.csName?.replace(/^CS\s+/i, "") || "Semua CS";
  const empty = report.data.summary.leads === 0 && report.data.summary.closings === 0;
  if (empty) {
    return <PanelState kind="empty" title={`Belum ada data untuk ${scopeLabel} pada periode ini`} />;
  }

  return <PerformancePanel report={report.data} scopeLabel={scopeLabel} />;
}
```

Replace the existing result ternary with:

```tsx
<PerformanceResultRegion submitted={submitted} report={report} />
```

Delete the now-unused `const empty = ...` from `PerformancePage`. Do not edit `use-convex-snapshot-query.ts`; its existing retained-data behavior already keeps the previous report visible during refresh.

- [ ] **Step 5: Run all Performance tests**

Run:

```powershell
rtk npm test -- app/panel/performance/page.test.tsx components/panel/performance-panel.test.tsx components/panel/performance-breakdowns.test.tsx lib/performance-report.test.ts
```

Expected: all Performance-related tests PASS.

- [ ] **Step 6: Prove no new backend or snapshot-hook changes exist**

Run:

```powershell
rtk git diff main...HEAD -- components/panel/use-convex-snapshot-query.ts convex/performanceReports.ts convex/schema.ts
```

Expected: no output.

Run:

```powershell
rtk rg -n "setInterval|setTimeout|useQuery|useMutation|useAction|api\.performanceReports" components/panel/performance-breakdowns.tsx components/panel/performance-panel.tsx
```

Expected: no matches in the two presentation modules.

- [ ] **Step 7: Commit stable result states**

```powershell
rtk git add app/panel/performance/page.tsx app/panel/performance/page.test.tsx
rtk git commit -m "feat: stabilize Performance report states"
```

---

### Task 5: Full verification and responsive browser acceptance

**Files:**
- Modify only if a verified defect is found: files already listed in Tasks 1–4.
- Verify: all tracked project files.

**Interfaces:**
- Consumes: the complete P2A branch from Tasks 1–4.
- Produces: a clean, buildable branch with captured desktop/mobile and request-count evidence.

- [ ] **Step 1: Run static and whitespace checks**

Run:

```powershell
rtk npx tsc --noEmit
rtk git diff --check
```

Expected: all commands exit 0 with no TypeScript or whitespace errors.

- [ ] **Step 2: Run the full test suite**

Run:

```powershell
rtk npm test
```

Expected: all test files PASS; baseline was 62 files and 477 tests before P2A.

- [ ] **Step 3: Run the production build**

Run:

```powershell
rtk npm run build
```

Expected: Next.js production build exits 0 and `/panel/performance` is generated without errors.

- [ ] **Step 4: Verify desktop behavior with production-shaped data**

Open `/panel/performance` at a 1440-pixel desktop viewport and verify:

1. no report request occurs before `Tampilkan laporan`;
2. submitting the current week produces exactly one report request;
3. the status band shows the submitted range, CS scope, cutoff, and status;
4. Ringkasan separates four primary metrics from supporting metrics;
5. Per CS columns follow identity, leads, closing, CR, response, revenue, payment;
6. Per Product follows product, closing, CR, revenue, leads, payment;
7. switching tabs and changing product sort makes no network request;
8. console contains no errors.

- [ ] **Step 5: Verify mobile behavior and overflow**

At a 390×844 viewport, verify:

1. controls stack with a full-width primary action and upright `CS` label;
2. the page root has `scrollWidth === clientWidth`;
3. Per CS and Per Product render ledger rows, not horizontally scrolled tables;
4. long product names remain readable within two lines;
5. every control has a visible focus state and at least a 44-pixel touch target;
6. loading, empty, and error surfaces keep a stable result height.

- [ ] **Step 6: Review the final diff against scope**

Run:

```powershell
rtk git diff --stat main...HEAD
rtk git diff --name-only main...HEAD
rtk git status --short
```

Expected: only the design/plan documents and Performance files listed in this plan appear; worktree status is clean after the final commit.

- [ ] **Step 7: Commit any verification-only correction**

Skip this commit when Step 1–6 require no code correction. If a verified UI defect was corrected, stage only the affected P2A files and commit:

```powershell
rtk git add app/panel/performance components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx components/panel/performance-breakdowns.tsx components/panel/performance-breakdowns.test.tsx
rtk git commit -m "fix: complete Performance P2A verification"
```
