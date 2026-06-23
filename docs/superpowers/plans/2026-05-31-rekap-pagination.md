# Rekap Pengiriman Stats Fix & Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix misleading stats cards and silent data truncation in the Rekap Pengiriman tab by adding a dedicated counts query, removing the hardcoded row limit, and adding client-side pagination.

**Architecture:** Add a `getCounts` Convex query (no limit, no status filter) that feeds stats cards and status badges. Remove `limit` from the existing `list` query (use `.collect()` bounded by date range index). Add `currentPage` state + pagination bar inside `ShippingRecapPanel`.

**Tech Stack:** Convex (TypeScript queries), Next.js 14 App Router, React 18, Tailwind CSS, shadcn/ui

---

## File Map

| File | Change |
|------|--------|
| `convex/shippingRecaps.ts` | Add `getCounts` query after `list` export; modify `list` to remove `limit` arg and use `.collect()` |
| `app/panel/page.tsx` | Add `countsData` query call; remove `limit` from `list` call; add `csName` + `totalCounts` props to `ShippingRecapPanel`; update component signature, counts fallback, stats cards, add pagination |

---

## Task 1: Add `getCounts` query to Convex

**Files:**
- Modify: `convex/shippingRecaps.ts`

- [ ] **Step 1.1: Add the `getCounts` export after the closing brace of `list` (~line 617)**

```typescript
export const getCounts = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    csName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();

    const filtered = rows.filter(
      (row) =>
        !isInternalTestPhone(row.customerPhone) &&
        (!args.csName || row.csName === args.csName),
    );

    const nonCancelled = filtered.filter(
      (row) => row.status !== "cancelled" && row.status !== "cancelled_after_export",
    );

    return {
      all: filtered.length,
      needs_review: filtered.filter((r) => r.status === "needs_review").length,
      ready: filtered.filter((r) => r.status === "ready").length,
      exported: filtered.filter((r) => r.status === "exported").length,
      delivered: filtered.filter((r) => r.status === "delivered").length,
      cancelled: filtered.filter(
        (r) => r.status === "cancelled" || r.status === "cancelled_after_export",
      ).length,
      totalCodValue: nonCancelled.reduce(
        (sum, r) => sum + (r.codValue ?? r.total ?? 0),
        0,
      ),
    };
  },
});
```

- [ ] **Step 1.2: Remove `limit` arg from `list` args validator**

Current `list` args block (~line 571):
```typescript
  args: {
    startAt: v.number(),
    endAt: v.number(),
    status: v.optional(statusValidator),
    paymentMethod: v.optional(paymentMethodValidator),
    search: v.optional(v.string()),
    csName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
```

Replace with (remove `limit` line):
```typescript
  args: {
    startAt: v.number(),
    endAt: v.number(),
    status: v.optional(statusValidator),
    paymentMethod: v.optional(paymentMethodValidator),
    search: v.optional(v.string()),
    csName: v.optional(v.string()),
  },
```

- [ ] **Step 1.3: Change `list` handler to use `.collect()` instead of `.take(limit * 4)` and remove slice**

Current handler body (~line 580):
```typescript
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = args.status
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_status_closedAt", (q) =>
            q.eq("status", args.status as RecapStatus).gte("closedAt", args.startAt).lte("closedAt", args.endAt),
          )
          .order("desc")
          .take(limit * 4)
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
          .order("desc")
          .take(limit * 4);
    const search = String(args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => !isInternalTestPhone(row.customerPhone))
      .filter((row) => !args.csName || row.csName === args.csName)
      .filter((row) => !args.paymentMethod || row.paymentMethod === args.paymentMethod)
      .filter((row) => {
        if (!search) return true;
        return [
          row.recipientName,
          row.customerName,
          row.recipientPhone,
          row.customerPhone,
          row.orderIdBerdu,
          row.packageContent,
          row.recipientCity,
          row.recipientDistrict,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .slice(0, limit);
  },
```

Replace with:
```typescript
  handler: async (ctx, args) => {
    const rows = args.status
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_status_closedAt", (q) =>
            q.eq("status", args.status as RecapStatus).gte("closedAt", args.startAt).lte("closedAt", args.endAt),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
          .order("desc")
          .collect();
    const search = String(args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => !isInternalTestPhone(row.customerPhone))
      .filter((row) => !args.csName || row.csName === args.csName)
      .filter((row) => !args.paymentMethod || row.paymentMethod === args.paymentMethod)
      .filter((row) => {
        if (!search) return true;
        return [
          row.recipientName,
          row.customerName,
          row.recipientPhone,
          row.customerPhone,
          row.orderIdBerdu,
          row.packageContent,
          row.recipientCity,
          row.recipientDistrict,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      });
  },
```

- [ ] **Step 1.4: TypeScript check**

```bash
cd wafachat && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 1.5: Commit**

```bash
cd wafachat
git add convex/shippingRecaps.ts
git commit -m "feat(convex): add getCounts query; remove limit from shippingRecaps.list"
```

---

## Task 2: Update `page.tsx` — queries and panel call

**Files:**
- Modify: `app/panel/page.tsx`

- [ ] **Step 2.1: Add `countsData` query after `performanceData` query (~line 265)**

```typescript
const countsData = useQuery(api.shippingRecaps.getCounts, {
  startAt: selectedDateRange.startAt,
  endAt: selectedDateRange.endAt,
  csName: csFilter,
});
```

- [ ] **Step 2.2: Remove `limit: 75,` from the `shippingRecapsData` query call (~line 258)**

Current:
```typescript
const shippingRecapsData = useQuery(api.shippingRecaps.list, {
  startAt: selectedDateRange.startAt,
  endAt: selectedDateRange.endAt,
  status: recapStatus === 'all' ? undefined : recapStatus,
  paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
  search: recapSearch || undefined,
  csName: csFilter,
  limit: 75,
});
```

Replace with (remove the `limit: 75,` line only):
```typescript
const shippingRecapsData = useQuery(api.shippingRecaps.list, {
  startAt: selectedDateRange.startAt,
  endAt: selectedDateRange.endAt,
  status: recapStatus === 'all' ? undefined : recapStatus,
  paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
  search: recapSearch || undefined,
  csName: csFilter,
});
```

- [ ] **Step 2.3: Add `csName` and `totalCounts` props to `<ShippingRecapPanel` JSX (~line 822)**

Add these two props (anywhere in the prop list is fine, convention: near the top):
```tsx
<ShippingRecapPanel
  actionLoading={actionLoading}
  csName={csFilter}
  totalCounts={countsData}
  paymentFilter={paymentFilter}
  {/* all other existing props unchanged */}
```

- [ ] **Step 2.4: TypeScript check — expect errors (Task 3 fixes component signature)**

```bash
cd wafachat && npx tsc --noEmit
```

Expected: type errors on `csName` and `totalCounts` not existing on panel props. This is expected — Task 3 resolves them.

---

## Task 3: Update `ShippingRecapPanel` component

**Files:**
- Modify: `app/panel/page.tsx` — `ShippingRecapPanel` function (~lines 988–1393)

- [ ] **Step 3.1: Add `csName` and `totalCounts` to destructuring**

In the destructuring at line 988, add after `actionLoading`:
```typescript
function ShippingRecapPanel({
  actionLoading,
  csName,
  totalCounts,
  paymentFilter,
  ...
```

- [ ] **Step 3.2: Add `csName` and `totalCounts` to the type annotation block (~line 1014)**

After `actionLoading: string | null;`, add:
```typescript
  csName: string | undefined;
  totalCounts: {
    all: number;
    needs_review: number;
    ready: number;
    exported: number;
    delivered: number;
    cancelled: number;
    totalCodValue: number;
  } | undefined;
```

- [ ] **Step 3.3: Replace `counts` derivation with fallback pattern (~line 1041)**

Current:
```typescript
  const counts = {
    all: rows.length,
    needs_review: rows.filter((r) => r.status === 'needs_review').length,
    ready: rows.filter((r) => r.status === 'ready').length,
    exported: rows.filter((r) => r.status === 'exported').length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    cancelled: rows.filter((r) => r.status === 'cancelled' || r.status === 'cancelled_after_export').length,
  };
```

Replace with:
```typescript
  const rowCounts = {
    all: rows.length,
    needs_review: rows.filter((r) => r.status === 'needs_review').length,
    ready: rows.filter((r) => r.status === 'ready').length,
    exported: rows.filter((r) => r.status === 'exported').length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    cancelled: rows.filter((r) => r.status === 'cancelled' || r.status === 'cancelled_after_export').length,
  };
  const counts = totalCounts ?? rowCounts;
```

- [ ] **Step 3.4: Replace `totalCodValue` derivation (~line 1075)**

Current:
```typescript
  const totalCodValue = rows
    .filter((r) => r.status !== 'cancelled' && r.status !== 'cancelled_after_export')
    .reduce((sum, r) => sum + (r.codValue ?? r.total ?? 0), 0);
```

Replace with:
```typescript
  const totalCodValue = totalCounts?.totalCodValue ??
    rows
      .filter((r) => r.status !== 'cancelled' && r.status !== 'cancelled_after_export')
      .reduce((sum, r) => sum + (r.codValue ?? r.total ?? 0), 0);
```

- [ ] **Step 3.5: Add `PAGE_SIZE`, `currentPage` state, and reset effect**

After the `totalCodValue` line, add:
```typescript
  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [recapStatus, paymentFilter, recapSearch, csName]);
```

- [ ] **Step 3.6: Add `totalPages` and `pagedRows` after `sortedRows` useMemo (~line 1057)**

```typescript
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const pagedRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
```

- [ ] **Step 3.7: Replace `sortedRows.map` with `pagedRows.map` in table body (~line 1264)**

Current:
```typescript
              sortedRows.map((row, idx) => {
```

Replace with:
```typescript
              pagedRows.map((row, idx) => {
```

If there is a `#` column showing `idx + 1`, update it to show the global row number:
```typescript
(currentPage - 1) * PAGE_SIZE + idx + 1
```

- [ ] **Step 3.8: Add pagination bar after the table's closing `</div>` (~line 1393)**

Add immediately after the `</div>` that closes `overflow-hidden rounded-lg border`:

```tsx
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-2">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
          >
            ← Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((page) => {
              if (totalPages <= 7) return true;
              if (page === 1 || page === totalPages) return true;
              if (Math.abs(page - currentPage) <= 2) return true;
              return false;
            })
            .reduce<(number | '...')[]>((acc, page, i, arr) => {
              if (i > 0 && typeof arr[i - 1] === 'number' && (page as number) - (arr[i - 1] as number) > 1) {
                acc.push('...');
              }
              acc.push(page);
              return acc;
            }, [])
            .map((item, i) =>
              item === '...' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setCurrentPage(item as number)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    currentPage === item
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                  type="button"
                >
                  {item}
                </button>
              ),
            )}
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
          >
            Next →
          </button>
        </div>
      )}
```

- [ ] **Step 3.9: TypeScript check — expect clean**

```bash
cd wafachat && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.10: Commit**

```bash
cd wafachat
git add app/panel/page.tsx
git commit -m "feat(panel): fix Rekap stats accuracy + add client-side pagination (25/page)"
```

---

## Task 4: Deploy and verify

- [ ] **Step 4.1: Push to trigger Vercel deploy**

```bash
cd wafachat && git push origin main
```

- [ ] **Step 4.2: Manual verification checklist (~2 min after deploy)**

1. **Stats accurate** — "Total Periode" on "Semua" tab = true total, not capped at 75.
2. **Stats stable on filter** — Switch to "Perlu Review" tab → stats cards show same totals as on "Semua".
3. **Badge counts** — status pill counts match stats card values.
4. **Pagination appears** — if >25 rows loaded, pagination bar visible below table.
5. **Page navigation** — click page 2 → rows 26–50 shown, filters + date range unchanged.
6. **Filter resets page** — change status filter → page automatically resets to 1.
7. **CS filter resets page** — change CS dropdown → page resets to 1.
8. **Sort does not reset page** — changing sort keeps current page (rows reordered globally, current page slice updates).
9. **7-day period** — switching to "7 hari" loads all records for 7 days with no 75-row cap.
