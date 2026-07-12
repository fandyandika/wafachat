# Fase B2b — Org-Isolation: dedup-scoping + reader org-filter + test isolasi (design)

> Status: APPROVED (Fandy, 2026-07-13 — "Go"; arah via "go now, B2B"). Penutup jalur B.
> Prasyarat LIVE: B1 (orgId REQUIRED di 16 tabel, organizations, users.orgId) + B2a
> (agents registry, resolveAgent). Gate abadi: parity 0 + suite hijau di tiap deploy —
> dengan org tunggal, index org-scoped atas orgId konstan ≡ index lama → byte-identik.

## 1. Tujuan & ancaman yang ditutup

**Tujuan:** tenant #2 aman secara **correctness** (dedup tak bisa nyilang org) dan
**privasi** (reader hanya melihat org-nya), dibuktikan test isolasi 2-org.

**Ancaman utama (temuan eksplorasi B2):** 54 site lookup unique-key
(`by_orderId`, `by_customerPhone`, `by_orderIdBerdu`, `by_normalizedName`,
`by_externalMessageId`, `by_phone`) berjalan TANPA scope org. `O-`id Berdu bisa
tabrakan antar tenant → `upsertOrderCore` tenant B menemukan row tenant A →
**PATCH MENIMPA data tenant lain**. Ini bug correctness, bukan sekadar privasi —
karena itu write-path di-scope DULUAN sebelum reader.

## 2. Keputusan desain

### 2.1 Resolusi org dari VIEWER — lookup server-side, JWT tak disentuh

JWT saat ini membawa `{role, name, email, csName}` tanpa orgId, dan `getViewer`
(authz.ts) murni claim-based. Keputusan: **JANGAN ubah rantai JWT/Next** (sudah
diverifikasi susah-payah di Fase 0). authz.ts mendapat:

```ts
export type ViewerOrg = { viewer: Viewer; orgId: Id<"organizations"> };
export async function requireMemberOrg(ctx, fn): Promise<ViewerOrg>
export async function requireAdminOrg(ctx, fn): Promise<ViewerOrg>
```

Implementasi: `requireMember/Admin` existing → lookup `users.by_email(viewer.email)`
→ `orgId` (REQUIRED post-B1, selalu ada). **Fallback admin-tanpa-row-users** (token
`_admin.mjs` / platform-operator): `getDefaultOrgId` — dicatat sebagai semantik
single-tenant, direvisi saat multi-org login (B3). Biaya: +1 point-read per call.
Test isolasi jadi bisa mengekspresikan "query sebagai user org B" via
`withIdentity({email})` + seed users row per org.

### 2.2 Dua aturan scoping (seragam di seluruh sweep)

1. **Viewer-driven** — public query/mutation panel: `const { orgId } = await
   requireMemberOrg(ctx, fn)` → semua range/lookup di handler pakai orgId itu.
2. **Data-driven** — helper internal & cron yang MENGIKUTI REFERENSI dari doc yang
   sudah dipegang (mis. conversation → recap via orderIdBerdu; order → conversation
   via phone): scope pakai **`doc.orgId`** milik doc tersebut, BUKAN viewer/default.
   Menutup vektor tabrakan di jalur tanpa viewer (cron/ingest) secara alami.

**Index ber-key Convex `_id`** (`by_conversation_createdAt`, dsb.) TIDAK diubah —
Id global unik, mustahil nyilang org. Ini mengecilkan sweep signifikan.

### 2.3 Index: tambah → switch → HAPUS yang lama

±20 index org-prefixed baru (nol migrasi data — orgId sudah ada; index dibangun
otomatis saat deploy):

| Tabel | Index baru (org-scoped) |
|---|---|
| orders | by_org_orderId, by_org_customerPhone, by_org_createdAt, by_org_csKey_createdAt (+varian assignedCsName/aiEligible HANYA bila grep menunjukkan pemakai) |
| conversations | by_org_orderId, by_org_status_updatedAt, by_org_customerPhone_updatedAt (+assignedCsName_status bila dipakai) |
| customers | by_org_phone |
| messages | by_org_createdAt, by_org_externalMessageId (+customerPhone/orderId_createdAt bila dipakai) |
| events | by_org_createdAt, by_org_type_createdAt |
| shippingRecaps | by_org_orderIdBerdu, by_org_customerPhone, by_org_closedAt, by_org_status_closedAt, by_org_csKey_closedAt (+csName/paymentMethod bila dipakai) |
| dailyRollups | by_org_window_cs, by_org_windowKey |
| responseSamples | by_org_createdAt, by_org_cs_createdAt |
| csConfigs | by_org_normalizedName (+by_org_active bila dipakai; by_org_key sudah ada dari B2a) |

Setelah SEMUA kode pindah (grep-verified nol pemakai): **index unscoped lama pada
tabel data DIHAPUS** dari schema (write-amp netral jangka panjang). Convex deploy
menghapusnya dengan konfirmasi `-y`.

**Tetap GLOBAL by-design:** `users.by_email` (login), `ingestSources.by_sourceKey`
(dialah resolver org), `organizations.by_slug`, infra ingest (`ingestEvents.*`,
`alertState`), `settings`/`orgSettings`/`closingRules` per-org lookup = deferral B3,
`dailyStats` (retired; drop tabel = housekeeping terpisah).

### 2.4 Cron per-org loop

`autoFollowUpSweep`, `cronArchiveSweep` (lifecycle), `trueUp` rollup: bungkus badan
per-org — `for (org of await ctx.db.query("organizations").collect())` → jalankan
logika dengan orgId itu (index org-scoped). 1 org sekarang = perilaku identik,
multi-tenant-ready. `runReconcile` sudah per-source (source ber-orgId — B1).
`checkHealth` monitor: global (infra) — tak diubah.

### 2.5 Hapus `*Legacy` internalQueries (backlog jatuh tempo)

Fallback reader `*Legacy` (analytics/metrics/responseTime/followUp/shippingRecaps —
sisa rollup project, post-soak sudah lama lewat) DIHAPUS: (a) sudah diverifikasi
`debugRollupParity` TIDAK memakainya (dia recompute fresh dari tabel mentah);
(b) mereka memakai index lama yang akan dicabut. Hapus SEBELUM pencabutan index.
Helper `compute*Raw` yang masih dipakai jalur live (mode raw "hari ini") TETAP —
hanya wrapper `*Legacy` yang unused yang mati; `compute*Raw` ikut di-org-scope
di sweep reader.

### 2.6 Test isolasi 2-org = test #1

File baru `convex/orgIsolation.test.ts`: seed org A + org B lengkap (users,
csConfigs/agents, orders/recaps/messages/conversations paralel, **orderId & phone
SAMA di kedua org**), lalu buktikan:
- **Dedup terpisah:** upsertOrderCore orderId "O-X" di A dan B → 2 row, masing-masing
  orgId benar; patch B tak menyentuh row A. Sama utk recap (orderIdBerdu) & message
  (externalMessageId) & conversation (orderId/phone).
- **Reader ter-scope:** sebagai user org A (withIdentity email A):
  getDashboardSummary/getDailyReport/getCsLeaderboard/getResponseTimes/
  listConversations/rollup readers → HANYA data A (angka = seed A, nol kebocoran B).
- **Rollup ter-scope:** recompute/bump per org tak saling menghitung.

## 3. Rollout (subagent-driven; controller deploy di 2 gate)

- **T1** authz `requireMemberOrg`/`requireAdminOrg` + fallback admin + unit tests.
- **T2** schema: ±20 index org-scoped (ADDITIVE — deploy inert).
- **T3** WRITE-path dedup scoping — 54 unique-key sites, aturan §2.2 + test tabrakan
  (inti correctness).
- **T4** reader sweep gel. 1: rollup engine + rollupReaders + analytics + metrics +
  responseTime (+compute*Raw).
- **T5** reader sweep gel. 2: state, shippingRecaps, followUp, conversationLifecycle,
  autoFollowUp, cs, messages, events + cron per-org loop.
- **GATE A** deploy → parity 0 ×3 window → live order+message normal → panel normal.
- **T6** `convex/orgIsolation.test.ts` (suite §2.6) + hapus `*Legacy`.
- **T7** hapus index unscoped lama (grep-verified nol pemakai per index) + tsc/suite.
- **GATE B** deploy (index removal) → parity 0 ×3 → §14 ledger (baris "isolasi" &
  index & Legacy) → merge ff → push (izin eksplisit).

## 4. Testing

- Unit authz-org (member/admin/fallback). Test tabrakan dedup per tabel (T3).
- Suite isolasi 2-org end-to-end (T6) = definisi selesai jalur B.
- Existing 270 test: hijau tanpa perubahan nilai (org tunggal → hasil identik);
  penyesuaian test hanya SEED (users row utk viewer-org bila test memanggil public
  query — mayoritas test pakai withIdentity admin TANPA users row → fallback default
  org → tetap jalan; catat di plan).
- Parity 0 ×3 window di GATE A dan GATE B. 1 known pre-existing followUp fail tetap.

## 5. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Salah range di index swap (semantik query berubah) | aturan mekanis `q.eq("orgId", orgId).eq/gte(...)` prefix di depan, sisanya identik; parity + suite hijau per task |
| Site kelewat saat switch → masih pakai index lama | T7 = grep per-nama-index sebelum hapus; deploy gagal typecheck kalau index hilang masih direferensikan (Convex validasi nama index saat push) |
| Fallback admin default-org menutupi bug resolusi viewer | test T1 eksplisit: user CS org B TIDAK jatuh ke default; fallback hanya utk admin tanpa users row |
| Cron per-org mengubah timing | 1 org = 1 iterasi = perilaku identik; test cron existing tetap hijau |

## 6. Non-goals / deferral

- Per-org lookup `settings`/`orgSettings`/`closingRules` + `tenantIntegrations` +
  source-key per-org onboarding + members/JWT-org-claim/multi-org login → **B3**.
- Cutoff/timezone per-org (re-key windowKey rollup) → **B4**.
- Drop tabel `dailyStats` (retired) → housekeeping terpisah.
- UI org-switcher/manajemen org → saat org #2 riil.
