# Laporan v2 — Period clarity + SLA-breach metric — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Goal

Make the Laporan tab more actionable with two additions: (A) a single **Live / Selesai** period indicator next to the date toggle so the open-vs-sealed status is obvious at a glance, and (B) an **SLA-breach metric** — how many first-replies waited longer than 15 minutes of *active hours* — shown overall and per CS. Both reuse existing data/infra; no pipeline changes.

## Problem

- The Laporan period's Live/Selesai status only appears buried in each per-CS card. But that status is a property of the **period**, not the CS (today → all cards Live; a past date → all Selesai). It should be stated once, near the date toggle.
- The per-CS median response-time (shipped) shows the *center* of speed. It does not surface the *failures* — the customers who waited too long, which are the real lost-sale risks. There is no "how many breached SLA" view.

## Approach

Pure-derivation for (A) from the existing 4pm-WIB window math; for (B), extend the existing response-time computation (`responseTimeMath` + `getResponseTimes`) with a business-hours-aware breach count. UI adds a period pill, an overall SLA tile, and a per-CS card line. No data, schema, or pipeline changes.

---

## A. Period indicator (Live vs Selesai)

**Derivation** (reuses [report-window.ts](../../../components/panel/report-window.ts)):
- The selected Laporan date has a label date `D`. The window is `[4pm D, 4pm (D+1))`.
- **LIVE** when `D === currentReportLabelDate(now)` — the window is still open; it seals at `fourPmWibMs(D+1)`. Show: **🔴 LIVE — tutup 16:00 WIB · sisa {Xj Ym}** (remaining = seal − now).
- **SELESAI** when `D` is before the current label date (window already sealed). Show: **✅ SELESAI — final**.

**Placement:** a status pill next to the date/calendar toggle in `daily-report-dashboard.tsx`. Per-CS Live/Selesai badges may stay (now redundant but harmless) or be simplified — keep them for v2 to minimize churn.

No new query; the component already knows the selected date and `now`.

## B. SLA-breach metric

### Definition (confirmed)

A first-reply is an **SLA breach** when its wait time — counting **only minutes within the active window 05:30–18:00 WIB** — exceeds **15 minutes**. The SLA clock pauses outside active hours.

| Inbound | First reply | Active minutes | Result |
|---|---|---|---|
| 10:00 | 10:20 | 20 | breach |
| 17:55 | next 06:00 | 5 + 30 = 35 | breach |
| 20:00 | 20:10 | 0 | ok |
| 20:00 | next 05:40 | 10 | ok |

Rationale: CS is not penalized for off-hours; an end-of-day message that carries into the morning still counts fairly (only its active minutes).

### Constants
```
SLA_THRESHOLD_MIN = 15
BH_START_MIN = 330   // 05:30 WIB, minutes from WIB midnight
BH_END_MIN   = 1080  // 18:00 WIB
```

### Math — `convex/responseTimeMath.ts` (pure, dependency-free, testable)

- **`businessMinutesBetween(startMs, endMs): number`** — sum of minutes in `[startMs, endMs]` that fall within the daily `[05:30, 18:00] WIB` windows. Walk day-by-day (WIB) over the span, intersect each day's active window with `[start, end]`, sum overlaps. Cap the walk at a small bound (e.g. 14 days) so a pathological pair can't loop unbounded; returns `0` for `endMs <= startMs`.
- **`isSlaBreach(inboundAt, replyAt, thresholdMin = SLA_THRESHOLD_MIN): boolean`** — `businessMinutesBetween(inboundAt, replyAt) > thresholdMin`.
- **Extend `pairResponseEvents`** to also return the first reply's timestamps so a breach can be computed: add `firstInboundAt: number | null` and `firstReplyAt: number | null` to its return (the inbound that the first reply answered, and that reply's time). Existing fields (`firstReplyMs`, `allReplyMs`) unchanged.

### Query — `convex/responseTime.ts` `getResponseTimes`

Per conversation, after `pairResponseEvents`, if a first reply exists compute `isSlaBreach(firstInboundAt, firstReplyAt)`. Aggregate per CS:
- add `slaBreaches: number` (conversations whose first reply breached) to each `cs[]` entry. Denominator is the existing `firstReplyCount` (so breach-% = `slaBreaches / firstReplyCount`).
- add to `overall`: `slaBreaches: number` (total) alongside the existing `firstReplyCount`.

The `csName` filter, internal-phone exclusion, and `Promise.all` conversation fetch stay exactly as they are. No new index or table.

### UI

- **Overall tile** in `daily-report-dashboard.tsx`: **⏱️ {N} chat lewat SLA** (subtitle: `>15m, jam aktif 05:30–18:00`), plus the worst CS (max `slaBreaches`) when N>0. Style consistent with the existing Sorotan/metric tiles. Neutral/zero state when N=0.
- **Per-CS card line** in `report-card.tsx`: near the existing ⚡ Respon line, add **⏱️ {n} lewat SLA** — muted when `n===0`, red (`text-negative`/destructive) when `n>0`. Omit the line entirely if the CS has no first-replies in the window.

## Out of scope (YAGNI)

- Unanswered-but-overdue chats (no reply yet) → that is the "live alert → Telegram" idea (currently on Hold).
- Configurable threshold / active hours UI — hardcode 15 min and 05:30–18:00 for v2; revisit if needed.
- Changing the existing median/p90 response-time (stays wall-clock); SLA is an additive, separate metric.

## Testing

`convex-test` + vitest (edge runtime):
- `businessMinutesBetween`: the four table cases (10:00→10:20 = 20; 17:55→06:00 = 35; 20:00→20:10 = 0; 20:00→05:40 = 10); `endMs<=startMs → 0`; a fully-in-hours span; a fully-off-hours span = 0.
- `isSlaBreach`: 15.0 active min → false (strictly `>`), 15.1 → true.
- `pairResponseEvents`: returns correct `firstInboundAt`/`firstReplyAt` for a simple inbound→reply, and `null`s when no reply.
- `getResponseTimes`: a conversation with an in-hours 20-min first reply increments that CS's `slaBreaches` and `overall.slaBreaches`; an off-hours fast reply does not.
- Build (`npm run build`, EXIT 0) + full `npx vitest run` green before deploy.

## Global constraints

- Convex 1.39, Next.js 14, single light theme, no emoji-as-text in data (lucide icons / the existing ⚡/⏱ glyph convention used in report cards is fine — match existing usage).
- All times WIB (UTC+7); reuse `JAK_MS` from `report-window.ts`/existing helpers.
- Deploy Convex only from `main` after build + `npx vitest run` green (query change needs a deploy).
- Additive only — no schema change, no new index, no pipeline/n8n change.
