# Fase B3 — Tenant Provisioning Core: config per-org + ingest org-dari-source + JWT org-claim + provisioning admin (design)

> Status: APPROVED (Fandy, 2026-07-13 — "Go opsi 1" lalu "go"). Pintu masuk tenant #2.
> Prasyarat LIVE: jalur B tutup (B1 orgId REQUIRED 16 tabel · B2a agents registry ·
> B2b org-isolation penuh — main 16edd6b, prod helpful-spoonbill-863).
> Gate abadi: parity 0 ×3 window tenant #1 + suite hijau (baseline 277 pass + 1 known
> followUp fail) di tiap deploy. Pola fallback in-code terbukti: tabel kosong → default
> in-code → perilaku byte-identik.

## 1. Tujuan & keputusan pemangkas scope

**Tujuan:** org #2 BISA dibuat dan beroperasi terisolasi penuh — provision → webhook
source-key sendiri → data masuk org-nya → login admin-nya → panel hanya lihat org-nya —
tanpa satu pun perubahan perilaku untuk tenant #1.

**Keputusan scope (Fandy, 2026-07-13):**
1. **Admin-provisioned, bukan self-serve.** Belum ada calon tenant #2; Fandy provision
   manual via mutation admin. Wizard self-serve = deferral (saat calon riil ada).
2. **1 akun = 1 org.** Tidak ada multi-org membership/switcher. Operator pakai akun
   terpisah per org bila perlu. JWT ditambah claim `orgId`.
3. **Kredensial Berdu TETAP ENV global (tenant-1-only).** Reconciler + enrich Berdu =
   fitur khusus tenant #1 sampai ada tenant Berdu ke-2. `tenantIntegrations`
   (secret per-org terenkripsi) = deferral, dicatat §14.

## 2. Komponen

### 2.1 Config per-org — `settings` / `orgSettings` / `closingRules`

Ketiga tabel SUDAH punya `orgId` (B1). Yang salah tinggal lookup-nya (global by key):
- `settings.getGlobalAi`/`setGlobalAi` → `by_key(GLOBAL_AI_KEY)` global
- `orgSettings` reader+writer → `by_key("default")` global
- `closingRules.getActiveClosingPhrases` → `by_active(true)` global

**Perubahan (pola B2b: additive index → switch → hapus index lama):**
- Schema: `settings.by_org_key ["orgId","key"]`, `orgSettings.by_org_key ["orgId","key"]`,
  `closingRules.by_org_active ["orgId","active"]`. Setelah switch: hapus `settings.by_key`,
  `orgSettings.by_key`, `closingRules.by_active` (grep 0 pemakai dulu; `dailyStats.by_date`
  dan index global by-design lain TIDAK disentuh).
- Public panel fns → `requireMemberOrg`/`requireAdminOrg` (ganti `requireDefaultOrgId`),
  range `q.eq("orgId", orgId).eq(...)`.
- Helper jalur ingest (`getActiveClosingPhrases(ctx)`, `getInternalPhoneSet(ctx)`) →
  tambah param `orgId` WAJIB (compiler paksa semua call site — pola `isInternalTestPhone`
  Fase A); caller (write cores/rollups) sudah pegang `orgId` sejak B1/B2b.
- **Fallback in-code TETAP:** org tanpa row → default in-code (frasa "PEMESANAN BERHASIL",
  internal phones kosong utk org baru, globalAi default). Tenant baru jalan tanpa seeding;
  tenant #1 byte-identik.

### 2.2 Ingest — org dari `ingestSources`, bukan default

`ingestSources` sudah `{orgId, sourceKey, secret, kind, enabled, enforceSignature}` +
`by_sourceKey` (global by-design — dialah resolver org). Yang salah: `http.ts` hardcode
`"kirimdev-pustakaislam"`/`"berdu-pustakaislam"` dan 3 titik `defaultOrgIdInternal`
(http.ts:67,161,174) yang menganggap semua trafik = org default.

**Perubahan:**
- Route webhook menerima sourceKey **dari URL** (path/query, mis.
  `/webhooks/kirimdev?source=<sourceKey>`) — saat ini TIDAK ada key di request (hardcode
  per route). Kontrak tenant #1 TIDAK berubah: route lama TANPA key = alias tetap ke
  sourceKey tenant-1 existing (URL webhook KirimDev/Berdu yang terdaftar tetap jalan);
  org baru pakai URL ber-key dari provisionOrg.
- Setelah lookup `by_sourceKey`: **`source.orgId` di-thread** ke `processEvent`/write
  cores menggantikan `defaultOrgIdInternal`. Unknown/disabled source tetap **200 ack**
  (trap auto-disable KirimDev sudah ditutup — jangan diregresikan).
- Reconciler (`runReconcile`): loop per source `kind="berdu"` enabled → pakai
  `source.orgId` utk counters/set_order; creds tetap ENV (keputusan §1.3) → efektif
  tenant-1-only sampai tenantIntegrations ada.
- **Route `/n8n/state` TETAP default-org by design** — relay order-notif personal
  tenant #1 (keputusan lama: notif order tidak diproduktisasi). Dicatat §14.

### 2.3 Auth — login per-org + JWT claim `orgId`

- `auth.ts` login (dan pembuatan user CS oleh admin): `orgId` dari **`userRow.orgId`**,
  buang `requireDefaultOrgId` (auth.ts:34,114).
- `lib/auth-jwt.ts` `Session` + `orgId: string`; `signSession` menyertakan claim;
  `verifySession` BACKWARD-COMPATIBLE: token lama tanpa `orgId` → field undefined,
  TIDAK invalid (nol logout massal saat deploy).
- `authz.resolveViewerOrg` prioritas baru:
  1. claim `orgId` di JWT → **divalidasi** terhadap users row (`users.by_email` →
     `userRow.orgId` HARUS sama; beda → THROW, anti claim palsu/stale);
  2. tanpa claim → resolusi existing `users.by_email` → `userRow.orgId`;
  3. admin TANPA users row (token `_admin.mjs`) → fallback `getDefaultOrgId` — semantik
     platform-operator, permanen dan didokumentasikan (bukan lagi "sementara").
  CS tanpa users row tetap THROW (tidak berubah dari B2b).

### 2.4 Provisioning admin (tanpa UI)

`convex/orgs.ts` + mutation **`provisionOrg`** (admin-guarded via `requireAdmin`,
dipanggil lewat `_admin.mjs`):
- Input: `{ slug, orgName, adminEmail, adminPassword, sources: [{ kind, name }] }`.
- Efek (satu mutation Convex = satu transaksi — atomic by construction): insert
  `organizations{slug}`, `orgSettings{key:"default", orgName, internalPhones:[]}`,
  `users{admin, passwordHash pola auth.ts existing, isActive:true}`, per source:
  `ingestSources{sourceKey: "<kind>-<slug>", secret: "whsec_"+random(32B hex),
  enabled:true, enforceSignature:false}` (log-only dulu — pelajaran auto-disable).
- Guard: slug sudah ada → THROW (idempotent-by-rejection, nol partial state karena
  transaksi tunggal); email sudah dipakai user lain → THROW (`users.by_email` global
  = login lookup, email unik lintas org sesuai keputusan 1-akun-1-org).
- Return: `{ orgId, sourceKeys: [{ sourceKey, secret }] }` — secret ditampilkan sekali,
  disimpan plaintext di `ingestSources.secret` (paritas dengan source existing; enkripsi
  = bagian deferral tenantIntegrations).

## 3. Aturan sweep `requireDefaultOrgId` (~50 situs sisa)

Klasifikasi WAJIB per situs (grep + audit satu-satu di plan):
- **PINDAH** — reachable trafik tenant-2: entry ingest (§2.2), panel public fns yang
  masih `requireDefaultOrgId` (audit: mayoritas panel sudah beres di B2b), helper config
  (§2.1), auth (§2.3).
- **TETAP default (keputusan sadar, dicatat di spec/plan + §14):** route `/n8n/state` +
  relay n8n; mutation backfill/migrasi one-time tenant-1 (mis. `backfillFromMessages`,
  import CSV); `ingest/monitor.checkHealth` (infra global); `ingest/sources` register
  CLI lama (digantikan provisionOrg utk org baru, tetap utk maintenance tenant-1).

Definisi selesai sweep: `grep -rn "requireDefaultOrgId\|defaultOrgIdInternal" convex`
→ setiap hit sisa masuk daftar TETAP yang tercatat.

## 4. Testing

- **Test end-to-end org #2 sintetis (definition-of-done, file baru
  `convex/orgProvisioning.test.ts`):** `provisionOrg` → assert semua row tercipta →
  simulasi ingest event dengan sourceKey org-2 (via entry internal yang dipakai route,
  atau `t.run` + core dengan `source.orgId`) → order/message ber-`orgId` org-2 (BUKAN
  default) → login/identity admin org-2 (`withIdentity` email org-2) →
  `getDashboardSummary`/`getCsLeaderboard` hanya data org-2 → org default tidak berubah.
- Unit: `resolveViewerOrg` claim-validation (claim cocok ✓, claim beda users row →
  THROW, tanpa claim → fallback existing — extend `convex/authz.test.ts`);
  `verifySession` token lama tanpa orgId tetap valid (`lib/auth-jwt.test.ts`);
  config fallback (org tanpa row → default; org dengan row → row-nya).
- Suite existing 277+1 known tetap; suite isolasi B2b tetap hijau.
- Gate deploy: parity 0 ×3 window tenant #1 + spot-check panel Fandy + webhook live
  tenant #1 tetap masuk (source lama resolve ke org default via row `ingestSources`-nya).

## 5. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Kontrak webhook tenant #1 berubah → delivery gagal/auto-disable | route baca kunci dari bentuk request existing; unknown source tetap 200 ack; verifikasi live post-deploy |
| JWT claim orgId palsu/stale (user dipindah org) | claim SELALU divalidasi vs users row; beda → THROW |
| Logout massal saat deploy (token lama tanpa claim) | verifySession backward-compatible; fallback resolusi lama |
| provisionOrg partial state | satu mutation Convex = satu transaksi atomic; guard slug/email di awal |
| Config fallback menyembunyikan row org yang salah | test eksplisit: org dengan row pakai row-nya, org tanpa row pakai default |
| Sweep kelewat situs default-org yang reachable tenant-2 | definisi selesai §3: grep final, tiap hit sisa harus masuk daftar TETAP tercatat |

## 6. Non-goals / deferral (dicatat §14)

- `tenantIntegrations` (kredensial Berdu per-org, terenkripsi) + reconciler/enrich
  per-org creds → saat tenant Berdu ke-2 ada.
- Wizard onboarding self-serve + signup flow → saat calon tenant riil.
- Multi-org membership / org-switcher UI → saat kebutuhan riil.
- Cutoff/timezone per-org (re-key `windowKey` rollup) → **B4**.
- Billing/paket → GTM.
- Enkripsi `ingestSources.secret` at-rest → bareng tenantIntegrations.

## 7. Rollout

Subagent-driven (pola B2b), ~6 task + 2 gate controller:
T1 schema index additive + provisionOrg + test provisioning · T2 config per-org switch
(settings/orgSettings/closingRules + helper orgId param) · T3 ingest org-dari-source
(http.ts + reconciler) · T4 auth JWT claim + resolveViewerOrg · T5 sweep sisa
requireDefaultOrgId (klasifikasi §3) · T6 test e2e org #2 sintetis + hapus index config
lama · GATE A (deploy + parity + webhook live) bisa di tengah bila perlu; GATE B final
(deploy + parity ×3 + §14 + merge + push izin).
