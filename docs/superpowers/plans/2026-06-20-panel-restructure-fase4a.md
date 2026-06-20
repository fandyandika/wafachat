# Fase 4A — App Shell + Routing Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2640-line `app/panel/page.tsx` monolith into a shared app-shell layout + four route pages (`/panel` Dashboard, `/panel/cs-ai`, `/panel/rekap`, `/panel/performance`), with global Periode+CS filters driven by URL search params — functionally equivalent, but route-based so each page mounts only its own queries (the heavy AI conversation query lands only on `/panel/cs-ai`).

**Architecture:** A client `app/panel/layout.tsx` renders the persistent sidebar + header (filters → URL) and `{children}`. The three big panel components and shared helpers are extracted into their own files. Each route page is a focused client component owning its domain's state + queries + handlers and consuming the shared filters via a `usePanelFilters()` hook. No behavior change beyond relocation; the conversation queue moves from the Dashboard tab to the new CS AI route.

**Tech Stack:** Next.js 14 App Router (nested layout + route segments), React 18, Convex `useQuery`/`useMutation`, Tailwind, the Fase 3 design system.

## Global Constraints

- **Presentation/structure only** — no Convex schema or data changes; every query/mutation keeps its exact `api.*` name and args. (Spec: Nature, §4)
- **Functionally equivalent after 4A** — same widgets/behavior, just relocated to routes; the only intentional relocation is the conversation queue + Global AI toggle moving from the Dashboard tab to `/panel/cs-ai`. (Spec §8)
- **Routes:** `/panel` (Dashboard general CS), `/panel/cs-ai`, `/panel/rekap`, `/panel/performance`. (Spec §2)
- **Global filters via URL search params** `?range=…&cs=…&date=…`, defaults `range=today`, `cs=all`. (Spec §2, §3.1, §6)
- **Light-mode only**; build on the existing design system. (Spec §1, §2)
- **No data deletion.** (Spec: Nature)
- **Repo:** git root `F:/Projects/whatsapp_cs_automotion/wafachat`; branch off `main`; paths repo-relative.

## Testing approach (read before starting)

This is a **refactor** — no new unit-testable logic (the one logic change, the `listConversations` fix, is Plan 4C). Per spec §7, 4A is verified by **`npm run build`** (typecheck — catches missing imports/props/types across the split) + a **visual parity check** (each route renders the same widgets and the filters work across pages). The existing convex-test suite stays green (`npm test` → 18/18, untouched). Do NOT add placeholder UI tests.

**Commands (from repo root `wafachat/`):**
- Build/typecheck: `npm run build`
- Dev (visual parity): `npm run dev` → http://localhost:3000/panel (+ /panel/cs-ai, /rekap, /performance)
- Regression: `npm test` (expect 18/18)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `components/panel/types.ts` | **New** — shared TS types/interfaces moved out of page.tsx (`Conversation`, `Stats`, `ShippingRecap`, `PerformanceData`, `CsConfig`, `QueueKey`, `RecapStatus`, `PaymentFilter`, `RecapSort`, etc.) |
| `lib/format.ts` | **New** — shared formatters moved out of page.tsx (`formatRupiah`, `formatTime`, `formatDateTime`, `pct`, `fmtTime`) |
| `components/panel/use-panel-filters.ts` | **New** — `DateRangeKey`, `resolveRange()`, `usePanelFilters()` (reads `range`/`cs`/`date` from URL → `{ startAt, endAt, csName, range, cs, customDate, jakartaDate }`) |
| `components/panel/conversation-panel.tsx` | **New** — move `ConversationPanel` + `ConversationDetailSheet` + `ConfirmDeleteDialog` + `StatusBadge` + `OutcomeBadge` + `DetailRow` verbatim |
| `components/panel/shipping-recap-panel.tsx` | **New** — move `ShippingRecapPanel` + `ShippingRecapDetailSheet` + `RecapStatusBadge` verbatim |
| `components/panel/performance-panel.tsx` | **New** — move `PerformancePanel` + `Sparkline` + `PerformanceTable` verbatim |
| `app/panel/layout.tsx` | **New** — shared shell: sidebar nav + header (filters→URL, CS dropdown, title) + `{children}` |
| `app/panel/page.tsx` | **Rewritten** — now the `/panel` **Dashboard** route only (general metrics + Order Dobel + readiness/formula; queue removed) |
| `app/panel/cs-ai/page.tsx` | **New** — CS AI route: conversation queue + Global AI toggle |
| `app/panel/rekap/page.tsx` | **New** — Rekap route: `ShippingRecapPanel` + its state/handlers |
| `app/panel/performance/page.tsx` | **New** — Performance route: `PerformancePanel` |

**Ownership map (derived from the current monolith — used by Tasks 5–8):**
- **Filters (shell/URL):** `dateRange`/`customDate`→`range`/`date`, `selectedCsName`→`cs`; `selectedDateRange`/`csFilter` come from `usePanelFilters()`. `csConfigs` (CS dropdown) → layout.
- **Dashboard page:** queries `getDashboardSummary`, `getDuplicateOrders`, `getPerformance`; derives `stats`, `totalClosing`, `crPerf`, `aiClosings`, the `cards` array + `DashboardStatCard`/`MetricSkeleton`; renders metric grid + Order Dobel + "System readiness"/"Today formula" cards (`ReadinessRow`/`Formula`). No conversation state.
- **CS AI page:** queries `listConversations`, `getGlobalAiEnabled`, `getDashboardSummary` (for AI counts); state `selectedConversation`, `selectedQueue`, `searchQuery`, `pendingDelete`, `globalAiConfirmOpen`, `optimisticGlobal`; mutations `setConversationStatus`, `markNotClosing`, `markClosing`, `markCancelled`, `undoCancelled`, `deleteOrder`, `createPanelClosingRecap`, `setGlobalAiEnabled`; handlers `handleGlobalAiToggle`, `doToggleGlobal`, `setStatus`, `notClosing`, `markWonManual`, `cancelOrder`, `undoCancelOrder`, `confirmDeleteOrder`; derives `active`/`handover`/`closed`/`displayGlobalEnabled`/`rowsByQueue`; renders `ConversationPanel` + Global AI toggle.
- **Rekap page:** queries `shippingRecaps.list`, `getCounts`; state `recapStatus`, `paymentFilter`, `recapSearch`, `selectedRecap`, `recapSort`, `selectedRecapIds`, `bulkCancelOpen`; mutations `markReady`/`markCancelled`/`undoCancelled`/`markExported`/`markDelivered`/`undoDelivered`/`markReadyBulk`/`markCancelledBulk`; handlers `markDeliveredRecap`/`undoDeliveredRecap`/`bulkMarkReady`/`bulkMarkDelivered`/`bulkCancel`/`markReadyRecap`/`cancelRecap`/`undoCancelRecap`/`downloadRecapCsv`; derives `readyRecaps`; renders `ShippingRecapPanel`.
- **Performance page:** queries `getCsLeaderboard`, `getProductDifficulty`, `getTrend`, `getPerformance` (+ `getPeriodReport` already inside `PerformancePanel`); renders `PerformancePanel`.
- Each page keeps its **own** `actionLoading` state (was shared) and imports formatters from `lib/format.ts` and types from `components/panel/types.ts`.

---

### Task 1: Extract shared types + formatters

**Files:** Create `components/panel/types.ts`, `lib/format.ts`. Modify `app/panel/page.tsx` (remove moved blocks, import from new files).

**Interfaces:**
- Produces: `components/panel/types.ts` exporting every interface/type alias currently declared at the top of `page.tsx` (≈ lines 85–188): `Conversation`, `Stats`, `QueueKey`, `RecapStatus`, `PaymentFilter`, `RecapSort`, `ShippingRecap`, `PerformanceData`, `CsConfig`. Do NOT move `DateRangeKey` (the filters hook owns it, Task 3) or `PanelView` (deleted — routing replaces it). `lib/format.ts` exporting `formatRupiah`, `formatTime`, `formatDateTime`, `pct`, `fmtTime`.

- [ ] **Step 1: Create `components/panel/types.ts`** — move the interface/type declarations from `app/panel/page.tsx` (`interface Conversation`, `interface Stats`, `type QueueKey`, `type RecapStatus`, `type PaymentFilter`, `type RecapSort`, `interface ShippingRecap`, `interface PerformanceData`, `interface CsConfig`) verbatim into the new file, adding `import type { Id } from '@/convex/_generated/dataModel';` at the top. Do NOT move `DateRangeKey` (Task 3 owns it). Do NOT move `PanelView` (deleted).

- [ ] **Step 2: Create `lib/format.ts`** — move `formatRupiah` (page.tsx ≈ 2636), `formatTime` (≈ 2613), `formatDateTime` (≈ 2622), and `pct` (≈ 2632) verbatim; add `export function fmtTime(ms: number): string { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(ms)); }` (lifted from the inline `fmtTime` at page.tsx ≈ 352). Export all five.

- [ ] **Step 3: Update `app/panel/page.tsx` imports** — delete the moved type/formatter declarations from page.tsx and add `import type { Conversation, Stats, ShippingRecap, PerformanceData, CsConfig, QueueKey, RecapStatus, PaymentFilter, RecapSort } from '@/components/panel/types';` and `import { formatRupiah, formatTime, formatDateTime, pct, fmtTime } from '@/lib/format';`. Replace the inline `const fmtTime = …` (≈ 352) with the imported one.

- [ ] **Step 4: Build** — `npm run build`. Expected: compiles (page.tsx still the monolith, now importing the extracted types/formatters).

- [ ] **Step 5: Commit**
```bash
git add components/panel/types.ts lib/format.ts app/panel/page.tsx
git commit -m "refactor(panel): extract shared types + formatters"
```

---

### Task 2: Extract the three panel components

**Files:** Create `components/panel/conversation-panel.tsx`, `components/panel/shipping-recap-panel.tsx`, `components/panel/performance-panel.tsx`. Modify `app/panel/page.tsx`.

**Interfaces:**
- Consumes: types from `@/components/panel/types`, formatters from `@/lib/format` (Task 1).
- Produces: three modules exporting the panels with their **exact current prop signatures** (unchanged), so the route pages (Tasks 5–8) import them:
  - `conversation-panel.tsx` → `ConversationPanel` (current signature at page.tsx ≈ 1953), plus `ConversationDetailSheet`, `ConfirmDeleteDialog`, `StatusBadge`, `OutcomeBadge`, `DetailRow`. Export `ConversationPanel`, `ConversationDetailSheet`, `ConfirmDeleteDialog`.
  - `shipping-recap-panel.tsx` → `ShippingRecapPanel` (≈ 1066) + `ShippingRecapDetailSheet` + `RecapStatusBadge`. Export `ShippingRecapPanel`, `ShippingRecapDetailSheet`.
  - `performance-panel.tsx` → `PerformancePanel` (≈ 1563) + `Sparkline` + `PerformanceTable`. Export `PerformancePanel`.

- [ ] **Step 1: Create `components/panel/conversation-panel.tsx`** — start with `'use client';`, then move verbatim from page.tsx: `ConversationPanel` (≈ 1953–2216), `ConversationDetailSheet` (≈ 2217–2425), `ConfirmDeleteDialog` (≈ 2489–2535), `StatusBadge` (≈ 2545–2555), `OutcomeBadge` (≈ 2557–2567), `DetailRow` (≈ 2536–2544). Add the imports these blocks use (React, the UI primitives they reference — `Badge`, `Button`, `Card*`, `Checkbox`, `Sheet*`, `Table*`, `AlertDialog*`, `Tooltip*` — icons from `lucide-react`, `cn`), types from `@/components/panel/types`, formatters from `@/lib/format`. Export `ConversationPanel`, `ConversationDetailSheet`, `ConfirmDeleteDialog`.

- [ ] **Step 2: Create `components/panel/shipping-recap-panel.tsx`** — `'use client';` + move `ShippingRecapPanel` (≈ 1066–1551), `ShippingRecapDetailSheet` (≈ 2426–2488), `RecapStatusBadge` (≈ 2569–2591) verbatim; add their imports (UI primitives, icons, `cn`, types, formatters, `Id`). Export `ShippingRecapPanel`, `ShippingRecapDetailSheet`.

- [ ] **Step 3: Create `components/panel/performance-panel.tsx`** — `'use client';` + move `PerformancePanel` (≈ 1563–1910), `Sparkline` (≈ 1552–1561), `PerformanceTable` (≈ 1912–1951) verbatim; add imports (`useState`, `useQuery`, `api`, UI primitives, `cn`, types, formatters). Export `PerformancePanel`.

- [ ] **Step 4: Update `app/panel/page.tsx`** — delete the moved component blocks; import what the still-monolithic page renders: `import { ConversationPanel, ConversationDetailSheet, ConfirmDeleteDialog } from '@/components/panel/conversation-panel';`, `import { ShippingRecapPanel, ShippingRecapDetailSheet } from '@/components/panel/shipping-recap-panel';`, `import { PerformancePanel } from '@/components/panel/performance-panel';`.

- [ ] **Step 5: Build** — `npm run build`. Expected: compiles; page.tsx is smaller and imports the panels. (If a moved block referenced a helper still in page.tsx, move that helper too or import it — resolve until green.)

- [ ] **Step 6: Commit**
```bash
git add components/panel/conversation-panel.tsx components/panel/shipping-recap-panel.tsx components/panel/performance-panel.tsx app/panel/page.tsx
git commit -m "refactor(panel): extract Conversation/Recap/Performance panels into components"
```

---

### Task 3: Filters hook (`usePanelFilters`)

**Files:** Create `components/panel/use-panel-filters.ts`.

**Interfaces:**
- Produces: `export type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';`; `export function resolveRange(range: DateRangeKey, customDate?: string): { startAt: number; endAt: number }`; `export function usePanelFilters(): { range: DateRangeKey; cs: string; csName: string | undefined; customDate: string; startAt: number; endAt: number; jakartaDate: string }`. Consumed by every route page + the layout header.

- [ ] **Step 1: Create the hook file**
```ts
'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

export type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export function resolveRange(range: DateRangeKey, customDate?: string): { startAt: number; endAt: number } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === 'custom' && customDate) {
    const d = new Date(customDate + 'T12:00:00');
    start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    start.setHours(0, 0, 0, 0);
    end.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    end.setHours(23, 59, 59, 999);
  } else if (range === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (range === '30d') {
    start.setDate(start.getDate() - 29);
  } else if (range === 'month') {
    start.setDate(1);
  }
  return { startAt: start.getTime(), endAt: end.getTime() };
}

const VALID_RANGES: DateRangeKey[] = ['today', 'yesterday', '7d', '30d', 'month', 'custom'];

export function usePanelFilters() {
  const sp = useSearchParams();
  const rawRange = sp.get('range');
  const range: DateRangeKey = VALID_RANGES.includes(rawRange as DateRangeKey) ? (rawRange as DateRangeKey) : 'today';
  const cs = sp.get('cs') || 'all';
  const customDate = sp.get('date') || '';
  const { startAt, endAt } = useMemo(() => resolveRange(range, customDate), [range, customDate]);
  const jakartaDate = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(endAt)),
    [endAt],
  );
  return { range, cs, csName: cs === 'all' ? undefined : cs, customDate, startAt, endAt, jakartaDate };
}
```

- [ ] **Step 2: Build** — `npm run build`. Expected: compiles (hook unused yet).

- [ ] **Step 3: Commit**
```bash
git add components/panel/use-panel-filters.ts
git commit -m "refactor(panel): add URL-param filters hook"
```

---

### Task 4: Shared shell — `app/panel/layout.tsx`

**Files:** Create `app/panel/layout.tsx`.

**Interfaces:**
- Consumes: `usePanelFilters` (Task 3), `api.csConfigs.list`.
- Produces: the persistent shell (sidebar + header) wrapping all `/panel/*` routes via `{children}`. Header writes `range`/`cs`/`date` to the URL with `useRouter().replace`; active nav from `usePathname`.

- [ ] **Step 1: Create the layout**
```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bot, LayoutDashboard, MessagesSquare, CheckCircle2, BarChart3 } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePanelFilters, type DateRangeKey } from '@/components/panel/use-panel-filters';

const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/cs-ai', label: 'CS AI', icon: MessagesSquare },
  { href: '/panel/rekap', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
] as const;

const RANGES: Array<{ label: string; value: DateRangeKey }> = [
  { label: 'Hari ini', value: 'today' },
  { label: 'Kemarin', value: 'yesterday' },
  { label: '7 hari', value: '7d' },
  { label: '30 hari', value: '30d' },
  { label: 'Bulan ini', value: 'month' },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const { range, cs } = usePanelFilters();
  const csConfigs = useQuery(api.csConfigs.list, {}) ?? [];
  const title = NAV.find((n) => n.href === pathname)?.label ?? 'Dashboard';

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(sp.toString());
    if (!value || (key === 'range' && value === 'today') || (key === 'cs' && value === 'all')) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Bot className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none text-foreground">WaFaChat</div>
                <div className="mt-1 text-xs text-muted-foreground">CS Automation</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-4">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={`${item.href}?${sp.toString()}`}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                <Badge variant="secondary">pustakaislam.net</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setParam('range', r.value)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        range === r.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Select value={cs} onValueChange={(v) => setParam('cs', v ?? 'all')}>
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Semua CS" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua CS</SelectItem>
                    {csConfigs.map((c: { csName: string }) => (
                      <SelectItem key={c.csName} value={c.csName}>{c.csName.replace(/^CS\s+/i, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {NAV.map((item) => (
                <Link key={item.href} href={`${item.href}?${sp.toString()}`}>
                  <Badge variant={pathname === item.href ? 'default' : 'secondary'}>{item.label}</Badge>
                </Link>
              ))}
            </div>
          </header>
          <div className="space-y-6 p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build** — `npm run build`. Expected: compiles. (The layout now wraps the still-monolithic `/panel` page, which has its own shell — you'll see a doubled shell until Task 5 strips the old one. Don't visual-review until Task 5.)

- [ ] **Step 3: Commit**
```bash
git add app/panel/layout.tsx
git commit -m "refactor(panel): shared app-shell layout with URL-param filters"
```

---

### Task 5: `/panel` Dashboard route (general CS)

**Files:** Rewrite `app/panel/page.tsx` to be ONLY the Dashboard route content (no shell, no conversation queue, no Rekap/Performance).

**Interfaces:**
- Consumes: `usePanelFilters`; `getDashboardSummary`, `getDuplicateOrders`, `getPerformance`; `StatCard`/`AnimatedNumber`/`useHighlightOnChange`; `formatRupiah`/`fmtTime`. Moves `DashboardStatCard` + `MetricSkeleton` + `ReadinessRow` + `Formula` into this file (dashboard-only).
- Produces: the `/panel` page rendering the metric grid + Order Dobel + readiness/formula. No shell.

- [ ] **Step 1: Rewrite `app/panel/page.tsx`** as a client component that: calls `usePanelFilters()` for `{ startAt, endAt, csName, jakartaDate }`; subscribes `getDashboardSummary` + `getPerformance` (always-on here) + `getDuplicateOrders`; rebuilds the dashboard-relevant derivations from the monolith (`stats`, `totalClosing`, `crPerf`, `aiClosings`, `manualClosings`, `handoverTodayCount`, `handoverRate`, the `cards` useMemo) — copy those exact expressions; keep `DashboardStatCard` + `MetricSkeleton` (move both fns into this file) and `ReadinessRow` + `Formula` (move both here); render ONLY the metric `<section>` grid, the Order Dobel `Card`, and the "System readiness" + "Today formula" aside `Card`s. Return that content with NO `min-h-screen`/`<aside>`/`<header>` wrapper (the layout supplies them) and NO `panelView` switch. Drop all conversation/recap/performance state, queries, handlers.

  Note: cards referencing `active.length`/`closed.length`/`handover.length` (conversation-derived) are AI metrics that move to CS AI in Task 6 — on the Dashboard, keep only the general cards (Orders, Total Closing, Manual closing→drop or keep as general? per spec the Dashboard keeps Orders/Total Closing/CR/Cancelled/Omzet; the AI-mixed cards move to CS AI). For 4A, render the general subset (Orders, Total Closing, Closing rate, Cancelled, plus Omzet from `performance`/summary) and leave the AI-mixed cards out (they appear on CS AI). The full lean redesign is Plan 4B.

- [ ] **Step 2: Build** — `npm run build`. Expected: compiles; `/panel` renders the Dashboard inside the shared shell (single shell now).

- [ ] **Step 3: Visual parity** — `npm run dev` → `/panel`: general metric cards + Order Dobel + readiness/formula render inside the new shell; Periode/CS header filters update the numbers; no conversation queue here.

- [ ] **Step 4: Commit**
```bash
git add app/panel/page.tsx
git commit -m "refactor(panel): /panel is now the Dashboard route (queue removed)"
```

---

### Task 6: `/panel/cs-ai` route (conversation queue + Global AI)

**Files:** Create `app/panel/cs-ai/page.tsx`.

**Interfaces:**
- Consumes: `usePanelFilters`; `listConversations`, `getGlobalAiEnabled`, `getDashboardSummary`; the conversation mutations + handlers (ownership map); `ConversationPanel`, `ConversationDetailSheet`, `ConfirmDeleteDialog` (Task 2).
- Produces: the CS AI page.

- [ ] **Step 1: Create `app/panel/cs-ai/page.tsx`** as a client component owning the conversation domain: `usePanelFilters()`; `useQuery(api.state.listConversations, { includeClosed: true, csName })`, `getGlobalAiEnabled`, `getDashboardSummary`; state `selectedConversation`/`selectedQueue`/`searchQuery`/`pendingDelete`/`globalAiConfirmOpen`/`optimisticGlobal` + own `actionLoading`; the mutations + handlers (`handleGlobalAiToggle`/`doToggleGlobal`/`setStatus`/`notClosing`/`markWonManual`/`cancelOrder`/`undoCancelOrder`/`confirmDeleteOrder`) moved verbatim from the monolith; derive `active`/`handover`/`closed`/`displayGlobalEnabled`/`rowsByQueue`/search filtering exactly as before; render the Global AI toggle button (move the header toggle markup here, the `handleGlobalAiToggle`/`displayGlobalEnabled` block) + AI KPI summary (active/handover/AI vs manual closing — optional in 4A, full in 4C) + `<ConversationPanel … />` (same props the monolith passed) + `<ConversationDetailSheet … />` + `<ConfirmDeleteDialog … />`. Return only that content.

- [ ] **Step 2: Build** — `npm run build`. Expected: compiles.

- [ ] **Step 3: Visual parity** — `/panel/cs-ai`: the queue (active/handover/closed), per-chat actions, detail sheet, delete dialog, and the Global AI toggle all work as before; navigating to it from another route keeps the filters.

- [ ] **Step 4: Commit**
```bash
git add app/panel/cs-ai/page.tsx
git commit -m "feat(panel): CS AI route (conversation queue + Global AI toggle)"
```

---

### Task 7: `/panel/rekap` route

**Files:** Create `app/panel/rekap/page.tsx`.

**Interfaces:**
- Consumes: `usePanelFilters`; `shippingRecaps.list`, `getCounts`; the recap mutations + handlers (ownership map); `ShippingRecapPanel`, `ShippingRecapDetailSheet` (Task 2).
- Produces: the Rekap page.

- [ ] **Step 1: Create `app/panel/rekap/page.tsx`** owning the recap domain: `usePanelFilters()`; `useQuery(api.shippingRecaps.list, { startAt, endAt, status: recapStatus === 'all' ? undefined : recapStatus, paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter, search: recapSearch || undefined, csName })` + `getCounts`; state `recapStatus`/`paymentFilter`/`recapSearch`/`selectedRecap`/`recapSort`/`selectedRecapIds`/`bulkCancelOpen` + own `actionLoading`; the recap mutations + handlers (`markReadyRecap`/`cancelRecap`/`undoCancelRecap`/`markDeliveredRecap`/`undoDeliveredRecap`/`bulkMarkReady`/`bulkMarkDelivered`/`bulkCancel`/`downloadRecapCsv`) moved verbatim; derive `readyRecaps`; render `<ShippingRecapPanel … />` (same props) + `<ShippingRecapDetailSheet … />`. In `downloadRecapCsv`, replace the `stats.date` filename token with `usePanelFilters().jakartaDate`.

- [ ] **Step 2: Build + visual parity** — `npm run build`; `/panel/rekap`: filters/chips/sort/search, row + bulk actions, export, detail sheet all behave as before.

- [ ] **Step 3: Commit**
```bash
git add app/panel/rekap/page.tsx
git commit -m "feat(panel): Rekap Pengiriman route"
```

---

### Task 8: `/panel/performance` route + cleanup

**Files:** Create `app/panel/performance/page.tsx`.

**Interfaces:**
- Consumes: `usePanelFilters`; `getCsLeaderboard`, `getProductDifficulty`, `getTrend`, `getPerformance`; `PerformancePanel` (Task 2).
- Produces: the Performance page; completes the routing split.

- [ ] **Step 1: Create `app/panel/performance/page.tsx`** owning the performance domain: `usePanelFilters()`; `useQuery` for `getCsLeaderboard` (`{ startAt, endAt }`), `getProductDifficulty` (`{ startAt, endAt }`), `getTrend` (`{ startAt, endAt, bucket: 'day' }`), and `getPerformance` (`{ startAt, endAt, includeInferredDiscount: false, csName }`); render `<PerformancePanel data={performance} csLeaderboard={csLeaderboard} productDifficulty={productDifficulty} trendData={trendData} />`. (`getPeriodReport` is queried inside `PerformancePanel`.)

- [ ] **Step 2: Confirm no orphans** — `grep -rn "panelView\|setPanelView" app` → no matches. `npm run build` → clean (no unused imports/vars in any page).

- [ ] **Step 3: Visual parity across all routes** — `npm run dev`: navigate `/panel` → `/panel/cs-ai` → `/panel/rekap` → `/panel/performance`; each shows the right content, filters persist across navigation (URL carries `?range&cs`), and the Dashboard no longer fires the conversation query (the lag win).

- [ ] **Step 4: Regression + commit**
```bash
npm test   # expect 18/18
git add app/panel/performance/page.tsx
git commit -m "feat(panel): Performance route; complete routing split"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 shell (sidebar + header + URL filters, Global AI NOT in header) → Tasks 3+4. ✓
- §3.2 four pages owning their own queries → Tasks 5–8 + ownership map. ✓
- §3.3 extract panels + helpers into files → Tasks 1+2. ✓
- §2 routes + URL-param filters (defaults today/all) → Task 3 (`resolveRange`, validation) + Task 4 (`setParam` deletes default keys). ✓
- §5 perf: route isolation (Dashboard no longer mounts `listConversations`) → Task 6 moves it to cs-ai; verified Task 8 Step 3. (The `listConversations` *fix*, lazy Order Double, lean dashboard query = 4B/4C — correctly out of 4A.) ✓
- §8 "functionally equivalent after 4A, AI query isolated" → Tasks 5–8 relocate widgets unchanged; queue→cs-ai. ✓
- §7 testing = build + visual parity; convex suite green → testing approach + per-task build/visual + Task 8 `npm test`. ✓

**2. Placeholder scan:** New glue code (types/format/hook/layout) is complete; relocations are precise (named blocks + line ranges + import/export instructions + ownership map) — "move this exact existing code," not vague. No TODO/TBD. ✓

**3. Type/name consistency:** `usePanelFilters()` returns `{ startAt, endAt, csName, jakartaDate, range, cs, customDate }`, consumed consistently in Tasks 5–8. Panel export names match their imports. `DateRangeKey` lives only in the hook (Task 1 explicitly does NOT duplicate it). `stats.date` → `jakartaDate` swap noted in Task 7. ✓

**Note (refactor caveat):** line numbers are approximate (the file shifts as blocks move); the executor should locate each named function/type/block by its declaration, not the exact line. Each task ends green-build, so a missed import surfaces immediately. The CS AI page (Task 6) intentionally takes the conversation queue out of the Dashboard — that relocation is the one behavioral change in 4A and the source of the perf win.
