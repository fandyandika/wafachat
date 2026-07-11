# Fase B1 — Org Spine: identitas org + pelabelan orgId semua data (design)

> Status: APPROVED (Fandy, 2026-07-11 — "go"; arah B1+B2 dipilih via "Saya ikuti saran
> terbaik kamu saja, just go!"). Bagian pertama dari dekomposisi Fase B
> (B1 org-spine → B2 agents+read-isolation → B3 tenant-integrations → B4 window per-org).
> Zero behavior change: reader TIDAK disentuh; semua hasil query wajib byte-identik.

## 1. Tujuan & non-tujuan

**Tujuan:** semua data WaFaChat terlabel `orgId` dengan jaminan schema-level (required),
tanpa mengubah satu pun hasil query — fondasi yang membuat B2 (agents + read-isolation)
mungkin dan menutup mode gagal paling berbahaya multi-tenant: row tak terlabel yang jadi
invisible saat reader mulai memfilter per-org (undercount senyap).

**Non-tujuan (milik sub-proyek lain, dicatat sebagai deferral §7):** index org-scoped,
read-filtering + test isolasi-baca (B2), entity `agents` (B2), `members`/multi-org login +
claim org di JWT (saat org #2 eksis), lookup `orgSettings` per-org (B3), `tenantIntegrations`
(B3), timezone/cutoff per-org + re-key rollup (B4), UI CRUD organizations (saat org #2).

## 2. Prinsip

1. **Resep yang sudah menang dua kali** (rollup project, Fase A): additive → stamp writes →
   backfill → coverage 0 → BARU kunci enforcement. Tiap langkah reversible, deploy inert.
2. **Reader diubah SEKALI, bukan dua kali:** org-filter + agent-resolution digabung di B2.
   B1 murni data-spine.
3. **Enforcement by construction:** flip `orgId` ke required = (a) Convex schema validation
   menolak deploy bila ada row lama tanpa orgId; (b) convex-test melempar error di tiap
   insert test tanpa orgId → `npx vitest run` menjadi checklist kelengkapan test-side;
   (c) TypeScript menolak insert prod tanpa field. Tiga penjaga otomatis.

## 3. Perubahan

### 3.1 Identitas — tabel `organizations` + helper (module baru `convex/orgs.ts`)

```ts
// schema.ts
organizations: defineTable({
  slug: v.string(),   // "pustakaislam" — stabil, dipakai resolusi default single-tenant
  name: v.string(),   // display, boleh sama dengan orgSettings.orgName
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_slug", ["slug"]),
```

`convex/orgs.ts`:
- `DEFAULT_ORG_SLUG = "pustakaislam"`.
- `getDefaultOrgId(ctx): Promise<Id<"organizations"> | null>` — point-read `by_slug`.
  **Sebelum seed → `null` dan pemanggil MELEWATKAN stamping** (field masih optional →
  deploy inert, zero-downtime). Sesudah seed → selalu resolve.
- `seedDefaultOrg` (mutation, requireAdmin, idempotent) — insert row default; nama diambil
  dari `loadOrgSettings(ctx).orgName`.
- Pasca-flip (§3.4) tersedia `requireDefaultOrgId(ctx)` (throw bila belum seed) untuk
  jalur yang wajib stamp.
- **JWT/session TIDAK berubah** — resolusi org server-side (single-tenant). Claim org
  per-user menyusul saat multi-org login eksis (baris §14).

### 3.2 Stamping — `orgId` di 16 tabel + 56 titik insert produksi

Field `orgId: v.optional(v.id("organizations"))` (→ required di §3.4) ditambahkan ke:
`orders`, `shippingRecaps`, `messages`, `conversations`, `customers`, `events`,
`csConfigs`, `ingestEvents`, `ingestSources`, `dailyRollups`, `responseSamples`,
`alertState`, `settings`, `closingRules`, `orgSettings`, `users`.

**Dikecualikan:** `dailyStats` (tabel RETIRED sejak dashboard 1A; writes sudah no-op) —
tidak dimigrasi; dicatat sebagai kandidat drop terpisah. `organizations` sendiri tentu tanpa orgId.

Titik insert produksi (56, per grep 2026-07-11): state.ts×15, shippingRecaps.ts×13,
messages.ts×9, settings.ts×2, rollups.ts×2, orgSettings.ts×2, ingest/core.ts×2,
followUp.ts×2, auth.ts×2, ingest/sources.ts×1, ingest/monitor.ts×1, ingest/events.ts×1,
events.ts×1, csConfigs.ts×1, cs.ts×1, closingRules.ts×1. Tiap handler/helper me-resolve
orgId SEKALI lalu meneruskan (pola `getInternalPhoneSet` Fase A).

**Jalur ingest (aliran orgId):** `ingestSources` row diberi orgId (seed) →
`captureEvent` menyalin `source.orgId` ke event → `processEvent` meneruskan ke
`upsertOrderCore`/`appendMessageCore`/`upsertRecapFromMessage`. Route generic
(`/ingest/*`) sama (resolve via source). Route legacy `/n8n/state` → `getDefaultOrgId`.
Cron (reconciler, followUp, lifecycle, trueUp) → `getDefaultOrgId`.

**Patch-sites tidak diubah** — orgId ditetapkan saat insert; row lama ditangani backfill.

### 3.3 Backfill + coverage

- `orgs.backfillOrgId` (mutation admin, bounded): args `{ table, limit }`, scan row
  `orgId === undefined` → patch dengan default orgId; return `{ patched, done }`
  (preseden `rollups.backfillCsKey`).
- `orgs.orgIdCoverage` (query admin): count row tanpa orgId per tabel.
- Volume kasar: orders ~8k, recaps ~4k, messages ~ratusan ribu, ingestEvents ~±138k
  (retensi 30 hari), sisanya kecil. Loop script `_admin.mjs` chunk 500; **one-time Usage
  spike diharapkan dan didokumentasikan** (preseden backfill rollup 183MB).

### 3.4 Kunci enforcement — flip required

Setelah `orgIdCoverage` = 0 di SEMUA tabel:
- Schema: `orgId: v.id("organizations")` (non-optional) di 16 tabel — **satu flip**;
  fallback staged per-batch tabel hanya bila deploy validation menemukan sisa row
  (kejadiannya = bug backfill, harus dibereskan, bukan dibiarkan).
- `getDefaultOrgId` callers di write-path pindah ke `requireDefaultOrgId`.
- **Test sweep:** ~291 insert di file test (terkonsentrasi di seed helper per file) diberi
  orgId — tiap file test membuat org via helper test bersama (mis. `seedTestOrg(t)` di
  util test) lalu menyisipkan `orgId` di object seed. Mekanis; convex-test schema
  validation membuat setiap yang terlewat GAGAL KERAS di vitest.

### 3.5 Verifikasi (urut, semua wajib lulus)

1. Pasca-M2 (stamping live): row BARU (order+message berikutnya) membawa orgId benar.
2. Pasca-M3 (backfill): `orgIdCoverage` = 0 × 16 tabel.
3. Pasca-M4 (flip): deploy sukses (validasi server-side seluruh tabel) +
   `debugRollupParity` 0 mismatch (reader tak berubah → identik) + suite hijau
   (kecuali 1 pre-existing followUp fail) + order/message live tetap mengalir.

## 4. Rollout (milestone; controller deploy di tiap gate)

- **M1**: organizations + seed + helper + field optional 16 tabel → deploy (inert,
  tabel org kosong → stamping skip) → seed org → verifikasi row baru mulai terstamp
  bertahap saat M2 mendarat.
- **M2**: stamp 56 titik insert + ingestSources.orgId + threading ingest → deploy →
  verifikasi §3.5.1.
- **M3**: backfill scripted → coverage 0.
- **M4**: flip required + test sweep + §14 ledger → deploy (gate validasi) → §3.5.3.

Urutan M1→M2 boleh digabung satu deploy (stamping dengan `getDefaultOrgId` null-tolerant
aman sebelum seed); M4 WAJIB terpisah dan terakhir.

## 5. Testing

- Unit orgs: seed idempotent, getDefaultOrgId null-sebelum-seed/resolve-sesudah,
  backfill bounded+idempotent, coverage query.
- Ingest: event dari source ber-orgId → order/message/recap terstamp orgId sama;
  event dari source tanpa orgId (pra-seed) → tetap terproses (optional).
- Existing 253 test: hijau di M1-M3 tanpa perubahan; M4 = sweep seed test (mekanis).
- Regression utama: parity rollup + hasil panel identik (reader untouched).

## 6. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Titik insert terlewat saat M2 (field optional = tak ada paksaan compiler) | coverage query per tabel dipantau pasca-M2 (angka missing per tabel HARUS berhenti tumbuh utk row baru); flip M4 = penjaga permanen |
| Backfill tabel besar (messages/ingestEvents) timeout | bounded per-call (limit 500) + loop script; ingestEvents boleh menunggu retensi 30 hari menghanguskan sisa lama bila perlu (flip ditunda sampai 0) |
| Flip gagal deploy karena sisa row | itu FITUR (gate) — jalankan coverage, backfill sisa, ulangi |
| Churn 291 insert test | mekanis + convex-test loud-fail per titik; dikerjakan subagent dengan pola seed-helper |

## 7. Deferral tercatat (masuk §14 ledger saat B1 selesai)

| Item | Kenapa ditunda | Kapan |
|---|---|---|
| Index org-scoped | bentuk index ditentukan pola baca reader B2; menambah sekarang = write-amp tanpa konsumen | B2, per-index saat reader butuh |
| Read-filtering + test isolasi-baca | reader diubah sekali bareng agent-resolution | B2 |
| `members` + claim org di JWT + multi-org login | belum ada org #2 / user multi-org | saat org #2 (B3-era) |
| `orgSettings`/`closingRules`/`settings` lookup per-org | masih single row default; field orgId sudah terpasang | B3 |
| Drop tabel `dailyStats` (retired) | kerja tak terkait B1 | housekeeping terpisah |
