# Rekap Pengiriman — Stats Fix & Pagination

**Date:** 2026-05-31  
**Status:** Approved  
**Scope:** `wafachat/convex/shippingRecaps.ts`, `wafachat/app/panel/page.tsx`

---

## Problem

Two bugs in the Rekap Pengiriman tab:

1. **Stats misleading.** `counts` (Total Periode, Perlu Review, Siap Export, etc.) are computed from `rows` — the limited dataset returned by the `list` query. With `limit: 75`, any day with >75 closings shows wrong totals.

2. **Data silently truncated.** The `list` query is called with `limit: 75`. Records 76+ are never loaded. There is no pagination UI and no indication that data is cut off.

---

## Design

### 1. Convex — add `getCounts` query

Add a new `getCounts` query to `shippingRecaps.ts`:

```ts
getCounts(startAt, endAt, csName?) → {
  all: number,
  needs_review: number,
  ready: number,
  exported: number,
  delivered: number,
  cancelled: number,       // cancelled + cancelled_after_export
  totalCodValue: number,   // sum for non-cancelled records
}
```

Implementation:
- Uses existing `by_closedAt` index with date range
- Calls `.collect()` — no limit
- Filters out `INTERNAL_TEST_PHONES`
- Filters by `csName` if provided
- No status/payment/search filter (always returns full period totals)

This query is fast — it only needs to read the date-range slice, no joins.

### 2. Convex — fix `list` query

Remove the `limit` arg entirely from the `list` query:
- Change `.take(limit * 4)` → `.collect()` after the index range filter
- Remove `limit` from the query args validator
- The date range (`by_closedAt` index) is the natural boundary

This is safe: Convex index range queries are efficient. For "Hari ini" (~75–150 records), "7 hari" (~500–1000), "30 hari" (~2000–4500) — all load fine as JSON. Client-side pagination handles rendering.

### 3. page.tsx — call `getCounts`, remove limit from `list`

```ts
// New query
const countsData = useQuery(api.shippingRecaps.getCounts, {
  startAt: selectedDateRange.startAt,
  endAt: selectedDateRange.endAt,
  csName: csFilter,
});

// Updated — no limit arg
const shippingRecapsData = useQuery(api.shippingRecaps.list, {
  startAt: selectedDateRange.startAt,
  endAt: selectedDateRange.endAt,
  status: recapStatus === 'all' ? undefined : recapStatus,
  paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
  search: recapSearch || undefined,
  csName: csFilter,
});
```

Pass `totalCounts={countsData}` to `ShippingRecapPanel`.

### 4. ShippingRecapPanel — use `totalCounts` + pagination

**Stats cards and status badges:**
Replace `counts` (computed from `rows`) with `totalCounts` prop for:
- Stats cards: Total Periode, Perlu Review, Siap Export, Sudah Terkirim, Nilai COD
- Status filter badges: count labels on each pill

While `totalCounts` is loading (undefined), fall back to `counts` from `rows` so UI does not flash to 0.

**Pagination:**
- `PAGE_SIZE = 25`
- `currentPage` state (default 1)
- Render `sortedRows.slice((page-1)*25, page*25)` in the table
- `useEffect` with `[recapStatus, paymentFilter, recapSearch, csName]` deps → reset `currentPage` to 1 on filter change (requires passing `csName` as explicit prop to panel)
- Pagination bar rendered below table only when `sortedRows.length > PAGE_SIZE`

**Pagination bar layout:**
```
← Prev   1  2  3  ...  N   Next →
```
- Show up to 5 page numbers with ellipsis for longer sequences
- Prev/Next disabled at boundaries
- Matches existing dark UI style (`cn`, `border-border`, `bg-background` classes)

---

## Data flow

```
selectedDateRange + csFilter
  ├─→ getCounts query  ──────────────────→ totalCounts (stats cards + badges)
  └─→ list query (+ status/payment/search) → shippingRecaps → sortedRows
                                                                    ↓
                                             sortedRows.slice(page window)
                                                                    ↓
                                                           table rows rendered
```

---

## What does NOT change

- Sort logic (`recapSort`) — unchanged, still applied to full `rows` before pagination
- Export selection — `selectedRecapIds` state; pagination does not affect export logic
- Individual row actions (Mark Ready, Cancel, etc.) — unchanged
- `getPerformance` query used for Dashboard stats — unchanged

---

## Files changed

| File | Change |
|------|--------|
| `convex/shippingRecaps.ts` | Add `getCounts` query; remove `limit` arg from `list`, change `.take()` to `.collect()` |
| `app/panel/page.tsx` | Add `countsData` query; remove `limit` from `list` call; pass `totalCounts` to `ShippingRecapPanel`; add `currentPage` state + pagination UI |
