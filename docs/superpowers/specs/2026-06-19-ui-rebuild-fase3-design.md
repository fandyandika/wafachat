# WaFaChat Panel UI Rebuild — Fase 3 (Design Spec)

**Date:** 2026-06-19
**Status:** Approved (design)
**Nature:** Presentation-only. **No data/Convex changes** — all metrics are already accurate & live (Fase 1+2). Fase 3 only touches the frontend (theme, components, layout, page markup).

## 1. Goal

Rebuild the whole panel into a **light-mode, minimalist, elegant, modern** interface that is comfortable to watch for long stretches and feels **satisfying when live closing/leads tick up**. Built with the **ui-ux-pro-max** skill during execution for visual craft.

## 2. Decisions (locked during brainstorming)

- **Light-mode ONLY** — light is the single theme; **no dark mode / no theme toggle** (drop the dark variant; `next-themes` not needed for theming).
- **Accent: indigo/violet** on a neutral (white/soft-gray) base. Semantic metric colors stay consistent: leads (indigo/sky), closing (emerald, positive), cancelled (red).
- **"Satisfying live": subtle** — animated count-up numbers + a brief soft highlight when a value increases. No confetti/pulse.
- **Density: airy/spacious** — generous whitespace, comfortable cards.
- **Full rebuild, all screens, one spec** — sequenced into build plans (3A/3B/3C).
- **No new features, no data changes, no charting library** — analytics keeps the functional tables + CSS sparklines from Fase 2, just restyled.

## 3. Architecture & components

Pure frontend. Files: `app/globals.css` (single light theme), `app/layout.tsx`, `components/ui/*` (refined primitives), new components, `app/panel/page.tsx` (restyle), `app/login/page.tsx`.

### 3.1 Design system (foundation)
- **Single light theme in `globals.css`**: tokens for `background` (near-white), `foreground`, `card`, `border`, `muted`/`muted-foreground`, `primary` (indigo/violet), plus semantic metric tokens (lead, closing/positive, cancelled/negative). Remove the `.dark` block.
- Typography scale (clear hierarchy), **generous spacing**, soft radius, subtle shadows (elevation, not heavy).
- Refine shared primitives for the airy/elegant look: `Card`, `Badge`, `Button`, `Tabs`, `Table`, and a `StatCard` (metric card).

### 3.2 "Satisfying live" mechanism
- **`AnimatedNumber`** — counts up/down to the target value via `requestAnimationFrame` (dependency-free), respects `prefers-reduced-motion`.
- **`useHighlightOnChange` / highlight class** — when a tracked value **increases**, briefly apply a soft accent background flash (CSS transition), then fade. Applied to key metrics (leads, closings) so live increments feel rewarding without being noisy.

### 3.3 Shell & screens (all restyled)
- **App shell / nav** + header (period/CS filters, last-updated, logout) — clean light layout.
- **Login** — minimalist light card.
- **Dashboard** — metric `StatCard`s (with `AnimatedNumber` + highlight), Order Dobel section, formula helper.
- **Analytics** (Performance tab) — KPI row + 🏆 Leaderboard / 📉 Product difficulty / 📈 Trend sparkline / 🧾 Laporan, all restyled airy.
- **Rekap Pengiriman** — table/filters restyled.

## 4. Data flow

Unchanged. Components keep consuming the existing Convex queries via `useQuery` (reactive/live). Fase 3 changes only how that data is presented.

## 5. Error/edge handling

- Loading states: light skeletons (not dark). Empty states: friendly light copy.
- `AnimatedNumber`: guard NaN/undefined (show 0 or `–`); on first render snap to value (no count-up from 0 on mount unless desired) — count-up only on subsequent increases.
- `prefers-reduced-motion`: disable count-up + highlight (instant updates).

## 6. Testing

- UI is verified by **`npm run build` (typecheck)** + **visual review** in the browser.
- One **unit test** for `AnimatedNumber`'s value/format logic (and that reduced-motion short-circuits).
- No regression to data: convex-test suite from Fase 1/2 stays green (untouched).

## 7. Build sequencing (separate plans, each shippable)

- **Plan 3A — Design system + shell:** single light theme tokens in `globals.css` (remove dark), refined primitives, app shell/nav + header, login restyle. After 3A the whole panel is already light + coherent.
- **Plan 3B — Dashboard + live:** `AnimatedNumber` + highlight components (+ unit test); restyle Dashboard StatCards/sections using them.
- **Plan 3C — Analytics + Rekap:** restyle the Performance/Analytics sections and the Rekap Pengiriman view to the new system.

## 8. Scope boundary (YAGNI)

**In:** light-only theme + design system; airy/elegant restyle of all screens; subtle count-up + highlight on live metrics; built with ui-ux-pro-max. **Out:** dark mode/theme toggle, any data/Convex change, new features, charting library, Task 5 (KirimDev webhook — separate, blocked), mobile-app shell.
