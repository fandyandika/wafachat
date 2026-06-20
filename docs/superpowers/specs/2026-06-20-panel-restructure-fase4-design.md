# WaFaChat Panel Restructure — Fase 4 (Design Spec)

**Date:** 2026-06-20
**Status:** Approved (design)
**Nature:** Structural + presentation rebuild. Splits the panel into route-based pages and separates AI-specific monitoring from general CS monitoring. **One data-layer logic change** (`listConversations` perf fix, unit-tested). **No data deletion** — all Convex tables (orders, shippingRecaps, conversations, …) stay intact; "removing unneeded" applies to UI/features/queries only.

## 1. Goals (in priority order)

1. **Smooth all** — kill the panel lag. Each page mounts only its own queries (route isolation); the heavy AI conversation query runs only on the CS AI page and is fixed (no unbounded closed-scan, no N+1).
2. **Beauty / elegant / minimalist / modern / satisfying** — build on the light indigo/violet design system (Plans 3A–3C): `StatCard`, `AnimatedNumber` count-up + highlight, semantic `Badge`s. Built with the **ui-ux-pro-max** skill at execution time.
3. **SaaS-friendly** — a proper app shell (persistent sidebar + clean header), distinct routes, bookmarkable URL-param filters.

## 2. Decisions (locked during brainstorming)

- **Route-based app shell.** Split the 2640-line `app/panel/page.tsx` into a shared `app/panel/layout.tsx` (sidebar + header) and four route pages:
  - `/panel` — **Dashboard (general CS monitoring)** — light.
  - `/panel/cs-ai` — **CS AI** — conversation queue + AI controls/metrics (all heavy AI queries here only).
  - `/panel/rekap` — **Rekap Pengiriman** (moved, already restyled in 3C).
  - `/panel/performance` — **Performance/Analytics** (moved, already restyled in 3C).
- **Global filters (Periode + CS) via URL search params** (`?range=7d&cs=Aisyah`) set in the shared header — persist across pages, bookmarkable. Each page reads them.
- **The split (general CS vs CS AI):**
  - **Dashboard (general CS):** Orders (leads), Total Closing, Closing Rate, Cancelled, Omzet — as KPI `StatCard`s; + **Order Double** (see below).
  - **CS AI:** Global AI toggle (ON/OFF), AI Closing vs Manual Closing, Handovers + Handover rate, Active chats, Archived, and the **conversation queue** (active/handover/closed, per-chat AI enable/disable, detail sheet).
- **"Order Dobel" → renamed "Order Double", and made click-to-open.** It becomes a button on the Dashboard (`⚠ Order Double · N`) that opens a right-side **Sheet (drawer)** containing the cross-check list — it must NOT lengthen the page. When N=0 the button is muted/disabled. Its data (`getDuplicateOrders`) is fetched lazily (only when the drawer opens).
- **`listConversations` perf fix (only logic change):** bound the **closed** conversations to "today" at the **DB index level** (stop `.collect()`-ing the entire closed history and filtering in JS); keep active/handover. Reduce/serialize the per-row order lookups so it's not an unbounded N+1. Returned shape + "today-only closed" semantics are preserved. This change gets a unit test.
- **Removed from the main dashboard** (not needed there): the "System readiness" card, the "Today formula" card, and the AI-mixed KPIs (Manual closing / Handovers / Handover rate / Active chats / Archived → moved to CS AI). Underlying data untouched.
- **Light-mode only**, consistent with Fase 3. No dark mode.

## 3. Architecture & components

### 3.1 Shared shell — `app/panel/layout.tsx` (client)
- Persistent left **sidebar**: brand mark + nav items (Dashboard, CS AI, Rekap Pengiriman, Performance) using `next/navigation` (active state from `usePathname`); mobile = the existing badge-row pattern.
- **Header**: page title (derived from route), the global **Periode** filter (Hari ini / Kemarin / 7 hari / 30 hari / Bulan ini) + **CS** selector, "last-updated" chip, and an account/logout affordance.
- Header writes filter state to the URL via `router.replace(?range=…&cs=…)`. A small `usePanelFilters()` hook reads `range`/`cs` from `useSearchParams` and resolves them to `{ startAt, endAt, csName }` (reusing the existing date-range logic). Layout persists across child-route navigations (Next App Router), so filters don't reset when switching pages.
- The Global AI toggle is **not** in the shared header — it lives on the CS AI page.

### 3.2 Pages (each a focused client component, own queries)
- **`/panel` Dashboard:** KPI `StatCard`s (`getDashboardSummary` → leads/closings/cr/cancelled/revenue, wired with `AnimatedNumber` + highlight) + an `OrderDoubleButton` that opens the `OrderDoubleSheet` (lazy `getDuplicateOrders`). Two light, windowed queries; the duplicates query is `'skip'` until the drawer opens.
- **`/panel/cs-ai` CS AI:** Global AI toggle; AI-ops KPIs sourced from `getDashboardSummary` (which already returns `manualClosings`, `handovers`, `activeChats`, `closings` → AI closing = `closings − manualClosings`) plus the conversation list for active/archived counts; the conversation queue (`ConversationPanel`) backed by the fixed `listConversations`. All conversation mutations (set status, pause/resume AI, mark closing/cancelled, delete) move here with the queue.
- **`/panel/rekap` Rekap:** `ShippingRecapPanel` (unchanged) + its queries (`shippingRecaps.list`, `getCounts`) and recap mutations.
- **`/panel/performance` Performance:** `PerformancePanel` (unchanged) + its queries (`getPerformance`, `getCsLeaderboard`, `getProductDifficulty`, `getTrend`, `getPeriodReport`).

### 3.3 Shared components extracted from the monolith
To split `page.tsx` cleanly, extract the reusable pieces into their own files (each one responsibility): `ConversationPanel`, `ShippingRecapPanel`, `PerformancePanel`, the detail sheets, and the small presentational helpers (`StatusBadge`, `OutcomeBadge`, `RecapStatusBadge`, `DetailRow`, etc.). Pages import what they need. This untangles the 2640-line file as part of the restructure (justified — we are restructuring it).

## 4. Data flow

Unchanged sources; redistributed by route. The Dashboard subscribes to ~2 light windowed queries; CS AI owns the (fixed) conversation query + AI metrics; Rekap and Performance own their existing queries. Filters flow shell → URL → page query args. No query runs on a page that doesn't display it.

## 5. Perf fixes (the "Smooth all")

1. **Route isolation** — the structural win: AI/conversation queries never instantiate on the Dashboard (separate route components, code-split bundles).
2. **`listConversations` fix** — bound closed to today at the DB level + de-N+1 the order lookups (see §2). This removes the unbounded, ever-growing scan that was the worst offender.
3. **Lazy Order Double** — `getDuplicateOrders` only runs when the drawer is opened.
4. **Lean Dashboard summary** — the Dashboard reads leads/closings/cr/cancelled/revenue from a single `getDashboardSummary` (drop the separate `getPerformance` dependency on the dashboard).

## 6. Error / edge handling

- Loading: light skeletons per page (reuse the 3B skeleton). Empty states: friendly light copy.
- URL params: missing/invalid `range`/`cs` fall back to defaults (`range=today`, `cs=all`).
- Order Double drawer: closed by default; `getDuplicateOrders` is `'skip'` until opened; N=0 → muted button + empty-state copy in the drawer.
- `listConversations`: an empty queue renders the existing empty state; the today-bound must use Asia/Jakarta start-of-day (consistent with existing `getJakartaDate`).

## 7. Testing

- **`listConversations` fix → unit test** (convex-test): seed active + handover + closed-today + closed-yesterday conversations; assert the query returns active + handover + closed-today and **excludes** closed-yesterday. This is the one behavior change worth a test.
- UI/routing → `npm run build` (typecheck) + visual review per page.
- No regression: the existing convex-test suite stays green (currently 18/18, untouched except the new `listConversations` test).

## 8. Build sequencing (separate plans, each shippable)

- **Plan 4A — App shell + routing skeleton:** create `app/panel/layout.tsx` (sidebar + header + URL-param filters), extract `ConversationPanel`/`ShippingRecapPanel`/`PerformancePanel` + shared helpers into their own files, and split the current tabs into routes (`/panel`, `/panel/cs-ai`, `/panel/rekap`, `/panel/performance`) — moving each panel's markup into its page. After 4A the app is route-based and functionally equivalent, with the heavy AI query already isolated to `/panel/cs-ai`.
- **Plan 4B — Dashboard (general CS) + Order Double drawer:** build the lean `/panel` page (KPI StatCards with count-up/highlight, slim queries) and the `OrderDoubleButton` + `OrderDoubleSheet` (renamed, lazy). Remove the System-readiness / Today-formula cards from the dashboard.
- **Plan 4C — CS AI page + `listConversations` fix:** finalize `/panel/cs-ai` (toggle + AI KPIs + queue) and implement the `listConversations` DB-level bounding + de-N+1, with the unit test.

## 9. Scope boundary (YAGNI)

**In:** route-based shell + URL-param filters; AI-vs-general split; lean Dashboard; Order Double as a lazy drawer; CS AI page; `listConversations` perf fix (+ test); built on the existing light design system with ui-ux-pro-max. **Out:** dark mode; any Convex schema/data deletion; new analytics/features; charting library; a separately-deployed app (CS AI is a route in the same Next app, not a separate deployment); the KirimDev message webhook (blocked, separate); changes to Rekap/Performance internals beyond moving them to routes.
