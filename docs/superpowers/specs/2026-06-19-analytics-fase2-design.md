# WaFaChat Dashboard Fase 2 — Analytics (Design Spec)

**Date:** 2026-06-19
**Status:** Approved (design)
**Builds on:** Fase 1 (accurate derive-on-read data: `getDashboardSummary`, `getTrend`, `getPerformance`, all live on prod).

## 1. Goal

Give the operator decision-grade analytics — **which CS is winning/slumping, which product is hard to close, momentum over time, and a periodic recap** — computed accurately from source records. Functional fidelity now (tables + ▲▼ deltas + CSS sparklines); the polished light-mode visual redesign is Fase 3.

## 2. Decisions (locked during brainstorming)

- **Scope:** all four — CS leaderboard (juara/lesu), product difficulty, trend over-time, periodic report.
- **Visual level:** functional — no charting library. Tables, ▲▼ up/down indicators, small CSS sparklines. Fase 3 makes it pretty.
- **Comparison ("vs periode lalu"):** every metric is compared to the **immediately-preceding window of equal length**. Selected `[startAt, endAt]` → prior window `[startAt - (endAt - startAt), startAt]`. For the periodic report, prior = previous week/month.
- **Architecture:** derive-on-read (same pattern as Fase 1). New queries in `convex/analytics.ts`; surface inside the existing **Performance tab → renamed "Analytics"** (it already has Ringkasan / Per CS / Per Produk sub-tabs).
- **Exclusions everywhere:** internal test phones (`isInternalTestPhone`); cancelled recaps excluded from closings/revenue.

## 3. Architecture & components

New file `convex/analytics.ts` (keeps `metrics.ts` focused). Three queries + reuse of existing `getTrend`. All read `orders` + `shippingRecaps` for `[startAt, endAt]` (and the prior window where deltas apply). Metric definitions match Fase 1 exactly (leads = distinct `customerPhone`; closings = distinct order in non-cancelled recaps; CR = closings/leads guarded; revenue = Σ `total ?? codValue ?? nonCodItemPrice` of non-cancelled closings).

### Query contracts

1. **`getCsLeaderboard({ startAt, endAt })`** → `Array<{ csName: string; leads: number; closings: number; cr: number; revenue: number; prevLeads: number; prevClosings: number; prevCr: number; deltaLeads: number; deltaClosings: number; deltaCr: number }>`
   - Per `assignedCsName` (leads, from orders) / `csName` (closings, from recaps). Computes the same metrics for the current and prior windows; `delta* = current - prev`.
   - Sorted by `closings` desc (juara → lesu). The Δ shows who is rising/falling.

2. **`getProductDifficulty({ startAt, endAt, minLeads? })`** → `Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>`
   - Per `productName`. **Per-product leads = orders of that product (order-granularity, not customer-deduped)** — matches Fase 1's per-product rule. Closings = recaps of that product.
   - Filter to `leads >= minLeads` (default **3**) to avoid noise from tiny samples. Sorted by `cr` asc (hardest-to-close first).

3. **`getPeriodReport({ period: "week" | "month", anchor?: number })`** → `{ label: string; rangeStart: number; rangeEnd: number; leads: number; closings: number; cr: number; revenue: number; cancelled: number; prevLeads: number; prevClosings: number; prevCr: number; prevRevenue: number; perCs: Array<{ csName: string; leads: number; closings: number; cr: number; revenue: number }> }`
   - `anchor` defaults to now (Asia/Jakarta). `week` = Mon–Sun containing anchor; `month` = calendar month. Prior = previous week/month. `label` e.g. `"Minggu 2026-W25"` / `"Juni 2026"`.

4. **Trend** — reuse existing `getTrend({ startAt, endAt, bucket })` (day/week/month). No new query.

### Panel (Analytics tab — extends existing Performance tab)

- **Per CS:** table from `getCsLeaderboard`, ranked juara→lesu, with ▲▼ Δ columns (leads/closing/CR vs prior window).
- **Per Produk:** add a "Tersusah closing" view from `getProductDifficulty` (CR asc, min-leads), with ΔCR ▲▼.
- **Trend (new sub-tab):** per-bucket table (leads/closing/CR) + a small CSS sparkline per metric, from `getTrend`.
- **Laporan (new sub-tab):** week/month selector → `getPeriodReport` summary + per-CS breakdown + Δ vs previous period. (Export to sheet/PDF is out of scope — later.)

## 4. Data flow

`orders` + `shippingRecaps` (Convex) → analytics queries (current + prior window, grouped, derived) → Analytics tab (reactive `useQuery`, tables + ▲▼ + sparklines).

## 5. Error handling / edge cases

- Prior window with 0 leads → CR delta guarded (treat prev 0 → delta = current; show as "baru"/▲). Divide-by-zero CR → 0.
- Empty range / no data → empty tables with a friendly empty state.
- Test phones excluded; cancelled recaps excluded from closings/revenue (same status filter as Fase 1).
- `minLeads` guards product noise.

## 6. Testing (convex-test, existing harness)

- **getCsLeaderboard:** seed two windows; assert per-CS leads/closings/CR + correct `delta*` (current − prior); ranking order.
- **getProductDifficulty:** seed products with varying CR; assert sort (CR asc) and `minLeads` filtering; ΔCR.
- **getPeriodReport:** seed a week's data + prior week; assert totals, per-CS, prior deltas, label/range.

## 7. Build sequencing (separate plans, each independently shippable)

- **Plan 2A:** `getCsLeaderboard` + `getProductDifficulty` (+ delta logic) → enrich the Per CS / Per Produk views.
- **Plan 2B:** trend surfacing (sparkline + table) + `getPeriodReport` view (Laporan sub-tab).

## 8. Scope boundary (YAGNI)

**In:** the 3 queries + `getTrend` surfacing; functional Analytics tab (tables, ▲▼, CSS sparklines); prior-window deltas. **Out:** charting library, export (sheet/PDF), real-time alerts/notifications, the light-mode visual redesign (Fase 3), Task 5 message pipeline (separate, blocked on KirimDev webhook setup).
