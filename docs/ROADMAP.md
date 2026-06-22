# WaFaChat — Roadmap / Backlog

Deferred items. Pull from here when needed.

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

### 1. ⚡ Response time per CS (speed-to-first-reply) — HIGHEST IMPACT
- **Why:** in WA sales, speed-to-reply is the #1 *leading* indicator of closing (reply <5 min vs >1 hr can swing close rate 2-5×). Predicts closing, unlike the lagging closing-count.
- **Data already there:** `messages` table has inbound (role `customer`) + outbound (role `cs`/`ai`) with `createdAt`. Per conversation: gap from a customer message → the next CS outbound = first-response time.
- **Approach:** Convex query — per conversation, pair each inbound with the next outbound, take the gap; aggregate **median + p90 per CS** per range. Surface as a Dashboard KPI ("Avg respon: 4m") + a column in Performance per-CS table.
- **Watch:** first response per conversation (not every message); restrict to business hours if noisy; exclude internal/CS phones (reuse `isInternalTestPhone`).

### 2. 🔔 Live alerts → Telegram
- **Why:** make the dashboard *proactive* — push when something's wrong instead of needing someone to watch it.
- **Infra exists:** Telegram already wired (`WaFaChat · Telegram Setup` `Pu5qEcSpu7e7NV09`, `Telegram Callback` `PvMTP5Ex3kzvjNgG`).
- **Alerts:** (a) **SLA breach** — an inbound lead with no CS reply in >X min during active hours; (b) a CS's CR drops sharply vs baseline; (c) leads spike with no closings (overload).
- **Approach:** n8n scheduled workflow (every 5-15 min) → query Convex (response-time / unanswered leads / CR) → if threshold breached, send Telegram. Thresholds configurable.

### 3. 🏆 Live leaderboard + pace-to-target
- **Why:** gamify → motivate CS (visible ranking drives performance).
- **Approach:** Performance page — real-time per-CS ranking (closing / CR / omzet / response-time today) + **pace vs daily target** (projected end-of-day from current rate). Targets configurable per CS. Reuses `getPerformance` (already per-CS).

## Notes / gotchas
- **n8n write API on `n8n.miqra.dev`:** `n8n_update_partial_workflow` **`updateNode` WORKS** (confirmed 2026-06-22 — used for receiver `csName` map + order-pipeline `set_order`-before-gate fixes; saved, stayed active, zero downtime, no manual re-activate). The earlier "write API broken" note was wrong/transient. `create`/`delete`/`get`/`list`/`executions` also work. For `updateNode` jsCode, write regex escaping as `\\s+`/`\\+` (match the get-output JSON) so it round-trips. Read real webhook payloads via `n8n_executions get mode:full`.
- **KirimDev message webhook** is **org-wide** (all CS phone lines), not per-CS. Payload shapes differ: inbound (`message.received`) = Meta WA Cloud envelope; outbound (`message.sent`) = KirimDev's own `body.data.message` shape. Receiver v2's Map handles both.
