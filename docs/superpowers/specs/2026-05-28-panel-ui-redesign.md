# Panel UI Redesign — Design Spec
**Date:** 2026-05-28  
**Status:** Approved (user: "Cakep banget! OK make it perfect, continue")

---

## Overview

Redesign the three views of the WafaChat CS Panel (`wafachat/app/panel/page.tsx`) to add bulk actions, better filters, sort, new "Sudah Terkirim" status, and improved UI throughout.

---

## 1. New Status: `delivered`

Add `delivered` to the `RecapStatus` union alongside existing values.

**Full lifecycle:**
```
needs_review → ready → exported → delivered
                    ↘ cancelled (any time)
```

- `delivered` = CS manually toggles after courier confirms delivery
- New Convex mutation: `markDelivered(ids: Id<"shippingRecaps">[])`
- New field: `deliveredAt?: number` (timestamp ms)
- Status labels: needs_review → "Perlu Review", ready → "Siap Export", exported → "Diekspor", delivered → "Terkirim", cancelled → "Dibatalkan"

---

## 2. Rekap Pengiriman View

### Stats bar (top)
5 cards: Total Hari Ini, Perlu Review, Siap Export, Sudah Terkirim, Nilai COD

### Filter bar
- **Periode**: Today / 7 hari / 30 hari / Bulan ini / Custom (date range picker)
- **Status**: chip buttons — Semua | Perlu Review | Siap Export | Diekspor | Terkirim | Dibatalkan (each shows count)
- **Pembayaran**: toggle — Semua / COD / Transfer
- **Cari**: text search on name, city, product, order ID
- **Urutkan**: dropdown — Terbaru / Terlama / Nilai ↑ / Nilai ↓ / Status

### Bulk action bar
Appears when ≥1 row selected. Shows selection count + buttons:
- **Tandai Siap Export** (needs_review → ready)
- **Export Terpilih** (ready → exported + download CSV)
- **Tandai Terkirim** (exported → delivered)
- **Batalkan** (any → cancelled)

### Table columns
Checkbox | # | Penerima & Alamat | CS | Produk | Metode | Nilai | Tanggal | Status | Aksi

### Per-row actions
- needs_review: "Siap" button inline
- ready: "Export" button inline
- exported: "Terkirim" button inline
- delivered: "Undo" link
- cancelled: "Pulihkan" link

### Pagination
10/20/50 per page

---

## 3. Dashboard View

### Top bar
- Date filter (Hari ini / 7 hari / 30 hari)
- AI Global toggle (badge pill, click to toggle)

### KPI row (4 cards)
Total Percakapan | Closing/Order | Conversion Rate | Nilai COD — each with sparkline trend bar

### Main layout: 2/3 + 1/3
**Left**: Percakapan Aktif list with bulk select bar: Aktifkan AI | Pause AI | Tutup

**Right**: Rekap hari ini (status bars) + CS leaderboard

### Bottom: 2 charts
Order per Hari (7 days) + Produk Terlaris

---

## 4. Performance View

### Top bar
- Tabs: Ringkasan | Per CS | Per Produk
- Date filter: 7 hari / Bulan ini / 3 bulan / Custom

### KPI row (5 cards)
Total Percakapan | Total Order | Conversion Rate | Nilai COD | Avg Response AI

### CS Performance table
Rank | CS | Percakapan | Closing | Conversion Rate (with bar) | Nilai COD | Tren sparkline

### Bottom: 2/3 + 1/3
Produk table + Metode bayar donut + kota terbanyak

---

## 5. Technical Changes

### Convex (`shippingRecaps.ts`)
- Add `delivered` to `RecapStatus` union in schema
- Add `deliveredAt?: v.optional(v.number())` field
- Add `markDelivered` mutation: accepts `ids[]`, sets status=delivered, deliveredAt=now
- Update `list` query filters to include delivered

### Next.js panel (`app/panel/page.tsx`)
- Install shadcn: `Checkbox`, `Select`, `AlertDialog`
- Bulk state: `selectedIds: Set<string>`
- Filter state: dateRange preset, status chip, payment toggle, search, sort
- Bulk action bar renders when selectedIds.size > 0

### No n8n/http.ts changes needed
`delivered` is a panel-only state transition.

---

## 6. shadcn Components to Install
- `npx shadcn@latest add checkbox`
- `npx shadcn@latest add select`
- `npx shadcn@latest add alert-dialog`
