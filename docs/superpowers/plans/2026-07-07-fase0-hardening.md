# Fase 0 — Hardening (SaaS Blueprint §3.1-3, §13.1)

**Goal:** WaFaChat aman dipakai orang selain internal — semua Convex function ber-auth,
hardcode pustakaislam jadi settings, observability dasar — TANPA memutus panel produksi
yang dipakai CS setiap hari.

**Prinsip rollout:** setiap langkah backward-compatible; enforcement auth di-flip TERAKHIR
setelah terverifikasi identitas mengalir di production logs.

## Arsitektur auth (keputusan)

- Session cookie (HS256, httpOnly) TIDAK berubah — nol risiko ke login existing.
- **Token Convex terpisah**: `GET /api/auth/convex-token` (cookie-authed) → JWT **RS256**
  short-lived (15 mnt) berisi claims `{sub, role, name, email, csName}`, `iss`
  `https://wafachat.vercel.app`, `aud "convex"`.
- Public key dipublikasikan via `GET /.well-known/jwks.json` (dibaca deployment Convex).
- `convex/auth.config.ts` provider Custom JWT (issuer + jwks + RS256).
- Browser: `ConvexReactClient.setAuth(fetchToken)` — sekali di provider, semua useQuery/
  snapshot hook otomatis membawa identitas.
- API routes (server): mint token sendiri (private key) → `ConvexHttpClient.setAuth`.
- Convex: helper `getViewer(ctx)` + `requireAdmin/requireMember` di `convex/authz.ts`.
  Mode `AUTH_ENFORCE` (env Convex): `off` → permisif (warn log), `on` → tolak.
- Pola `authSecret` existing (auth.ts, followUp) & adapter-secret n8n TIDAK berubah.

## Tasks

1. **Keys & plumbing** — generate RSA keypair; env: `CONVEX_JWT_PRIVATE_KEY_B64` (Next,
   local + Vercel), public JWK di-derive dari private key. Files: `lib/convex-token.ts`,
   `app/.well-known/jwks.json/route.ts`, `app/api/auth/convex-token/route.ts`.
2. **Convex config & helper** — `convex/auth.config.ts`, `convex/authz.ts`
   (`getViewer`, `requireMember`, `requireAdmin`, enforcement via env `AUTH_ENFORCE`),
   unit test via `convex-test` `t.withIdentity`.
3. **Client wiring** — `ConvexClientProvider` setAuth; snapshot hook ikut otomatis
   (pakai client dari provider); API route response-times → HttpClient.setAuth.
4. **Guard sweep mutations** (permisif): csConfigs, cs (avatar), settings,
   shippingRecaps (mark*/update/backfill/import/reparse), state (mark*/delete/create),
   messages (appendMessage/deleteMessage/appendMessageFromN8n → requireMember),
   events.appendEvent, followUp mutations tanpa authSecret, closingRules.
5. **Guard sweep queries** (permisif): analytics.*, shippingRecaps.getPerformance/list/
   getCounts, metrics.*, responseTime, followUp queries, cs.listCs, csConfigs.list,
   state queries. Role rule: member cukup (scoping per-CS detail menyusul multi-tenant).
6. **Verifikasi & flip** — deploy permisif → cek Convex logs identitas hadir dari panel
   prod → set `AUTH_ENFORCE=on` (dashboard env) → smoke test panel + jalur n8n.
7. **Hardcode → settings** — tabel `orgSettings` (single row sementara): timezone,
   cutoffHour (16), jam aktif SLA, internalTestPhones[], dataCutoffMs. Reader helper +
   default = nilai sekarang; ganti pemakaian di lib.ts / report-window / queries.
   (Frasa closing sudah configurable via `closingRules` — biarkan.)
8. **Observability** — tabel `auditLogs` (aksi admin: user CRUD, csConfig CRUD, recap
   mark*, export) ditulis dari mutations ter-guard; endpoint export CSV dasar.

## Kriteria selesai Fase 0
- Panggilan Convex anonim DITOLAK (kecuali jalur authSecret/adapter server-side) —
  dibuktikan curl anonim gagal.
- Panel (admin + CS) berfungsi normal; 142+ test hijau + test authz baru.
- Tidak ada konstanta pustakaislam-specific dibaca langsung logika (semua via settings).
- Audit log terisi untuk aksi admin destruktif.
