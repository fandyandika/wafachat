# WaFaChat Panel — Disable AI Dashboard + Accurate Closing Display

**Date:** 2026-06-21
**Status:** Approved (brainstorm)

## Context

Post migrasi KirimChat → KirimDev, AI Chat Handler (n8n) di-OFF 2026-06-03. **Sekarang 100% CS manusia**, belum ada AI. Closing balik nyala 2026-06-21 lewat webhook KirimDev `message.sent` → auto-detect frasa "PEMESANAN BERHASIL".

**Masalah:** Panel masih nampilin dimensi AI yang sekarang nyesatin:
- Kartu **Total Closing** di Dashboard nampilin `AI: X · Manual: Y`. Padahal semua closing = CS. Penyebab: outbound CS dari WA HP (`source:"app"`) ke-map `role:"ai"` oleh receiver (rule lama `source==='dashboard'?'cs':'ai'`), dan metric nge-cap message-sourced recap sebagai "AI". Jadi closing CS muncul sebagai "AI".
- Route **`/panel/cs-ai`** (Global AI toggle + AI Closing/Manual Closing KPI + conversation queue) ga relevan tanpa AI.

User minta: **matikan semua tampilan AI dulu**, tampilkan closing apa adanya (semua CS), dan **masukkan rencana AI ke ROADMAP** buat di-nyalain lagi pas AI di-setup.

## Goals

1. Hilangkan dimensi "AI" yang nyesatin dari panel — tampilan **akurat** (semua closing = CS).
2. **Disable** route/nav `/panel/cs-ai` (AI dashboard) sampai AI di-setup lagi.
3. UI/UX tetap **jelas, nyaman, smooth** — tanpa link mati / halaman pecah / angka membingungkan.
4. Catat rencana re-enable AI + gap teknis ke `docs/ROADMAP.md`.

## Non-Goals (→ ROADMAP)

- **Bikin attribution AI vs CS** (baru relevan kalau AI ada). Termasuk fix receiver n8n `source`→`role` (`api`→ai, `app`/`dashboard`→cs).
- **Gap empty-body** closing dari `source:"app"` (Coexistence) — intermiten, sebagian closing bisa kelewat. Monitor dulu.
- Perubahan Convex backend / n8n receiver (receiver lagi live; jangan disentuh). Closing detection tetap jalan apa adanya.

## Changes

Frontend-only (Next.js panel). Tidak ada perubahan Convex/n8n.

### 1. Sembunyikan route CS AI — `app/panel/layout.tsx`
- Hapus entri `{ href: '/panel/cs-ai', label: 'CS AI', icon: MessagesSquare }` dari array `NAV` (baris 14-19). Ini otomatis ngilangin link dari sidebar desktop **dan** badge nav mobile (dua-duanya map dari `NAV`).
- Bersihin import yang jadi orphan (`MessagesSquare` kalau ga kepakai lagi).

### 2. Disable halaman CS AI — `app/panel/cs-ai/page.tsx`
- **Preservasi dulu:** pindahkan seluruh implementasi client sekarang (default export `CsAiPage` + isinya) ke komponen baru `components/panel/cs-ai-dashboard.tsx` (export `CsAiDashboard`, identik, **tidak di-render** oleh route mana pun → ga masuk bundle, siap di-restore).
- **Ganti `app/panel/cs-ai/page.tsx`** jadi **server component redirect**:
  ```tsx
  import { redirect } from 'next/navigation';
  export default function Page() {
    redirect('/panel');
  }
  ```
  Server-redirect = ga ada client mount, ga nge-mount query berat `listConversations`, bookmark/URL langsung mulus ke `/panel`.
- Lokasi preservasi (`components/panel/cs-ai-dashboard.tsx`) dicatat di ROADMAP buat re-enable.

### 3. Akuratin kartu Total Closing — `app/panel/page.tsx`
- Kartu **Total Closing**: ganti `detail` dari `AI: ${aiClosings} · Manual: ${manualClosings}` jadi netral & akurat, mis. `"Closing CS · periode ini"`.
- Hapus derivasi yang jadi orphan akibat perubahan ini: `stats.ai_closings`, `stats.manual_closings` (kalau ga dipakai lagi), `aiClosings`, `manualClosings` (baris ~72-73). Sisakan `totalClosing` apa adanya.
- Jangan ubah angka `Total Closing` itu sendiri (sudah benar: recap unik per order).

### 4. Audit sisa referensi AI di panel
- Pastikan Performance & Rekap **tidak** punya breakdown AI (per cek awal: `getPerformance` pakai breakdown per-CS/produk, bukan AI — aman). Konfirmasi pas implementasi; kalau ada label "AI" nyasar, rapiin.

### 5. ROADMAP — `docs/ROADMAP.md`
Tambah 2 entri:
- **Re-enable AI Dashboard + attribution AI/CS** (pas AI di-setup lagi): unhide `/panel/cs-ai` (restore dari lokasi preservasi), balikin AI/Manual KPI, dan fix receiver n8n `Map to append_message` `source`→`role` (`api`→ai untuk AI; `app`/`dashboard`→cs) — plus simpan `closedBy` di recap + metric hitung AI vs CS dari situ. Backfill hanya recap KirimDev-era (06-21+); recap pra-06-04 sudah benar "AI" (era Chat Handler).
- **Gap empty-body closing** (`source:"app"`, Coexistence): sebagian outbound CS dari HP body kosong → closing kelewat. Opsi: pakai `template_name` kalau closing dikirim sbg template, atau `conversation.closed` event, atau import Berdu verified rows sbg source-of-truth.

## Acceptance / Testing

- `npm run build` (wafachat) **hijau** (cek exit code, bukan cuma "compiled").
- Nav cuma 3 menu: Dashboard, Rekap Pengiriman, Performance. Tidak ada "CS AI".
- Buka `/panel/cs-ai` langsung → redirect mulus ke `/panel` (ga ada halaman pecah / query berat ke-mount).
- Dashboard: Total Closing tampil angka akurat tanpa "AI/Manual"; ga ada angka nyesatin.
- Tidak ada link mati / import orphan / warning build.
- `npm test` (wafachat) tetap hijau (suite eksisting; perubahan presentation-only, harusnya ga kesentuh).

## Quality bar

Smooth, tampilan akurat, UI/UX jelas & nyaman (sesuai permintaan user). Light theme indigo/violet eksisting dipertahankan.
