# Fase B2a — Agents: identitas CS ber-registry + resolusi alias saat-tulis (design)

> Status: APPROVED (Fandy, 2026-07-12 — "Go B2" + "ok what is the next step?" atas desain
> yang dipresentasikan). Bagian pertama dari dekomposisi B2 (B2a agents SEKARANG →
> B2b org-isolation SIKLUS BERIKUT). Prasyarat: B1 org-spine LIVE (orgId REQUIRED 16 tabel).
> Zero behavior change untuk 5 CS existing; parity 0 tetap gate.

## 1. Masalah & keputusan arsitektur utama

**Masalah.** Identitas CS hari ini = string nama yang dinormalisasi saat dipakai:
- Row data (orders/recaps/samples) menyimpan nama mentah + `csKey` hasil normalisasi
  nama itu. Varian nama baru yang tak dikenal → csKey baru → **CS hantu** (bug
  fragmentasi yang pernah terjadi: "CS Aisyah" vs "Aisyah").
- `csConfigs` (registry de-facto) punya DUA skema kunci paralel: `normalizedName`
  (`normalizeCsName`, "csaisyah") untuk lookup admin vs `csKey` ("aisyah") untuk
  grouping analytics.
- **Rename nyata tidak aman**: `renameCs` cosmetic hanya aman untuk varian nama yang
  csKey-nya sama ("CS Aisyah"→"Aisyah"). Rename beda nama ("Aisyah"→"Ayesha") akan
  mengubah csKey(nama) → data terbelah dua.

**Keputusan utama: TIDAK re-key data ke `agentId` — row tetap membawa `csKey` kanonik.**
Fragmentasi adalah bug SAAT-TULIS (normalisasi string mentah), bukan bug identitas.
Solusi: resolusi alias di SEMUA pintu masuk tulis → row distamp nama+key kanonik dari
registry. Konsekuensi yang dibeli dengan keputusan ini:
- NOL migrasi 218k row, NOL re-key `dailyRollups` (tetap `(windowKey, csKey)`),
  NOL perubahan FE (Queen/Arena/panel semua group by csKey).
- Agent tetap punya `_id` Convex yang stabil (untuk FK masa depan bila perlu) dan
  `key` per-org yang stabil (rename hanya mengubah display name).
- Blueprint §10.3 ("agents ber-ID stabil + alias resolver") terpenuhi secara substansi;
  "row membawa key kanonik, bukan Id" dicatat sebagai keputusan sadar di §14 ledger.

**Keputusan kedua: `csConfigs` ADALAH tabel agents — tidak di-rename.** Rename tabel di
Convex = tabel baru + copy data + sweep kode, churn tanpa manfaat perilaku. Konsep agents
hadir sebagai module `convex/agents.ts`; nama fisik tabel tetap `csConfigs` (tidak
user-visible). Dicatat di ledger sebagai cosmetic-deferral.

## 2. Perubahan

### 2.1 Schema — `csConfigs` menjadi registry agent penuh

Field baru:
```ts
    key: v.optional(v.string()),          // kunci identitas KANONIK per-org (= csKey(csName) saat dibuat; IMMUTABLE saat rename)
    nameAliases: v.optional(v.array(v.string())), // bentuk nama mentah yang me-resolve ke agent ini (mis. "CS Aisyah")
```
Index baru: `.index("by_org_key", ["orgId", "key"])`.

`key` optional dulu (pola B1) → backfill 5 row (`key = csKey(csName)`) → flip required
TIDAK diperlukan di B2a (tabel kecil, resolver menoleransi via fallback; flip ikut B2b
bila mau). `normalizedName` DIPERTAHANKAN untuk lookup admin existing (by_normalizedName)
— dualitas selesai karena `key` menjadi satu-satunya kunci IDENTITAS; normalizedName
tinggal alat lookup nama.

### 2.2 Module `convex/agents.ts` — satu resolver untuk semua pintu tulis

```ts
export type ResolvedAgent = { key: string; csName: string; agentId: Id<"csConfigs"> } | null;

// SATU pintu resolusi identitas CS. Prioritas: alias eksplisit > kunci kanonik.
// null = tak dikenal → pemanggil pakai fallback perilaku lama (store raw + csKey(raw))
// — sekaligus mekanisme DISCOVERY: CS/staff baru muncul apa adanya di panel.
export async function resolveAgent(ctx, args: {
  name?: string;            // bentuk nama mentah (import CSV, manual, legacy)
  berduStaffId?: string;    // dari webhook order Berdu
  phoneNumberId?: string;   // dari webhook message KirimDev
}): Promise<ResolvedAgent>
```
Implementasi: baca csConfigs org (tabel kecil ~6 row, collect — pola
`resolveCsByPhoneNumberId` existing), cocokkan berurutan: `phoneNumberId` ∈
providerNumberIds/providerNumberId → `berduStaffId` ∈ berduStaffIds → `name`:
persis == `csName` saat-ini (case-insensitive trim; WAJIB — pasca-rename csKey(namaBaru)
≠ key, hanya csName-match yang mengembalikan key lama) ATAU persis ∈ nameAliases ATAU
`csKey(name) == key`. Kembalikan key+csName kanonik agent.

`resolveCsByPhoneNumberId` dan `resolveBerduStaffMap` (ingest/core.ts) menjadi
pemakai/alias tipis dari resolveAgent (atau digantikan langsung) — SATU sumber logika.

### 2.3 Pintu masuk tulis — semua stamping nama lewat resolver

| Pintu | Hari ini | Menjadi |
|---|---|---|
| `processCapturedEvent` message.event | `resolveCsByPhoneNumberId` → csName mentah | `resolveAgent({phoneNumberId})` → csName+key kanonik |
| `processCapturedEvent` lead.created | `resolveBerduStaffMap` → map staffId→nama | `resolveAgent({berduStaffId})`; fallback `DEFAULT_BERDU_STAFF_MAP` tetap (pra-seed) |
| `upsertOrderCore` / `appendMessageCore` / `upsertRecapFromMessage` | terima csName string, stamp `csKey(csName)` | terima csName DAN key hasil resolver (param opsional `csKeyResolved?`); tanpa resolver-hit → perilaku lama persis |
| `importBerduVerifiedRows` (CSV) | nama mentah → csKey(mentah) | `resolveAgent({name})` per row; miss → lama |
| Mutation manual (manual closing, backfillCsNameByOrderIds, createTestConversation) | nama dari UI (sudah kanonik) | lewat resolver juga (murah, konsisten) |

**Invariant:** untuk 5 CS existing, output resolver == hasil normalisasi lama —
key == csKey(csName), dan jalur staffMap/phoneNumberId memang sudah emit nama kanonik
→ resolver hit via key-match tanpa perlu alias (nameAliases mulai kosong, diisi untuk
varian MENDATANG/rename) → **byte-identik**, parity 0.

### 2.4 Rename aman (perubahan perilaku yang DIINGINKAN)

`renameCs` diubah: patch `csName` (+`normalizedName`) TAPI `key` TETAP; nama lama otomatis
masuk `nameAliases`. Efek: rename apa pun ("Aisyah"→"Ayesha") tidak membelah data — row
baru tetap key "aisyah", display name baru. Catatan jujur: display di laporan memakai
raw-name dominan per key (perilaku existing) → sesudah rename, tampilan berangsur pindah
ke nama baru seiring data baru masuk; `listCs`/Settings langsung menampilkan nama baru.
(Unifikasi display instan = tweak read-side kecil, DITUNDA — bukan identitas.)

### 2.5 UI Settings (minor)

Kartu CS (Settings→Tim): tampilkan `key` (read-only, kecil) + field **Alias nama**
(comma-separated → patch `nameAliases`) di samping Berdu Staff ID existing. Pola persis
`BerduStaffIdsField` Fase A.

### 2.6 Seed & backfill (trivial)

Mutation `agents.seedKeys` (admin, idempotent): untuk tiap csConfigs row tanpa `key` →
`key = csKey(csName)`; nameAliases awal = []. 5-6 row. Tidak perlu cursor-paging.

## 3. Rollout

1. Deploy schema+module+resolver-wiring (resolver miss → fallback lama → inert pra-seed).
2. `agents.seedKeys` di prod (5 CS dapat key).
3. Verifikasi: order+message live berikutnya ter-attribute kanonik (sama seperti kemarin);
   `debugRollupParity` 0×3 window; test rename di UI (nama berubah, key tetap, laporan
   tidak membelah).

## 4. Testing

- Unit resolveAgent: hit by phoneNumberId / berduStaffId / nameAlias / csKey-match;
  miss → null; prioritas benar; case-insensitive.
- Regression: pipeline ingest end-to-end menghasilkan row byte-identik dgn sebelum
  (5 CS existing).
- Rename: rename agent → row baru tetap key lama + nameAliases berisi nama lama;
  getDailyReport tidak menghasilkan kartu ganda.
- Parity: debugRollupParity 0.
- Baseline: 259 test (258 pass + 1 known followUp fail — jangan disentuh).

## 5. B2b (siklus berikutnya — TERCATAT, bukan sekarang)

Org-isolation penuh, spec+plan sendiri: (a) **dedup-key scoping DULU** — temuan kritis:
`by_orderId`/`by_customerPhone`/`by_normalizedName` lookups tanpa scope org → order
tenant B bisa MENIMPA row tenant A (O-id Berdu bisa tabrakan antar tenant). Correctness,
bukan cuma privasi; (b) reader org-filter + index org-scoped (167 titik withIndex; index
murah — orgId sudah di semua row, tinggal definisi); (c) test isolasi 2-org = test #1;
(d) flip `csConfigs.key` required bila belum. Pola cursor-paged B1 dipakai bila ada
migrasi; parity 0 gate.

## 6. Non-goals B2a

- Tanpa `agentId` di row data (keputusan §1). Tanpa rename tabel csConfigs. Tanpa
  org-filter reader (B2b). Tanpa tabel `agentAliases` terpisah (embedded arrays — YAGNI,
  cukup sampai ada kebutuhan cross-source yang kompleks). Tanpa unifikasi display-name
  instan pasca-rename (§2.4). Tanpa perubahan rollup engine/FE.
