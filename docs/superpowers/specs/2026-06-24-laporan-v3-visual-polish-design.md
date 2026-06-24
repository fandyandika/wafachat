# Laporan v3 — Visual polish (gold token + cohesion) — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Goal

Perfect the Laporan page's gamification look: give "achievement" a single, system-tuned **gold**, reserve it strictly for wins (never warnings), and remove leader-info redundancy. Presentation-only — no logic, query, or data change.

## Problem (from the token audit)

The theme is a harmonized OKLCH set — primary **indigo** `oklch(0.52 0.22 280)`, lead **blue** `252`, positive **green** `162`, negative **red** `27`. But the gamification layer uses **raw Tailwind `amber/yellow`** (off-system) and uses it for **two conflicting meanings at once**: achievement (Queen hero, Queen chip, reward chips) AND caution (double-order, CR 50–60%). At a glance "menang" and "awas" look identical, and the warm amber doesn't sit in the OKLCH system. Separately, the "who's winning" info repeats 3× (Queen hero + Sorotan row + per-card reward chips).

(`primary` indigo vs `positive` green are distinct hues — the rank-1 ring vs CR bar do NOT clash; left as-is.)

## Changes

### 1. Add a tuned gold token — `app/globals.css` + `tailwind.config.ts`

`:root` in `globals.css`:
```css
/* Achievement gold (gamification) — tuned to the OKLCH system, reserved for wins */
--gold: oklch(0.72 0.13 85);
--gold-soft: oklch(0.95 0.05 85);
--gold-foreground: oklch(0.42 0.09 75);
```
`tailwind.config.ts` `colors` (next to `positive`/`lead`):
```ts
gold: 'var(--gold)',
'gold-soft': 'var(--gold-soft)',
'gold-foreground': 'var(--gold-foreground)',
```
This makes `bg-gold`, `bg-gold-soft`, `text-gold`, `text-gold-foreground`, `ring-gold`, `border-gold` available and harmonized with the brand.

### 2. Gold = achievement ONLY — `components/panel/report-card.tsx`

- **Queen ring:** `ring-2 ring-amber-400/70` → `ring-2 ring-gold/60`.
- **Queen chip** (top of CardContent): the bold achievement marker → `bg-gold-soft text-gold-foreground ring-1 ring-gold/40 font-bold`, `Crown` icon `text-gold`.
- **Reward chips** (Closing Terbanyak / CR Tertinggi / Respon Tercepat): one consistent, *lighter* gold (secondary to the Queen chip) → `bg-gold-soft/60 text-gold-foreground ring-1 ring-gold/20`, icon `text-gold`. (No more `from-amber-100 to-yellow-100`.)

### 3. Warnings move OFF gold

- **Per-card double-order callout** (`card.duplicates > 0` block, report-card.tsx): from amber (`border-amber-200 bg-amber-50 text-amber-800`) → **neutral/muted**: `border-border bg-muted/50 text-muted-foreground`, `Copy` icon muted. It is informational, not an achievement.
- **InfoStrip double-order item** (daily-report-dashboard.tsx): `text-amber-700` + amber icons → muted (`text-muted-foreground`, `Copy`/`Info` `text-muted-foreground`). The "Tidak ada order double" check stays `text-positive` (green). The SLA item stays **red** (`text-destructive`) — a real problem, correctly distinct from gold.
- **CR 50–60% (`lib/cr.ts`)**: left as `amber-500` — a genuine performance-caution on the green→amber→red CR scale, and the saturated amber reads clearly different from the soft achievement gold. Out of scope to change.

### 4. Remove leader redundancy — `components/panel/daily-report-dashboard.tsx`

- **Delete the "Sorotan" row** (the `{showHighlights && (...)}` block) and the now-unused `HighlightCard` component. The Queen hero (overall champion) + the per-card reward chips (category wins, shown in context on each CS card) already cover this — cleaner, one less full-width row.
- Keep the `topClosing` / `topCr` / `fastestResp` computations (they still feed `rewardsByCs`); drop the unused `showHighlights` flag.
- **QueenHero** component: re-skin to gold tokens — `bg-gold-soft` (or a subtle `from-gold-soft` gradient), `border-gold/60`, `ring-gold/30`, `Crown` `text-gold`, headings `text-gold-foreground`. Stays directly below `GrandStrip` (KPI first, then celebrate).

## Architecture / data flow

Pure presentation: a new theme token + className swaps + removing one render block and one component. No query, schema, props-logic, or data change. The Queen/SLA/reward DATA is unchanged.

## Testing

- `npm run build` EXIT 0; `npx vitest run` stays green (81 tests — no logic touched).
- Visual sanity after deploy: gold appears only on Queen hero / Queen chip / reward chips; double-order reads neutral; SLA reads red; Sorotan row gone; no leftover `amber-`/`yellow-` classes in the achievement elements.

## Global constraints

- Next.js 14 + Tailwind v3 (shadcn base); single light theme; lucide icons; no emoji-as-text.
- Reserve `gold` strictly for achievement; warnings neutral/red; performance scale (CR) stays green/amber/red.
- Presentation-only — no schema/query/Convex change. Existing 81 tests stay green.
- Deploy: build + vitest green, `git push` (Vercel). No Convex deploy.

## Out of scope (YAGNI)

- Dark mode / theme variants.
- Tokenizing the CR-scale amber.
- Reordering Queen hero above GrandStrip (kept KPI-first; trivially adjustable later).
- Animations / metallic gold effects.
