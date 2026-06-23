# WaFaChat Dashboard Rebuild — Fase 1: Data Foundation & Accuracy (Design Spec)

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan
**Part of:** Full WaFaChat dashboard rebuild (3 phases). This spec covers **Fase 1 only** — the accurate data foundation that Fase 2 (analytics) and Fase 3 (UI/UX + reports + audit) build on.

---

## 1. Goal

Rebuild the data foundation of the WaFaChat dashboard so that **CS performance metrics are accurate, live, and auditable** — the base for monitoring (who's the top CS, which CS is slumping, which product is hard to close, live leads & closings) and recap/report analysis.

**Why now:** Since the KirimDev migration, the data pipeline to Convex is paused (orders/leads no longer written; closings not recorded). The legacy metrics also drift because they use imperative increment counters (`dailyStats`) that require a manual `repairDailyStats`. This phase restores the feeds and replaces the fragile counters with metrics **derived from source records**.

## 2. Key decisions (locked during brainstorming)

- **Data store: stay Convex** (not Supabase). Data + event log + indexes already there; reactive queries give LIVE for free; accuracy is a computation problem, not a DB limitation; one-store scale. Supabase would mean migration + new sync for no accuracy gain.
- **Metric architecture: derive-on-read.** Compute every metric from source records (`orders`, `shippingRecaps`, `events`) per query, for any date range. No stored counters. Accurate by construction; cancel/un-cancel/cross-day edits are automatically correct. `dailyStats` counters are deprecated.
- **Lead = unique customer (phone)**, attributed by order date.
- **Closing = manual + auto**, source-agnostic record. **Date attribution: store both order-date and closing-date; default views use closing-date.**
- **Auto-closing from chat:** detect a **user-configurable** keyword phrase (e.g. `PEMESANAN BERHASIL`) in outbound CS messages → auto-create a closing record. **Dedup per `order_id`/conversation** (one closing per order, regardless of how many times the phrase appears or across days; closing date = first detection). Manual marking in the panel remains as override/correction.
- **Feasibility confirmed:** KirimDev fires `message.sent` (incl. coexistence WA-Business-App echoes, `source: "app"`) + `message.received` — so CS-typed confirmation messages are capturable.

## 3. Architecture & components

Five components (3 new, 2 restored/existing):

1. **Leads feed** *(restore)* — v2 KirimDev workflow (`M16ChgpsZsbDAlqC`) `Normalize Order Data` node adds the `set_order` call → Convex `upsertOrderFromN8n` → writes `orders` + `conversations`. Wrapped in try/catch so a Convex outage never blocks the WhatsApp send.
2. **Message pipeline** *(new)* — subscribe to KirimDev webhooks `message.sent` + `message.received` → a new n8n workflow → Convex `ingestMessage` mutation → `messages` table (linked to conversation by phone/order). HMAC-verified; idempotent (dedup by `externalMessageId`).
3. **Auto-closing detector** *(new)* — when an outbound message (`role` cs/ai) matches a configured closing phrase, create/upsert a closing record for that order (dedup per `order_id`), `source: "auto"`, and log a `closing_detected` event. Reuses existing `shippingRecaps` creation/parsing logic where possible.
4. **Metrics layer** *(new, derive-on-read)* — Convex queries that compute all metrics from `orders` + `shippingRecaps` + `events` for an arbitrary `[startAt, endAt]` + optional `csName`. Replaces `getDailyStats`. Functions: `getMetrics`, `getCsLeaderboard`, `getProductBreakdown`, `getTrend` (daily/weekly/monthly buckets).
5. **Manual closing** *(existing)* — `markConversationClosing` + `createFromPanelClosing` stay as the CS override/correction path.

**Deprecated:** `dailyStats` increment/decrement counters and `repairDailyStats`. The `events` table is retained as the audit source of truth.

### Data flow
```
Berdu order → v2 KirimDev ─┬→ WhatsApp notif (already live)
                           └→ set_order → Convex orders + conversations          (LEADS)
CS replies in WA Business App → KirimDev message.sent → n8n → Convex messages
                           └→ matches closing phrase → auto closing (dedup/order) (CLOSING)
CS clicks "closing" in panel (override) ──────────────→ closing record           (CLOSING)
Dashboard → Convex metric queries (derive from orders+recaps+events, reactive/LIVE)
```

## 4. Metric definitions — the accuracy contract

All computed derive-on-read; `EXCLUDED_PHONES` (test numbers) are excluded everywhere.

| Metric | Definition |
|---|---|
| **Leads** (period) | count of **distinct `customerPhone`** in `orders` with `createdAt ∈ [startAt, endAt]` and assigned CS active+reporting. (by order-date) |
| **Closings** (period) | count of **distinct `customerPhone`** in `shippingRecaps` with `closedAt ∈ [startAt, endAt]` and `status ∉ {cancelled, cancelled_after_export}`. (by closing-date) |
| **Closing Rate (CR)** | closings ÷ leads, guarded for divide-by-zero (0 leads → CR 0). |
| **Per-CS leaderboard** | group by CS: leads (distinct phone per `assignedCsName`), closings (distinct phone per `csName`), CR, revenue. |
| **Per-product** | group by product: leads = **orders** of that product (order-granularity, not customer-deduped, because one customer may buy different products), closings = recaps of that product, CR. |
| **Revenue** (period) | Σ `codValue ?? total` of non-cancelled closings with `closedAt ∈ period`. |
| **Cancelled** (period) | recaps with `status ∈ {cancelled, cancelled_after_export}` in period. |
| **Handover / Active** | from `conversations` (status) + `events` (handover events) in period. |

**Invariant:** because every number is recomputed from records, corrections (cancel, un-cancel, CS edits, cross-day closings) are reflected automatically with no counter to repair.

## 5. Configurable closing rules

- Closing phrases stored in `settings` (or a small `closingRules` table) — user-editable in the panel (Fase 3 surfaces the editor; Fase 1 can seed via a Convex mutation/config). Support multiple phrases; case-insensitive match.
- Matching is on **outbound** messages (CS/AI), not inbound, to avoid false positives from customers quoting text.

## 6. Error handling

- `set_order`: try/catch in the n8n Code node — WhatsApp notif still sends if Convex is unreachable.
- Webhook ingestion: verify KirimDev HMAC signature (`X-Kirim-Signature: t=…,v1=…`); idempotent by `externalMessageId`; a message that fails to parse is logged, not fatal.
- Auto-closing: dedup per `order_id` prevents duplicates; manual override corrects misses/false-positives.
- Metrics: divide-by-zero guards; exclude test phones; cancellation handled purely by the status filter (no counter fix needed).

## 7. Testing (TDD)

- **Metric queries:** seed sample orders + recaps, assert leads (distinct-customer), closings, CR, per-CS, per-product, both date attributions, and cancelled-exclusion. Include a repeat-customer case (2 orders, 1 closing) to lock the per-customer semantics.
- **Auto-closing detector:** outbound message with the phrase → exactly one closing for the order; phrase appears again (same order) → still one; different order same customer → separate closing.
- **Idempotent ingestion:** same `externalMessageId` twice → one `messages` row.

## 8. Scope boundary

**In Fase 1:** restore leads feed; message pipeline (KirimDev webhooks → Convex `messages`); auto + manual closing; derive-on-read metrics layer; deprecate `dailyStats`.

**Out of Fase 1 (later phases):**
- **Fase 2 — Analytics:** richer CS leaderboard (juara/lesu via trend), product difficulty, leads/closing over-time, weekly/monthly aggregations. (Metric queries here already accept arbitrary date ranges as the foundation.)
- **Fase 3 — UI/UX redesign + reports + audit:** new monitoring/analytics interface, weekly/monthly report views, audit log view. **UI direction (noted for Fase 3):** light mode default; minimalist, elegant, modern; enjoyable to watch long-term (satisfying when live closings/leads tick up); comfortable, easy to understand. To be built with the ui-ux-pro-max skill.
- **AI auto-reply** (separate AI phase) — though the message pipeline built here is its foundation.
- **No backfill** of the post-migration gap period.
- The existing panel may be wired to the new metric queries during Fase 1 only to verify correctness; the visual redesign is Fase 3.

## 9. Files (anticipated; finalized in the plan)

- Modify: v2 workflow `Normalize Order Data` (add `set_order` call).
- New: n8n message-ingestion workflow (KirimDev webhooks).
- Convex: new `metrics.ts` (derive-on-read queries); `ingestMessage` mutation + closing-detector (likely in `messages.ts`/`state.ts`); closing-rule config; deprecate `dailyStats` writes in `state.ts`.
- Convex `shippingRecaps.ts`: reuse for auto-closing recap creation.
