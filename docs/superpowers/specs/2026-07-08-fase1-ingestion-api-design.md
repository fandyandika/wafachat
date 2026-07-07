# Fase 1 — WaFaChat Ingestion API (Design)

**Tanggal:** 2026-07-08
**Status:** Approved-pending-review
**Konteks insiden pemicu:** 7 Juli 2026 — VPS n8n down 19:29–20:59 WIB; KirimDev subscription `wbs_A3A14…` auto-disabled 19:33 setelah 23 consecutive failures; panel buta ~4,5 jam sampai Re-enable manual + replay dead deliveries. Recovery berhasil hanya karena KirimDev kebetulan menyimpan dead-letter queue.

## 1. Tujuan

Mengeluarkan n8n sepenuhnya dari **jalur data-ingestion** WaFaChat (pesan + order) dan menggantinya dengan Ingestion API di Convex yang: (a) berjalan di infra HA, (b) tidak pernah kehilangan event yang sudah diterima, (c) memonitor dirinya sendiri, dan (d) berbentuk produk SaaS (BSP-agnostic, org-ready) — bukan glue per-customer.

**Non-goal:** notif-order (outbound WA template) TETAP di n8n — keputusan produk: layanan terpisah dari WaFaChat. Telegram handover flows dan Chat Handler AI juga di luar scope.

## 2. Prinsip arsitektur

1. **Capture-first.** Setiap webhook disimpan mentah ke tabel `ingestEvents` SEBELUM diproses. Bug pemrosesan ≠ data hilang; event gagal di-replay dari tabel sendiri, bukan dari dashboard vendor.
2. **Always-200.** Setelah event ter-capture, endpoint SELALU balas 200 ke vendor (kecuali signature invalid → 401, payload bukan JSON/oversize → 400). Vendor tidak pernah menghitung kegagalan internal kita → auto-disable tidak bisa terulang dari sisi kita. (Bandingkan hari ini: n8n `neverError:true` menelan kegagalan Convex secara diam-diam — event hilang tanpa jejak.)
3. **Push primary, pull safety-net.** Real-time via webhook (requirement: monitoring harus instant); cron reconciler menambal gap. Instant saat sehat, tidak pernah hilang saat sakit.
4. **Pengawas tidak mati bersama yang diawasi.** Silence detector + alerting berjalan di Convex cron dan mengirim alert langsung (Telegram Bot API via fetch), tanpa lewat n8n/VPS.
5. **Dua event universal** (sesuai blueprint): `message.event` dan `lead.created`. Adapter vendor menerjemahkan payload native ke dua bentuk ini; core tidak tahu-menahu soal vendor.

## 3. Komponen

```
KirimDev ─► POST /webhooks/kirimdev   (verifikasi x-kirim-signature)─┐
Berdu    ─► POST /webhooks/berdu      (verifikasi HMAC per-source)───┤
BSP lain ─► POST /ingest/message      (HMAC per-source, universal)───┼─► capture → process
Sumber   ─► POST /ingest/lead         (HMAC per-source, universal)───┘        │
                                                                              ▼
                                                          Core: ingestMessage / ingestLead
                                                          (internalMutation, idempotent,
                                                           timestamp asli, closing detection)

Cron: berduReconcile (5 mnt) · silenceDetector (5 mnt) · cleanupIngestEvents (harian)
```

### 3.1 Struktur file (unit terisolasi, pure function bisa dites tanpa convex-test)

| File | Tanggung jawab |
|---|---|
| `convex/http.ts` | Routing + capture + always-200 envelope. Route lama `/n8n/state` tetap hidup selama transisi. |
| `convex/ingest/signature.ts` | Pure: verifikasi & pembuatan HMAC `t=<unix>,v1=<hex>` (konvensi Stripe; dipakai untuk verifikasi KirimDev DAN auth endpoint generic — satu skema, di-dogfood). Toleransi skew 5 menit. |
| `convex/ingest/kirimdevAdapter.ts` | Pure: parse payload KirimDev → `MessageEvent` universal (atau `{skip, reason}`). Port 1:1 dari node n8n "Map to append_message" (lihat §5). |
| `convex/ingest/berduAdapter.ts` | Pure: parse payload/order Berdu → `LeadEvent` universal. Normalisasi rupiah/phone port dari node "Normalize Order Data". |
| `convex/ingest/core.ts` | `ingestMessage` / `ingestLead` (internalMutation) — pembungkus tipis di atas `messages.appendMessageFromN8n` dan `state.upsertOrderFromN8n` yang sudah teruji 6 minggu di prod. Fungsi lama tetap diekspor (back-compat n8n selama transisi). |
| `convex/ingest/events.ts` | `captureEvent`, `markProcessed/Failed/Skipped`, `replayEvent` (public, requireAdmin), `replayAllFailed` (public, requireAdmin), `cleanupOld`. |
| `convex/ingest/sources.ts` | CRUD `ingestSources` (requireAdmin) + `getBySourceKey` (internal). |
| `convex/ingest/reconciler.ts` | Action cron: port n8n "Order Reconciler" — ambil counters dari Convex, deteksi gap, GET /order/detail Berdu (HMAC auth scheme diekstrak dari node n8n `HMAC SHA256` + `Build Auth Header` saat implementasi), upsert via `ingestLead`. |
| `convex/ingest/monitor.ts` | Action cron: silence detector + failure-spike detector + kirim alert Telegram. |
| `convex/crons.ts` | Registrasi 3 cron. |

### 3.2 Skema tabel baru

```ts
ingestEvents: defineTable({
  sourceKey: v.string(),            // "kirimdev-pustakaislam" | "berdu-pustakaislam" | custom
  kind: v.string(),                 // "message.event" | "lead.created" | "unknown"
  rawHeaders: v.string(),           // JSON string — subset relevan (x-kirim-*, content-type)
  rawBody: v.string(),              // payload mentah verbatim (untuk replay & verifikasi ulang)
  signatureOk: v.boolean(),
  status: v.union(v.literal("received"), v.literal("processed"),
                  v.literal("failed"), v.literal("skipped")),
  error: v.optional(v.string()),    // pesan error saat failed
  skipReason: v.optional(v.string()),
  resultRef: v.optional(v.string()),// messageId/orderId hasil proses (audit)
  receivedAt: v.number(),
  processedAt: v.optional(v.number()),
  replayOf: v.optional(v.id("ingestEvents")),
})
  .index("by_status_receivedAt", ["status", "receivedAt"])
  .index("by_receivedAt", ["receivedAt"]),

ingestSources: defineTable({
  sourceKey: v.string(),            // identitas di header X-Wafachat-Source / path
  name: v.string(),
  kind: v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom")),
  secret: v.string(),               // HMAC signing secret (webhook secret vendor, atau yang kita terbitkan)
  orgId: v.optional(v.string()),    // org-ready; diisi saat multi-org (Task E) hidup
  enabled: v.boolean(),
  enforceSignature: v.boolean(),    // false = log-only (signatureOk dicatat, request tetap diterima);
                                    // true = tolak 401. Onboarding source baru mulai log-only.
  createdAt: v.number(),
})
  .index("by_sourceKey", ["sourceKey"]),

alertState: defineTable({
  alertKey: v.string(),             // "silence" | "failure-spike"
  lastSentAt: v.number(),           // cooldown 60 menit dihitung dari sini
})
  .index("by_alertKey", ["alertKey"]),
```

Perubahan tabel existing: `csConfigs.providerNumberIds: v.optional(v.array(v.string()))` — satu CS bisa punya >1 nomor WABA (kasus nyata: Nabila punya 2 phone_number_id). Field lama `providerNumberId` tetap; lookup mencocokkan keduanya. Seed awal dari mapping n8n (§5).

### 3.3 Alur request (semua endpoint)

1. Baca raw body (cap 256 KB → 400 bila lebih).
2. Verifikasi signature terhadap secret `ingestSources` (KirimDev: header `x-kirim-signature`; generic/Berdu: `X-Wafachat-Signature`). Invalid + `enforceSignature: true` → **401 tanpa capture**. Invalid + `enforceSignature: false` (mode log-only saat onboarding) → tetap di-capture dengan `signatureOk: false` dan diproses — mencegah skenario "konstruksi HMAC kita keliru → 401 beruntun → vendor auto-disable subscription BARU". Flip ke enforce setelah konstruksi terverifikasi terhadap event live.
3. `captureEvent` — insert `ingestEvents` status `received`. (Mutation minimal, praktis tak bisa gagal.)
4. Proses: adapter parse → core mutation. Sukses → `processed` (+`resultRef`); parse memutuskan skip → `skipped` (+alasan); exception → `failed` (+error) **tapi tetap balas 200**.
5. Response 200 `{ok: true, eventId}`.

Capture (3) dan process (4) adalah dua mutation terpisah — kegagalan proses tidak membatalkan capture.

### 3.4 Idempotensi & replay

- Pesan: dedup by `externalMessageId` (sudah ada di `appendMessageFromN8n`). Order: upsert by `orderId`. Closing recap: upsert by order key. → Replay, dual-delivery saat cutover, dan retry vendor semuanya aman by construction.
- `replayEvent(id)` / `replayAllFailed()`: jalankan ulang step-proses pada `rawBody` tersimpan; hasil dicatat sebagai event baru dengan `replayOf`. Guarded `requireAdmin` (bisa dipanggil dari panel; deploy key tidak bisa run internal function — itu sebabnya public+guard, bukan internal).

## 4. Jalur pesan (KirimDev) — prioritas #1

Endpoint `/webhooks/kirimdev`. Verifikasi `x-kirim-signature` format `t=<unix>,v1=<hex>`: HMAC-SHA256 atas `${t}.${rawBody}` (konvensi Stripe). **Verifikasi konstruksi signed-payload terhadap event live saat langkah rollout pertama** — kalau KirimDev ternyata menandatangani body saja, sesuaikan `signature.ts` (satu tempat). Signing secret didapat saat membuat subscription baru (KirimDev menampilkan sekali) → disimpan di `ingestSources`.

## 5. Kontrak mapping KirimDev → MessageEvent (port 1:1 dari n8n, perilaku terbukti)

**`message.sent`** (shape KirimDev `body.data`):
- Non-text → skip `outbound not text`.
- `phone` = `data.contact.phone_number` ?? `message.to`, strip `+` prefix.
- `content` = `message.body`; `direction` = `outbound`.
- `role` = `message.source === "dashboard"` ? `"cs"` : `"ai"`.
- `externalMessageId` = `message.provider_id` ?? `message.id`.
- `createdAt` = `Date.parse(data.timestamp)` (fallback: waktu terima).
- CS attribution: `data.meta.phone_number_id` ?? `data.session` → lookup `csConfigs.providerNumberId(s)`.

**`message.received`** (shape Meta `entry[0].changes[0].value`):
- `type === "text"` → `text.body`; `type === "button"` → `button.text`; lainnya → skip `inbound type <x>`.
- `phone` = `contacts[0].wa_id` ?? `messages[0].from` ?? `kirim.contact.phone_number` (strip `+`).
- `direction` = `inbound`, `role` = `customer`.
- `externalMessageId` = `messages[0].id` ?? header `x-kirim-event-id`.
- `createdAt` = `messages[0].timestamp × 1000`.
- CS attribution: `value.metadata.phone_number_id` → lookup csConfigs.

Event lain / phone kosong / content kosong → skip dengan alasan. **Mapping CS pindah dari hardcode n8n ke `csConfigs`**; seed: Aisyah `1197250776802755`, Risma `433364286526515`, Azelia `485071188032281`, Lila `248236235032868`, Nabila `[589458990909040, 1149779461560484]`.

Limitasi yang dipertahankan (parity, YAGNI): pesan media/gambar di-skip — closing "PEMESANAN BERHASIL" selalu teks.

## 6. Jalur order (Berdu) — instant + self-healing

- **Plan A (dicek di langkah pertama implementasi):** Berdu mendukung >1 URL webhook → daftarkan webhook kedua ke `/webhooks/berdu`; n8n & notif-order tidak tersentuh.
- **Plan B (fallback):** webhook Berdu tetap ke n8n; node order-sync di "Order Trigger v2" diarahkan LANGSUNG ke `/webhooks/berdu` Convex (menghapus double-hop internal `n8n → webhook n8n lain → Convex` yang ada hari ini).
- **Apapun A/B:** cron `berduReconcile` tiap 5 menit (port dari n8n Reconciler: bandingkan order counters, tarik detail order yang bolong dari Berdu API dengan HMAC auth, upsert idempotent). VPS mati → order tetap masuk, telat maksimal ~5 menit; laporan/leads tidak pernah bolong permanen.
- `upsertOrderFromN8n` sudah menerima & mempertahankan `createdAt` asli (perubahan uncommitted di `convex/state.ts` — di-commit sebagai bagian fase ini).

## 7. Endpoint generic (bentuk SaaS)

`POST /ingest/message` dan `POST /ingest/lead` — body = event universal:

```jsonc
// message.event
{ "phone": "628…", "direction": "inbound|outbound", "role": "customer|cs|ai",
  "content": "…", "externalMessageId": "…", "timestamp": 1783427359000,
  "csName": "Azelia?", "messageType": "text" }
// lead.created
{ "phone": "628…", "orderId": "O-…", "csName": "…", "customerName": "…",
  "products": "…", "total": "Rp…", "timestamp": 1783427359000, "source": "…" }
```

Auth: header `X-Wafachat-Source: <sourceKey>` + `X-Wafachat-Signature: t=…,v1=…` (HMAC-SHA256 dengan secret source tsb — skema yang sama dengan yang kita verifikasi dari KirimDev). Onboarding sumber baru = insert row `ingestSources`, tanpa deploy. UI self-serve (gaya Scalev-KirimDev yang jadi acuan) menyusul di Fase 2.

## 8. Monitoring & alerting

Cron `silenceDetector` tiap 5 menit:
- **Silence:** dalam jam operasional (08:00–21:00 WIB) tidak ada `message.event` `processed` selama ≥45 menit → alert.
- **Failure spike:** ≥5 `failed` dalam 15 menit → alert (dengan sampel error).
- Alert = pesan Telegram langsung dari Convex action (`fetch` Bot API; env `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` — reuse bot yang sudah dipakai flow handover). Cooldown 60 menit per jenis alert, state di tabel `alertState` (§3.2).
- Insiden 7 Jul sebagai tolok ukur: buta 4,5 jam → dengan ini terdeteksi ≤45 menit (praktisnya ≤50 menit di kasus terburuk cooldown).

## 9. Rollout — cutover tanpa momen buta

1. **M1 (hari 1-2):** schema + signature + adapter KirimDev + capture/replay + `/webhooks/kirimdev` + tes. Deploy (belum ada traffic).
2. Buat subscription KirimDev **baru** → URL Convex; simpan secret di `ingestSources` dengan `enforceSignature: false` (log-only). **Dual-run** dengan subscription n8n (dedup membuat dobel kiriman aman). Verifikasi konstruksi signature terhadap event live (`signatureOk` harus true konsisten) → flip `enforceSignature: true`.
3. **M2 (hari 2):** silenceDetector + alert Telegram live.
4. **Paritas 2–3 hari:** bandingkan jumlah pesan/closing versi n8n vs Convex per hari (query sederhana atas `ingestEvents` vs `messages.source`). Identik → matikan subscription lama. Field `messages.source` diisi `"ingest"` untuk jalur baru agar paritas terukur.
5. **M3 (hari 3-4):** jalur order — cek Plan A/B, `/webhooks/berdu`, port reconciler ke cron, commit perubahan `state.ts` (preserve createdAt) + test.
6. **M4 (hari 4-5):** endpoint generic `/ingest/*` + dokumentasi singkat kontrak (modal onboarding Fase 2).
7. **Purna:** workflow n8n "KirimDev Message Receiver v2" dinonaktifkan (disimpan 2 minggu → arsip). Reconciler n8n dinonaktifkan setelah cron Convex terbukti. Rollback kapan pun selama transisi = re-enable subscription lama.

## 10. Testing

- **Pure (vitest, tanpa convex-test):** `signature.ts` (vektor uji: secret dummy + payload → hex yang diketahui; skew ±5 mnt; format rusak), `kirimdevAdapter.ts` (fixture = payload asli yang tercapture dari execution log n8n, kedua event type + semua cabang skip), `berduAdapter.ts` (fixture payload Berdu).
- **convex-test:** capture-first (proses dilempar exception → event `failed` + response tetap 200), idempotensi (event sama 2× → 1 message), replay (`failed` → `processed`, `replayOf` terisi), CS lookup via `providerNumberIds` (kasus Nabila 2 nomor), closing detection tetap jalan lewat jalur ingest, guard `requireAdmin` pada replay/sources.
- **Live (sebelum cutover):** test-event KirimDev ke endpoint baru; 1 hari dual-run dibandingkan per-event.

## 11. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Konstruksi signature KirimDev beda dari konvensi Stripe | Diverifikasi terhadap event live di langkah rollout #2; logika terisolasi di `signature.ts`; selama dual-run jalur lama masih hidup. |
| Shape `message.sent` belum pernah dilihat mentah (hanya dari kode mapper n8n) | Dual-run menangkap payload asli ke `ingestEvents.rawBody` → fixture tes diperbarui dari data nyata sebelum cutover. |
| Berdu tidak mendukung 2 webhook (Plan A gagal) | Plan B siap: n8n → Convex direct + reconciler 5 mnt; tetap instant saat sehat. |
| Volume `ingestEvents` | ~ratusan event/hari; retensi 30 hari via cron cleanup; rawBody dicap 256 KB. |
| Convex down (jarang, tapi mungkin) | Vendor retry + dead-letter vendor tetap ada sebagai lapisan terakhir; reconciler menambal order; ini setara/lebih baik dari semua alternatif. |

## 12. Definisi selesai

- KirimDev → Convex live, subscription n8n lama nonaktif, paritas terverifikasi.
- Order mengalir instant + reconciler cron Convex aktif; reconciler n8n nonaktif.
- Silence/failure alert masuk Telegram (diuji dengan simulasi: subscription sengaja di-pause 50 menit di luar jam sibuk).
- Semua tes hijau (vitest + convex-test); `npm run build` hijau.
- VPS n8n dimatikan total selama 1 jam di jam kerja (uji api sesungguhnya): panel tetap menerima pesan & order, alert TIDAK berbunyi (karena memang tidak ada yang putus), notif-order antri/gagal sesuai ekspektasi layanan terpisah.
