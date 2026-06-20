# Fase 4B — Dashboard Lean + Order Double Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Dashboard: add the Omzet KPI, drop the static "System readiness"/"Today formula" cards, and turn the inline "Order Dobel" section into a renamed **"Order Double"** button that opens a right-side drawer (no more long page).

**Architecture:** Presentation-only edits to the single `/panel` route `app/panel/page.tsx`. The KPI cards already use `StatCard` + `AnimatedNumber` + highlight (from 3B/4A); add a 5th (Omzet) and remove the aside cards. Order Double's list moves into a `Sheet` (drawer) triggered by a count button; the existing windowed `getDuplicateOrders` query stays (the button shows its count). No Convex/data changes.

**Tech Stack:** Next.js 14, React, Tailwind, the Fase 3 `StatCard`/`AnimatedNumber`, the shadcn `Sheet` primitive, `lucide-react`.

## Global Constraints

- **Presentation-only** — no Convex/query/data changes. `getDuplicateOrders` keeps its current always-on, windowed subscription (the button shows its count). (Spec §2, §4)
- **Order Double:** renamed from "Order Dobel"; an inline list is NOT allowed — it must be a button (`⚠ Order Double · N`) that opens a drawer; muted when N=0. (Spec §2, §3.3)
- **Dashboard (general CS) keeps:** Orders, Total Closing, Closing Rate, Cancelled, **Omzet** as KPI `StatCard`s + the Order Double button. (Spec §2, §3.3)
- **Drop from the dashboard:** "System readiness" + "Today formula" cards (not needed). (Spec §2)
- **Light-mode**, build on the existing design system; satisfying count-up retained. (Spec §1, §3.2)
- **Repo:** git root `F:/Projects/whatsapp_cs_automotion/wafachat`; branch off `main`; paths repo-relative.

## Testing approach

Presentation-only → `npm run build` (EXIT 0) + visual review per task. No unit tests. Convex suite stays green (`npm test` → 21/21, untouched). Commands from repo root `wafachat/`; dev: `npm run dev` → http://localhost:3000/panel.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/panel/page.tsx` | Both tasks: add Omzet KPI + drop aside cards (Task 1); Order Double button→drawer (Task 2) |

The current file (≈ 268 lines) already holds `DashboardPage`, `DashboardStatCard`, `MetricSkeleton`, and the (to-be-removed) `ReadinessRow`/`Formula` helpers.

---

### Task 1: Lean KPIs — add Omzet, drop the aside cards

**Files:**
- Modify: `app/panel/page.tsx` (imports; add a `revenue` derivation + Omzet card; widen the grid + skeleton count; delete the `<section>` aside block and the `ReadinessRow`/`Formula` helpers + their now-unused imports).

**Interfaces:**
- Consumes: `summaryData.revenue` (already returned by `getDashboardSummary`), `formatRupiah` (`@/lib/format`), `StatCard`/`AnimatedNumber` (existing).
- Produces: a 5-KPI dashboard with no aside cards.

- [ ] **Step 1: Update imports**

In `app/panel/page.tsx`:
- Add `Wallet` to the `lucide-react` import and REMOVE `ShieldCheck` (unused after this task):
```tsx
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Wallet,
} from 'lucide-react';
```
- Add `formatRupiah` to the format import:
```tsx
import { pct, fmtTime, formatRupiah } from '@/lib/format';
```
- REMOVE the now-unused `Separator` import (the line `import { Separator } from '@/components/ui/separator';`).

- [ ] **Step 2: Add the `revenue` derivation**

After the `handoverRate` derivation (≈ line 73), add:
```tsx
  const revenue = summaryData?.revenue ?? 0;
```

- [ ] **Step 3: Add the Omzet card + fix the useMemo deps**

In the `cards` useMemo array, add a 5th entry after the `Cancelled` card:
```tsx
      {
        label: 'Omzet',
        value: revenue,
        detail: 'Revenue periode',
        icon: Wallet,
        tone: 'positive',
        format: formatRupiah,
      },
```
And add `revenue` to the useMemo dependency array (so it becomes `[aiClosings, crPerf, manualClosings, performance, revenue, stats, totalClosing]`).

- [ ] **Step 4: Widen the grid + skeleton count**

Change the metric `<section>` grid to fit 5 cards, and the skeleton loop to 5:
```tsx
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, index) => <MetricSkeleton key={index} />)
          : cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
      </section>
```

- [ ] **Step 5: Delete the aside section + helpers**

Delete the entire `<section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"> … </section>` block (the empty `<div />` + the "System readiness" and "Today formula" `Card`s). Also delete the `ReadinessRow` and `Formula` function declarations at the bottom of the file. (`fmtTime` is still used by the Order Double list — keep it.)

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: EXIT 0, no unused-import/type errors.

- [ ] **Step 7: Visual review**

`npm run dev` → http://localhost:3000/panel: 5 KPI cards (Orders, Total Closing, Closing rate, Cancelled, **Omzet** = Rp…, count-up animated); the "System readiness"/"Today formula" cards are gone. (Order Double is still the inline card from before — Task 2 fixes it.)

- [ ] **Step 8: Commit**
```bash
git add app/panel/page.tsx
git commit -m "feat(panel): add Omzet KPI, drop readiness/formula cards (lean dashboard)"
```

---

### Task 2: Order Double drawer

**Files:**
- Modify: `app/panel/page.tsx` (replace the inline Order Dobel `Card` with a count button + `Sheet` drawer; rename to "Order Double").

**Interfaces:**
- Consumes: `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetDescription` (`@/components/ui/sheet`), `Badge`, `cn` (`@/lib/utils`), the existing `duplicateOrders` query result + `fmtTime`.
- Produces: a non-inline Order Double (button → drawer).

- [ ] **Step 1: Add imports + open state**

In `app/panel/page.tsx`:
- Change the React import to `import { useMemo, useState } from 'react';`.
- Add:
```tsx
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
```
- At the top of `DashboardPage`, after the queries, add:
```tsx
  const [dupOpen, setDupOpen] = useState(false);
  const dupCount = duplicateOrders?.length ?? 0;
```

- [ ] **Step 2: Replace the inline Order Dobel Card with a button + Sheet**

Delete the entire inline Order Dobel `<Card> … </Card>` block (the one with `<CardTitle className="text-base">⚠️ Order Dobel</CardTitle>` and the `duplicateOrders.map(...)` list). In its place — directly after the KPI `<section>` — put a button row + the drawer:
```tsx
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setDupOpen(true)}
          disabled={dupCount === 0}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-default',
            dupCount > 0
              ? 'border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'border-border bg-card text-muted-foreground',
          )}
        >
          <CircleAlert className="size-4" />
          Order Double
          <Badge variant={dupCount > 0 ? 'warning' : 'secondary'}>{dupCount}</Badge>
        </button>
        <span className="text-xs text-muted-foreground">Kroscek customer dengan ≥2 order di periode ini.</span>
      </div>

      <Sheet open={dupOpen} onOpenChange={setDupOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>⚠️ Order Double</SheetTitle>
            <SheetDescription>
              Customer dengan ≥2 order di periode ini — kroscek di Berdu, cancel jika dobel tak sengaja.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {duplicateOrders === undefined ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : duplicateOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada order double di periode ini ✅</p>
            ) : (
              duplicateOrders.map((d) => (
                <div key={d.phone} className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{d.customerName || 'Tanpa Nama'}</span>
                    <span className="text-muted-foreground">{d.phone}</span>
                    <span className="text-muted-foreground">· {d.csName || '—'}</span>
                    <Badge variant="secondary">{d.count}× order</Badge>
                    {d.likelyAccidental ? (
                      <Badge variant="warning">⚠ kemungkinan accidental</Badge>
                    ) : (
                      <Badge variant="secondary">repeat customer</Badge>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {d.orders.map((o) => (
                      <li key={o.orderId} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <code className="text-foreground">{o.orderId}</code>
                        <span>{o.productName || '—'}</span>
                        <span>{o.total || '—'}</span>
                        <span>{fmtTime(o.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
```

- [ ] **Step 3: Remove now-unused imports**

After Task 1 + Task 2, the `@/components/ui/card` import (`Card`/`CardContent`/`CardDescription`/`CardHeader`/`CardTitle`) is likely unused (KPIs use `StatCard`; the aside `Card`s and the Order Dobel `Card` are deleted). Remove the `@/components/ui/card` import line. The build (Step 4) flags anything still in use — keep only what compiles.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: EXIT 0 (no unused-import/type errors; `Sheet` resolves).

- [ ] **Step 5: Visual review**

`npm run dev` → http://localhost:3000/panel:
- The dashboard is short — no inline duplicate list.
- An "⚠ Order Double · N" button sits under the KPIs (amber when N>0, muted/disabled when N=0).
- Clicking it opens a right-side drawer titled "Order Double" with the cross-check list; closing returns to the short dashboard.
- Changing Periode/CS updates N and the drawer contents.

- [ ] **Step 6: Commit**
```bash
git add app/panel/page.tsx
git commit -m "feat(panel): Order Double as a drawer button (no inline list)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.3 "Dashboard KPIs: Orders/Total Closing/CR/Cancelled/Omzet as StatCards" → existing 4 + Task 1 adds Omzet. ✓
- §2 "drop System readiness + Today formula" → Task 1 Step 5. ✓
- §2/§3.3 "Order Double = renamed + click-to-open drawer, muted at N=0, not inline" → Task 2 (button + Sheet, `dupCount===0` disabled, list inside drawer). ✓
- §2 "presentation-only, no data change" → `getDuplicateOrders` subscription unchanged (kept for the count). ✓
- §3.2 "satisfying count-up" → KPIs keep `DashboardStatCard` (AnimatedNumber + highlight); Omzet animates via `format={formatRupiah}`. ✓

**Deviation noted:** spec §3.2 also mentioned `getDuplicateOrders` could be **`'skip'` until the drawer opens**. The button shows the count `N`, which requires the query — so it stays always-on (a windowed, light query, already always-on before 4B; no perf regression vs the deployed state). The user-facing goal (dashboard not long → list in a drawer) is met.

**2. Placeholder scan:** Full code for every step (imports, derivation, Omzet card, grid, button, Sheet, item markup). No TODO/TBD. ✓

**3. Type/name consistency:** `revenue` defined in Task 1 + added to useMemo deps + used by the Omzet card. `formatRupiah` (n→string) fits `StatCard`/`AnimatedNumber`'s `format?: (n: number) => string`. `dupOpen`/`setDupOpen`/`dupCount` defined in Task 2 Step 1 and used in Step 2. `Sheet*` import names match the primitive's exports (same set the conversation/recap detail sheets use). ✓
