# Fase 3C — Analytics + Rekap Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Fase 3 UI rebuild — make the Performance/Analytics tab and the Rekap Pengiriman view fully coherent with the light design system by retoning the leftover washed-out hardcoded accents to semantic tokens, adopting the 3A semantic `Badge` variants, and giving the shared `Table` primitive an airier feel.

**Architecture:** Pure presentation. Because Plan 3A already made `Card`/`Badge`/`Table` light and token-based, both panels already render light — 3C is a targeted polish: (1) an airier `Table` primitive + the shared status-badge helpers switched to the 3A `Badge` variants; (2) Performance/Analytics accent retone; (3) Rekap stats-card retone. No data, Convex, query, or handler changes.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind 3.4, `lucide-react`. No new dependencies.

## Global Constraints

- **Light-mode ONLY**, indigo/violet accent, airy density — the design system from Plan 3A (tokens + `StatCard` + soft `Badge` variants `success`/`info`/`warning`) is already on `main`. (Spec §2, §3.1)
- **Semantic metric colors:** leads → `lead` (sky/indigo), closing/positive → `positive` (emerald), cancelled/negative → `negative`/`destructive` (red). Use the token classes (`text-positive`, `text-lead`, `bg-positive`, etc.) and the `Badge` variants — not raw washed `-400`/`-500` Tailwind shades. (Spec §2)
- **Presentation-only:** no data/Convex/query/handler changes. Both panels keep consuming their existing props/`useQuery` calls unchanged. (Spec §1, §4)
- **No new features, no charting library** — the analytics keep the functional tables + CSS sparklines, just retoned. (Spec §8)
- **Testing:** `npm run build` (typecheck) + visual review. No new unit tests (pure presentation). The Convex + AnimatedNumber suite stays green (18/18, untouched). (Spec §6)
- **Repo:** git root is `F:/Projects/whatsapp_cs_automotion/wafachat`. Branch off `main`. All paths are repo-relative.

## Testing approach (read before starting)

This is a pure CSS/markup polish — there is no unit-testable logic, and the project has no React render-test infrastructure (vitest is edge-runtime for Convex/pure logic only). Per spec §6, each task is verified by **`npm run build`** + a **visual-review checklist**. Do NOT invent placeholder unit tests. The existing suite (`npm test` → 18/18) is rerun once at the end to confirm nothing in the data layer was touched.

**Commands (run from repo root `wafachat/`):**
- Build/typecheck: `npm run build`
- Dev server for visual review: `npm run dev` → http://localhost:3000/panel
- Regression: `npm test` (expect 18/18)

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `components/ui/table.tsx` | Airier Table primitive (taller header, roomier cells, softer row hover, muted header text) | 1 |
| `app/panel/page.tsx` | `StatusBadge` / `OutcomeBadge` / `ReadinessRow` → 3A semantic `Badge` variants (drop washed `-400` outline colors) | 1 |
| `app/panel/page.tsx` | Performance/Analytics retone: `deltaTag`, `Sparkline` call tones, `kpiCards` tones, the "Per CS" table accent | 2 |
| `app/panel/page.tsx` | Rekap Pengiriman retone: the 5 stats-card tones | 3 |

**Scope boundary (YAGNI):**
- **`button.tsx` is intentionally NOT changed.** It was reviewed: it is already fully token-based (`bg-primary`, `border-border`, `ring-ring`) and renders correctly on the light base; its inert `dark:` variants are harmless. Refining it further would be broad-risk churn for no visible gain. The spec's "refine Button" is satisfied by it already being light-correct.
- **`RecapStatusBadge` (≈ line 2569) is NOT changed** — it already uses light-appropriate fills (`bg-amber-50 text-amber-700`, `bg-blue-50 text-blue-700`, etc.). Leave it.
- **The raw analytics `<table>`s** (Leaderboard / Produk / Trend / Laporan) already use light tokens (`border-border` rows, `text-muted-foreground` headers) and are left structurally as-is; only their colored sub-elements (`deltaTag`, `Sparkline`) are retoned in Task 2.

---

### Task 1: Airy Table primitive + semantic status badges

**Files:**
- Modify: `components/ui/table.tsx` (the `TableHead`, `TableCell`, `TableRow` classNames)
- Modify: `app/panel/page.tsx` — `StatusBadge` (≈ 2545–2555), `OutcomeBadge` (≈ 2557–2567), `ReadinessRow` (≈ 2593–2602)

**Interfaces:**
- Consumes: the 3A `Badge` variants `success` / `info` / `warning` (already on `main`); existing `secondary` / `destructive` / `outline` variants.
- Produces: airier tables app-wide (Rekap table, Performance "Per CS" table) and token-consistent status badges in the conversation/readiness views. No prop/signature changes — `StatusBadge`, `OutcomeBadge`, `ReadinessRow` keep their exact same props.

- [ ] **Step 1: Make the `Table` primitive airier**

In `components/ui/table.tsx`:

`TableHead` — change its className from:
```
"h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0"
```
to:
```
"h-11 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0"
```

`TableCell` — change its className from:
```
"p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0"
```
to:
```
"px-3 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0"
```

`TableRow` — change its className from:
```
"border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted"
```
to:
```
"border-b border-border transition-colors hover:bg-accent/40 has-aria-expanded:bg-accent/40 data-[state=selected]:bg-accent"
```

Leave `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableCaption` unchanged.

- [ ] **Step 2: Switch `StatusBadge` to semantic variants**

In `app/panel/page.tsx`, replace the entire `StatusBadge` function (≈ 2545–2555) with:
```tsx
function StatusBadge({ status }: { status: Conversation['status'] }) {
  if (status === 'handover') {
    return <Badge variant="warning">handover</Badge>;
  }

  if (status === 'closed') {
    return <Badge variant="secondary">closed</Badge>;
  }

  return <Badge variant="success">active</Badge>;
}
```

- [ ] **Step 3: Switch `OutcomeBadge` to semantic variants**

Replace the entire `OutcomeBadge` function (≈ 2557–2567) with:
```tsx
function OutcomeBadge({ outcome }: { outcome: 'ai_won' | 'manual_won' | 'cancelled' }) {
  if (outcome === 'cancelled') {
    return <Badge variant="destructive">cancelled</Badge>;
  }

  return (
    <Badge variant={outcome === 'manual_won' ? 'info' : 'success'}>
      {outcome === 'manual_won' ? 'manual closing' : 'AI closing'}
    </Badge>
  );
}
```

- [ ] **Step 4: Token-fix the `ReadinessRow` ok badge**

Replace the entire `ReadinessRow` function (≈ 2593–2602) with:
```tsx
function ReadinessRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? 'success' : 'outline'}>{value}</Badge>
    </div>
  );
}
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: build completes, no TS errors.

- [ ] **Step 6: Visual review checklist**

`npm run dev` → http://localhost:3000/panel:
- Rekap Pengiriman table (and Performance → "Per CS" table): roomier rows, muted header text, soft indigo row hover — no cramped `p-2` feel.
- Dashboard conversation queue: "active" badge = soft emerald, "handover" = soft amber, "closed" = neutral — none of the old washed `-400` outline text.
- Conversation detail: AI/manual closing badges are soft emerald/indigo; cancelled is soft red.
- "System readiness" rows: green soft badge when OK.

- [ ] **Step 7: Commit**

```bash
git add components/ui/table.tsx app/panel/page.tsx
git commit -m "feat(ui): airy Table primitive + semantic status badges"
```

---

### Task 2: Performance/Analytics retone

**Files:**
- Modify: `app/panel/page.tsx` — `deltaTag` (≈ 1577–1581), the two `Sparkline` call tones (≈ 1728–1729), `kpiCards` array (≈ 1593–1603), the "Per CS" table accent cells (≈ 1871 and 1876–1880)

**Interfaces:**
- Consumes: token color classes `text-positive` / `text-lead` / `text-primary` / `bg-positive` / `bg-lead` (defined in Plan 3A). Existing `data`, `csLeaderboard`, `productDifficulty`, `trendData` props unchanged.
- Produces: the Performance tab using semantic accent tokens instead of washed Tailwind shades.

- [ ] **Step 1: Retone `deltaTag` (up arrow → positive token)**

In `PerformancePanel`, replace the `deltaTag` definition (≈ 1577–1581) with:
```tsx
  const deltaTag = (d: number, suffix = '') => {
    if (d > 0) return <span className="text-positive">▲{d}{suffix}</span>;
    if (d < 0) return <span className="text-destructive">▼{Math.abs(d)}{suffix}</span>;
    return <span className="text-muted-foreground">–</span>;
  };
```

- [ ] **Step 2: Retone the `kpiCards` array**

Replace the `kpiCards` array (≈ 1593–1603) with (only the `tone` values change; labels/values are identical):
```tsx
  const kpiCards = [
    { label: 'Total Percakapan', value: data?.totalLeads ?? 0, tone: 'text-lead' },
    { label: 'Total Closing', value: data?.totalClosing ?? 0, tone: 'text-positive' },
    { label: 'Conversion Rate', value: `${data?.overallCr ?? 0}%`, tone: 'text-primary' },
    { label: 'COD', value: data?.totalCod ?? 0, tone: 'text-amber-600' },
    { label: 'Transfer', value: data?.totalTransfer ?? 0, tone: 'text-lead' },
    { label: 'Metode?', value: unknownPayment, tone: unknownPayment > 0 ? 'text-amber-600' : 'text-muted-foreground' },
    { label: 'Omzet', value: formatRupiah(data?.totalRevenue), tone: 'text-positive' },
    { label: 'Terkirim', value: data?.delivered ?? 0, tone: 'text-positive' },
    { label: 'Dibatalkan', value: data?.cancelled ?? 0, tone: 'text-destructive' },
  ];
```

- [ ] **Step 3: Retone the two `Sparkline` calls**

In the "📈 Trend Harian" card, replace the two `Sparkline` lines (≈ 1728–1729):
```tsx
                <div><div className="text-xs text-muted-foreground">Leads</div><Sparkline values={trendData.map((b) => b.leads)} tone="bg-sky-500/70" /></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><Sparkline values={trendData.map((b) => b.closings)} tone="bg-emerald-500/70" /></div>
```
with:
```tsx
                <div><div className="text-xs text-muted-foreground">Leads</div><Sparkline values={trendData.map((b) => b.leads)} tone="bg-lead" /></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><Sparkline values={trendData.map((b) => b.closings)} tone="bg-positive" /></div>
```

- [ ] **Step 4: Retone the "Per CS" table accent cells**

In the `perfTab === 'cs'` table, the closing cell (≈ 1871):
```tsx
                      <TableCell className="font-bold text-emerald-600">{row.closing}</TableCell>
```
→
```tsx
                      <TableCell className="font-bold text-positive">{row.closing}</TableCell>
```

And the conversion-rate bar block (≈ 1874–1880) — change the bar fill and the percent text:
```tsx
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${row.cr}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-emerald-600">{row.cr}%</span>
```
→
```tsx
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-positive"
                              style={{ width: `${row.cr}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-positive">{row.cr}%</span>
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: build completes, no TS errors.

- [ ] **Step 6: Visual review checklist**

`npm run dev` → http://localhost:3000/panel → Performance tab:
- KPI strip: "Total Percakapan" indigo/sky, "Total Closing"/"Omzet"/"Terkirim" emerald, "Conversion Rate" indigo, "Dibatalkan" red, COD/Metode amber — all crisp on white (no washed pastel).
- Leaderboard/Laporan ▲ deltas are emerald, ▼ deltas red.
- Trend sparklines: Leads bars indigo/sky, Closing bars emerald.
- "Per CS" table: closing + CR bar/percent emerald.

- [ ] **Step 7: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(ui): retone Performance/Analytics accents to semantic tokens"
```

---

### Task 3: Rekap Pengiriman stats retone

**Files:**
- Modify: `app/panel/page.tsx` — the Rekap stats-card array inside `ShippingRecapPanel` (≈ 1185–1190)

**Interfaces:**
- Consumes: token color classes `text-lead` / `text-positive` / `text-primary` (Plan 3A). Existing `counts`, `totalCodValue` references unchanged.
- Produces: the 5 Rekap summary cards using semantic tokens instead of washed `-400` shades.

- [ ] **Step 1: Retone the Rekap stats cards**

In `ShippingRecapPanel`, replace the stats-card array (≈ 1185–1190 — the `[ … ].map((c) => …)` source array) with (only `tone` values change):
```tsx
        {[
          { label: 'Total Periode', value: counts.all, tone: 'text-lead' },
          { label: 'Perlu Review', value: counts.needs_review, tone: 'text-amber-600' },
          { label: 'Siap Export', value: counts.ready, tone: 'text-lead' },
          { label: 'Sudah Terkirim', value: counts.delivered, tone: 'text-positive' },
          { label: 'Nilai COD', value: formatRupiah(totalCodValue), tone: 'text-primary' },
        ].map((c) => (
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: build completes, no TS errors.

- [ ] **Step 3: Run the Convex regression suite (unchanged data layer)**

Run: `npm test`
Expected: 18/18 pass (no UI change touched Convex/logic).

- [ ] **Step 4: Visual review checklist**

`npm run dev` → http://localhost:3000/panel → Rekap Pengiriman:
- The 5 summary cards: "Total Periode"/"Siap Export" indigo/sky, "Perlu Review" amber, "Sudah Terkirim" emerald, "Nilai COD" indigo — crisp on white.
- Status chips, filter bar, bulk-action bar, table, and `RecapStatusBadge` pills all read coherently light (these were already token-based — confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(ui): retone Rekap Pengiriman stats to semantic tokens"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 "refine shared primitives (… Table …)" → Task 1 (airy `Table`); `Button` documented as already-light (scope boundary); `Card`/`Badge` done in 3A. ✓
- §3.3 "Analytics (Performance tab) — KPI row + Leaderboard / Product difficulty / Trend sparkline / Laporan, all restyled airy" → Task 2 (KPI retone, deltaTag, sparkline, Per-CS table); the raw analytics tables already conform (scope boundary). ✓
- §3.3 "Rekap Pengiriman — table/filters restyled" → Task 1 (airy Table used by Rekap; status badges) + Task 3 (stats retone); filter bar/chips already token-based. ✓
- §2 "semantic metric colors (lead/positive/negative), no washed shades" → Tasks 1–3 replace `-400`/`-500` hardcodes with `text-positive`/`text-lead`/`text-primary`/`Badge` variants. ✓
- §4 "data flow unchanged" → no Convex/query/handler edits; only classNames + Badge variant choices change. ✓
- §6 "build + visual review; Convex suite stays green; no new UI unit tests" → per-task build/visual steps + Task 3 reruns `npm test`. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every step shows the exact before/after classes. The `button.tsx`/`RecapStatusBadge`/raw-table "no change" decisions are explicit scope boundaries, not placeholders. ✓

**3. Type/name consistency:** No signature changes — `StatusBadge`/`OutcomeBadge`/`ReadinessRow` keep their exact props; `kpiCards`/stats arrays keep their shape (only `tone` string values change); `Sparkline` keeps its `{ values, tone }` props. Token class names (`text-positive`, `text-lead`, `text-primary`, `bg-positive`, `bg-lead`) and `Badge` variants (`success`, `info`, `warning`, `destructive`, `secondary`, `outline`) all exist on `main` from Plan 3A. ✓

**Note on opacity:** `hover:bg-accent/40` / `bg-amber-50` style classes use solid/registered colors or built-in Tailwind palettes (which support the `/opacity` modifier); the new semantic accents are used as **solid** `text-*`/`bg-*` (no `/opacity` on a CSS-var color), consistent with the Plan 3A approach.
