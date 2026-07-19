# WaFaChat — Roadmap / Backlog

Deferred items. Pull from here when needed.

## Current execution roadmap (2026-07-19)

### Baseline Convex — 18 July 2026

- Database I/O: **193.2 MB/day** (74 MB reads + 16.86 MB writes shown for the largest function; dashboard total includes all functions).
- Largest function: `ingest/core.processEvent` **90.86 MB / 47.0%**.
- Next hot groups: response time **17.09 MB**, follow-up **17.63 MB combined**, order-counter reconciler **9.89 MB**, period report **9.30 MB**, health monitor **7.53 MB**, lifecycle **7.13 MB**.
- Detailed implementation plan: [`docs/superpowers/plans/2026-07-19-convex-io-remediation-roadmap.md`](superpowers/plans/2026-07-19-convex-io-remediation-roadmap.md).

### Ordered delivery gates

1. **Convex correctness baseline** — fix the two date-dependent tests; full suite green.
2. **Low-risk I/O wins** — indexed health snapshot, reusable response-time cache buckets, incremental Berdu reconciliation.
3. **Follow-up/lifecycle efficiency** — direction index, four-page durable lifecycle workers, scheduled continuations, and tenant-isolated scheduling.
4. **Analytics safety completion** — additive sealed facts remain rollup-backed; non-composable identity unions remain exact raw with half-open 35-day/900-row fail-loud bounds. No additive distinct approximation.
5. **Ingestion tuning** — indexed agent resolution, platform-wide resumable provider-claim migration, and fail-closed legacy registry caps while preserving raw capture/replay.
6. **24-hour production comparison** — target ≤135 MB/day at comparable traffic, stretch ≤115 MB/day.
7. **PWA project** — installable app shell, new branded icons, safe update flow, static/offline fallback only; authenticated Convex data is never cached by the service worker.
8. **SaaS platform continuation** — B4 per-org timezone/cutoff, encrypted `tenantIntegrations`, onboarding/field mapper, connector presets, billing, Sentry/audit/export.

### SaaS readiness status

- ✅ Brand identity and favicon/app icons.
- ✅ Organization spine, required `orgId`, tenant-isolated indexes/readers, tenant provisioning core, JWT org validation.
- ✅ Universal capture-first ingestion and daily rollup foundation.
- 🟡 Convex I/O remediation — local implementation/release gates green; production migration, deploy, parity run, and 24-hour measurement remain.
- ⬜ PWA/mobile installability — next standalone project.
- ⬜ Per-org timezone and daily cutoff (B4).
- ⬜ Per-org encrypted integration credentials and reconciler/connectors.
- ⬜ Self-serve onboarding, field mapper, platform presets, org switcher/multi-org membership.
- ⬜ Billing/plan gating, production observability, audit log, backup/export controls.
- ⬜ External early access gate: three owner-controlled tenant integrations stable, onboarding documentation/video ready.

## Recently shipped (2026-06-24)
- ✅ **Order Reconciler (gap-heal)** — n8n workflow `fFXsXmtn94tnocJu`, every 30 min + on-demand webhook `reconcile-orders`. Detects gaps in Berdu's per-day order sequence, backfills via `/order/detail` + `set_order` with the real `created_at`. Self-heals silent drops.
- ✅ **Normalize node hardening** — order-sync now has `timeout: 10000` + 3 retries + visible `[order-sync] FAILED` logging (was a 300s hang that silently lost orders).
- ✅ **Panel Team Auth** — per-user email+password login, admin/cs roles, JWT cookie, admin user-management in Settings → Tim. Replaced shared `PANEL_PASSWORD`. (spec/plan: `2026-06-24-panel-team-auth*`)
- ✅ **Response time per CS** (#1 below), CS Management (photos/filters), SaaS redesign + gamification.

## Hold — parked by owner (2026-06-24)
- ⏸️ **Dashboard timezone filter (daily boundary)** — Dashboard "today" uses browser-local day; can mis-bucket orders at the midnight/4pm boundary. Laporan is immune (absolute UTC math). Owner chose to defer.
- ⏸️ **Proactive alerts → Telegram/WA push** — see "Live alerts → Telegram" (#2). Parked for now.

## Hardening (optional, do when needed)

### HMAC verify on the KirimDev message webhook
- **What:** verify `x-kirim-signature: t=<unix>,v1=<hex>` (HMAC-SHA256 over `"{t}.{rawbody}"`, 5-min tolerance) on the n8n receiver (`WaFaChat - KirimDev Message Receiver v2`, id `STIyKl6dDgdZgKeh`) before forwarding to Convex `append_message`.
- **Why deferred:** not strictly needed — internal CS tool, unguessable-ish URL, forward already uses the Convex adapter-secret, idempotency via `externalMessageId`. Risk if skipped: someone who knows the URL + payload format could inject fake inbound/outbound messages → junk chat history, or (outbound matching the closing phrase) a false auto-close. Likelihood low.
- **Why fiddly here:** (1) n8n parses JSON → raw bytes lost; HMAC needs exact bytes. Either `JSON.stringify(body)` (works only if KirimDev sends compact JSON in the same key order — testable) or force n8n raw-body capture. (2) n8n write/activate API is broken on this instance (`update_partial`/`updateNode`/`activateWorkflow` → "request/body must NOT have additional properties") → must edit by delete+create (MCP) + manual UI activate.
- **Options when revisited:**
  - **(a) Cheap, ~90%:** recreate the receiver with a **random/unguessable webhook path** (e.g. `kirim-message-<random>`) + update the URL in the KirimDev webhook. No credential, no raw-body. Security-by-obscurity but sufficient for this threat model.
  - **(b) Textbook:** add a **Crypto node (HMAC-SHA256)** using a **Crypto credential** holding the signing secret → compare to `v1` + check `t` freshness. Build NON-blocking first (annotate `_sigOk`, still forward), test that re-stringify matches the real signature, then flip to blocking. If re-stringify doesn't match → switch to raw-body capture.

### Re-enable AI Dashboard + attribution AI vs CS (saat AI di-setup lagi)
- **Konteks:** Per 2026-06-21 semua closing = CS manusia (AI Chat Handler n8n OFF sejak 06-03). Dimensi AI di panel di-disable (lihat spec `2026-06-21-panel-disable-ai-closing-cleanup-design.md`).
- **Restore UI:** implementasi CS-AI dashboard dipreservasi di `wafachat/components/panel/cs-ai-dashboard.tsx`. Re-enable = balikin entri NAV `/panel/cs-ai` di `app/panel/layout.tsx` + render `<CsAiDashboard/>` dari `app/panel/cs-ai/page.tsx` (ganti redirect), balikin breakdown AI/Manual di kartu Total Closing (`app/panel/page.tsx`).
- **Attribution akurat:** fix receiver n8n `WaFaChat - KirimDev Message Receiver v2` node "Map to append_message" `source`→`role`: `data.message.source === 'api'` → `ai` (AI/automation), `app`/`dashboard`/lainnya → `cs` (manusia). Lalu simpan `closedBy` (`ai`/`cs`) di recap (`upsertRecapFromMessage`) + metric `getDashboardSummary` hitung AI vs CS dari `closedBy` (bukan dari ada/enggaknya `sourceMessageId`). Backfill HANYA recap KirimDev-era (closedAt ≥ 2026-06-21); recap pra-06-04 sudah benar "AI" (era Chat Handler). ⚠️ edit receiver = delete+create (n8n write API rusak) + activate manual.

### Gap empty-body closing (source:"app" / WA Coexistence)
- **Gejala:** sebagian outbound CS dari WA HP (`message.sent` `data.message.source:"app"`) datang dengan `body` KOSONG → Map noop → closing kelewat (intermiten; mayoritas body ada).
- **Opsi:** (a) kalau closing dikirim sebagai WhatsApp template, pakai `data.message.template_name` buat deteksi closing walau body kosong; (b) subscribe event `conversation.closed` sebagai sinyal closing; (c) import Berdu verified rows (`importBerduVerifiedRows`) sebagai source-of-truth closing.

## Feature ideas — CS performance monitoring (proposed 2026-06-22)

Pure monitoring, no AI, built on data/infra that already exists. Goal stays "monitoring first." Recommended order: #1 first (highest impact, data ready).

### 1. ⚡ Response time per CS (speed-to-first-reply) — ✅ SHIPPED 2026-06-23
- **Why:** in WA sales, speed-to-reply is the #1 *leading* indicator of closing (reply <5 min vs >1 hr can swing close rate 2-5×). Predicts closing, unlike the lagging closing-count.
- **Data already there:** `messages` table has inbound (role `customer`) + outbound (role `cs`/`ai`) with `createdAt`. Per conversation: gap from a customer message → the next CS outbound = first-response time.
- **Approach:** Convex query — per conversation, pair each inbound with the next outbound, take the gap; aggregate **median + p90 per CS** per range. Surface as a Dashboard KPI ("Avg respon: 4m") + a column in Performance per-CS table.
- **Watch:** first response per conversation (not every message); restrict to business hours if noisy; exclude internal/CS phones (reuse `isInternalTestPhone`).

### 2. 🔔 Live alerts → Telegram — ⏸️ HOLD (parked by owner 2026-06-24)
- **Why:** make the dashboard *proactive* — push when something's wrong instead of needing someone to watch it.
- **Infra exists:** Telegram already wired (`WaFaChat · Telegram Setup` `Pu5qEcSpu7e7NV09`, `Telegram Callback` `PvMTP5Ex3kzvjNgG`).
- **Alerts:** (a) **SLA breach** — an inbound lead with no CS reply in >X min during active hours; (b) a CS's CR drops sharply vs baseline; (c) leads spike with no closings (overload).
- **Approach:** n8n scheduled workflow (every 5-15 min) → query Convex (response-time / unanswered leads / CR) → if threshold breached, send Telegram. Thresholds configurable.

### 3. 🏆 Live leaderboard + pace-to-target
- **Why:** gamify → motivate CS (visible ranking drives performance).
- **Approach:** Performance page — real-time per-CS ranking (closing / CR / omzet / response-time today) + **pace vs daily target** (projected end-of-day from current rate). Targets configurable per CS. Reuses `getPerformance` (already per-CS).

## Feature ideas — Laporan & SLA (proposed 2026-06-24)

### 4. 🗓️ Period clarity in Laporan (Live vs Selesai at a glance)
- **Why:** today the Live/Selesai status only shows per-CS card. Hard to tell at a glance whether the whole selected period is still accumulating or already sealed.
- **What:** a single status indicator next to the date/calendar toggle: **🔴 LIVE — masih berjalan, tutup 16:00 WIB (sisa Xh)** for the current open-date window, or **✅ SELESAI — final** for a past sealed date. Complements (not replaces) the per-CS badges.
- **Data:** reuses the existing 4pm-WIB open-date window logic; status is derived from the selected date vs the 16:00 seal. Low effort, high clarity.

### 5. ⏱️ SLA-breach metric (chats that waited too long)
- **Why:** median response-time shows the center; the actionable failure signal is *how many customers waited past SLA* (those are the lost-sale risks). The flip-side of #1.
- **What:** count + % of first-responses exceeding an SLA threshold (default e.g. 15 min, configurable), shown (a) as an overall matrix tile in Laporan and (b) as a per-CS card line ("3 chat lewat SLA >15m", red if any).
- **Data:** extends the existing response-time computation (`responseTimeMath` / `getResponseTimes`) — add a count-over-threshold; no new pipeline.

## Growth / revenue ideas (proposed 2026-06-24)

### 6. 💰 Follow-up otomatis order belum bayar (not_paid) — HIGH ROI
- **Why:** many Berdu orders are `payment_status: not_paid` with no automated nudge → recoverable revenue leaking.
- **What:** n8n scheduled workflow — find orders still `not_paid` at +1h / +1day → send a gentle WhatsApp reminder (approved template). Stop on payment. Reuses Berdu detail + KirimDev send.

### 7. 🤖 AI draft reply (human-approved, ban-safe)
- **Why:** revive the "AI" value without auto-reply ban risk (official API quality/tier).
- **What:** AI drafts a reply from the knowledge-base + product docs; CS approves with one tap (Telegram inline / panel) before sending. Human-in-the-loop. (Related: re-enable AI Dashboard above.)

### 8. 🔁 Repeat-buyer & upsell lens
- **Why:** double-orders = loyal customers; books sell in series/bundles.
- **What:** a "pembeli ulang" view + upsell candidate list (e.g. Quran Mapping → Buku Doa). Grow omzet from existing trust.

### 9. 📈 Closing coaching insights
- **Why:** turn analytics into action.
- **What:** surface what drives higher closing (response speed, time-of-day, product) as concrete tips ("balas <5 min → closing 2× lebih tinggi").

## Notes / gotchas
- **n8n write API on `n8n.miqra.dev`:** `n8n_update_partial_workflow` **`updateNode` WORKS** (confirmed 2026-06-22 — used for receiver `csName` map + order-pipeline `set_order`-before-gate fixes; saved, stayed active, zero downtime, no manual re-activate). The earlier "write API broken" note was wrong/transient. `create`/`delete`/`get`/`list`/`executions` also work. For `updateNode` jsCode, write regex escaping as `\\s+`/`\\+` (match the get-output JSON) so it round-trips. Read real webhook payloads via `n8n_executions get mode:full`.
- **KirimDev message webhook** is **org-wide** (all CS phone lines), not per-CS. Payload shapes differ: inbound (`message.received`) = Meta WA Cloud envelope; outbound (`message.sent`) = KirimDev's own `body.data.message` shape. Receiver v2's Map handles both.
