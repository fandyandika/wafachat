# Panel — Disable AI Dashboard + Accurate Closing Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hilangkan dimensi "AI" yang nyesatin dari panel WaFaChat (semua closing sekarang = CS manusia; AI belum ada) dengan men-disable route/nav CS AI dan mengakuratkan kartu Total Closing.

**Architecture:** Frontend-only (Next.js 14 App Router panel). Tidak ada perubahan Convex/n8n. Implementasi CS-AI dipreservasi sebagai komponen unused (siap di-restore), route-nya jadi server-redirect, kartu Total Closing dibikin akurat. Closing detection tetap jalan apa adanya di backend.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind, lucide-react. Build: `npm run build` (di `wafachat/`). Test eksisting: `npm test` (vitest + convex-test).

## Global Constraints

- Spec: `wafachat/docs/superpowers/specs/2026-06-21-panel-disable-ai-closing-cleanup-design.md`.
- **Frontend-only.** JANGAN ubah `convex/**` atau workflow n8n. JANGAN `npx convex deploy` (ga ada perubahan backend).
- Semua command dijalankan dari folder `wafachat/`.
- Light theme indigo/violet eksisting dipertahankan; presentation-only.
- Subagent commit: `git add <file spesifik>` only — JANGAN `git add -A` / `git add .`.
- Branch kerja dari `main`. Deploy = `git push` ke `main` (Vercel auto-deploy) setelah semua task + review beres.
- Verifikasi build = cek **exit code** `npm run build` (bukan cuma teks "Compiled successfully").

---

### Task 1: Disable & preservasi route CS AI

**Files:**
- Create: `components/panel/cs-ai-dashboard.tsx`
- Modify: `app/panel/cs-ai/page.tsx` (ganti total → server redirect)
- Modify: `app/panel/layout.tsx` (hapus 1 entri NAV + 1 import)

**Interfaces:**
- Produces: `components/panel/cs-ai-dashboard.tsx` mengekspor `export function CsAiDashboard()` (komponen client, identik dengan `CsAiPage` lama). Tidak diimpor siapa pun (preserved untuk re-enable).

- [ ] **Step 1: Pindahkan implementasi CS-AI ke komponen (preservasi)**

Baca `app/panel/cs-ai/page.tsx` saat ini, lalu buat file baru `components/panel/cs-ai-dashboard.tsx` dengan **isi yang sama persis**, dengan 2 perubahan saja:
1. Baris pertama tetap `'use client';`.
2. Ganti baris signature `export default function CsAiPage() {` menjadi `export function CsAiDashboard() {`.

Semua import & body lainnya dibiarkan identik (komponen ini sengaja tidak di-render oleh route mana pun; ini cadangan untuk re-enable nanti).

- [ ] **Step 2: Ganti route page jadi server-redirect**

Timpa total isi `app/panel/cs-ai/page.tsx` dengan:

```tsx
import { redirect } from 'next/navigation';

// CS AI dashboard di-disable sementara (belum ada AI; lihat docs/ROADMAP.md).
// Implementasi dipreservasi di components/panel/cs-ai-dashboard.tsx.
export default function Page() {
  redirect('/panel');
}
```

- [ ] **Step 3: Hapus entri nav CS AI dari layout**

Di `app/panel/layout.tsx`:

Ganti array `NAV`:

```tsx
const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/cs-ai', label: 'CS AI', icon: MessagesSquare },
  { href: '/panel/rekap', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
] as const;
```

menjadi:

```tsx
const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/rekap', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
] as const;
```

Lalu di baris import lucide-react, hapus `MessagesSquare` (sekarang orphan):

```tsx
import { Bot, LayoutDashboard, MessagesSquare, CheckCircle2, BarChart3 } from 'lucide-react';
```

menjadi:

```tsx
import { Bot, LayoutDashboard, CheckCircle2, BarChart3 } from 'lucide-react';
```

- [ ] **Step 4: Verifikasi build hijau + nav benar**

Run: `npm run build`
Expected: exit code 0 (selesai tanpa error). Tidak ada error "MessagesSquare is not defined" / unused import.

Run: `grep -n "cs-ai" app/panel/layout.tsx`
Expected: tidak ada output (nav sudah bersih dari cs-ai).

Run: `grep -n "redirect" app/panel/cs-ai/page.tsx`
Expected: ada `redirect('/panel')`.

- [ ] **Step 5: Commit**

```bash
git add app/panel/cs-ai/page.tsx components/panel/cs-ai-dashboard.tsx app/panel/layout.tsx
git commit -m "feat(panel): disable CS AI route, preserve impl as component"
```

---

### Task 2: Akuratin kartu Total Closing (buang AI/Manual)

**Files:**
- Modify: `app/panel/page.tsx`

**Interfaces:**
- Consumes: `summaryData` dari `api.metrics.getDashboardSummary` (tidak diubah), `totalClosing` dari `performance` (tidak diubah).

- [ ] **Step 1: Konfirmasi pemakaian variabel orphan**

Run: `grep -n "aiClosings\|manualClosings" app/panel/page.tsx`
Expected: muncul di 3 tempat — definisi 2 const (`const manualClosings = ...`, `const aiClosings = ...`), pemakaian di `detail` kartu Total Closing, dan di dependency array `useMemo`. (Kalau ada pemakaian LAIN di luar itu, STOP dan lapor — jangan hapus.)

- [ ] **Step 2: Ganti detail kartu Total Closing**

Di `app/panel/page.tsx`, di dalam array `cards`, kartu Total Closing:

```tsx
      {
        label: 'Total Closing',
        value: totalClosing,
        detail: `AI: ${aiClosings} · Manual: ${manualClosings}`,
        icon: CheckCircle2,
        tone: 'positive',
        highlightable: true,
      },
```

ubah baris `detail` menjadi:

```tsx
        detail: 'Closing CS · periode ini',
```

- [ ] **Step 3: Hapus 2 const orphan**

Hapus dua baris ini (derivasi yang sekarang tak terpakai):

```tsx
  const manualClosings = stats.manual_closings ?? 0;
  const aiClosings = Math.max(totalClosing - manualClosings, 0);
```

- [ ] **Step 4: Update dependency array useMemo**

Di akhir `useMemo` `cards`, dependency array:

```tsx
    [aiClosings, crPerf, manualClosings, performance, revenue, stats, totalClosing],
```

ubah jadi (buang `aiClosings` & `manualClosings`):

```tsx
    [crPerf, performance, revenue, stats, totalClosing],
```

- [ ] **Step 5: Verifikasi build hijau + tidak ada "AI:" nyesatin**

Run: `npm run build`
Expected: exit code 0. Tidak ada error unused-var (`aiClosings`/`manualClosings`).

Run: `grep -n "AI: \${" app/panel/page.tsx`
Expected: tidak ada output (label "AI: X · Manual: Y" sudah hilang).

- [ ] **Step 6: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(panel): show accurate CS-only closing detail on Total Closing card"
```

---

### Task 3: Audit sisa label AI + ROADMAP + verifikasi akhir

**Files:**
- Modify: `docs/ROADMAP.md`
- Audit (read-only): `components/panel/performance-panel.tsx`, `components/panel/shipping-recap-panel.tsx`

- [ ] **Step 1: Audit label AI nyasar di Performance & Rekap**

Run: `grep -rni "\bAI\b\|ai_closing\|manual closing" components/panel/performance-panel.tsx components/panel/shipping-recap-panel.tsx`
Expected: tidak ada label "AI" yang user-facing di Performance/Rekap (breakdown-nya per-CS/produk). Kalau ADA label "AI" yang nyesatin (mis. judul/kolom "AI"), rapikan jadi netral/CS dan catat di commit. Kalau tidak ada, lanjut (audit clean).

- [ ] **Step 2: Tambah 2 entri ROADMAP**

Di `docs/ROADMAP.md`, tambahkan dua entri berikut (boleh di bawah section "## Hardening" atau bikin section "## Deferred features"):

```markdown
### Re-enable AI Dashboard + attribution AI vs CS (saat AI di-setup lagi)
- **Konteks:** Per 2026-06-21 semua closing = CS manusia (AI Chat Handler n8n OFF sejak 06-03). Dimensi AI di panel di-disable (lihat spec `2026-06-21-panel-disable-ai-closing-cleanup-design.md`).
- **Restore UI:** implementasi CS-AI dashboard dipreservasi di `wafachat/components/panel/cs-ai-dashboard.tsx`. Re-enable = balikin entri NAV `/panel/cs-ai` di `app/panel/layout.tsx` + render `<CsAiDashboard/>` dari `app/panel/cs-ai/page.tsx` (ganti redirect), balikin breakdown AI/Manual di kartu Total Closing (`app/panel/page.tsx`).
- **Attribution akurat:** fix receiver n8n `WaFaChat - KirimDev Message Receiver v2` node "Map to append_message" `source`→`role`: `data.message.source === 'api'` → `ai` (AI/automation), `app`/`dashboard`/lainnya → `cs` (manusia). Lalu simpan `closedBy` (`ai`/`cs`) di recap (`upsertRecapFromMessage`) + metric `getDashboardSummary` hitung AI vs CS dari `closedBy` (bukan dari ada/enggaknya `sourceMessageId`). Backfill HANYA recap KirimDev-era (closedAt ≥ 2026-06-21); recap pra-06-04 sudah benar "AI" (era Chat Handler). ⚠️ edit receiver = delete+create (n8n write API rusak) + activate manual.

### Gap empty-body closing (source:"app" / WA Coexistence)
- **Gejala:** sebagian outbound CS dari WA HP (`message.sent` `data.message.source:"app"`) datang dengan `body` KOSONG → Map noop → closing kelewat (intermiten; mayoritas body ada).
- **Opsi:** (a) kalau closing dikirim sebagai WhatsApp template, pakai `data.message.template_name` buat deteksi closing walau body kosong; (b) subscribe event `conversation.closed` sebagai sinyal closing; (c) import Berdu verified rows (`importBerduVerifiedRows`) sebagai source-of-truth closing.
```

- [ ] **Step 3: Verifikasi akhir — build + test hijau**

Run: `npm run build`
Expected: exit code 0.

Run: `npm test`
Expected: semua test hijau (suite eksisting; perubahan presentation-only tidak menyentuh fungsi Convex yang dites).

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): defer AI dashboard re-enable + empty-body closing gap"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §1 (sembunyikan nav cs-ai) → Task 1 Step 3. ✓
- Spec §2 (disable page + preservasi komponen) → Task 1 Steps 1-2. ✓
- Spec §3 (akuratin Total Closing + buang orphan) → Task 2. ✓
- Spec §4 (audit Performance/Rekap) → Task 3 Step 1. ✓
- Spec §5 (ROADMAP 2 entri) → Task 3 Step 2. ✓
- Spec Acceptance (build hijau, 3 menu, redirect mulus, closing akurat, test hijau) → Task 1 Step 4, Task 2 Step 5, Task 3 Step 3. ✓

**2. Placeholder scan:** Tidak ada TBD/TODO. Semua step punya kode/command konkret. ✓

**3. Type consistency:** `CsAiDashboard` (Task 1) konsisten dipakai di ROADMAP (Task 3). Nama var `aiClosings`/`manualClosings` (Task 2) cocok dengan kode eksisting `app/panel/page.tsx`. ✓

## Acceptance (recap)

- `npm run build` exit 0; `npm test` hijau.
- Nav: Dashboard / Rekap Pengiriman / Performance (tanpa "CS AI").
- `/panel/cs-ai` → redirect mulus ke `/panel` (ga mount query berat).
- Kartu Total Closing: angka apa adanya + detail "Closing CS · periode ini" (tanpa AI/Manual).
- `docs/ROADMAP.md` punya 2 entri deferred.
