# Onboarding Multi-CS ke KirimDev (Order Notif) — Runbook

**Tujuan:** Migrasi semua CS notif order ke KirimDev v2 (`M16ChgpsZsbDAlqC`). Aisyah sudah live. Tambah Risma (pindah dari kirim.chat), Azelia, Lila. Setelah Risma pindah, matikan v1 (kirim.chat) total.

**Prinsip eksekusi (permintaan user):** (1) begitu PHONE_ID datang, langsung jalan; (2) TIDAK BOLEH ada order nyasar ke CS lain; (3) template harus benar (nama jangan jadi produk dll); (4) smooth, CS tetap operasional tanpa hambatan seperti Aisyah.

---

## Fakta sistem (yang bikin onboarding cepat & aman)

- **1 API key org-wide** (`kdv_live_…`, credential `KirimDev API` id `h0T10P1wlRr9mOqA`) untuk SEMUA CS. Tidak ada key per-CS.
- **1 Berdu app** (`1igxbn`) sudah nerima SEMUA order toko pustakaislam.net. Tidak perlu app/credential Berdu baru per CS.
- Yang beda per CS hanya: **PHONE_ID** (nomor pengirim) + **Berdu staff ID** (sudah ada) + **templateName**.
- Routing by `order.assigned_to_staff` → tiap order hanya diproses oleh CS pemiliknya. Recipient = `shipping_address.phone` order itu sendiri.

## Berdu staff ID (sudah dikonfirmasi user 2026-06-17)

| CS | staff ID | PHONE_ID | Status |
|---|---|---|---|
| Aisyah | `B-1apQSy` | `525357427330995` | LIVE di v2 |
| Risma | `B-1CxSmL` | `RISMA_PHONE_ID` (menunggu) | migrasi dari v1/kirim.chat |
| Azelia | `B-Z28TdYc` | `AZELA_PHONE_ID` (menunggu) | onboard |
| Lila | `B-NCIXt` | `LILA_PHONE_ID` (menunggu) | onboard |

## Keputusan template (PERLU dipastikan user sebelum eksekusi)

Param template Aisyah `whatsapp_notif_order_aisyah` urutan SEKARANG (10 param):
`{{1}}Nama {{2}}CS {{3}}Produk {{4}}Harga {{5}}Ongkir {{6}}Total {{7}}HP {{8}}Alamat {{9}}Kecamatan {{10}}Kota`

- **Pilihan A (disarankan): 1 template bersama** untuk semua CS (nama CS = {{2}}). Tidak perlu approve template baru. Syarat: semua nomor di 1 WABA.
- **Pilihan B: template per-CS** (`whatsapp_notif_order_risma`, dll). Wajib **verifikasi tiap template punya urutan {{1}}..{{10}} SAMA** seperti di atas. Kalau beda → render kacau (nama jadi produk dll).

`templateName` di staffMap menyesuaikan pilihan ini.

### KEPUTUSAN: Invoice link (2026-06-17)

Button template dipakai untuk **COD / Transfer** (quick-reply), jadi invoice link **TIDAK** pakai URL button — masuk **teks body** sebagai variabel ke-11.

- **Placement final (dikunci 2026-06-17):** setelah blok alamat, sebelum CTA COD/Transfer:
  ```
  *🧾 Invoice resmi pesanan Kakak:*
  {{11}}
  ```
  `{{11}}` = full order URL dari Berdu `order.url` (mis. `https://pustakaislam.net/o/260617000253/aadea82`). Sample value di editor Meta = URL itu. Aman dari aturan Meta (variabel tidak di awal/akhir body).

**Teks template FINAL (dikunci user 2026-06-17) — 11 param:**
```
Assalamu'alaikum Kak,
Saya {{2}} dari Pustaka Islam 🙏
Terima kasih, pesanan Kakak sudah masuk ya.

Mohon cek detail pesanannya:

Produk: *{{3}}*
Harga: *{{4}}*
Ongkir: {{5}}
*Total: {{6}}*

📦 Dikirim ke:
{{1}} | {{7}}
{{8}}, {{9}}, {{10}}

*🧾 Invoice resmi pesanannya:*
{{11}}

Kakak lebih nyaman pilih *COD* atau *Transfer*?

Silakan pilih tombol di bawah ya Kak 👇
```
Mapping param (urutan v2 `templateParams`): {{1}}customerName {{2}}senderName {{3}}productsList {{4}}productsSubtotal {{5}}shippingCost {{6}}total {{7}}phone {{8}}shippingAddress {{9}}shippingDistrict {{10}}shippingCity {{11}}order.url.

**KOORDINASI WAJIB:** v2 saat ini masih 10 param (Aisyah live). JANGAN update v2 ke 11 param sampai template 11-param ini APPROVED & jadi template aktif Aisyah — kalau v2 kirim 11 ke template 10 (atau sebaliknya) → error. Update v2 ke 11 param bersamaan dengan switch templateName.
- **Param jadi 11.** Saat template baru di-approve, update v2 `templateParams` jadi append `order.url`:
  ```js
  const templateParams = [ customerName, csConfig.senderName, productsList, formatRupiah(productsSubtotal), formatRupiah(shippingCost), formatRupiah(total), phone, shippingAddress, shippingDistrict, shippingCity, (order.url || '') ];
  ```
- **KOORDINASI:** ubah template (+{{11}}) dan v2 (kirim 11 param) BERSAMAAN. Kalau template 11 tapi v2 kirim 10 → error; kalau v2 kirim 11 tapi template 10 → param ke-11 diabaikan.

---

## Eksekusi (begitu PHONE_ID + keputusan template ada)

### Step 1 — Isi PHONE_ID + templateName per CS (staffMap SUDAH pre-staged)

**Sudah dikerjakan 2026-06-17:** staffMap v2 di `M16ChgpsZsbDAlqC` sudah berisi 4 CS. Risma/Azelia/Lila pakai `phoneId: 'PENDING'` + `templateName: 'PENDING'`, dan ada **guard**: kalau salah satunya masih `PENDING` → order CS itu di-skip (jadi aman, gak nyasar/dobel; Risma tetap di v1). Terverifikasi: Aisyah tetap jalan normal.

**Besok tinggal:** per CS, ganti `'PENDING'` → PHONE_ID asli + nama template approved (via `patchNodeField`). Begitu kedua-duanya keisi, CS itu langsung live. Bentuk akhir staffMap:
```js
const staffMap = {
  'B-1apQSy': { platform: 'kirimdev', phoneId: '525357427330995', senderName: 'Aisyah', templateName: 'whatsapp_notif_order_aisyah_v2' },
  'B-1CxSmL': { platform: 'kirimdev', phoneId: 'RISMA_PHONE_ID',   senderName: 'Risma',  templateName: 'whatsapp_notif_order_risma' },
  'B-Z28TdYc': { platform: 'kirimdev', phoneId: 'AZELA_PHONE_ID',  senderName: 'Azelia',  templateName: 'whatsapp_notif_order_azela' },
  'B-NCIXt':   { platform: 'kirimdev', phoneId: 'LILA_PHONE_ID',   senderName: 'Lila',   templateName: 'whatsapp_notif_order_lila'  },
};
```
(Kalau Pilihan A: semua `templateName` = nama template bersama.)

**Jaminan anti-nyasar:** tiap staff ID → phoneId + nama + template MILIKNYA SENDIRI. Tidak ada CS yang nunjuk ke nomor CS lain. Insiden 2025 (salah map ke nomor Aisyah) mustahil terulang.

### Step 2 — Verifikasi per CS SEBELUM live (pola Aisyah, anti-nyasar & anti-salah-template)

Untuk tiap CS baru (Risma, Azelia, Lila):
1. **Disable node `Send Template KirimDev`** (biar gak kirim dulu).
2. Test `n8n_test_workflow` dengan order ASLI milik CS itu (`event_type:order.new`, `user_id`, `order_id` ber-prefix `O-`).
3. Cek output `Normalize`: `phone` = nomor customer order itu, `csConfig.senderName` = CS yang benar, `templateParams` urutan benar (Nama→CS→Produk→Harga→Ongkir→Total→HP→Alamat→Kec→Kota), `phoneId` = nomor CS itu.
4. Kalau benar → **enable** node → test sekali (kirim ke nomor test/own) → konfirmasi WA + format.

### Step 3 — Migrasi Risma & matikan v1

1. Setelah Risma terverifikasi di v2 → **hapus `B-1CxSmL` (Risma) dari staffMap v1** (`wgOVQrzkYOijDta1`). v1 jadi kosong.
2. **Deactivate v1** (kirim.chat retired). Aisyah+Risma+Azelia+Lila semua di v2/KirimDev.
3. Verifikasi: order tiap CS → tepat 1 notif dari nomor CS sendiri, tidak ada dobel.

### Step 4 — Sinkron repo & memori

- Update `order-trigger-v2-kirimdev.json` (staffMap multi-CS, PHONE_ID di-redact/placeholder di repo).
- Update README (v1 → Inactive/retired; v2 → multi-CS).
- Update memori project.

---

## Checklist user (untuk besok)

- [ ] PHONE_ID: Risma, Azelia, Lila (dari KirimDev, setelah nomor mereka di-connect)
- [ ] Pastikan nomor WA Risma/Azelia/Lila sudah connect ke KirimDev
- [ ] Keputusan template: 1 bersama (A) atau per-CS (B); kalau B, urutan variabel tiap template sama
- [ ] (Opsional) order_id contoh per CS untuk verifikasi (atau buat 1 test order/CS dengan nomor sendiri)

## Catatan
- Convex `set_order` & dashboard WaFaChat = DITUNDA (dashboard mau dirombak, metrik closing/leads belum akurat). v2 tetap murni notif order untuk fase ini.
- AI Agent = fase setelah dashboard. Rencana: n8n AI Agent (bukan Hermes).
