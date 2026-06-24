# Queen CS crown + SLA mini-badge — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Goal

Two report-card refinements: (A) a single **Queen CS** crown — the overall best CS for the period, combining closings + closing-rate + response speed via a weighted score; and (B) turn the SLA-breach metric from a full row into a lean **mini-badge** on the card. Both are front-end only (derived from data already in the Laporan view) — no Convex/schema/pipeline change.

## A. Queen CS

### Scoring (weighted 40/40/20)

A CS qualifies if **`leads >= 3`** (avoids a 1-lead-100%-CR fluke). Among qualified CS, each metric is normalized 0–1 **relative to the best qualified CS** (so weights stay fair across different scales):

- `closeScore = closings / maxClosings`
- `crScore = cr / maxCr`
- `speedScore = minMedianMs / respMedianMs` (fastest → 1.0). A CS needs **`respCount >= 3`** for a reliable median; CS with fewer get `speedScore = 0` (they can still win on closings + CR). `minMedianMs` = the fastest median among speed-eligible qualified CS; if none are speed-eligible, every `speedScore = 0`.

`score = 0.40·closeScore + 0.40·crScore + 0.20·speedScore`

**Queen = highest score.** Tie-break by `closings` desc, then `cr` desc.

### Eligibility to crown

- Need **at least 2 qualified CS** (so "Queen" implies a contest). Fewer → no Queen that period.
- Only on the **team view** (not when the header CS filter selects one CS).
- Works in both Live and Selesai periods.

### Module — `lib/queen.ts` (pure, testable)

```ts
export type QueenInput = { csName: string; closings: number; cr: number; leads: number; respMedianMs: number | null; respCount: number };
export const QUEEN_WEIGHTS = { closing: 0.4, cr: 0.4, speed: 0.2 };
export function computeQueenCs(rows: QueenInput[], minLeads = 3, minRespCount = 3): { csName: string; score: number } | null;
```

`computeQueenCs` filters to `leads >= minLeads`, returns `null` if fewer than 2 qualify, computes the relative-normalized weighted score per the rules above, sorts by `score` then `closings` then `cr`, and returns the winner (or `null`). Guards: `maxClosings`/`maxCr` of 0 → that sub-score 0.

### Wiring — `components/panel/daily-report-dashboard.tsx`

Build `QueenInput[]` from `allCs` (csName/closings/cr/leads) + `respByCs` (firstReplyMedianMs/firstReplyCount). Call `computeQueenCs` only on the unfiltered team view (`!csName`). Pass the winner name down so the matching card shows the crown.

## A-display: where the crown shows

- **Queen hero banner** above the existing "Sorotan" section: a distinct gold/amber banner with a `Crown` (lucide) icon, the winner's avatar + name, and a short label (e.g. "Queen CS · juara umum"). Prominent, sits above the 3 per-category Sorotan cards (which stay).
- **Crown marker on the winner's card:** `ReportCard` gains an `isQueen?: boolean` prop. When true: a gold ring on the card and a small `Crown` + "Queen" marker in the header. Existing per-category reward chips (Closing Terbanyak / CR Tertinggi / Respon Tercepat) stay — Queen is the meta-award above them.

## B. SLA mini-badge

Replace the full per-CS SLA row (added in Laporan v2) with a **mini-badge in the card header**, next to the Live/Selesai badge:

- Shown **only when `resp.slaBreaches > 0`** → a small red chip: `Clock` icon + `{n}` (e.g. "2"), tooltip/aria "n chat lewat SLA (>15m)".
- When `0` → render nothing (lean).
- The "Balas chat baru" median line stays (primary info). The dedicated SLA row from Laporan v2 is removed.

## Architecture / data flow

All derived client-side from the existing `getDailyReport` (`report.cs`) + `getResponseTimes` (`respByCs`) results — no new query, no Convex change. `lib/queen.ts` is the only new file; the rest are edits to the two Laporan components.

## Testing

vitest:
- `computeQueenCs`: (1) a CS dominating closings + CR wins; (2) speed weighting — a much faster CS with weaker closings/CR does **not** overtake (20% weight); (3) `<2` qualified → `null`; (4) `leads<3` excluded from qualification; (5) tie on score → higher `closings` wins; (6) all `respCount<3` → still crowns by closings + CR (no crash, speedScore 0).
- Build (`npm run build`, EXIT 0) + full `npx vitest run` green before deploy.

## Global constraints

- Next.js 14, single light theme; lucide icons (`Crown`, `Clock`), no emoji-as-text in components.
- Front-end / derived only — no schema, index, query, or pipeline change.
- Reuse existing tokens/patterns (the `bg-positive-soft`, amber, `crTextClass`, reward-chip gradient already in the cards).
- Deploy: `npm run build` + `npx vitest run` green, then `git push` (Vercel). No Convex deploy needed (no backend change).

## Out of scope (YAGNI)

- Configurable weights UI (hardcode 40/40/20; tune in `QUEEN_WEIGHTS` if needed).
- Queen history / streaks / "Queen of the week".
- Crowning when only 1 CS qualifies (intentionally requires ≥2).
