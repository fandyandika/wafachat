# WaFaChat — Workflow Overview
**Last updated:** 2026-05-26

---

## Gambaran Besar Sistem

```
[Berdu Order]
     │ webhook (order.new)
     ▼
[WaFaChat · Order Trigger]  — 12 nodes
  → pull order detail dari Berdu API
  → save order details ke State Manager (set_order)
  → routing ke CS yang assigned (staffMap)
  → kirim WA template ke customer via KirimChat
     │
     │ customer balas WA
     ▼
[WaFaChat · Chat Handler]  — 19 nodes
  → cek state conversation (State Manager)
  → kalau handover/closed → diam (CS handle manual)
  → kalau active → Build Context → AI Agent (GPT-4o-mini)
     → kalau AI trigger handover:
         → balas "Baik sebentar ya Kak 🙏"
         → set state = handover
         → notif CS via Telegram (WaFaChat · Handover Notifier)
           + inline keyboard: [📱 Buka WA] [🔄 Resume AI] [✅ Selesai]
     → kalau normal → balas ke customer
     → kalau closing (PEMESANAN BERHASIL):
         → balas ke customer
         → increment_stat closings
         → log ke Google Sheet (ekspedisi-ready)
     │
     │ CS klik tombol di Telegram
     ▼
[WaFaChat · Telegram Callback]  — 7 nodes
  → parse callbackData (resume_ai:628xxx / selesai:628xxx)
  → set status = active (Resume AI) / closed (Selesai)
  → balas konfirmasi ke CS di Telegram
```

---

## WaFaChat · Order Trigger
**ID:** `wgOVQrzkYOijDta1` | **Status:** ACTIVE | **Nodes:** 12
**Webhook:** `https://n8n.miqra.dev/webhook/berdu-order-prod`
**Trigger:** Berdu webhook `order.new`

**Alur:**
1. Terima webhook Berdu → validasi event type
2. Build HMAC auth header (3-node pattern)
3. GET `/order/detail` dari Berdu API
4. Normalize data (phone, produk, harga, alamat, assigned CS)
5. **Save ke State Manager** via `set_order` (csName, productName, harga, alamat)
6. Route ke staffMap berdasarkan `assigned_to_staff`
7. POST ke KirimChat API → kirim WA template ke customer

**Template aktif:** `whatsapp_notif_order_aisyah` ✅

**Nodes disabled (placeholder, belum dipakai):**
- `Send Template: Bayar Sukses` — triggered `order.update.paymentStatus`
- `Send Template: Terkirim` — triggered `order.update.shippingStatus`

**Bug fix 2026-05-26:** `fetch` → `this.helpers.httpRequest()` di node Normalize Order Data (n8n task runner tidak support global `fetch`)

---

## WaFaChat · Chat Handler
**ID:** `4eBFqyabDlIRx3ZY` | **Status:** ACTIVE | **Nodes:** 19
**Webhook:** `https://n8n.miqra.dev/webhook/kirimchat-inbound`
**Trigger:** KirimChat webhook (customer balas WA)

**Alur:**
```
KirimChat Inbound Webhook
  → Parse Inbound Message     (filter inbound, handle text + image)
  → Get State                 (tanya State Manager get_with_global)
  → Parse State               (extract globalEnabled bool + status + order details)
  → Is AI Active? (IF)
      [handover/closed] → Skip  ← AI diam
      [active]          → Build Context  ← inject systemMessage dinamis
                           → AI Agent (GPT-4o-mini)
                              ├ Window Buffer Memory (10 msg, phone as key)
                              └ GPT-4o-mini (maxTokens 350)
                           → Parse AI Response
                               detect: isHandover / isClosing / orderMethod
                                       bonusItem / instruksiPengiriman
                           → Handover? (IF)
                               [true]  → Send Handover Reply
                                         → Set State: Handover
                                         → Log Handover → Handover Notifier
                               [false] → Send Reply
                                         → Is Closing? (IF)
                                             [true] → Increment Closing
                                                      → Log to Google Sheet
```

**Build Context node:**
- Baca `csName`, `productName`, order details dari Parse State
- Fuzzy match keyword → load product knowledge (tazyin / medis / mapping)
- Inject ke systemMessage (Mode A Post-Order Closing v4)
- Output: `systemMessage` + semua field asli

**Google Sheet (Log to Google Sheet node):**
- Sheet ID: `1acve92eQneZCthTX879nxj40Ne4pJjFpPoTdlslZBnI`
- Trigger: `isClosing = true` (AI kirim PEMESANAN BERHASIL)
- 16 kolom ekspedisi-ready: Tanggal, Pengirim, Penerima, Alamat, Metode Bayar, Harga, Nilai COD, Order ID, Bonus, Diskon, Instruksi Pengiriman

**Bug fixes 2026-05-26:**
- Backtick unescaped di Build Context → `\``
- `fetch` → `this.helpers.httpRequest()` di Log Handover node
- `promptType: "auto"` → `"define"` + `text: $json.messageText` di AI Agent
- `temperature: 0.4` dihapus (tidak supported di model terbaru OpenAI)

---

## WaFaChat · State Manager
**ID:** `oTNay1fDleMibZ3J` | **Status:** ACTIVE | **Nodes:** 8
**Webhook:** `https://n8n.miqra.dev/webhook/conversation-state`

**Actions:**
```
get              → ambil status conversation
set              → update status (active/handover/closed)
                   status=closed: remove dari phone_index + increment closed_today
get_with_global  → ambil status + order details + globalEnabled boolean
set_order        → simpan detail order + dedup via order_keys + add ke phone_index
set_global       → set global AI on/off (globalEnabled boolean)
get_global       → ambil globalEnabled status
increment_stat   → increment field: closings atau handovers
get_stats        → ambil stats hari ini (orders, closings, handovers, closed_today)
list_all         → list semua active+handover conversations (via phone_index)
```

**State structure:**
```javascript
state.global_ai_enabled = true/false
state.phone_index = ["628xxx", ...]          // conversations non-closed
state.daily_stats[date] = {
  orders, closings, handovers, closed_today,
  order_keys: ["628xxx:ProductName", ...],   // dedup order per phone+produk per hari
  closing_keys: ["O-260526000058", ...]      // dedup closing per order_id
}
state["628xxx"] = { status, csName, productName, updatedAt, ... }
```

---

## WaFaChat · Handover Notifier
**ID:** `GUQJrCIn1xGKJjH0` | **Status:** ACTIVE | **Nodes:** 5
**Webhook:** `https://n8n.miqra.dev/webhook/cs-handover`
**Channel:** Telegram via @pustakaislam_cs_bot

**Notif yang diterima CS:**
```
🚨 Handover — Butuh CS

Nama: [nama customer]
Nomor: `628xxx`
Produk: [nama produk]
Catatan: [alasan handover]
Waktu: [HH:MM WIB]
```

**Inline keyboard (3 tombol):**
- 📱 Buka WA → `https://wa.me/628xxx`
- 🔄 Resume AI → callbackData: `resume_ai:628xxx`
- ✅ Selesai → callbackData: `selesai:628xxx`

**CS Telegram chat IDs:**
- Aisyah: `8652698740` ✅
- Lila/Azelia/Risma: TBD (chat @pustakaislam_cs_bot → dapat chat ID)

---

## WaFaChat · Telegram Callback
**ID:** `PvMTP5Ex3kzvjNgG` | **Status:** ACTIVE | **Nodes:** 7
**Trigger:** Telegram callback_query

CS klik tombol di notif Telegram → workflow handle:
- `resume_ai:628xxx` → set status = active → konfirmasi ke CS
- `selesai:628xxx` → set status = closed → konfirmasi ke CS

---

## WaFaChat · Telegram Setup
**ID:** `Pu5qEcSpu7e7NV09` | **Status:** ACTIVE | **Nodes:** 2
**Trigger:** Telegram (chat @pustakaislam_cs_bot)

CS kirim pesan apapun ke bot → bot auto-reply dengan chat ID mereka.

---

## WaFaChat CS Panel
**URL:** https://wafachat.vercel.app
**Repo:** https://github.com/fandyandika/wafachat
**Stack:** Next.js 14 + Tailwind + Vercel
**Auth:** cookie `auth_session=1`, password via `PANEL_PASSWORD` env var

**Features:**
- Login page
- 7 stats cards: Pesanan, Closing AI, CR AI, Handover, Handover Rate, Chat Aktif, Selesai
- Tabel handover (highlight kuning) + tabel aktif
- Action buttons: WA link, Resume AI, Selesai
- Global AI toggle (on/off semua AI sekaligus)
- Auto-refresh setiap 10 detik

---

## Checklist Go-Live

### ✅ Sudah Selesai
- [x] Berdu webhook → pull order detail → kirim WA template (`whatsapp_notif_order_aisyah`)
- [x] Save order details ke State Manager saat order masuk
- [x] AI Agent balas customer WA (inbound) — GPT-4o-mini maxTokens 350
- [x] Conversation state management (active/handover/closed)
- [x] Handover: AI balas sopan + diam setelahnya
- [x] CS dapat notif Telegram + inline keyboard 3 tombol
- [x] Telegram Callback Handler: Resume AI / Selesai dari tombol
- [x] Window Buffer Memory (10 pesan per customer)
- [x] Image inbound: bukti transfer / foto rusak / tidak jelas
- [x] Dynamic prompt injection (Build Context node)
- [x] Product knowledge 3 SKU (Tazyin, Medis, Mapping)
- [x] Google Sheet recap otomatis saat PEMESANAN BERHASIL (COD/Transfer)
- [x] Bonus / Instruksi Pengiriman diekstrak dari template AI ke sheet
- [x] COD warm intro
- [x] Order dedup via order_keys (phone+produk per hari)
- [x] Stats tracking: orders, closings, handovers, closed_today
- [x] CS Panel deployed di wafachat.vercel.app
- [x] Workflow naming standard: WaFaChat · [Nama]
- [x] PoC workflows archived

### ⏳ Yang Masih Perlu Dilakukan

| Item | Prioritas | Keterangan |
|---|---|---|
| **KirimChat + staffMap** Lila/Azelia/Risma | 🔴 Blocker | 4 syarat: Berdu ID + WA sendiri + API key + template approved |
| **Telegram chat ID** Lila/Azelia/Risma | 🟡 Tergantung KirimChat | Chat @pustakaislam_cs_bot → dapat chat ID |
| **KirimChat webhook secret** | 🟡 Security | HMAC validation di awal Chat Handler |
| **Shadcn/ui** di CS Panel | 🟡 UX | Komponen UI lebih polished |
| **Convex** database | 🟡 Architecture | Replace n8n global static data, real-time panel |
| **Template Bayar Sukses & Terkirim** | 🟢 Optional | Node disabled — aktifkan kalau mau |

---

## Untuk Tambah Produk Baru

1. Buat file `products/{nama-produk}-v1.md`
2. Di n8n, buka **WaFaChat · Chat Handler** → node **Build Context**
3. Tambah entry di `PRODUCT_KNOWLEDGE` object
4. Tambah `else if (productNameRaw.includes('keyword'))` di bagian matching
5. Update [Prompt AI Agent.md](Prompt AI Agent.md) keyword matching table

## Untuk Tambah CS Baru ke staffMap

1. Pastikan 4 syarat terpenuhi (Berdu ID + KirimChat WA + API key + Meta template approved)
2. Di **WaFaChat · Order Trigger** → node **Normalize Order Data**, tambah entry di `staffMap`
3. Dapatkan Telegram chat ID CS baru (chat @pustakaislam_cs_bot)
4. Di **WaFaChat · Handover Notifier** → node **Format Notif**, tambah chat ID ke mapping
5. **⚠️ JANGAN skip syarat** — lihat CONTEXT.md Section 4 tentang incident staffMap
