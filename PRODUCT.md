# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Wafachat melayani dua pengguna utama dengan bobot setara:

- Owner atau manager yang memantau kesehatan penjualan, kualitas follow-up, performa CS, laporan, dan pencapaian Queen untuk mengambil keputusan operasional.
- Customer service yang menjalankan pekerjaan harian, melihat progresnya, memproses antrean follow-up, dan memahami target serta hasil kerjanya.

Pengalaman beranda harus adaptif terhadap role. Owner melihat command center bisnis; CS melihat pekerjaan berikutnya, target, antrean, dan progres pribadi. Akses data dan tindakan tetap mengikuti permissions yang sudah ada.

## Product Purpose

Wafachat menyatukan aliran order dan percakapan WhatsApp menjadi ruang kerja operasional yang membantu tim menangkap leads dan closing, mengawasi performa, menindaklanjuti pelanggan, serta membuat laporan yang dapat dipakai untuk evaluasi harian, pekanan, dan bulanan.

Keberhasilan produk berarti owner dapat memahami kondisi bisnis dan mengambil tindakan dengan cepat, sementara CS dapat mengetahui pekerjaan prioritas berikutnya tanpa menebak atau berpindah-pindah alat.

## Positioning

Wafachat bukan dashboard analytics generik. Ia menghubungkan event order, percakapan, closing, performa CS, follow-up, response time, laporan operasional, dan pencapaian Queen dalam satu alur kerja yang memakai aturan bisnis nyata tim WhatsApp commerce.

## Operating Context

- Owner dan CS menggunakan produk berulang kali sepanjang hari di desktop dan mobile/PWA.
- Hari kerja laporan memakai cutoff 16:00 WIB ketika konteks laporan atau Queen memerlukannya; evaluasi kalender dan periode lain mempertahankan aturan yang sudah ada.
- Owner mengevaluasi performa per hari, pekan, bulan, CS, produk, metode pembayaran, dan status operasional.
- CS memerlukan antrean dan status yang jelas untuk follow-up, serta feedback setelah tindakan dijalankan.
- Data berasal dari integrasi Berdu/KirimDev, webhook dan reconciliation, lalu disimpan dan dihitung melalui Convex.

## Capabilities and Constraints

- Pertahankan seluruh business logic, routes, role permissions, webhook behavior, cutoff, Queen rules, report calculations, deduplication, reconciliation, dan notification guardrails yang sudah berjalan.
- Penggunaan Convex harus tetap lean: jangan menambah realtime query, polling, atau pembacaan berulang hanya demi presentasi UI.
- Performance dan Queen tetap on-demand ketika itu merupakan perilaku yang sudah ditetapkan.
- Follow-up mempertahankan bounded snapshot dan guardrail tindakan massal.
- Redesign harus SaaS-ready pada shell, role, organisasi, dan permissions, tetapi tidak menambah billing, tenant switch, onboarding komersial, atau fitur spekulatif lain.
- Bahasa produk utama adalah Bahasa Indonesia dengan istilah operasional yang sudah dikenal pengguna.
- Push notification bukan bagian dari scope saat ini.

## Brand Commitments

- Nama produk adalah Wafachat.
- Gunakan logo resmi yang bersumber dari `assets/logo/logo-apps-1.png` dan `assets/logo/logo-apps-2.png`, termasuk favicon/PWA assets turunannya.
- Pustaka Islam adalah client/organisasi, bukan identitas produk.
- Suara produk harus profesional, ringkas, tenang, dan operasional; hindari copy promosi atau gamifikasi berlebihan di luar konteks Queen.

## Evidence on Hand

- Data operasional nyata tersedia melalui Convex untuk dashboard, performance report, laporan harian, Queen recap, dan follow-up.
- Existing routes, tests, query contracts, permissions, and calculations provide implementation truth.
- Brand logo assets are available in the repository.
- No customer testimonials, pricing claims, cross-tenant benchmarks, or commercial SaaS proof may be invented.

## Product Principles

1. Setiap role langsung melihat pekerjaan dan keputusan yang paling relevan baginya.
2. Status operasional harus dapat dipahami dalam satu kali pemindaian, lalu detail tersedia saat diminta.
3. Akurasi data, aturan bisnis, dan keselamatan tindakan lebih penting daripada dekorasi.
4. SaaS-ready berarti struktur yang matang, bukan fitur spekulatif.
5. Visual refinement tidak boleh menambah pemborosan Convex atau memperlambat pekerjaan harian.

## Accessibility & Inclusion

- Semua workflow harus dapat digunakan dengan keyboard dan memiliki focus state yang jelas.
- Kontrol mobile memiliki target sentuh minimum 44px.
- Input memiliki label terlihat; loading, empty, success, dan error states dapat dipahami serta diumumkan dengan tepat.
- Kontras teks dan kontrol memenuhi WCAG AA.
- Motion menghormati `prefers-reduced-motion`.
