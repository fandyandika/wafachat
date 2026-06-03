# CS Panel v2 + Telegram Enhancement — Design Spec
**Date:** 2026-05-26  
**Status:** APPROVED — ready for implementation  
**Scope:** New web dashboard (Vercel) + enhanced Telegram handover + n8n extensions

---

## 1. Overview

Dua komponen utama:
1. **CS AI Panel** — Next.js web app di Vercel, real-time monitoring & kontrol AI per customer
2. **Telegram Enhancement** — notif handover lebih kaya + inline keyboard 3 tombol

Backend tetap n8n. Tidak ada database baru — semua state di n8n global static data.

---

## 2. Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14+ (App Router) + TypeScript + Tailwind CSS |
| Hosting | Vercel |
| Backend API | n8n (existing) via Next.js API routes (proxy) |
| Auth | Simple password via `PANEL_PASSWORD` env var |
| State storage | n8n global static data (extended) |

---

## 3. Conversation State Lifecycle

**3 states** (industry standard, aligned dengan Cekat.ai/Respond.io/Intercom):

```
active → [AI trigger HANDOVER] → handover → [Resume AI] → active → [Selesai] → closed
```

| State | AI | Panel | Keterangan |
|---|---|---|---|
| `active` | Handle | Baris hijau | Normal — AI closing |
| `handover` | Diam | Baris kuning | CS handle manual |
| `closed` | Tidak respond | Hilang dari panel | Selesai total |

**Reopen rule:** Hanya via order baru dari Berdu (`set_order` reset ke `active`). Customer balas WA saat `closed` tanpa order baru → AI diam.

---

## 4. CS AI Panel — Web App

### Layout
- **Top bar**: Logo + "CS AI Panel" + Global AI toggle (ON/OFF)
- **Stats row** (6 cards): Orders hari ini | Closing hari ini | CR AI | Handover Rate | Active (realtime) | Perlu CS (realtime)
- **Info note**: Penjelasan formula metrics
- **Table**: Conversation aktif — Customer | Produk | Status | CS | Update | Aksi

### Stats & Metrics

| Metric | Formula | Keterangan |
|---|---|---|
| Orders hari ini | Count unique (phone+product) per hari | Dedup: form submit 3x = 1 order. Phone sama + produk beda = 2 order (valid) |
| Closing hari ini | Count PEMESANAN BERHASIL hari ini | Breakdown COD vs Transfer |
| CR AI | Closing / Orders hari ini x 100% | Simple daily CR |
| Handover Rate | Handovers / Orders hari ini x 100% | Makin rendah = AI makin kuat |
| Active | Count conversations state=active | Realtime |
| Perlu CS | Count conversations state=handover | Realtime |
| Selesai | Count conversations di-closed hari ini | Realtime — increment saat state di-set ke `closed` |

**Dedup logic:** Key = `{phone}:{productName}`. Jika key sudah ada di `order_keys` hari ini → skip increment. Jika phone sama tapi produk beda → key berbeda → order baru (valid).

### Table Behavior
- **Handover row**: highlight background kuning + 3 action buttons: `WA` · `Resume AI` · `Selesai`
- **Active row**: toggle switch (AI on/off per customer)
- **Closed rows**: hilang dari tabel
- **Duplikat badge**: label kecil di nama customer kalau phone sama order 2x hari ini

### Polling
- `useEffect` + `setInterval` tiap 10 detik
- Fetch `/api/conversations` + `/api/stats` + `/api/global`

### Auth
- Middleware Next.js cek session cookie
- `/login` page dengan password form
- Password dari `PANEL_PASSWORD` env var di Vercel

### Environment Variables
```
PANEL_PASSWORD=xxxx
N8N_STATE_MANAGER_URL=https://n8n.miqra.dev/webhook/conversation-state
```

---

## 5. Telegram Enhancement

### Notif Handover (Workflow 4 — diupdate)
Format baru:
```
Handover — Butuh CS

Nama: [customerName]
Nomor: [phone]
Produk: [productName]
Catatan: [alasan handover]
Waktu: [DD/MM HH:MM WIB]
```

**Inline keyboard (3 tombol):**
- `Buka WA` — URL button ke `https://wa.me/{phone}`
- `Resume AI` — callback button → trigger Workflow 7
- `Selesai` — callback button → trigger Workflow 7

### Workflow 7 — Telegram Callback Handler (NEW)
- **Trigger:** Telegram node, type: `callback_query`
- **Callback data format:** `resume_ai:{phone}` atau `selesai:{phone}`
- **Resume AI:** State Manager set status=active → reply Telegram konfirmasi
- **Selesai:** State Manager set status=closed → reply Telegram konfirmasi

---

## 6. n8n Changes Required

### Workflow 3 — State Manager (EXTEND)
Tambah actions:

| Action | Input | Output |
|---|---|---|
| `list_all` | `{action}` | Array semua conversation records |
| `set_global` | `{action, enabled: bool}` | `{ok: true}` |
| `get_global` | `{action}` | `{globalEnabled: bool}` |
| `increment_stat` | `{action, date, field}` | `{ok: true}` |
| `get_stats` | `{action, date}` | `{orders, closings, handovers, closed_today, date}` |

**Global static data structure extension:**
```javascript
{
  // per-phone records (existing)
  "628xxx": { status, customerName, productName, csName, order_id, updatedAt, csNumber },

  // phone index for list_all (NEW)
  phone_index: ["628xxx", "628yyy"],

  // daily stats (NEW)
  daily_stats: {
    "2026-05-26": {
      orders: 8,
      closings: 6,
      handovers: 2,
      closed_today: 3,
      order_keys: ["628xxx:Tazyin", "628yyy:QuranMapping"]  // dedup set
    }
  },

  // global flag (NEW)
  global_ai_enabled: true
}
```

**set_order change:** cek `order_keys` untuk dedup (key = `phone:productName`). Jika key baru → tambah phone ke `phone_index` (jika belum ada) + increment `orders` + append ke `order_keys`. Jika key sudah ada → skip.  
**set status=closed:** remove phone from `phone_index` + increment `daily_stats[today].closed_today`  
**PEMESANAN BERHASIL (Workflow 2):** increment `daily_stats[today].closings`

### Workflow 2 — Inbound Handler (EXTEND)
Tambah di awal flow setelah Parse Inbound Message:
1. GET `get_global` dari State Manager
2. IF `globalEnabled = false` → Skip
3. IF state = `closed` → Skip

### Workflow 4 — Handover Notifier (EXTEND)
- Update format notif: tambah Produk + Waktu
- Tambah `reply_markup` inline keyboard 3 tombol
- Callback data: `resume_ai:{{phone}}` dan `selesai:{{phone}}`
- Increment `daily_stats[today].handovers`

### Workflow 1 — Outbound Trigger (MINOR)
- Pastikan `set_order` call juga trigger increment stats untuk orders

---

## 7. Next.js App Structure

```
cs-panel/
├── app/
│   ├── login/page.tsx
│   ├── panel/page.tsx          (main panel)
│   └── api/
│       ├── conversations/      GET: list_all
│       ├── stats/              GET: get_stats hari ini
│       ├── global/             GET/POST: get_global / set_global
│       └── toggle/             POST: set status per phone
├── middleware.ts               (auth check)
└── .env.local
```

---

## 8. Implementation Order

1. State Manager extend — list_all, set_global, get_global, increment_stat, get_stats, state closed
2. Workflow 2 extend — cek global flag + state closed di awal
3. Workflow 4 extend — format notif baru + inline keyboard
4. Workflow 7 baru — Telegram callback handler
5. Next.js app — scaffold, auth, panel page, API routes
6. Deploy ke Vercel — env vars, domain

---

## 9. Visual Reference
Mockup final tersimpan di:
`f:\Projects\whatsapp_cs_automotion\.superpowers\brainstorm\1685-1779755411\content\panel-v2.html`

---

## 10. Out of Scope (untuk sekarang)
- History page (web terpisah, v2)
- 7-day CR trend chart
- Snoozed state (terlalu kompleks untuk v2, pertimbangkan di v3)
- Per-CS breakdown stats
- Auto-cleanup old closed records
