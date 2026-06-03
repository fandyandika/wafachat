# WhatsApp CS Automation — Context & Technical Notes

**Project:** pustakaislam.net WA CS Automation  
**Last updated:** 2026-05-26  
**Tujuan file ini:** Capture semua temuan teknis, keputusan arsitektur, dan hal penting agar tidak hilang antar sesi.

---

## 1. Infrastruktur yang Sudah Live

| Asset | Detail |
|---|---|
| n8n instance | `https://n8n.miqra.dev` — v2.21.7, healthy |
| Berdu store | `pustakaislam.net` |
| n8n credential "Berdu HMAC Secret" | id: `cC2zMvNDWjYud4XA`, type: crypto |

---

## 2. Berdu API — Temuan Teknis

### Auth Header Format
```
Authorization: {app_id}.{timestamp}.{base64_hmac_sha256}

message untuk HMAC = "{app_id}:{timestamp}:{api_secret}"
key untuk HMAC    = api_secret
```

### PENTING: n8n Code Node Sandbox Restriction
- `require('crypto')` → **DIBLOKIR** di n8n task runner
- **Solusi:** Gunakan n8n Crypto node (action: hmac, type: SHA256, encoding: base64)

### Pattern 3-Node HMAC di n8n (wajib dipakai di semua workflow)
```
Code "Prepare HMAC Message"  →  output: { ..., ts, hmacMessage, target_url }
Crypto "HMAC SHA256"         →  credential: "Berdu HMAC Secret", output: + signature
Code "Build Auth Header"     →  output: { authHeader: "appId.ts.sig", url, ... }
```

### Webhook Payload dari Berdu (confirmed dari data real)
```json
{
  "user_id": "...",
  "order_id": "O-XXXXXXXXX",
  "event_type": "order.new",
  "trigger": "checkout"
}
```

### Field Mapping dari `/order/detail` (confirmed)
```
Phone customer   → body.shipping_address.phone
Nama customer    → body.shipping_address.firstName
Alamat jalan     → body.shipping_address.address
Kecamatan        → body.shipping_address.district
Kota             → body.shipping_address.city
Produk           → body.products[].name, .count, .price
Ongkir           → body.shipping_cost
Total            → body.total
CS assigned      → body.assigned_to_staff  (format: B-XXXXX)
```

### Normalisasi Phone
```javascript
phone.replace(/^0/, '62').replace(/\s+/g, '').replace(/^\+/, '')
```

### API Quirks
- `/order/list` tidak include `assigned_to_staff` → harus call `/order/detail`
- Berdu IP di webhook: `172.105.115.109` (untuk IP allowlist)

---

## 3. Staff ID Mapping

| Nama Staff | Berdu ID | KirimChat WA Number | KirimChat API Key |
|---|---|---|---|
| CS Aisyah | `B-1apQSy` ✅ | `6281385708799` | cred id: `v59HaGi4ygCRhANf` |
| CS Lila | `B-NCIXt` | TBD | TBD |
| CS Azelia | `B-Z28TdYc` | TBD | TBD |
| CS Risma | `B-1CxSmL` | TBD | TBD |

---

## 4. KirimChat — Keputusan Arsitektur

- **1 KirimChat account per CS** (1 account = 1 WA number)
- **Paket BASIC (Rp 25.000/bulan)** per CS
- KirimChat node resmi belum terinstall → pakai HTTP Request node
- **KirimChat API endpoint** semua tipe pesan: `POST https://api-prod.kirim.chat/api/v1/public/messages/send`
- **KirimChat template body**: field `language` harus object `{ code: "id" }`, bukan string

### Routing Logic — staffMap

**⚠️ ATURAN WAJIB — JANGAN DILANGGAR:**
> JANGAN pernah menambahkan CS ke `staffMap` kecuali CS tersebut sudah punya KirimChat account sendiri dengan nomor WA dan API key milik mereka sendiri.
>
> Incident 2026-05-25: Lila, Azelia, Risma sempat di-map ke nomor Aisyah → order mereka terkirim dari nomor Aisyah. Tidak bisa di-undo.

**4 syarat sebelum tambah CS ke staffMap:**
1. Berdu staff ID confirmed
2. Nomor WA KirimChat sendiri
3. API key KirimChat sendiri
4. Meta template approved (nama template berbeda per CS)

**Template naming convention:** `whatsapp_notif_order_{nama_cs}` — tiap CS nama template beda agar bisa audit dan pause per-CS independen.

---

## 5. Keputusan AI & Prompt

- **Model:** GPT-4o-mini, maxTokens 350 (**tanpa temperature** — OpenAI menolak parameter `temperature` di model terbaru, hapus dari node)
- **Prompt:** Mode A Post-Order Closing v4 — lihat [Prompt AI Agent.md](Prompt AI Agent.md)
- **Product knowledge:** Injeksi dinamis via Build Context node
  - Keyword match: `tazyin` / `medis` / `mapping` di productName
  - Files referensi: `products/*.md`
- **Order context:** csName, produk, harga, alamat — di-save saat order masuk via `set_order`
- **Conversation memory:** Window Buffer Memory, 10 pesan, session key = phone
- **Anti-hallucinate:** [HANDOVER] kalau tidak tahu, jangan tebak
- **Handover triggers:** refund, rusak, komplain, cancel, resi, stok, diskon, post-COD cancel, di luar FAQ
- **State:** `active` → AI handle | `handover` → AI diam
- **promptType:** Gunakan `"define"` + `text: "={{ $json.messageText }}"` di AI Agent node — `"auto"` hanya work dengan Chat Trigger, tidak dengan webhook
- **⚠️ AI Agent (langchain) DISABLED** — selalu return `output: ""` di n8n v2.21.7 (bug: agent type mismatch). Diganti dengan HTTP Request langsung ke `https://api.openai.com/v1/chat/completions`. Node baru: "Call OpenAI" + "Extract Output".

---

## 6. State Manager

**Workflow:** `oTNay1fDleMibZ3J` | `POST https://n8n.miqra.dev/webhook/conversation-state`

| Action | Fields | Fungsi |
|---|---|---|
| `get` | `{ action, phone }` | Ambil status conversation |
| `set` | `{ action, phone, status, note, customerName, csNumber }` | Set status (closed: remove dari phone_index + increment closed_today) |
| `get_with_global` | `{ action, phone }` | Ambil status + order details + globalEnabled boolean |
| `set_order` | `{ action, phone, csName, productName, products, productsSubtotal, shippingCost, total, customerName, shippingAddress, shippingDistrict, shippingCity, order_id }` | Simpan detail order + dedup via order_keys + add ke phone_index |
| `set_global` | `{ action, enabled }` | Set globalEnabled AI on/off |
| `get_global` | `{ action }` | Ambil globalEnabled status |
| `increment_stat` | `{ action, field, phone, order_id, productName }` | Increment `closings` dengan dedup per `order_id`; `handovers` tetap simple increment |
| `get_stats` | `{ action }` | Ambil stats hari ini (orders, closings, handovers, closed_today) |
| `list_all` | `{ action }` | List semua active+handover conversations (via phone_index) |

---

## 7. Hal Penting — Jangan Sampai Lupa

**⚠️ CRITICAL — n8n Code node: DILARANG pakai `fetch()` atau `require()`** — task runner tidak support. Selalu pakai `this.helpers.httpRequest({ method, url, headers, body })`

1. Webhook Berdu live di `https://n8n.miqra.dev/webhook/berdu-order-prod` — jangan nonaktifkan workflow `wgOVQrzkYOijDta1`
2. Berdu tidak ada webhook signature → IP allowlist `172.105.115.109`
3. KirimChat rate limit: **60 pesan/menit**
4. Berdu API quota: **1000 calls / 10 menit**
5. Meta Coexistence approval: **4-5 hari** setelah daftar KirimChat
6. **⚠️ JANGAN tambah CS ke staffMap tanpa KirimChat account sendiri** — lihat Section 4
7. KirimChat webhook secret belum divalidasi di workflow (TODO: HMAC verification di awal Workflow 2)

---

## 8. Workflow IDs (Production)

Naming convention: **WaFaChat · [Nama]** (updated 2026-05-26)

| Workflow | n8n ID | Status | URL |
|---|---|---|---|
| WaFaChat · Order Trigger | `wgOVQrzkYOijDta1` | **ACTIVE** | `/webhook/berdu-order-prod` |
| WaFaChat · Chat Handler | `4eBFqyabDlIRx3ZY` | **ACTIVE** | `/webhook/kirimchat-inbound` |
| WaFaChat · State Manager | `oTNay1fDleMibZ3J` | **ACTIVE** | `/webhook/conversation-state` |
| WaFaChat · Handover Notifier | `GUQJrCIn1xGKJjH0` | **ACTIVE** | `/webhook/cs-handover` |
| WaFaChat · Telegram Setup | `Pu5qEcSpu7e7NV09` | **ACTIVE** | (Telegram trigger) |
| WaFaChat · Telegram Callback | `PvMTP5Ex3kzvjNgG` | **ACTIVE** | (Telegram callback_query) |
| WA CS - CS Control Panel | `TfcHuN7GhygTrEKL` | **DELETED** | — |

### Telegram
- Bot: `@pustakaislam_cs_bot` | Credential: `BNv9Fk7CC6wpafvg`
- CS Aisyah chat ID: `8652698740`
- CS lain: minta chat @pustakaislam_cs_bot → bot auto-reply chat ID

---

## 9. Progress Log

| Tanggal | Yang Dikerjakan | Status |
|---|---|---|
| 2026-05-24 | PoC Berdu Auth, Webhook, Field mapping | ✅ |
| 2026-05-24 | Workflow 1: WA CS Outbound Trigger | ✅ |
| 2026-05-25 | Workflow 2: Inbound Handler + AI Agent | ✅ |
| 2026-05-25 | State Manager + Handover Notifier + CS Control Panel | ✅ |
| 2026-05-25 | Window Buffer Memory (10 msg, phone as key) | ✅ |
| 2026-05-25 | Image inbound support | ✅ |
| 2026-05-25 | State Manager: `set_order` + `get_with_global` | ✅ |
| 2026-05-25 | Telegram bot setup + Chat ID Helper workflow | ✅ |
| 2026-05-26 | Build Context node + dynamic prompt injection | ✅ |
| 2026-05-26 | Product knowledge 3 SKU embedded (Tazyin, Medis, Mapping) | ✅ |
| 2026-05-26 | GPT-4o-mini: maxTokens 350 (temperature dihapus — tidak supported) | ✅ |
| 2026-05-26 | Google Sheet recap: detect PEMESANAN BERHASIL → append row ke Sheet `1acve92eQneZCthTX879nxj40Ne4pJjFpPoTdlslZBnI` | ✅ |
| 2026-05-26 | Prompt v4: Bonus + Instruksi Pengiriman di template PEMESANAN BERHASIL | ✅ |
| 2026-05-26 | COD warm intro + disable node Bayar Sukses & Terkirim | ✅ |
| 2026-05-26 | Fix: `fetch` → `this.helpers.httpRequest()` di Normalize Order Data & Log Handover | ✅ |
| 2026-05-26 | Fix: backtick unescaped di Build Context node | ✅ |
| 2026-05-26 | Fix: AI Agent `promptType: "auto"` → `"define"` + explicit `text` field | ✅ |
| 2026-05-26 | Fix: hapus `temperature: 0.4` dari GPT-4o-mini node | ✅ |
| 2026-05-26 | Rename semua workflow ke WaFaChat · naming convention | ✅ |
| 2026-05-26 | Archive PoC workflows yang tidak relevan | ✅ |
| 2026-05-26 | Delete WA CS - CS Control Panel (legacy) | ✅ |
| 2026-05-26 | CS Panel: Next.js 14 + Tailwind deployed ke wafachat.vercel.app | ✅ |
| 2026-05-26 | CS Panel: repo github.com/fandyandika/wafachat | ✅ |
| 2026-05-26 | State Manager: tambah actions list_all, set_global, get_global, increment_stat, get_stats | ✅ |
| 2026-05-26 | Telegram Callback Handler workflow (WaFaChat · Telegram Callback) | ✅ |
| 2026-05-26 | maxTokens 350 → 500 di GPT-4o-mini node | ✅ |
| 2026-05-26 | Fix prompt: trigger eksplisit "Ragu — COD vs Transfer" + guardrail "Konfirmasi Tanpa Metode Bayar" | ✅ |
| 2026-05-26 | Fix CRITICAL: AI Agent (langchain) return output="" bug — bypass dengan HTTP Request langsung ke OpenAI API | ✅ |
| 2026-05-26 | Chat Handler: AI Agent + GPT-4o-mini + Window Buffer Memory DISABLED, replaced by "Call OpenAI" (HTTP Request) + "Extract Output" (Code) | ✅ |
| 2026-05-26 | Fix stats: Closing AI dedup per `order_id` via `closing_keys`; CR AI tidak inflate saat pesan closing terkirim berulang | ✅ |
| TBD | Verifikasi end-to-end AI reply setelah bypass AI Agent | ⏳ |
| TBD | KirimChat + staffMap Lila/Azelia/Risma (4 syarat) | ⏳ |
| TBD | KirimChat webhook secret validation (HMAC di Chat Handler) | ⏳ |
| TBD | Shadcn/ui di CS Panel | ⏳ |
| TBD | Convex database (replace n8n global static data) | ⏳ |
| TBD | Re-implement conversation history (disabled bersama AI Agent) | ⏳ |
