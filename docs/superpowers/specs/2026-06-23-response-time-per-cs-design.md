# Response Time per CS — Design

**Date:** 2026-06-23
**Status:** Approved (design phase)
**Owner:** pustakaislam.net WA CS Automation (WaFaChat)
**Roadmap item:** #1 ⚡ Response time per CS (highest impact, data ready)

## Goal

Measure how fast each CS replies to customers — a **leading** indicator of closing (speed-to-reply predicts close rate; closing-count is lagging). Concretely: answer "is a CS slacking off (slow to reply), e.g. Risma after 4pm" with a number instead of a guess. Monitoring-first; no AI.

## Context (data reality)

- **`messages`** table: `conversationId`, `orderId`, `customerPhone`, `role` (customer/ai/cs/system), `direction` (inbound/outbound), `content`, `messageType` (text/image/template/button), `source`, `externalMessageId`, `createdAt`. Indexes: `by_conversation_createdAt`, `by_customerPhone_createdAt`, `by_orderId_createdAt`, `by_externalMessageId`. **No global `by_createdAt` index** (added by this feature).
- **CS attribution is NOT on the message** — it's on `conversations.assignedCsName`. Response times join message → conversation.
- **Outbound role may be mislabeled** `ai` vs `cs` (old `source==='dashboard'?'cs':'ai'` map). So a "CS reply" = `direction==='outbound'` (any role except `system`), NOT a role filter.
- **The customer flow** (critical): customer fills a Berdu form (not a WA message) → an **instant automated Meta Utility template** is sent (`messageType: 'template'`, order confirmation + COD/Transfer buttons) → customer WhatsApps a greeting or clicks COD/Transfer (inbound) → **CS replies manually** (text / quick-reply, stored as text). The auto-template must be **excluded** from "CS reply" or it falsely shows ~0s response times.

## Metric definitions

A **response event** = a customer's turn answered by a CS reply, found by walking a conversation's messages in `createdAt` order:
- A customer **inbound** (`direction==='inbound'`, any `messageType`) starts a turn (records `pendingInboundAt` if none pending).
- A **CS reply** (`direction==='outbound'` AND `messageType !== 'template'` AND `role !== 'system'`) closes the open turn → emit event `gap = reply.createdAt − pendingInboundAt`, then clear `pendingInboundAt`.
- An outbound with no pending inbound (auto-template, or CS messaging first) emits nothing.
- Consecutive customer inbounds before a reply collapse into one turn (use the **first** inbound's time — honest "customer asked → CS answered").

Per event: attributed to the window by the **inbound's** `createdAt`, and to the CS by the conversation's `assignedCsName` (display-normalized via `normalizeCsName`).

**Aggregates per CS (over a window):**
- **First-reply** = the *first* response event per conversation → **median**, **p90**, **count**.
- **Ongoing** = *all* response events → **median**, **count**.
- **Overall** (all CS combined) first-reply **median** — for the Dashboard KPI.

`p90` (nearest-rank): `sorted[ceil(0.9 · n) − 1]`. `median`: middle (avg of two middles if even). Both over the gap arrays.

## Non-goals (explicitly NOT built here)

- **SLA % / "belum dibales" (unanswered) count** → belongs to roadmap #2 (Telegram alerts); not here.
- **Business-hours filter** → the 4pm Laporan window already isolates evening; no separate filter.
- **Precompute-on-write / backfill** → derive-on-read (see Architecture).
- No write-path changes to `appendMessageFromN8n`.
- No change to existing `getDailyReport` / `getPerformance` / `computeCsAgg` logic.

## Architecture

**Approach A — derive-on-read** (chosen over precompute-on-write to stay consistent with `computeCsAgg`/`getDailyReport`, keep it live/reactive, and avoid a hot-path change + backfill).

- **New index:** `messages.by_createdAt: ["createdAt"]`.
- **New query** `convex/responseTime.ts` → `getResponseTimes({ startAt, endAt, csName? })`:
  1. Scan messages in `[startAt, endAt]` via `by_createdAt`.
  2. Drop messages whose `customerPhone` is internal/CS (`isInternalTestPhone`).
  3. Group by `conversationId`, preserving `createdAt` order (global scan order ⊇ per-conversation order).
  4. Batch-fetch the unique conversation docs (`ctx.db.get`) → `Map<conversationId, assignedCsName>`.
  5. Turn-based pairing per conversation → response events; tag the first event per conversation as `isFirst`.
  6. Aggregate per CS (keyed by `normalizeCsName(assignedCsName)`): first-reply median/p90/count, ongoing median/count. Plus an overall first-reply median.
  7. If `csName` is passed, filter to that CS.
- **Pure, tested helpers** in `convex/responseTimeMath.ts`: `median(nums)`, `percentile(nums, p)`, `pairResponseEvents(orderedMessages)` (the turn-based walk over a message list → gaps + isFirst). Client-side `formatDuration(ms)` in `lib/format.ts`.
- **Caveat (accepted):** events whose inbound/reply straddle the window boundary are clipped/missed — negligible for aggregates. Window-scoped (not conversation-lifetime) "first reply" = first answered turn *in the window*, which is the right read for "how responsive during this window".

**Return contract:**
```ts
{
  windowStart: number, windowEnd: number,
  overall: { firstReplyMedianMs: number | null, firstReplyCount: number },
  cs: Array<{
    csName: string,
    firstReplyMedianMs: number | null, firstReplyP90Ms: number | null, firstReplyCount: number,
    ongoingMedianMs: number | null, ongoingCount: number,
  }>,
}
```
`null` when count is 0 (display "–").

## Surfaces (3, all per-CS, each calls `getResponseTimes` with its own window)

1. **Laporan harian (4pm window)** — one extra line per CS card: `⚡ Respon: 4m · p90 12m (n=8)`. Merged into the card by `csName` (client-side join with the `getDailyReport` cs rows). **This is the direct answer to "Risma after 4pm."**
2. **Performance** — two columns in the per-CS table: `Respon (median)` and `p90`. Merged by `csName` with `getCsLeaderboard`.
3. **Dashboard** — one KPI `StatCard`: `⚡ Avg respon: 4m` (from `overall.firstReplyMedianMs`).

**Display:** `formatDuration` → `45s` / `4m` / `1j 12m`; `null`/0 → `–`. Small samples (`count < 3`) rendered muted (low confidence). Ongoing median shown as a secondary/tooltip detail where space allows (primary headline = first-reply median).

## Testing

- **Pure helpers:** `median`, `percentile` (incl. p90 nearest-rank, even/odd n, empty→null), `formatDuration` (s/m/j boundaries, 0), `pairResponseEvents` (turn-based: single turn, multi-inbound→one reply collapses to first inbound, template outbound skipped, outbound-with-no-pending emits nothing, isFirst tagging).
- **`getResponseTimes` (convex-test):** fixtures of `conversations` + `messages` covering: basic first-reply gap; ongoing (2nd turn) counted; **template outbound excluded** (no false ~0s); internal/CS phone excluded; per-CS attribution via `conversation.assignedCsName`; `csName` filter; empty window → nulls.
- **Prod sanity (once, at implementation):** confirm the auto-notif is stored as `messageType='template'`, and there's enough message volume per CS for meaningful medians.

## File structure

**Backend**
- `convex/schema.ts` (modify) — add `by_createdAt` index to `messages`.
- `convex/responseTime.ts` (create) — `getResponseTimes` query + the pairing/aggregation, using pure helpers.
- `convex/responseTimeMath.ts` (create) — pure `median` / `percentile` / `pairResponseEvents` (+ tests `convex/responseTimeMath.test.ts`).
- `convex/responseTime.test.ts` (create) — query tests.

**Frontend**
- `lib/format.ts` (modify) — add `formatDuration(ms)` (+ test if a format test file exists, else a small new one).
- `components/panel/daily-report-dashboard.tsx` + `report-card.tsx` (modify) — fetch `getResponseTimes` for the 4pm window, merge by `csName`, render the `⚡ Respon` line.
- `components/panel/performance-panel.tsx` + `app/panel/performance/page.tsx` (modify) — fetch `getResponseTimes` for the panel range, add the two columns.
- `app/panel/page.tsx` (modify) — add the `⚡ Avg respon` KPI StatCard (fetch `getResponseTimes` for the panel range).

## Deferred / future

- SLA threshold + "% replied within X min" + unanswered count → feeds roadmap #2 (Telegram alerts).
- Business-hours / time-of-day split.
- Precompute-on-write if derive-on-read gets slow at scale.
