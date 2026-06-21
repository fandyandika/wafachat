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

## Notes / gotchas
- **n8n write API broken** on `n8n.miqra.dev`: only `create`/`delete`/`get`/`list`/`executions` work via MCP. To change a workflow: delete + create (MCP), then toggle Active once in the UI. Read real webhook payloads via `n8n_executions get mode:full`.
- **KirimDev message webhook** is **org-wide** (all CS phone lines), not per-CS. Payload shapes differ: inbound (`message.received`) = Meta WA Cloud envelope; outbound (`message.sent`) = KirimDev's own `body.data.message` shape. Receiver v2's Map handles both.
