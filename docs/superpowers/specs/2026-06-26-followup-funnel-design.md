# Follow-up Funnel (manual template via KirimDev) — Design Spec

**Date:** 2026-06-26
**Status:** Approved (brainstorm) — pending spec review

## 1. Problem & Context

CS follow up leads at **H+1 and H+2** (1–2 days after the customer's last message). Those moments are **outside WhatsApp's 24-hour customer-service window**, so the WABA number (via KirimDev) **rejects free-form messages** — CS get blocked ("pesan >24jam ditolak").

The only sanctioned way to message outside 24h is an **approved template** (verified in [KirimDev docs](https://docs.kirimdev.com/sending/send-templates/) — endpoint literally built to *"re-engage past customers outside the 24-hour window"*).

KirimDev's own broadcast/follow-up feature exists but is **separate, unlabelled, unfiltered** → CS don't know *who* to follow up. WaFaChat already holds the order/conversation data needed to target precisely.

## 2. Goal

A **dedicated, filtered, manual** follow-up tool inside WaFaChat that lets CS send approved follow-up templates (H+1, then H+2) — via the KirimDev API — only to **ghosted, not-yet-closed, still-fresh** leads whose 24h window has closed. A 2-stage **funnel**: H+2 ⊂ {got H+1 and still silent}.

### Non-goals (YAGNI)
- NOT a chat inbox / CRM in WaFaChat (CS keep chatting in WhatsApp).
- NOT automated/scheduled sends — **manual trigger only** for v1.
- NOT H+3+ or H+2A/H+2B template variants — config is extensible, but **v1 = 2 stages, 1 template each**.
- NOT touching the existing order-notif n8n flow.

## 3. Architecture

**Convex action calls the KirimDev REST API directly** (chosen over routing through n8n).

```
POST https://api.kirimdev.com/v1/{phone_number_id}/messages
Authorization: Bearer {KIRIMDEV_API_KEY}
Idempotency-Key: fu-{conversationId}-{stage}
Content-Type: application/json
{ "messaging_product":"whatsapp", "to":"+628...", "type":"template",
  "template": { "name":"<approved>", "language":"id",
    "components":[ { "type":"body", "parameters":[ {"type":"text","text":"<param>"}, ... ] } ] } }
```

**Why direct (not n8n):** the trigger (CS click) and the state (eligibility + idempotency) both live in Convex; the send is one HTTP call. KirimDev provides a native **`Idempotency-Key`** header and **stable error codes** (`template_paused`, `account_rate_limited`, `outside_24h_window`, …), so a single Convex action gives clean atomic idempotency + precise errors. n8n would only be a middleman doing the same `fetch`.

**Secrets/config (Convex env, set via dashboard like `PANEL_AUTH_SECRET`):**
- `KIRIMDEV_API_KEY`
- `KIRIMDEV_BASE_URL` (default `https://api.kirimdev.com/v1`)

## 4. Data Model

Add two optional fields to `conversations`:
- `followUpStage: v.optional(v.number())` — highest stage sent (1 = H+1 sent, 2 = H+2 sent; absent = none).
- `followUpStageAt: v.optional(v.number())` — timestamp the current stage was sent.

No new index strictly required (eligibility is derive-on-read over open conversations, following the existing query patterns). Re-evaluate if the open-conversation set grows large.

## 5. Funnel Stages (config-driven)

A code constant (extensible — add an entry to add a stage):

```ts
FOLLOWUP_STAGES = [
  { stage: 1, label: "H+1", templateName: "<approved_H1>", language: "id",
    minHoursSinceLastInbound: 24, maxHoursSinceLastInbound: 120 }, // 24h .. 5-day ceiling (first touch)
  { stage: 2, label: "H+2", templateName: "<approved_H2>", language: "id",
    requiresPrevStage: 1, minHoursSincePrevStage: 20 },
]
```

- **Add H+3** → append one entry + one approved template.
- **H+2A/H+2B variants** → future (a stage carrying multiple templates, chosen by rule). Structure allows it; **not built in v1**.

Template **param mapping** (per stage, finalised at build once template names are known) pulls from the order/conversation: e.g. `{{1}}=customerName`, `{{2}}=productName`, `{{3}}=orderId`. Supports KirimDev positional or named params.

## 6. Eligibility Rules

For each open conversation, derive: `lastInboundAt` (customer's last message), latest-message direction, `followUpStage`, `followUpStageAt`, closed-state, shipping-recap existence.

**Base filters (all stages):**
- **Not closed** — `conversation.status != "closed"` AND no `shippingRecaps` row for the customer/order (req #4, #7).
- **Ghosted** — latest message in the conversation is **outbound** (we replied, customer silent); `lastInboundAt` exists (req #5).
- **Within ceiling** — `now - lastInboundAt ≤ 5 days` (safety backstop so we never touch stale DB; req #1).
- **CS scoping** — CS sees only conversations where `assignedCsName` = their CS; admin sees all (+ optional CS filter).

**Stage 1 — H+1 tab (first touch):**
- `followUpStage` is absent/0.
- `24h ≤ (now - lastInboundAt) ≤ 5 days` (window closed; not yet followed up). Widened from a 24–48h "day-1 only" window so leads aren't lost when CS is limited/busy for a day (req #1, #3, #7).

**Stage 2 — H+2 tab (subset of H+1 recipients):**
- `followUpStage == 1`.
- **Still silent since H+1** — `lastInboundAt < followUpStageAt` (customer didn't reply to the H+1 template).
- `(now - followUpStageAt) ≥ 20h` (≈ one day after H+1).
- Within the 5-day ceiling.

A customer who **replies** (new inbound) or **closes** (shipping recap / status closed) automatically drops out of the funnel — no further follow-up.

**Idempotency (req #2):** `followUpStage` gates re-sends per stage, and the KirimDev `Idempotency-Key` (`fu-{conversationId}-{stage}`) is a second guard against network-retry duplicates.

## 7. Send Action (Convex)

`sendFollowUp(conversationId, stage)` action:
1. Load conversation; **re-check eligibility** for `stage` (defends against stale UI). Not eligible → friendly error (`sudah closing` / `sudah dibalas` / `sudah di-follow-up` / `belum waktunya`).
2. Resolve the CS WABA `phone_number_id` (`csConfigs` by `assignedCsName` → `providerNumberId`). Missing → error.
3. Resolve stage template + build params from order data.
4. `POST` to KirimDev with `Authorization`, `Idempotency-Key`, template body.
5. **On 200** → mutation: set `followUpStage = stage`, `followUpStageAt = now`; insert an **outbound** `messages` row (`messageType: "template"`, `role: "cs"`, `source: "panel"`); optionally an `events` row.
6. **On error** → map KirimDev `error.code` to an Indonesian message; **do NOT stamp**.

Batch: the page calls the action per selected row (a thin wrapper may loop with a per-row result list + a cap); failures are reported per-row, successes stamped independently.

## 8. UI — `/panel/follow-up`

- New route + nav entry (auth-gated; CS + admin).
- **Two tabs: "H+1" and "H+2"**, each with a count badge and a table.
- Columns: customer name · product · order ID · "chat terakhir X jam/hari lalu" · CS (admin only).
- Row action **"Kirim"**; multi-select + **"Kirim terpilih (N)"** with a **confirm dialog when N > 20**.
- After a successful send: row shows **"✓ Terkirim"** and leaves the list (it advances to the next stage / drops out).
- States: loading skeleton, empty ("Tidak ada yang perlu di-follow-up 🎉"), per-row error toast.

## 9. Safety / "ga boros"

- 5-day ceiling on `lastInboundAt`.
- Stage timing windows (H+1: 24–48h; H+2: ≥20h after H+1).
- Per-stage idempotency + KirimDev `Idempotency-Key`.
- Batch confirmation above 20.
- Manual trigger only; intended for use when blocked by the 24h window.

## 10. Error Handling

Map KirimDev stable error codes → friendly Indonesian (e.g. `template_paused` → "Template lagi dijeda Meta, cek di KirimDev", `account_rate_limited` → "Nomor lagi dibatasi, coba lagi nanti", `template_not_found` → "Template belum approved"). Eligibility re-checked at send time. Partial batch failures surfaced per row.

## 11. Testing

- **Pure eligibility logic** (stage rules over derived facts) → unit tests, mirroring the existing pure-helper + vitest pattern.
- **Eligible-list query** → convex-test (seed conversations/messages/recaps; assert H+1 vs H+2 membership, ghosting, closed exclusion, idempotency).
- **Send action** → KirimDev `fetch` mocked; assert eligibility re-check, success stamping (`followUpStage`/`followUpStageAt` + message insert), and that errors do **not** stamp.
- Front-end: light (page renders the query; tabs filter).

## 12. Needed at build time (not now)
- Template **names + languages + param mapping** for H+1 and H+2 (approved templates).
- `KIRIMDEV_API_KEY` (Convex dashboard) + base URL.
- Confirm KirimDev send endpoint/auth against a live test number.
- (`phone_number_id` per CS already in `csConfigs.providerNumberId`.)

## 13. File Structure (anticipated)
- `convex/schema.ts` — add `followUpStage`, `followUpStageAt` to `conversations`.
- `convex/followUpMath.ts` (new) — pure eligibility helpers + `FOLLOWUP_STAGES` config (+ tests).
- `convex/followUp.ts` (new) — `getFollowUpCandidates` query + `sendFollowUp` action.
- `app/panel/follow-up/page.tsx` (new) + `components/panel/follow-up-*` — the UI.
- Panel nav — add "Follow-up" entry.
