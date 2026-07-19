# WaFaChat — SaaS Blueprint

> Dokumen produk & arsitektur untuk transformasi WaFaChat dari tool internal (pustakaislam.net)
> menjadi SaaS komersial. Disusun 2026-07-07. Pemilik: Fandy. Status: draft untuk eksekusi.
>
> Berisi: positioning, keputusan build-vs-rebuild, arsitektur target, daftar perbaikan,
> roadmap berfase, pricing, go-to-market, risiko, outline pitch deck, dan brief developer.

---

## 1. Positioning

**Satu kalimat:** *Papan skor & pusat kendali tim CS WhatsApp — supaya owner tahu persis
performa tiap CS, dan tiap CS terpacu jadi lebih baik.*

**Kategori:** CS Performance Monitoring untuk bisnis WhatsApp-first di Indonesia.

**Yang BUKAN kita** (pasar crowded, hindari):
- WhatsApp automation / anti-banned / auto-reply murah
- Omnichannel shared inbox (Qontak, SleekFlow, Qiscus — bermodal besar, perang fitur inbox)
- BSP / penyedia WhatsApp API (compliance berat, arms race anti-ban)

**Yang KITA:** satu-satunya *scoreboard*. Masalah yang diselesaikan: **CS sulit dikontrol** —
bawa HP pulang, owner cuma lihat hasil akhir, tidak tahu siapa cepat/lambat, siapa closing
karena skill vs karena kebagian leads banyak. Bukti internal: setelah tim CS bisa melihat
papan skornya sendiri (Arena), CR tim naik ke 60–70%.

**Pengguna:**
- **Owner/SPV** — melihat semua: leaderboard, CR, kecepatan respon, SLA, omzet, cancel rate,
  order double, audit rincian per closing.
- **CS** — scoped ke dirinya sendiri: kartu performa + peringkat + Arena (gamifikasi) +
  follow-up + self-check Rincian. Tidak melihat omzet total atau detail CS lain.

**Prinsip AI (visi owner):** AI berada *di bawah* monitoring, bukan menggantikan CS.
Fase AI = alat ukur (review kualitas chat, kepatuhan script, benchmark AI-vs-human CR) —
bukan auto-reply. Market Indonesia belum siap full-AI tanpa human touch, dan itu justru
peluang positioning.

---

## 2. Keputusan fundamental

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Rebuild dari nol? | **TIDAK — evolusi ke multi-tenant** | Nilai WaFaChat = logika yang sudah teruji data nyata (Queen score, Arena, CR pelanggan-unik, deteksi closing, SLA jam-aktif, Rincian). Rebuild membuang bukti kerja berbulan-bulan; refactor platform layer di sekitarnya. |
| Bangun BSP sendiri (ala Kirim.dev)? | **TIDAK** | Itu pasar crowded yang mau dihindari. Jadilah layer di ATAS semua BSP. Jangka menengah: daftar **Meta Tech Provider** (Embedded Signup) agar tenant bisa connect WABA langsung — menghapus ketergantungan tanpa jadi BSP. |
| Convex diganti? | **TIDAK (untuk sekarang)** | Kecepatan dev terbukti; realtime gratis; zero ops. Mitigasi lock-in & biaya: arsitektur event+rollup (lihat §4) membuat storage layer portable — migrasi ke Postgres jadi opsi enak SETELAH ada revenue, bukan prasyarat. **Data latensi (diukur 2026-07-07 dari Indonesia):** query ringan median 273ms, query berat (laporan 1 hari) 517ms — Convex di US East. Diterima untuk dashboard (tim internal 5 orang pakai harian tanpa keluhan kecepatan). **Kriteria ganti (gerbang Fase 2, ke Postgres region SG — Supabase/Neon):** (a) tenant komplain kecepatan, (b) p95 load panel > 2 detik, (c) biaya Convex tak proporsional per tenant, (d) tuntutan data residency. |
| n8n bagian dari produk? | **TIDAK** | n8n = alat prototyping internal. Semua glue per-customer dipindah ke Ingestion API yang diproduktisasi. |

---

## 3. Perbaikan dari kecil ke besar

### Kecil (minggu-an) — "Hardening"
1. **Gembok semua Convex function** — pola `authSecret` sudah ada di auth/followUp; terapkan
   ke seluruh query/mutation. Untuk SaaS: session-based per-org auth di level function.
2. Cabut semua hardcode pustakaislam → **settings per-organisasi**: nomor test/internal,
   `DATA_CUTOFF_MS`, cutoff harian 16:00 (jadi configurable per org + timezone),
   frasa closing "PEMESANAN BERHASIL", kanonikalisasi produk.
3. Observability: Sentry (error tracking), audit log aksi admin, export/backup data.

### Sedang (bulan-an) — "Data model & engine"
4. **CS = entity ber-ID, bukan string nama.** Akar dari bug fragmentasi ("CS Aisyah" pecah
   3 kartu) dan semua akrobat `csKey`. Target: 1 CS = 1 ID stabil + tabel alias per sumber
   (Berdu staff ID, phone_number_id, variasi nama di pesan).
5. **Metrics engine: event-in → rollup harian tersimpan** (per org × CS × hari) untuk fakta
   yang composable. Union identitas lintas hari/CS (distinct phone/order) tetap dihitung exact
   dari raw range yang dibatasi 35 hari + 900 row/source dan fail-loud; count distinct harian
   tidak pernah dijumlahkan sebagai aproksimasi. Raw event tetap disimpan untuk drill-down.
6. **Closing-rule builder per tenant**: wizard "tempel contoh pesan closing-mu" → sistem
   menyusun parser (generalisasi tabel `closingRules`). Tier premium: AI parsing format bebas.

### Besar (kuartal) — "Platform"
7. **Multi-tenancy penuh**: organizations, members, roles (owner/SPV/CS), isolasi data
   (orgId di semua tabel + index), billing, onboarding self-serve.
8. **Connector layer** (§4) — ini produknya, sekaligus moat.
9. Rebranding + UX overhaul + landing page + dokumentasi publik.

---

## 4. Arsitektur target

```
[SUMBER]                     [WAFACHAT CORE]                 [PRODUK]
Order:  Berdu / Scalev /     ┌───────────────────────┐       Laporan & Leaderboard
        Mengantar / LP        │  INGESTION API         │      Arena / Queen / Gamifikasi
        custom / CSV     ───► │  2 event universal:    │ ───► SLA & kecepatan respon
                              │   • lead.created       │      Rincian (self-check/audit)
WA:     KirimDev / Qiscus /   │   • message.event      │      Follow-up funnel
        Fonnte / Cloud API ─► │  + closing rules/tenant│      (Fase 4: AI quality review)
                              │  + CS alias resolver   │
                              └───────────────────────┘
                                        │
                              event store → ROLLUP harian (org × CS × hari)
```

**Ide kunci — normalisasi ke 2 event.** Apapun platform tenant, semuanya diterjemahkan menjadi:
- `lead.created` — {siapa (phone), kapan, produk, CS-mana, sumber, order_id}
- `message.event` — {arah in/out, siapa, kapan, isi, CS-mana}

Seluruh analytics yang sudah ada (leaderboard, CR, SLA, Queen, follow-up, Rincian) sudah
bekerja di atas dua konsep ini — itulah mengapa evolusi mungkin dan rebuild tidak perlu.

**3 jalur masuk order (urutan prioritas build):**
1. **Universal Webhook + Field Mapper** — tenant tempel URL webhook WaFaChat di platformnya,
   lalu mapping visual (field `customer.phone` mereka → `phone` kita). Satu fitur meng-cover
   Berdu, Scalev, Mengantar, dan landing page custom sekaligus.
2. **Connector native** untuk 3–5 platform terpopuler (preset mapper, tinggal klik).
3. **Import CSV / input manual** — fallback untuk seller kecil.

**Sisi WhatsApp — BSP-agnostic:**
- Syarat minimal partner BSP: webhook `message.sent` + `message.received`.
- Mulai: KirimDev (sudah jalan) → tambah 1–2 BSP populer.
- Jangka menengah: **Meta Tech Provider + Embedded Signup** → tenant connect WABA-nya sendiri
  langsung ke WaFaChat, tanpa tergantung BSP pihak ketiga.

**Stack:**
Next.js (tetap) · Convex (tetap, dengan arsitektur event+rollup) · Clerk/WorkOS (auth
multi-tenant) · Midtrans/Xendit (billing IDR) · Sentry · Vercel.

---

## 5. Roadmap berfase (dengan kriteria lulus)

| Fase | Durasi | Isi | Kriteria lulus |
|---|---|---|---|
| **0 — Hardening** | 2–4 minggu | §3 poin 1–3 | Aman dipakai orang selain internal |
| **1 — Self-tenant testing** | 1–2 bulan | Org/member/role, universal webhook + mapper, closing-rule builder, CS ber-ID. **Owner = tenant #1–#3 sendiri**: org Berdu (produksi existing), org Scalev (test), org LP platform (beli paket test). | Ketiga org jalan akurat end-to-end; preset Berdu/Scalev/LP terbentuk; onboarding terdokumentasi (tulisan + video) |
| **2 — Early access** | 2–3 bulan | Onboarding wizard + video, rebranding + UX, landing page, rollup engine, lalu buka trial ke seller luar — **produk sudah settle, bukan uji coba** | 10–20 tenant luar aktif; churn rendah → baru billing |
| **3 — Diferensiasi** | kuartal berikutnya | Gamifikasi configurable (hadiah harian/mingguan/bulanan, SPV view, WA digest ke owner), audit lengkap, mobile polish | Fitur yang kompetitor tidak punya |
| **4 — AI di bawah monitoring** | setelahnya | AI chat-quality review (skor kepatuhan script/tone per CS), benchmark AI-vs-human | AI sebagai alat ukur, bukan core |

> ⚠️ Prinsip fase 1 (keputusan owner, 2026-07-07): **JANGAN jadikan seller luar kelinci
> percobaan.** Produk ini menyentuh WhatsApp jualan orang — bug di WA CS tenant luar =
> trust hangus + reputasi buruk menyebar di komunitas target. Validasi platform-platform
> dilakukan dengan AKUN SENDIRI (Berdu existing, Scalev, beli paket LP untuk test).
> Seller luar baru masuk saat onboarding sudah mulus + terdokumentasi (fase 2).
> Billing tetap paling akhir: setelah tenant luar terbukti betah.

---

## 6. Pricing (value-based, IDR)

Jangkar nilai: *"1 closing tambahan per hari sudah membayar langganan sebulan."*

| Paket | Harga | Batas | Isi |
|---|---|---|---|
| **Solo** | Rp 99–149rb/bln | 1 CS | Laporan + realtime closing/respon (wedge akuisisi: owner 1 CS pun butuh visibilitas realtime — tanpa ini dia nunggu rekap 24 jam; upsell alami saat timnya tumbuh) |
| **Starter** | Rp 299rb/bln | ≤ 3 CS | Laporan, Arena, SLA, leaderboard |
| **Growth** | Rp 799rb/bln | ≤ 10 CS | + connector, follow-up funnel, Rincian, WA digest owner |
| **Pro** | Rp 1,5–2jt/bln | unlimited, multi-cabang | + API, AI quality review, prioritas support |

- Trial 14 hari.
- **Onboarding dibantu via WA** (white-glove) — di market Indonesia ini pembeda besar.

---

## 7. Go-to-market Indonesia

- **Niche-first**: seller COD / landing-page / advertiser — persis profil pemilik.
  Komunitas seller & advertiser (grup FB/Telegram/WA) sebagai kanal awal.
- **Partnership distribusi**: ekosistem Berdu, Scalev, Mengantar, BSP — integrasi = kanal.
- **Senjata utama: case study sendiri** — "CR tim kami naik ke 65–70% setelah CS bisa melihat
  papan skornya" + screenshot Arena. Cerita yang tidak bisa dipalsukan kompetitor.
- Copywriting menyerang *ketidaktahuan owner*, bukan kompetitor:
  *"CS-mu bawa HP pulang — kamu tahu apa yang terjadi?"*

---

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Ketergantungan BSP (akses/harga berubah) | Multi-BSP sejak awal; jalur Meta Tech Provider |
| Scope creep ke inbox/automation | **Disiplin positioning**: selama kita scoreboard, kita sendirian di lapangan; begitu jadi inbox, kita lawan raksasa |
| Format closing beragam antar tenant | Closing-rule builder + AI parsing (premium) |
| Biaya Convex membengkak di skala | Fakta additive via rollup; union identitas non-composable tetap raw-exact dengan range/cap fail-loud (bukan penjumlahan distinct aproksimatif) + opsi migrasi Postgres pasca-revenue |
| Fitur gamifikasi memicu burnout CS | Prinsip yang sudah dipelajari: speed = gerbang SOP bukan balapan; kompetisi lewat kualitas (CR); copy kalem |
| Data sensitif lintas tenant | Auth per-function + orgId di semua query + audit log (Fase 0–1) |

---

## 9. Outline pitch deck (10 slide)

1. **Masalah** — CS sulit dikontrol; owner buta performa; HP dibawa pulang.
2. **Dampak** — CR rendah = omzet hilang jutaan/bulan; tidak tahu CS mana masalahnya.
3. **Solusi** — WaFaChat: papan skor & pusat kendali tim CS WhatsApp.
4. **Demo** — Laporan, Arena (gamifikasi), SLA, Rincian self-check. (Screenshot nyata.)
5. **Traction/bukti** — case study internal: CR naik ke 60–70%; CS berkompetisi sehat.
6. **Kenapa sekarang** — Indonesia WhatsApp-first; toko online masih human-CS; tool
   monitoring khusus belum ada.
7. **Pasar** — seller WA-first Indonesia (LP/COD/marketplace-escapee); bottom-up niche.
8. **Model bisnis** — SaaS per-tier (299rb–2jt/bln), onboarding WA white-glove.
9. **Moat** — connector layer + logika scoring teruji + brand gamifikasi (Queen/Arena).
10. **Roadmap & ask** — fase §5; kebutuhan (tim/dana/partner) sesuai konteks pitch.

---

## 10. Brief developer (ringkas)

**Konteks:** SaaS-kan codebase existing (Next.js + Convex, repo ini). JANGAN rebuild;
refactor bertahap. Logika bisnis di `lib/queen.ts`, `convex/analytics.ts`,
`convex/shippingRecaps.ts` (parser), `convex/responseTime*.ts`, `components/panel/*`
adalah aset — pertahankan perilakunya (142 test hijau sebagai kontrak).

**Urutan kerja:**
1. Auth per-function (semua Convex query/mutation menolak caller tanpa session org valid).
2. Skema multi-tenant: tabel `organizations`, `members`; tambah `orgId` + index ke semua
   tabel data; migrasi data pustakaislam sebagai org pertama.
3. Entity `agents` (CS ber-ID) + `agentAliases` (mapping nama/staffId/phoneNumberId per
   sumber); ganti pencocokan nama string (`csKey`) dengan resolusi alias → ID.
4. Ingestion API: endpoint `POST /ingest/lead` + `POST /ingest/message` (HMAC per org) +
   Field Mapper config; port logika n8n "Normalize Order Data" & "Map to append_message"
   ke sini.
5. Rollup harian (org × agent × hari) terisi dari event; panel membaca fakta additive dari
   rollup. Metrik union identitas dan drill-down membaca raw range exact dengan cap eksplisit
   sampai tersedia representasi composable yang exact.
6. Settings per org: timezone + jam cutoff, closing rules, nomor internal, jam aktif SLA,
   target Queen (band CR, bobot).
7. Billing (Midtrans/Xendit) + gating fitur per paket.

**Definisi selesai per langkah:** test existing tetap hijau + test baru untuk perilaku
multi-tenant (isolasi org adalah kasus uji nomor satu).

---

## 11. Playbook onboarding & koneksi (per platform)

**Pola tunggal:** tiap org dapat **1 URL webhook unik + secret** → ditempel di platform
tenant → event pertama masuk → **Field Mapper** memetakan field mereka ke skema kita →
tersimpan. Setup pertama untuk sebuah platform = investasi: mapping-nya disimpan sebagai
**preset**, tenant berikutnya di platform yang sama tinggal klik.

| Tipe platform | Cara connect | Effort |
|---|---|---|
| Berdu | Preset (payload sudah dikuasai dari operasional sendiri) | ±5 menit |
| Scalev / OrderOnline / Mengantar / LP builder ber-webhook | Mapping sekali → jadi preset publik | 30 mnt pertama, 5 mnt berikutnya |
| LP custom | Universal webhook + mapper manual | 15–30 menit |
| Tanpa webhook | Import CSV / input manual | fallback |

**Model setup bertahap:**
1. **Alpha (5–10 tenant): white-glove penuh** via WA/screen-share — setiap sesi setup
   sekaligus menghasilkan preset + dokumentasi. White-glove di market Indonesia =
   selling point, bukan kelemahan.
2. **Beta: onboarding wizard** in-product (pilih platform → copy URL → test event →
   daftar CS + alias → aturan closing → connect BSP) + tombol "minta bantuan via WA".
3. **Skala:** 80% self-serve (preset lengkap); white-glove jadi fitur paket Pro.

**Formulir intake calon tenant (1 halaman):** platform order, BSP WA, jumlah CS, contoh
format pesan closing, jam operasional. Hasilnya = requirement matrix yang menentukan
urutan preset yang dibangun.

## 12. Jalur Meta API resmi (Tech Provider)

**Prinsip: bukan blocker.** Hari 1 cukup BSP-agnostic (konsumsi webhook BSP tenant).
Jalur resmi dikerjakan PARALEL mulai fase 2:

1. **Legalitas**: badan usaha (PT/CV) → **Business Verification** di Meta Business
   Manager (dokumen legal, domain, email bisnis). Durasi: hari–minggu.
2. **Meta App + produk WhatsApp** → ajukan **App Review + Embedded Signup**
   (demonstrasi use case). Durasi: minggu.
3. **Hasil**: tombol "Hubungkan WhatsApp" di dashboard WaFaChat — tenant login Facebook,
   WABA-nya ter-connect langsung (pesan mengalir dari Meta ke kita tanpa BSP perantara).
   Mode **coexistence** (CS tetap pakai WA Business App di HP — model yang sudah terbukti
   di operasional internal) tersedia via Cloud API.
4. Estimasi total: 1–3 bulan, biaya kecil (legalitas + waktu).

**Kenapa ini penting jangka menengah:** menghapus ketergantungan pada BSP pihak ketiga
(risiko §8 nomor 1) TANPA menjadikan kita BSP anti-ban — kita tetap layer monitoring.

## 13. Langkah pertama (revisi 2026-07-07 — self-test first)

1. **Fase 0 (hardening) langsung jalan** — tidak menunggu komitmen siapa pun: auth semua
   function, cabut hardcode → per-org settings, CS ber-ID.
2. **Owner jadi tenant #1–#3 sendiri**: org Berdu (produksi existing) · org Scalev (test;
   pernah dipakai, tinggal connect) · org LP platform (beli paket termurah untuk test).
   Dari sini lahir preset + dokumentasi onboarding (tulisan & video) yang teruji.
3. **Legalitas**: rencana pendirian PT ~31 Juli 2026 → begitu berdiri, mulai proses Meta
   Business Verification → Tech Provider (§12) berjalan paralel.
4. **Early access ke seller luar** HANYA setelah #2 settle — onboarding mulus, video siap,
   zero kelinci percobaan.

---

## 14. Debt ledger — pintasan single-tenant → target SaaS

> **Disiplin (owner, 2026-07-08):** bangun untuk Fandy dulu (self-test, tenant #1), TAPI tiap
> tindakan wajib punya jalur ke target multi-tenant di dokumen ini — **jangan tambah kopling
> single-tenant yang jadi jalan buntu.** Tiap pintasan yang diambil dicatat di sini + target-nya.
> Semua ini SUDAH kompatibel dengan arsitektur (§4 event universal + rollup + ingestion API);
> yang berubah nanti cuma "dari mana config dibaca": ENV/hardcode → tabel per-org.

| Pintasan sekarang (single-tenant) | Lokasi | Target SaaS | Ref |
|---|---|---|---|
| Secret Berdu (`BERDU_APP_ID/SECRET/HMAC/USER_ID`) di **ENV Convex global** | Convex env | tabel `tenantIntegrations` per-org, secret **dienkripsi** app-side | §10.4 |
| ✅ **LUNAS 2026-07-14 (B3)** — Source key hardcoded `berdu-pustakaislam` / `kirimdev-pustakaislam` | → route `/webhooks/{kirimdev,berdu}` baca `?source=<sourceKey>` dari URL → `ingestSources.by_sourceKey` → `source.orgId` di-thread; URL lama tenant-1 tetap jalan via alias. `provisionOrg` mint sourceKey `<kind>-<slug>` + secret per-org. Wizard self-serve = tunda | §11 |
| ✅ **LUNAS 2026-07-11** — `BERDU_STAFF_MAP` (staff Berdu → nama CS) | ~~berduAdapter.ts~~ → `csConfigs.berduStaffIds` + `resolveBerduStaffMap` (fallback baked) | `agentAliases` per-org (staffId → agentId) | §10.3 |
| ✅ **LUNAS 2026-07-12 (B2a)** — Attribution phone_number_id → CS | → `resolveAgent({phoneNumberId})` (`convex/agents.ts`) — SATU resolver di semua write entry | `agentAliases` per-org (embedded arrays di csConfigs) | §10.3 |
| ✅ **LUNAS 2026-07-12 (B2a)** — CS = string nama + csKey normalisasi | → registry `csConfigs.key` (kanonik, IMMUTABLE across rename) + `nameAliases` + resolver `resolveAgent`/`canonicalizeCs` di tiap write-stamp; rename-safe (key tak berubah → data tak membelah). **Keputusan sadar:** row tetap bawa csKey kanonik (BUKAN agentId) → nol re-key 218k row, nol perubahan rollup/FE. csConfigs = tabel agents (tak di-rename, cosmetic-deferral). Reader org-filter/isolation = **B2b** | `agents` ber-ID stabil + alias resolver | §3.4, §10.3 |
| ✅ **LUNAS 2026-07-14 (B3)** — Frasa closing "PEMESANAN BERHASIL" per-org | → `closingRules` reader `getActiveClosingPhrases(ctx, orgId)` via `by_org_active`; fallback `DEFAULT_PHRASES` universal semua org. (Builder UI per-org = kosmetik, tunda) | §3.6 |
| ✅ **LUNAS 2026-07-11** — Nomor internal/test hardcoded | ~~lib.ts `INTERNAL_TEST_PHONES`~~ → `orgSettings.internalPhones` (reader `getInternalPhoneSet`, fallback in-code) | settings per-org | §3.2 |
| ✅ **LUNAS 2026-07-11** — Identitas org (belum ada) | → `orgSettings` (`key="default"` + `orgName`) — anchor tenant #1 | per-org rows di Fase B | §10.2 |
| Cutoff harian 16:00 WIB + timezone hardcoded | lib window helpers | timezone + jam cutoff **per-org** | §3.2 |
| ✅ **LUNAS 2026-07-12 (Fase B1)** — `orgId` di tabel data | → `organizations` table + `orgId` **REQUIRED** (schema-enforced) di 16 tabel data; ~218k row di-backfill, coverage 0, parity 0. Reader belum filter (B2). Sisa target: index org-scoped + read-isolation = **B2** | §10.2 |
| ✅ **LUNAS 2026-07-13 (Fase B2b)** — Org-isolation penuh (penutup jalur B) | → dedup write-path org-scoped (orderId/externalMessageId/orderIdBerdu/normalizedName tak bisa nyilang org — collision test hijau); SEMUA reader + cron per-org via 26 index `by_org_*` (viewer-driven `requireMemberOrg`, data-driven `doc.orgId`); suite isolasi 2-org `convex/orgIsolation.test.ts` (definition-of-done jalur B); 9 `*Legacy` internalQueries dihapus; 30 index unscoped lama DIHAPUS dari prod (deploy-verified); +1 leak `csConfigs.list` ketemu & difix di sweep. Parity 0 ×3 window pasca index-removal. Deferral: settings/source-key/tenantIntegrations/members/JWT-org/multi-org-login = **B3**; cutoff+timezone per-org = **B4** | §10.2, §11 |
| ✅ **LUNAS 2026-07-14 (Fase B3)** — Pintu masuk tenant (config+identity per-org) | → `provisionOrg` atomic (org+orgSettings+admin user+ingestSources+secret, guard slug/email); config settings/orgSettings/closingRules per-org via `by_org_*` (fallback slug-aware: default→tenant-1, org baru→kosong/DEFAULT_PHRASES); ingest `?source=`→org; JWT claim `orgId` **selalu divalidasi vs users-row** (backward-compat, nol logout massal) + login per-org; 18 mutation viewer-facing dipindah requireAdminOrg/requireMemberOrg, 13 TETAP (n8n/authSecret/infra) dicatat; suite e2e org#2 (definition-of-done); 3 index config global dihapus prod (parity 0 ×3). **Whole-branch review (opus) temukan+tutup 1 kelas lubang: 10 mutation admin by-ID (recap/message) tanpa row-orgId guard → cross-tenant mutate-by-id, difix guard `row.orgId===viewer.orgId`.** Deferral: `tenantIntegrations`/Berdu-creds per-org + enrich/reconciler = saat tenant Berdu #2; wizard self-serve + members multi-org + org-switcher = saat kebutuhan riil; cutoff/timezone = **B4** | §10.2, §10.3, §11 |
| Kredensial diset manual (dashboard/CLI oleh dev) | operasional | **wizard onboarding self-serve** (paste/OAuth → DB) — tunda sampai calon tenant riil | §11 |
| Webhook enrich sinkron fetch order (`fetchBerduOrderDetail` pakai ENV) | http.ts/reconciler | fetch pakai creds **per-org dari DB**; reconciler per-org | §4 |

**Cara pakai ledger:** tiap kali kerja nambah pintasan single-tenant baru → tambah baris di
sini + target-nya. Saat masuk Fase multi-tenant, ledger ini = checklist migrasi (tiap baris:
pindah baca-config dari ENV/hardcode ke tabel per-org, tanpa ubah logika inti/rollup).

Yang barusan dikerjakan (2026-07-08) dan **sudah SaaS-shaped**: Ingestion API (event universal
lead.created/message.event) + rollup per-(csKey×window) + capture-first always-200 + dedup by
orderId — semua ini portable ke multi-tenant tinggal tambah `orgId`. Pintasan-nya cuma di baris
config/secret di atas, bukan di arsitektur.

**Fase A — LUNAS 2026-07-11 (config-from-DB, single-tenant anchor).** 3 hardcode dicabut ke DB
dengan pola fallback in-code (`getActiveClosingPhrases`-style → deploy = perilaku byte-identik,
tabel kosong pakai default): (1) nomor internal → `orgSettings.internalPhones`; (2) staff map
Berdu → `csConfigs.berduStaffIds` (+`resolveBerduStaffMap`, fallback baked); (3) identitas org →
`orgSettings.key="default"`. UI Settings: section Organisasi + field Berdu Staff ID per CS. Deploy
+ seed prod terverifikasi: `debugRollupParity` 0 mismatch di 3 window (termasuk live) → nol
pergeseran metrik; order Berdu live ter-attribute CS benar. Spec/plan:
`docs/superpowers/{specs,plans}/2026-07-11-fase-a-orgsettings*`.

**Sengaja DITUNDA di Fase A (keputusan sadar, spec §6):** (a) **cutoff 16:00 + timezone** — dia
kunci `windowKey` semua `dailyRollups`; configurable cutoff butuh strategi re-key/migrasi rollup
sendiri → digarap bareng `orgId` di Fase B. (b) **source key `*-pustakaislam`** — sudah
registry-driven (`ingestSources`); resolusi org-dari-key butuh org table dulu → Fase B. (c)
**`PRODUCT_ALIASES` editable** — alias = kunci grouping byProduct rollup; editable runtime =
jendela drift increment-vs-trueUp; katalog stabil → tunda.

---

*Dokumen ini hidup — revisi seiring temuan dari tenant alpha. Sumber keputusan historis:
memory proyek + `docs/superpowers/specs/`.*
