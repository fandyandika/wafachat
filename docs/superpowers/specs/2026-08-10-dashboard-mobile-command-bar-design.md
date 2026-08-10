# Dashboard Mobile Command Bar Design

## Goal

Saat owner membuka Dashboard melalui mobile/PWA, metrik bisnis utama harus terlihat cepat tanpa melewati rangkaian header, context card, form filter, dan attention card yang tinggi.

Desktop mempertahankan komposisi yang sudah berjalan. Perubahan ini khusus adaptasi mobile dan tidak mengubah query, business logic, cutoff, permissions, maupun perhitungan data.

## Current problem

Pada viewport mobile saat ini:

1. Shell header menampilkan judul serta konteks organisasi dalam area yang terlalu tinggi.
2. `Kendali operasional` memakai satu blok sendiri.
3. Filter tanggal dan basis hari selalu terbuka serta menumpuk vertikal.
4. Tombol status `Sudah diterapkan` tetap mengambil satu baris penuh.
5. `Lihat analisis lengkap` mengambil satu baris penuh.
6. `Perlu perhatian` tampil sebagai section besar sebelum KPI.

Akibatnya, `Kinerja bisnis` baru terlihat setelah scroll panjang. Dashboard gagal menjalankan fungsi utamanya sebagai snapshot cepat.

## Selected direction

### Compact mobile shell header

- Tinggi header mobile dipadatkan.
- `Dashboard` tetap menjadi heading utama.
- Konteks organisasi/role menjadi metadata kecil dan tidak mendominasi viewport.
- Desktop header tidak berubah.

### Mobile command bar

Gabungkan context operasional dan pemicu filter menjadi satu band ringkas setelah header.

Command bar menampilkan:

- tanggal aktif dalam format pendek Indonesia;
- basis aktif: `Hari kalender` atau `Cutoff CS · 16.00`;
- waktu pembaruan terakhir;
- tombol ikon Refresh;
- tombol `Atur` untuk membuka filter.

Status histori tetap terlihat bila tanggal terpilih bukan periode berjalan. Exact boundary tetap tersedia di panel filter, sehingga data tidak kehilangan konteks.

### Filter bottom sheet

Pada mobile, tanggal dan basis hari tidak selalu terbuka. Tombol `Atur` membuka bottom sheet yang berisi:

- exact active boundary;
- input tanggal;
- segmented control basis hari;
- primary action `Terapkan`;
- secondary action `Buka Performance`.

Draft perubahan tidak menjalankan query. Query hanya berjalan setelah `Terapkan`, sesuai kontrak on-demand saat ini. Sheet menutup setelah apply berhasil.

Desktop tetap memakai filter inline yang sekarang.

### Content priority

Urutan mobile menjadi:

1. Compact shell header.
2. Mobile command bar.
3. Error alert bila ada.
4. `Kinerja bisnis`.
5. Compact operational attention row.
6. Top CS.
7. Top Produk.

`Perlu perhatian` tidak lagi menjadi section tinggi pada mobile. Order ganda tampil sebagai satu action row ringkas dengan count dan status. Tap tetap membuka Duplicate Sheet yang sama. Kondisi normal menjadi status ringkas dan tenang.

Desktop mempertahankan attention rail di samping matriks KPI.

## Component boundaries

- `DashboardHistoryFilter` mempertahankan state draft dan logic apply yang sama, lalu menyediakan presentasi desktop inline dan mobile sheet.
- Mobile command bar menjadi komponen presentasional dengan active selection, update status, loading state, serta callbacks `onOpenFilter` dan `onRefresh`.
- Owner Dashboard menentukan urutan mobile versus desktop melalui responsive composition; tidak menduplikasi data fetching.
- Existing `DuplicateSheet`, metric components, ranking components, dan `useDashboardData` tetap menjadi implementation truth.

## Interaction and states

- Semua target sentuh mobile minimum 44×44 px.
- Filter sheet memiliki judul, deskripsi, focus management, close control, dan keyboard support dari dialog primitive yang sudah ada.
- Refresh disabled saat request berjalan; ikon menunjukkan loading tanpa menghilangkan data lama.
- `Terapkan` disabled bila draft sama dengan selection aktif atau tanggal invalid.
- Error tetap muncul dekat command bar dan menyediakan retry.
- Loading KPI tetap memakai skeleton yang bentuknya sama dengan hasil akhir.
- Historical selection menyembunyikan order-ganda current-action seperti perilaku sekarang.

## Visual direction

- Pertahankan Wafachat Operational Ledger: warm paper, ruled bands, blue-black ink, violet hanya untuk action/selection.
- Command bar berupa satu continuous ledger band, bukan kumpulan floating cards.
- Gunakan tabular numerals untuk tanggal dan waktu.
- Hindari shadow dekoratif serta animasi non-fungsional.

## Data and performance constraints

- Tidak ada query Convex baru.
- Tidak ada polling, realtime subscription baru, cron, atau prefetch tambahan.
- Membuka/menutup bottom sheet tidak melakukan request.
- Existing refresh dan apply tetap satu-shot.
- Desktop dan mobile memakai selection serta result data yang sama.

## Responsive scope

- Mobile target utama: 320–767 px, portrait dan landscape.
- Tablet/desktop dari breakpoint existing mempertahankan inline filter dan owner composition saat ruang cukup.
- Tidak boleh ada horizontal overflow pada 320 px.
- Fixed bottom navigation dan safe-area padding tetap dihormati.

## Testing and verification

- Unit test mobile command-bar labels, historical label, loading/disabled state, dan callbacks.
- Unit test filter apply: draft tidak query; submit mengubah applied selection.
- Unit test link menuju Performance mempertahankan tanggal dan basis.
- Existing Dashboard calculation/query tests harus tetap lulus.
- TypeScript dan production build harus lulus.
- Browser QA satu batch: desktop serta mobile 320/390 px; cek first viewport, filter sheet, refresh, historical mode, Duplicate Sheet, keyboard focus, console, dan overflow.
- Jalankan Impeccable detector satu kali setelah seluruh UI selesai, lalu satu bounded correction pass bila perlu.

## Success criteria

1. Pada mobile 390 px, heading `Kinerja bisnis` atau baris pertama KPI terlihat di first viewport tanpa scroll panjang.
2. Owner dapat mengubah tanggal/basis dengan jumlah fungsi yang sama seperti sebelum redesign.
3. Current selection, exact boundary, histori state, dan waktu update tetap jelas.
4. Order ganda tetap mudah ditemukan dan dibuka, tetapi tidak mendorong KPI jauh ke bawah.
5. Desktop tidak mengalami regresi visual maupun interaksi.
6. Tidak ada tambahan konsumsi Convex akibat redesign.

## Out of scope

- Perubahan business metric, cutoff, atau duplicate-order rules.
- Redesign Performance, Laporan, Follow-up, atau Settings.
- Penambahan chart, auto-refresh, dan push notification.
- Perubahan backend, Convex schema, Berdu, KirimDev, atau n8n.

## Roadmap after this task

1. Diagnosis dan perbaikan Follow-up CS.
2. Final consistency pass seluruh halaman.
3. Penyempurnaan Laporan dan export on-demand.
