# Fase A — orgSettings: cabut hardcode pustakaislam → config-from-DB (design)

> Status: APPROVED (Fandy, 2026-07-11 — "go"). Single-tenant tetap (Fandy = tenant #1),
> tapi tiap config pindah dari hardcode ke tabel sehingga tenant lain nantinya cukup
> punya row sendiri — tanpa ubah kode. Melunasi 3 baris debt ledger SAAS-BLUEPRINT §14.

## 1. Masalah

Tiga config tenant masih hardcoded di kode (sisanya di §14 sudah table-driven atau
sengaja ditunda, lihat §6):

| Hardcode | Lokasi | Dipakai oleh |
|---|---|---|
| `INTERNAL_TEST_PHONES` (9 nomor: owner/admin/CS lines) | `convex/lib.ts:31-41` | `isInternalTestPhone` — ~48 call site di 7 file produksi (analytics, metrics, rollups, rollupReaders, responseTime, shippingRecaps, followUp) |
| `BERDU_STAFF_MAP` (staffId Berdu → nama CS, 5 CS) | `convex/ingest/berduAdapter.ts:17-23` | `parseBerduOrderDetail` (attribution order → CS), dipanggil `core.ts:52` |
| Identitas org (nama) | tidak ada sama sekali | — (anchor Fase B) |

Konsekuensi hari ini: ganti nomor CS / tambah CS di Berdu = edit kode + deploy.
Konsekuensi SaaS: tenant lain mustahil tanpa fork kode.

## 2. Prinsip desain

1. **Pola fallback yang sudah terbukti di repo ini** — `getActiveClosingPhrases()`
   (closingRules.ts): baca tabel, fallback ke default in-code saat tabel kosong.
   Efek: deploy = zero behavior change (tabel kosong → fallback = nilai sekarang);
   dev/test env jalan tanpa seeding; seed = tabel take over.
2. **Dua rumah, bukan satu:** config org-level → tabel baru `orgSettings`;
   atribut per-CS → field baru di `csConfigs` yang sudah ada (proto-`agents`:
   sudah punya providerNumberIds + admin UI Settings→Tim). Staff ID Berdu itu
   atribut per-CS → csConfigs, sejalur target §10.3 `agentAliases`.
3. **Konsistensi metrik dijaga compiler.** `isInternalTestPhone` ganti signature
   dengan param WAJIB — TypeScript memaksa semua ~48 call site diperbarui; mustahil
   ada reader/writer yang diam-diam pakai set beda (drift parity).
4. **Aturan universal tetap di kode.** Group-JID heuristic (`length > 15`) bukan
   config tenant — tidak pindah ke DB.

## 3. Perubahan

### 3.1 Tabel `orgSettings` + module `convex/orgSettings.ts` (baru)

```ts
// schema.ts
orgSettings: defineTable({
  key: v.string(),                      // "default" — single-tenant anchor; Fase B: lookup per-org
  orgName: v.string(),                  // "Pustaka Islam"
  internalPhones: v.array(v.string()),  // normalized (62…) — pindahan INTERNAL_TEST_PHONES
  updatedAt: v.number(),
}).index("by_key", ["key"])
```

`convex/orgSettings.ts`:
- `DEFAULT_ORG_SETTINGS` in-code = nilai hardcode sekarang (fallback dev/test).
- `loadOrgSettings(ctx)` → point-read `by_key("default")`; row ?? DEFAULT. (+1 point-read
  per handler yang butuh — trivial vs anggaran I/O.)
- `getInternalPhoneSet(ctx): Promise<ReadonlySet<string>>` — helper turunan yang
  dipakai semua handler metrik.
- `get` (query, requireAdmin) / `update` (mutation, requireAdmin, partial patch) /
  `seedDefault` (mutation, requireAdmin, idempotent — no-op kalau row sudah ada).

### 3.2 `isInternalTestPhone` → config-driven (sweep terlebar)

- `convex/lib.ts`: signature jadi
  `isInternalTestPhone(value: string | undefined, internalPhones: ReadonlySet<string>): boolean`
  — param **wajib**. Set hardcode `INTERNAL_TEST_PHONES` pindah ke
  `DEFAULT_ORG_SETTINGS.internalPhones` di orgSettings.ts (lib.ts tidak lagi punya
  daftar nomor). Group-JID rule tetap di fungsi.
- Tiap query/mutation handler yang memfilter: load sekali di atas
  (`const phones = await getInternalPhoneSet(ctx)`), pass down ke helper murni /
  callback filter. Berlaku ke SEMUA jalur: rollup writer (`computeRollupValues`),
  rollup readers, raw/legacy readers, responseTime, followUp, shippingRecaps —
  compiler yang menjamin kelengkapan.
- Test existing lulus tanpa seeding (fallback = set yang sama). `lib.test.ts`
  menyesuaikan signature (pass set eksplisit).

### 3.3 `BERDU_STAFF_MAP` → `csConfigs.berduStaffIds`

- `schema.ts`: `csConfigs` + `berduStaffIds: v.optional(v.array(v.string()))`
  (array — preseden providerNumberIds/Nabila 2 nomor).
- `berduAdapter.ts`: `parseBerduOrderDetail(raw, staffMap: Record<string, string>)`
  — map di-inject caller, adapter tetap pure/testable. Baked map lama jadi
  `DEFAULT_BERDU_STAFF_MAP` (fallback).
- `core.ts`: sebelum parse, build map dari csConfigs (pola cermin
  `resolveCsByPhoneNumberId` di core.ts:11): scan csConfigs yang punya
  `berduStaffIds`, hasilkan `{staffId → csName}`; kalau TIDAK ada satu pun csConfig
  ber-staffIds → pakai `DEFAULT_BERDU_STAFF_MAP` (masa transisi, sebelum seed).
- Reconciler path (`ingest/reconciler.ts` → captureEvent → processEvent) otomatis
  ikut — dia lewat processEvent yang sama.

### 3.4 UI Settings (minimal, komponen existing)

- Settings → section "Organisasi": nama org (text) + daftar nomor internal
  (add/remove, tampil ternormalisasi). Backed by `orgSettings.get`/`update`.
- Settings → Tim (kartu CS): input "Berdu Staff ID(s)" per CS → patch
  `csConfigs.berduStaffIds`.

## 4. Rollout (tiap langkah reversible, zero-downtime)

1. Deploy schema + module + sweep call site. Tabel kosong → fallback → perilaku
   identik. Gate: `npm run build` + `npx tsc --noEmit -p convex` + `npx vitest run`
   + `npx convex deploy -y`.
2. Seed prod via `_admin.mjs`: `orgSettings.seedDefault` + patch `berduStaffIds`
   5 CS (`B-1apQSy`→Aisyah, `B-1CxSmL`→Risma, `B-Z28TdYc`→Azelia, `B-NCIXt`→Lila,
   `B-ZDfQE9`→Nabila).
3. Verifikasi: (a) `debugRollupParity` 0 mismatch (set nomor identik → nol
   pergeseran metrik); (b) order Berdu live berikutnya ter-attribute CS benar;
   (c) edit nomor internal via UI → kebaca query (spot-check).
4. Update SAAS-BLUEPRINT §14: baris "Nomor internal/test" + "BERDU_STAFF_MAP" +
   "identitas org" → LUNAS; catat deferral §6.

## 5. Testing

- Unit baru: loader fallback (tabel kosong → DEFAULT), seedDefault idempotent,
  staff-map resolver (registry → map; registry kosong → baked default),
  `isInternalTestPhone` dengan set eksplisit (termasuk group-JID rule).
- Existing 246 test: hijau tanpa perubahan perilaku; hanya penyesuaian signature.
- Parity: `debugRollupParity` pra & pasca seed di prod.

## 6. Sengaja DITUNDA (keputusan sadar, bukan lupa)

| Item | Alasan tunda | Kapan |
|---|---|---|
| Cutoff 16:00 + timezone per-org | Kunci `windowKey` semua `dailyRollups` — configurable cutoff butuh strategi re-key/migrasi rollup sendiri | Fase B (bareng orgId, rollup toh di-re-key per org) |
| Source key `*-pustakaislam` (http.ts:206,252) | Sudah registry-driven (`ingestSources`); resolusi org-dari-key butuh org table; tenant ke-2 belum bisa eksis | Fase B |
| `PRODUCT_ALIASES` editable | Alias = kunci grouping byProduct rollup; editable runtime = jendela drift increment-vs-trueUp; katalog stabil → nilai rendah, risiko medium | Saat katalog churn / Fase B |

## 7. Non-goals

- Tanpa `orgId` di tabel data (Fase B). `orgSettings.key="default"` = anchor-nya.
- Tanpa perubahan logika metrik/rollup apa pun — murni "dari mana config dibaca".
- Tanpa wizard onboarding (§11) — UI minimal untuk owner existing saja.
