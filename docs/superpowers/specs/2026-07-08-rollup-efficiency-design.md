# Rollup Efficiency — ganti derive-on-read dengan rollup + compute-on-write (Design)

**Tanggal:** 2026-07-08
**Status:** Approved (owner delegasi penuh: "berikan rekomendasi terbaik dan implementasikan saja langsung")
**Pemicu:** Convex dashboard DB I/O 268 MB/hari (single tenant!): getResponseTimes 108.9 MB, getDailyReport 49.7, getFollowUpEffectiveness 35.9, getTrend 14.3, getPeriodReport 10.3, getCsLeaderboard/getProductDifficulty/getPerformance/getDashboardSummary ~10 total. Pembanding: ingest processEvent 1.5 MB. 92% biaya = query panel derive-on-read (scan tabel mentah per buka). O(N)-per-buka → tidak scale ke SaaS multi-tenant.

## 1. Tujuan

Panel tetap **akurat & instant** bagi user; biaya DB jadi **O(aktivitas tulis)**, bukan O(buka panel × ukuran tabel). Target: total DB I/O turun ±90% (268 → ~25 MB/hari) tanpa perubahan makna metrik (kecuali §7, disengaja).

## 2. Keputusan arsitektur (dari 3 opsi)

- **Ditolak — counter increment murni:** cepat tapi drift; `dailyStats` lama diretire persis karena ini (counter melenceng dari kebenaran tanpa self-heal).
- **Ditolak — cron refresh berkala:** stale (owner: monitoring harus instant) + biaya jalan walau sepi.
- **DIPILIH — dirty recompute-bounded on write + fact table + nightly true-up:**
  1. Setiap write yang menyentuh orders/recaps memanggil `bumpRollup(csKey, windowKey)` → **hitung ulang SATU row rollup** dari raw yang ter-bound (satu CS × satu window ≈ 30–60 row). Idempotent → **drift mustahil by construction** (row = fungsi murni dari raw). Terjadi dalam mutation yang sama → read-after-write konsisten (instant).
  2. `windowKey` dihitung dari **`createdAt`/`closedAt` event** (bukan `now`) → backfill/manual-patch/out-of-order otomatis mendarat di window yang benar.
  3. Median/P90 response time tidak bisa di-agregasi inkremental → **fact table `responseSamples`** (row mungil ditulis saat reply terdeteksi); reader hitung median dari samples.
  4. **Nightly true-up cron**: rebuild rollups + samples untuk window kemarin + hari-ini dari raw (bounded ~1 hari data). Jaring pengaman kalau ada write-path terlewat; self-heal ≤ 24 jam.

## 3. Skema baru

```ts
// 1 row per (csKey, window 16:00 WIB). Kecil (~300B–1KB dgn byProduct).
dailyRollups: defineTable({
  windowKey: v.string(),        // label date window 16:00→16:00 WIB, "YYYY-MM-DD" (tanggal BUKA window)
  csKey: v.string(),            // csKey() — konsisten dgn grouping panel
  csName: v.string(),           // display name dominan
  orgId: v.optional(v.string()),// multi-tenant ready (Task E)
  leadOrders: v.number(),       // row order mentah (utk duplicates = leadOrders - leadsCust)
  leadsCust: v.number(),        // distinct customerPhone
  closings: v.number(),         // order-level (dedup orderIdBerdu||phone), non-cancelled
  closedCust: v.number(),       // distinct customer closing (pembilang CR)
  cancelled: v.number(),
  manualClosings: v.number(),   // recap tanpa sourceMessageId
  delivered: v.number(),        // recap status delivered (getPerformance)
  revenue: v.number(),          // sum(total ?? codValue ?? nonCodItemPrice)
  discount: v.number(),
  fuClosings: v.number(),       // closing dgn followUpTouchesAtClose >= 1
  fuH1: v.number(), fuH2: v.number(), fuH3: v.number(), // breakdown touches 1 / 2 / >=3
  byProduct: v.array(v.object({ product: v.string(), leads: v.number(), closings: v.number() })),
  updatedAt: v.number(),
})
  .index("by_window_cs", ["windowKey", "csKey"])
  .index("by_windowKey", ["windowKey"]),

// Fact mungil per reply-pair terdeteksi (~100B). Sumber median/P90/SLA (Queen speed gate).
// CATATAN DESAIN: TANPA tag first/ongoing — "first reply" pada semantik existing adalah
// pair PERTAMA DI DALAM window scan (window-dependent), jadi reader yang men-derive:
// per window, sample paling awal per conversationId = "first", sisanya "ongoing".
// Ini mereproduksi pairResponseEvents existing secara eksak.
responseSamples: defineTable({
  csKey: v.string(),
  csName: v.string(),
  conversationId: v.id("conversations"),
  deltaMs: v.number(),          // gap = activeMs (businessMinutesBetween) fallback wall-clock — logika pairResponseEvents persis
  inboundAt: v.number(),        // inbound pembuka pair
  slaBreach: v.boolean(),       // isSlaBreach(inboundAt, replyAt) — window-independent; reader hitung breach hanya utk sample yang jadi "first" di window-nya
  createdAt: v.number(),        // = createdAt outbound reply
})
  .index("by_createdAt", ["createdAt"])
  .index("by_cs_createdAt", ["csKey", "createdAt"]),
```

Semua metrik & filter existing dipertahankan persis: exclude `isInternalTestPhone`, exclude status cancelled/cancelled_after_export, dedup key `orderIdBerdu ?? phone`, grouping `csKey`, template/system message tidak dihitung reply.

## 4. Mesin rollup — `convex/rollups.ts`

- `windowKeyFor(ms)` — label date window 16:00 WIB berisi `ms` (port `fourPmWibMs`/`currentReportLabelDate` dari `components/panel/report-window.ts` ke `convex/lib.ts`; satu sumber kebenaran, FE re-export).
- `computeRollupRow(ctx, csKey, windowKey)` — pure recompute: baca orders (`by_createdAt` dibound window, filter csKey) + recaps (`by_closedAt` dibound window, filter csKey; termasuk fallback lookup order by `by_orderId`/`by_customerPhone` utk atribusi CS/product recap yatim — logika sama dgn getDailyReport existing) → hasilkan seluruh field §3 → upsert row `by_window_cs`.
- `bumpRollup(ctx, {csKeys, windowKey})` — dipanggil write-path; recompute tiap csKey yang kena. **Wajib dipanggil dari:** `upsertOrderCore` (order baru/patch), `upsertRecapFromMessage` (closing), `markLatestCancelledByPhone` + `undoCancelled` + `markClosing` (state.ts), `importBerduVerifiedRows`, `deleteOrder`, replay/manual patch (lewat core yang sama). Kalau `csName` berubah antar-write (mis. recap pindah CS), bump kedua csKey (lama+baru).
- **Sample extraction** di `appendMessageCore` — streaming O(1) dengan pairing state di conversation (field opsional baru `conversations.rtPendingInboundAt`): pesan `inbound` masuk → set field kalau masih kosong (= inbound pertama streak, semantik `pendingInboundAt` di `pairResponseEvents`); pesan `outbound` qualifying (messageType ≠ template, role ≠ system) masuk & field terisi → tulis 1 row `responseSamples` (`deltaMs` = activeMs `businessMinutesBetween` fallback wall-clock — rumus persis pairResponseEvents; `slaBreach` = isSlaBreach) lalu clear field. Dedup pesan by externalMessageId terjadi SEBELUM titik ini → sample tidak dobel saat replay. Out-of-order/backfill bisa mis-pair state → dikoreksi true-up nightly (rebuild exact via pairResponseEvents penuh).
- **Nightly true-up** (`crons.daily` 20:00 UTC = 03:00 WIB): utk windowKey kemarin & hari-ini → delete+rebuild `responseSamples` window itu dari `messages` (scan bounded 1–2 hari, pakai `responseTimeMath` full = exact) + `computeRollupRow` semua csKey aktif. Koreksi mis-pairing out-of-order & path terlewat.
- **Backfill action** (sekali, admin-triggered): loop windowKey dari data tertua → hari ini, `computeRollupRow` per window per csKey + rebuild samples per window. Bounded per iterasi; idempotent; bisa diulang.

## 5. Reader dialihkan (output shape DIPERTAHANKAN per fungsi — FE tidak berubah kecuali §7)

| Fungsi | Sekarang scan | Jadi |
|---|---|---|
| `responseTime.getResponseTimes` | SEMUA messages window | `responseSamples` window (`by_createdAt`) → median/P90/count/slaBreaches per csKey + overall. `lastReplyAt` = max sample createdAt per CS. |
| `analytics.getDailyReport` | orders+recaps+fallback | ≤N row `dailyRollups` `by_windowKey` → map ke shape existing (per-CS + totals + byProduct). CR = closedCust/leadsCust. |
| `metrics.getTrend` | orders+recaps se-window | N row rollup (7–30 windowKey) → bucket day = window; week/month = sum window. |
| `metrics.getDashboardSummary` | orders+recaps+events+conversations | rollups utk leads/closings/cr/revenue/cancelled/manualClosings; `handovers` tetap events `by_type_createdAt` (bounded, murah); `activeChats` tetap (pool kecil). |
| `analytics.getCsLeaderboard` / `getProductDifficulty` / `getPeriodReport` / `shippingRecaps.getPerformance` | orders+recaps ×2 (current+prior) | sum rollup rows current + prior. byProduct dari field rollup. delivered dari field rollup. |
| `followUp.getFollowUpEffectiveness` | recaps 30 hari | sum `fuClosings/fuH1/fuH2/fuH3` dari 30 row rollup. |

**TIDAK diubah (YAGNI, disengaja):** `getFollowUpCandidates` (operasional real-time, sudah bounded 6 hari), `getCsDetail` (drawer on-demand, low QPS), sweep `conversationLifecycle` (background truth), semua mutation panel.

## 6. Verifikasi paritas (wajib sebelum switch)

Query lama TIDAK dihapus dulu. Tambah `debugRollupParity` (admin): jalankan versi lama vs baru utk window/range sama → diff per field per CS. Switch reader per-fungsi hanya setelah parity bersih di data live (pola dual-run Fase 1). Setelah 2–3 hari stabil, badan query lama diganti implementasi rollup (nama & shape tetap → FE tak tersentuh).

## 7. Perubahan produk yang disengaja: SATU batas hari = window 16:00 WIB

Sekarang: Laporan/Queen pakai window 16:00→16:00 WIB, tapi Trend (`bucketKey`) & `periodRange` pakai tengah-malam WIB → angka antar halaman tidak cocok (sumber kebingungan). Keputusan: **semua halaman pindah ke window 16:00 WIB** (hari bisnis nyata). Konsekuensi: label "hari" di Dashboard/Performance/Trend = tanggal buka window; range picker snap ke window utuh; angka Dashboard == Laporan utk "hari" yang sama. Delta minor pada angka historis harian di Dashboard (batas geser 8 jam) — bukan bug, konsistensi.

## 8. Biaya sesudah (estimasi)

- Write path: +1 recompute bounded (~30–60 row kecil) per order/closing ≈ 5–10 MB/hari.
- Samples: ~500–1000 row × 100B/hari tulis; reader baca KB.
- True-up nightly: 1× scan bounded 1–2 hari ≈ 5–8 MB/hari.
- Panel reads: rollup rows (≤ ratusan × ~500B) ≈ 1–3 MB/hari total.
- **Total ≈ 15–25 MB/hari (dari 268), flat terhadap frekuensi buka panel.** Multi-tenant: skala linear dgn aktivitas org, bukan ukuran tabel.

## 9. Testing

- Pure: `windowKeyFor` (batas 16:00 WIB persis, sebelum/sesudah), pairing sample streaming (first vs ongoing, template excluded), median/P90 dari samples == hasil `responseTimeMath` existing utk fixture sama.
- convex-test: `computeRollupRow` == hasil getDailyReport existing utk dataset sintetis (order dobel, cancel, undo, CS ganda, produk multi, test-phone excluded); bump terpanggil dari tiap write-path (order, closing, cancel, undo, import, delete); out-of-order createdAt mendarat di window benar; true-up memperbaiki row yang sengaja dirusak; parity harness.
- Live: backfill → `debugRollupParity` 30 window terakhir → 0 diff → switch.

## 10. Rollout

1. Schema + engine + instrumen write-path + samples (deploy; rollup terisi utk data BARU, reader belum berubah — zero risk).
2. Backfill historis + nightly true-up cron.
3. Parity live → switch reader per fungsi (bertahap, mulai getResponseTimes = penghemat terbesar).
4. Unifikasi window FE (Dashboard/Performance/Trend → window 16:00).
5. Purna: badan query lama = implementasi rollup (nama+shape tetap); verifikasi penurunan di Convex Usage (target ≥85%).

## 11. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Write-path terlewat → rollup kurang | true-up nightly rebuild kemarin+hari-ini; parity harness saat rollout; daftar path §4 diverifikasi reviewer |
| Sample mis-pair saat out-of-order | true-up rebuild samples dari messages (exact) — sample live approx ≤24 jam |
| byProduct array bikin row besar | produk unik per CS per hari kecil; cap 50 entri + bucket "lainnya" |
| Recompute menambah latensi mutation ingest | bounded ~30–60 row (~ms); capture-first tetap (gagal recompute ≠ event hilang; true-up menambal) |
| Angka historis Dashboard bergeser (window unification) | disengaja (§7); Laporan/Queen tidak berubah makna |
