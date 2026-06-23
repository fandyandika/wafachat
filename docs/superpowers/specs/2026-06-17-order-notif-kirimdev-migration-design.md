# Order Notification Migration to KirimDev — Design Spec

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 1 — migrate the automatic *new-order* WhatsApp notification from kirim.chat to KirimDev, piloting with **CS Aisyah** only. Risma and all other CS stay on the existing kirim.chat workflow untouched.

---

## 1. Goal

Replace the kirim.chat transport with **KirimDev** (`kirim.dev`, same developer, supports many WhatsApp numbers under one organization account) for the automatic "order baru" WhatsApp notification, **for CS Aisyah only**, as a low-risk pilot. Once proven, the same pattern migrates the remaining CS.

**Explicitly out of scope for this phase** (each gets its own spec later):
- Convex `state-tracking` (`set_order`) for Aisyah — added back after the bare notification is proven.
- Migrating Risma and other CS to KirimDev.
- AI CS automation (Hermes Agent / AI sales agent).
- Payment-paid and shipping-status notifications (current workflow only fires on `order.new` anyway).

## 2. Key facts established during research

### KirimDev (docs.kirimdev.com)
- **Base URL:** `https://api.kirimdev.com/v1/`
- **Auth:** single org-wide bearer token, `Authorization: Bearer kdv_live_<…>`. One token covers all WhatsApp numbers in the org.
- **Send template endpoint:** `POST https://api.kirimdev.com/v1/{PHONE_ID}/messages` — the `{PHONE_ID}` **in the URL path selects which WhatsApp number sends**. This is the multi-number capability the migration is for.
- **Body is Meta WhatsApp Cloud API-compatible:**
  ```json
  {
    "messaging_product": "whatsapp",
    "to": "<recipient>",
    "type": "template",
    "template": {
      "name": "whatsapp_notif_order_aisyah",
      "language": "id",
      "components": [
        { "type": "body", "parameters": [ { "type": "text", "text": "…" } ] }
      ]
    }
  }
  ```
- Positional params fill `{{1}}`, `{{2}}`, … in declaration order — same as the current kirim.chat template.
- **No dedicated n8n node** exists; use the HTTP Request node (same as today). The MCP server KirimDev offers is for AI assistants, not n8n.
- **Templates carry over:** because we connect the *existing WABA*, the already-approved Meta templates live at the WABA level and appear in KirimDev once the WABA is connected. No re-approval needed.

### Berdu (berdu.dev developer portal)
- Model is **one developer App = one App ID/Secret = one Webhook URL.**
- Existing App: `WhatsApp CS Automation`, App ID `Z1Ch4oa`, Redirect Domain `n8n.miqra.dev`, Webhook `https://n8n.miqra.dev/webhook/berdu-order-prod` → the current (v1) workflow.
- **Test User** = the Berdu store connected to the App: `PustakaIslam` / pustakaislam.net / user_id `brt9rr55bruefkmnl1_1`. This `user_id` is what arrives in webhook payloads and is used in `/order/detail?user_id=…`.
- Webhook History shows a stream of `order.new` events to that URL. (Observed: deliveries showing status **"Pending"** — to be verified as "Success" during testing; not a blocker for design.)
- **Fan-out mechanism:** a second App, with the same store added as a Test User, receives its own copy of `order.new` at its own Webhook URL. This is how we run two workflows in parallel without Berdu supporting multiple URLs per app.
- Order detail call (unchanged from v1): HMAC SHA256 over `app_id:ts:app_secret`, header `Authorization: app_id.ts.signature`, `GET https://api.berdu.id/v0.0/order/detail?user_id=…&order_id=…`.

## 3. Architecture

Two Berdu Apps fan `order.new` out to two parallel n8n workflows:

```
                      ┌─→ App "WhatsApp CS Automation" (Z1Ch4oa)
                      │     webhook /berdu-order-prod → Workflow v1 (LAMA) → Risma (kirim.chat)
Berdu order.new ──────┤
   (pustakaislam.net) │
                      └─→ App "WhatsApp CS Automation v2" (new id)
                            webhook /berdu-order-v2  → Workflow v2 (BARU) → Aisyah (KirimDev)
```

- Each workflow filters by assigned CS, so an order is acted on by exactly one workflow.
- To prevent Aisyah getting **double notifications**, Aisyah is removed from the v1 workflow's `staffMap` at cutover (one-line edit; Risma's logic untouched).

## 4. Components

### 4.1 New Berdu App (manual setup in berdu.dev)
- **+ App Baru:** Name `WhatsApp CS Automation v2 (KirimDev)`, Redirect Domain `n8n.miqra.dev`, Webhook `https://n8n.miqra.dev/webhook/berdu-order-v2`.
- **Add Test User:** pustakaislam.net (same store) so the new app receives its `order.new` events.
- Yields a **new APP_ID + APP_SECRET** used for HMAC in the v2 workflow.
- If the new app does not receive events (because permissions/authorization differ from the existing app), Request Permission / re-connect the store. Verify during setup.

### 4.2 New n8n workflow: `WaFaChat - Order Trigger v2 (KirimDev)`
Export to `wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json`.

Node flow:
```
Berdu Order Webhook (POST /berdu-order-v2)
 → Extract Webhook Data (Code)   // accept only order.new; build HMAC inputs with NEW app_id/secret; mark _skip for other events
 → Skip? (IF _skip)              // true → Log; false → continue
 → HMAC SHA256 (crypto)          // new credential "Berdu HMAC Secret v2" (new app secret)
 → Build Auth Header (Code)      // app_id.ts.signature
 → GET /order/detail (HTTP, Berdu)
 → Normalize Order Data (Code)   // parse order; staffMap = ONLY Aisyah; skip if staff != Aisyah or no phone; build 10 params + KirimDev body
 → Skip? (IF _skip)              // true → Log; false → continue
 → Send Template KirimDev (HTTP) // POST /v1/{PHONE_ID}/messages, Bearer credential
 → Log Result (Code)
```
No Convex call, no Risma branch, no Switch in v1 — single CS, single platform.

### 4.3 KirimDev send node
- `POST https://api.kirimdev.com/v1/{{ $json.csConfig.phoneId }}/messages`
- Auth via n8n credential **"KirimDev API"** (HTTP Header Auth: header `Authorization`, value `Bearer kdv_live_…`). Single org token reused by all CS later.
- Body as in §2, 10 body parameters in the **same order** as the current kirim.chat template:
  1. Total, 2. Nama penerima, 3. Nama CS, 4. Produk, 5. Subtotal, 6. Ongkir, 7. No HP, 8. Alamat, 9. Kecamatan, 10. Kota.
- `neverError: true` on the response so logging always runs.

**To verify against the KirimDev OpenAPI spec (`https://api.kirimdev.com/v1/openapi.json`) before building:**
- `language`: bare string `"id"` vs object `{ "code": "id" }`.
- `to` format: with/without leading `+`; whether the existing `62…` normalization is accepted.
- Success response shape (for Log Result / verification).

### 4.4 staffMap (v2 workflow)
```js
const staffMap = {
  'B-1apQSy': { platform: 'kirimdev', phoneId: '<AISYAH_PHONE_ID>', senderName: 'CS Aisyah', templateName: 'whatsapp_notif_order_aisyah' }
};
```
Any other `assigned_to_staff` → `_skip` (handled by the v1 workflow).

### 4.5 v1 workflow edit (at cutover only)
- Remove the `'B-1apQSy'` (Aisyah) entry from the v1 `staffMap`. v1 then serves Risma (`B-1CxSmL`) only. No other change to v1.

## 5. Prerequisites the user provides
1. **KirimDev:** connect the existing WABA → obtain Aisyah's `PHONE_ID`; generate an API key `kdv_live_…`.
2. **Berdu:** create the new App + add pustakaislam.net as Test User → obtain the new `APP_ID` + `APP_SECRET`; set its Webhook to `/berdu-order-v2`.

## 6. Testing (pinned, no customer impact)
1. Grab a real `order.new` payload for an Aisyah-assigned order from Berdu's **Webhook History** (or create a test order on pustakaislam.net).
2. Pin that payload on the v2 webhook node in n8n.
3. Execute the v2 workflow manually.
4. **Pass criteria:** KirimDev API returns success; the WhatsApp template arrives on the recipient; all 10 body parameters render correctly and in the right order.

## 7. Cutover
1. Confirm the pinned test passes.
2. Activate the v2 workflow (gives it a production webhook URL; ensure it matches the URL set in the new Berdu App).
3. The new Berdu App webhook is live → v2 receives Aisyah's orders.
4. Remove Aisyah from the v1 `staffMap` (v1 now Risma-only).
5. Live-verify: a real Aisyah order produces exactly **one** notification (KirimDev), no double-send; Risma unaffected.

## 8. Rollback
- Re-add Aisyah to the v1 `staffMap` (back to kirim.chat) and deactivate the v2 workflow (or remove/disable the new Berdu App webhook). Aisyah returns to the old path. Risma is never touched in either direction.

## 9. Error handling
- Event filter: non-`order.new` events short-circuit to Log (no send).
- Unmapped staff / missing phone: `_skip` to Log (no send).
- KirimDev HTTP node uses `neverError` so a failed send is logged rather than throwing; Log Result records status for inspection.
- Berdu `/order/detail` uses `neverError` (as in v1).

## 10. Files
- New: `wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json` (exported canonical JSON).
- Update: `wafachat/automations/n8n/README.md` — add the v2 workflow (id, name, webhook path, purpose, that it pilots Aisyah on KirimDev).
- Edited at cutover: v1 workflow `wgOVQrzkYOijDta1` (remove Aisyah from staffMap).
