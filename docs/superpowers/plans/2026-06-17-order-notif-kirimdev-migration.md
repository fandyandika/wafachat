# Order Notification Migration to KirimDev — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate CS Aisyah's automatic new-order WhatsApp notification from kirim.chat to KirimDev via a new, parallel n8n workflow fed by a second Berdu App — with Risma and all other CS left on the existing kirim.chat workflow.

**Architecture:** A second Berdu developer App (same store as Test User) fans `order.new` out to a new n8n webhook (`/berdu-order-v2`). The new workflow filters to Aisyah only, fetches order detail from Berdu (HMAC with the new app's secret), builds a Meta-compatible template body, and sends via KirimDev (`POST /v1/{PHONE_ID}/messages`). At cutover, Aisyah is removed from the v1 workflow's `staffMap` so she is not double-notified.

**Tech Stack:** n8n (Code, Crypto, IF, HTTP Request, Webhook nodes) via n8n-mcp; KirimDev REST API; Berdu order API.

## Global Constraints

- v1 workflow `wgOVQrzkYOijDta1` (`WaFaChat - Order Trigger`) is NOT modified except a single `staffMap` deletion, and only at cutover (Task 6). Risma logic is never touched.
- KirimDev send: body MUST include `messaging_product:"whatsapp"`, `to`, `type:"template"`, `template`. `to` MUST be E.164 with a leading `+`. `language` is `{"code":"id"}`.
- Template `whatsapp_notif_order_aisyah`, 10 body params in this order: Total, Nama penerima, Nama CS, Produk, Subtotal, Ongkir, No HP, Alamat, Kecamatan, Kota.
- Aisyah staff id: `B-1apQSy`. Only `order.new` triggers a send.
- New webhook path: `/berdu-order-v2`. New workflow name: `WaFaChat - Order Trigger v2 (KirimDev)`.
- No Convex `set_order` call in this phase.
- Secrets are never hardcoded in the exported repo JSON beyond what v1 already does; real values are wired in Task 4 after the user supplies them. Placeholders used until then: `NEW_APP_ID`, `NEW_APP_SECRET`, `AISYAH_PHONE_ID`.

---

### Task 1: Build the v2 workflow in n8n (structure + logic, placeholder secrets)

**Files:**
- n8n instance (via n8n-mcp `n8n_create_workflow`) — no repo file yet.

**Interfaces:**
- Produces: a workflow wired Webhook → Extract → Skip? → HMAC → Build Auth Header → GET /order/detail → Normalize → Skip?2 → Send KirimDev → Log. Node names are referenced verbatim by later tasks (esp. `Extract Webhook Data`, `Normalize Order Data`).

- [ ] **Step 1: Create the workflow with all nodes via `n8n_create_workflow`.**

Node configs (typeVersions mirror the working v1 workflow):

`Berdu Order Webhook` — `n8n-nodes-base.webhook` v2, params `{ httpMethod:"POST", path:"berdu-order-v2", options:{} }`.

`Extract Webhook Data` — `n8n-nodes-base.code` v2:
```js
const body = $input.first().json.body || $input.first().json;
const userId = body.user_id;
const orderId = body.order_id;
const eventType = body.event_type;
if (eventType !== 'order.new') return [{ json: { _skip: true, reason: `event ${eventType} diabaikan (hanya order.new)` } }];
if (!userId || !orderId) throw new Error('Webhook payload missing user_id or order_id');
const APP_ID = 'NEW_APP_ID';
const APP_SECRET = 'NEW_APP_SECRET';
const ts = Math.floor(Date.now() / 1000);
const hmacMessage = `${APP_ID}:${ts}:${APP_SECRET}`;
return [{ json: { app_id: APP_ID, api_secret: APP_SECRET, user_id: userId, order_id: orderId, event_type: eventType, ts, hmacMessage, target_url: `https://api.berdu.id/v0.0/order/detail?user_id=${userId}&order_id=${orderId}` } }];
```

`Skip?` — `n8n-nodes-base.if` v2.2, condition boolean `={{ $json._skip }}` equals `true`. TRUE → `Log Result`; FALSE → `HMAC SHA256`.

`HMAC SHA256` — `n8n-nodes-base.crypto` v2, params `{ action:"hmac", value:"={{ $json.hmacMessage }}", dataPropertyName:"signature", encoding:"base64" }`, credential `crypto` → "Berdu HMAC Secret v2" (created in Task 4; leave credential unset for now).

`Build Auth Header` — `n8n-nodes-base.code` v2:
```js
const d = $input.first().json;
const authHeader = `${d.app_id}.${d.ts}.${d.signature}`;
return [{ json: { ...d, authHeader } }];
```

`GET /order/detail` — `n8n-nodes-base.httpRequest` v4.2, params `{ url:"={{ $json.target_url }}", sendHeaders:true, headerParameters:{ parameters:[{ name:"Authorization", value:"={{ $json.authHeader }}" }] }, options:{ response:{ response:{ neverError:true } } } }`.

`Normalize Order Data` — `n8n-nodes-base.code` v2:
```js
const d = $input.first().json;
const order = d.body || d;
function normalizePhone(raw) { if (!raw) return null; return raw.toString().replace(/\s+/g,'').replace(/^\+/,'').replace(/^0/,'62'); }
function formatRupiah(num) { return 'Rp' + Number(num).toLocaleString('id-ID'); }
const addr = order.shipping_address || {};
const phone = normalizePhone(addr.phone);
const customerName = addr.firstName || 'Pelanggan';
const assignedStaff = order.assigned_to_staff;
const shippingCost = order.shipping_cost || 0;
const total = order.total || 0;
const productsSubtotal = (order.products || []).reduce((sum, p) => sum + (p.price * p.count), 0);
const productsList = (order.products || []).map(p => `${p.name} (${p.count}x)`).join(', ');
const shippingAddress = addr.address || '';
const shippingDistrict = addr.district || '';
const shippingCity = addr.city || '';
const staffMap = { 'B-1apQSy': { platform: 'kirimdev', phoneId: 'AISYAH_PHONE_ID', senderName: 'CS Aisyah', templateName: 'whatsapp_notif_order_aisyah' } };
const csConfig = staffMap[assignedStaff];
if (!csConfig) return [{ json: { _skip: true, reason: `staff ${assignedStaff} bukan Aisyah (ditangani workflow lama)` } }];
if (!phone) return [{ json: { _skip: true, reason: 'phone tidak ditemukan di order' } }];
const webhookData = $('Extract Webhook Data').first().json;
const templateParams = [ formatRupiah(total), customerName, csConfig.senderName, productsList, formatRupiah(productsSubtotal), formatRupiah(shippingCost), phone, shippingAddress, shippingDistrict, shippingCity ];
const kirimDevBody = { messaging_product: 'whatsapp', to: '+' + phone, type: 'template', template: { name: csConfig.templateName, language: { code: 'id' }, components: [{ type: 'body', parameters: templateParams.map(text => ({ type: 'text', text: String(text) })) }] } };
return [{ json: { phone, customerName, assignedStaff, csConfig, total: formatRupiah(total), productsSubtotal: formatRupiah(productsSubtotal), shippingCost: formatRupiah(shippingCost), products: productsList, shippingAddress, shippingDistrict, shippingCity, templateParams, event_type: webhookData.event_type, order_id: webhookData.order_id, kirimDevBody } }];
```

`Skip?2` — `n8n-nodes-base.if` v2.2, condition boolean `={{ $json._skip }}` equals `true`. TRUE → `Log Result`; FALSE → `Send Template KirimDev`.

`Send Template KirimDev` — `n8n-nodes-base.httpRequest` v4.2, params `{ method:"POST", url:"=https://api.kirimdev.com/v1/{{ $json.csConfig.phoneId }}/messages", sendBody:true, specifyBody:"json", jsonBody:"={{ JSON.stringify($json.kirimDevBody) }}", options:{ response:{ response:{ neverError:true } } } }`, with `genericAuthType:"httpHeaderAuth"` + credential `httpHeaderAuth` → "KirimDev API" (created in Task 4; leave unset for now).

`Log Result` — `n8n-nodes-base.code` v2:
```js
const r = $input.first().json;
const status = (r.data && r.data.status) || r.statusCode || (r._skip ? 'skipped' : 'unknown');
console.log('KirimDev v2 done:', JSON.stringify({ status, request_id: r.request_id || null, reason: r.reason || null }));
return [{ json: { logged: true, status, ts: new Date().toISOString() } }];
```

Workflow `settings`: `{ executionOrder:"v1", saveDataErrorExecution:"all", saveDataSuccessExecution:"all", saveManualExecutions:true }`.

- [ ] **Step 2: Validate the workflow.**

Run: `n8n_validate_workflow({ id: <new id> })`
Expected: no structural errors. Auto-sanitized operator/connection warnings are acceptable; unresolved credential warnings for "Berdu HMAC Secret v2" and "KirimDev API" are EXPECTED here (wired in Task 4).

- [ ] **Step 3: Record the new workflow id** in this plan and the README task. Do NOT activate yet.

---

### Task 2: Export canonical JSON to repo + update README

**Files:**
- Create: `wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json`
- Modify: `wafachat/automations/n8n/README.md`

- [ ] **Step 1: Export** via `n8n_get_workflow({ id })` and write the JSON to `order-trigger-v2-kirimdev.json` (placeholders remain in the repo copy — never commit real secrets).

- [ ] **Step 2: Add a README row** documenting: name `WaFaChat - Order Trigger v2 (KirimDev)`, the new id, webhook path `/berdu-order-v2`, purpose ("Aisyah-only pilot: Berdu order.new → KirimDev template send"), and that it runs in parallel with v1 (Risma stays on v1).

- [ ] **Step 3: Verify** the file exists and the README renders the new row. Docs deliverable — no code test.

---

### Task 3: Prerequisite checklist for the user (gates Tasks 4–6)

**Files:** none (coordination task).

- [ ] **Step 1:** Confirm the user has handed over these 4 values:
  1. KirimDev WABA connected → **`AISYAH_PHONE_ID`** for Aisyah's number.
  2. KirimDev API key **`kdv_live_…`**.
  3. Berdu new App `WhatsApp CS Automation v2 (KirimDev)`, Redirect Domain `n8n.miqra.dev`, Webhook `https://n8n.miqra.dev/webhook/berdu-order-v2`, with pustakaislam.net as Test User → **`NEW_APP_ID`** + **`NEW_APP_SECRET`**.

- [ ] **Step 2:** If the new Berdu App's Webhook History shows no `order.new` deliveries after a test order, Request Permission / re-connect the store, then re-check.

---

### Task 4: Wire real credentials and values

**Files:** n8n credentials (`n8n_manage_credentials`) + workflow update (`n8n_update_partial_workflow`).

- [ ] **Step 1: Create credential "KirimDev API"** — `n8n_manage_credentials({ action:"create", name:"KirimDev API", type:"httpHeaderAuth", data:{ name:"Authorization", value:"Bearer <kdv_live_…>" } })`.

- [ ] **Step 2: Create credential "Berdu HMAC Secret v2"** — crypto credential holding `NEW_APP_SECRET` as the HMAC key. Use `getSchema` for the `crypto` credential type first to confirm field names, then `create`.

- [ ] **Step 3: Patch the workflow** via `n8n_update_partial_workflow`:
  - In `Extract Webhook Data`, replace `'NEW_APP_ID'` and `'NEW_APP_SECRET'` with the real values.
  - In `Normalize Order Data`, replace `'AISYAH_PHONE_ID'` with the real PHONE_ID.
  - Attach credential `crypto` → "Berdu HMAC Secret v2" on `HMAC SHA256`.
  - Attach credential `httpHeaderAuth` → "KirimDev API" on `Send Template KirimDev`.

- [ ] **Step 4: Re-validate** with `n8n_validate_workflow({ id })`. Expected: no credential warnings remaining.

---

### Task 5: Pinned test (no customer impact)

**Files:** none (live test in n8n).

- [ ] **Step 1:** From the new Berdu App's **Webhook History**, copy a real `order.new` payload for an Aisyah-assigned order (or create one test order on pustakaislam.net assigned to Aisyah).

- [ ] **Step 2:** Pin that payload on `Berdu Order Webhook` and run the workflow manually (`n8n_test_workflow` or Execute in UI).

- [ ] **Step 3: Pass criteria** — `Send Template KirimDev` returns `data.status` ∈ {queued, pending, sent} and a `request_id`; the WhatsApp template arrives on the recipient; all 10 body params render in order (Total → Kota). If `data.error` is present, read `data.error.message`/`provider_code` and fix (most likely `to` format or template name/locale), then re-run.

---

### Task 6: Cutover + rollback note

**Files:** Modify at cutover — v1 workflow `wgOVQrzkYOijDta1`, `Normalize Order Data` `staffMap`.

- [ ] **Step 1:** Activate the v2 workflow (`activateWorkflow`). Confirm its production webhook URL equals `https://n8n.miqra.dev/webhook/berdu-order-v2`.

- [ ] **Step 2:** Remove the `'B-1apQSy'` (Aisyah) entry from the v1 `staffMap` so v1 serves only Risma (`B-1CxSmL`). Re-validate v1.

- [ ] **Step 3: Live verify** — a real Aisyah order produces exactly ONE WhatsApp notification (via KirimDev); Risma unaffected; the new Berdu App's Webhook History flips from Pending to success.

- [ ] **Step 4: Rollback (if needed)** — re-add the Aisyah entry to the v1 `staffMap` and deactivate the v2 workflow (or disable the new Berdu App webhook). Aisyah returns to kirim.chat; Risma never touched.
