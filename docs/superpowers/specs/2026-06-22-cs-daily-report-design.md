# Laporan Harian CS — Design

**Date:** 2026-06-22
**Status:** Approved (design phase)
**Owner:** pustakaislam.net WA CS Automation (WaFaChat)

## Goal

Give the owner an **accurate, WaFaChat-generated daily CS report** on a **16:00→16:00 WIB ("4 sore") window**, mirroring the format CS already post manually to the WA group — so the owner has a trustworthy real number to judge CS performance against. When WaFaChat's numbers are proven accurate over time, the owner can release CS from manual reporting.

## Context & model

- WaFaChat is already real-time and accurate: leads, closings, CR, omzet, per-CS, products. ~90% of the CS report is already computed.
- CS keep posting their manual report (template + freeform "kendala") to a WA group. **WaFaChat does NOT parse or ingest those messages.** The owner compares by eye.
- The CS report fields and where they come from:

| Field report CS | Sumber WaFaChat |
|---|---|
| Per-produk CR `TZN 33% (1/3)` | derived (per-CS × per-produk) |
| Total Leads / Closing / CR | existing dedup rules (`computeCsAgg`) |
| Diskon (total) | `shippingRecaps.discount` (parsed dari "Diskon:" di pesan closing) |
| CP Diskon (diskon ÷ closing) | derived |
| Mis Rep | **CS judgment — NOT generated.** WaFaChat only surfaces an auto-detected "duplikat" proxy |

- **Kode produk** (TZN/B7S/…) tidak dipakai — pakai nama produk. (Owner decision.)
- **Window labeling = close-date:** report bertanggal `D` mencakup `[16:00 (D-1), 16:00 D)` WIB. (Owner decision.)
- **Scope = view + tombol Copy teks WA.** Auto-post ke grup ditunda (roadmap). (Owner decision.)

## Reference aggregator (consistency requirement)

The panel's trusted per-CS numbers come from **`computeCsAgg`** in [`convex/analytics.ts`](../../../convex/analytics.ts) (consumed via `getPeriodReport` in the Performance "Laporan" card). `getPerformance` in `shippingRecaps.ts` is **not** consumed by any component.

`computeCsAgg` rules (the report MUST match these so totals are identical to what the owner already sees):
- Exclude internal/test phones (`isInternalTestPhone`).
- Exclude recaps with status `cancelled` / `cancelled_after_export`.
- **Leads** deduped by **phone** (`Set<normalizePhone>`), grouped by **raw** `assignedCsName`.
- **Closings** deduped by **`orderIdBerdu ‖ normalizePhone`**, grouped by **raw** `csName`.
- Revenue per closing = `total ?? codValue ?? nonCodItemPrice ?? 0`.

What `computeCsAgg` does NOT have, and the report adds: **discount**, **per-product nesting inside each CS**, **duplicate count**.

## Non-goals (explicitly NOT built)

- No parsing/ingestion of CS WA-group messages.
- No full Mis Rep (uncontactable / wrong-number are CS judgment). Only an auto "duplikat (nomor sama)" proxy.
- No off-template discount capture (only the parsed `discount`).
- No auto-post to WA/Telegram (roadmap).
- No manual data-entry fields in the panel.
- No changes to the existing Dashboard / Performance views (additive only).

---

## 1. Architecture

New additive route **`/panel/laporan` — "Laporan Harian"**. One new Convex query, two pure client utils, one view + card component, one nav entry. Nothing existing is modified except a small nav addition and a route-scoped hide of the midnight range buttons.

```
/panel/laporan (route)
  └─ DailyReportDashboard (client)
       ├─ reportWindow util  ── 4pm-window resolver (pure)
       ├─ useQuery(api.analytics.getDailyReport, { startAt, endAt })
       ├─ grand-total strip
       └─ ReportCard[] (one per CS)  ──> reportText() copy (pure util)
```

**Rejected alternative:** calling `getPerformance` once per CS from the client. `getPerformance` filters on **raw** `csName` (`args.csName === order.assignedCsName`) but returns **display-normalized** names from its `cs[]` (e.g. raw `"Aisyah"` → `"CS Aisyah"`). Passing a normalized name back as the filter would mismatch and undercount. A single nested query groups by raw name once and normalizes only at the display edge — correct, and one table scan instead of 1+N.

## 2. Query `getDailyReport`

Location: `convex/analytics.ts` (next to `computeCsAgg`, reusing its helpers and rules).

**Signature:** `getDailyReport({ startAt: number, endAt: number })`

**Algorithm (single pass over the window):**
1. Fetch `orders` by `by_createdAt` in `[startAt, endAt]`, `recaps` by `by_closedAt` in `[startAt, endAt]`.
2. Apply the exact `computeCsAgg` filters (internal-excluded; cancelled-excluded for closings).
3. Build `Map<rawCsName, CsAccum>` where:
   - `leads: Set<phone>` — dedup by phone
   - `closings: Set<orderId‖phone>` — dedup by order key
   - `revenue: number`, `discount: number` (`r.discount ?? 0`)
   - `rawLeadCount: number` — count of in-window orders for this CS **before** phone-dedup (for duplicates)
   - `products: Map<product, { leads: Set<phone>, closings: Set<orderKey> }>`
4. **Product of a closing** = matched in-window order's product name, fallback `recap.packageContent`, via `normalizeProductName` (anti-fragmentation: same product name as leads). Build `latestOrderByPhone` from in-window orders to match. (Cross-window order fallback DB lookup is deferred — see §7.)
5. Product of a lead = `normalizeProductName(order.productName || order.products)`.

**Return contract:**
```ts
{
  windowStart: number,
  windowEnd: number,
  totals: {                         // global union dedup (matches getPeriodReport totals semantics)
    leads: number, closings: number, cr: number,   // cr = closings/leads*100, 1 dp, guard leads=0 → 0
    revenue: number, discount: number,
    cpDiscount: number,             // discount/closings, rounded to integer rupiah, guard closings=0 → 0
    duplicates: number,             // globalRawLeads - globalUniqueLeads
  },
  cs: Array<{
    csName: string,                 // DISPLAY-normalized at the edge
    leads: number, closings: number, cr: number,
    revenue: number, discount: number, cpDiscount: number,
    duplicates: number,             // perCsRawLeads - perCsUniqueLeads
    products: Array<{ product: string, leads: number, closings: number, cr: number }>,
  }>,                               // sorted by closings desc, then leads desc
}
```
- Grand `totals` use **global union** dedup across all CS (a phone under two CS counts once globally) — identical to `getPeriodReport`'s `totals()`. Per-CS rows dedup within the CS. The two need not sum exactly; this matches existing behavior.
- Products sorted by `leads` desc, tiebreak name. A CS's products array includes products that have closings even if 0 in-window leads (CR guarded).
- CS rows with `leads === 0 && closings === 0` are omitted.

## 3. Window logic — `components/panel/report-window.ts` (pure, tested)

- `JAK_MS = 7*3600*1000`. 4pm WIB for calendar `Y-M-D` = `Date.UTC(Y, M, D, 9, 0, 0)` (16−7).
- `reportWindowForLabelDate(Y,M,D)` → `{ startAt: fourPm(Y,M,D-1), endAt: fourPm(Y,M,D) }` (close-date convention; `endAt` exclusive in intent, passed as the inclusive upper bound to the indexed range — a hit exactly at 4pm is negligible and owned by the next window).
- `currentReportWindow(now)` → the **open** window containing `now`: if WIB hour `< 16` the label date is today, else tomorrow; window = `[close-24h, close)`.
- `labelDateOf(window)` → the close-date (for display + text).
- **Data cutoff clamp:** `startAt = Math.max(startAt, DATA_CUTOFF_MS)` (reuse the `2026-06-22T00:00:00+07:00` constant from `use-panel-filters.ts`). Expose a `clamped: boolean` so the UI can note "data dari 22 Jun 00:00".

## 4. UI — `/panel/laporan`

**`DailyReportDashboard`:**
- Header controls (in page body, not the global header): day stepper `◀ [date] ▶` + native date input. Default = `currentReportWindow(now)`. Day state in `?day=YYYY-MM-DD` (omit when = current).
- Explicit window line: `Periode 21 Jun 16:00 → 22 Jun 16:00 WIB · Laporan 22 Jun` + a `berjalan` badge when it's the open window; a small note when `clamped`.
- **Grand-total strip:** Total Leads · Total Closing · CR · Omzet · Diskon · CP Diskon.
- **`ReportCard` per CS** (mirrors the WA format):

```
🟠 CS Azella                       Laporan · Senin 22 Jun
21 Jun 16:00 → 22 Jun 16:00 · berjalan
──────────────────────────────────────────────
Quran Mapping        72%   (31/43)
Al-Quran Tazyin      57%   (4/7)
Al-Quran Medis       67%   (2/3)
──────────────────────────────────────────────
Total Leads    60      Diskon     Rp40.000
Total Closing  40      CP Diskon  Rp1.000
CR             67%     Duplikat   1
                              [ 📋 Copy teks WA ]
```

- Light theme, consistent with current panel components (`Card`, `Badge`, etc.). Products listed leads-desc.
- Route-scoped: hide the global midnight range buttons in `PanelShell` when `pathname === '/panel/laporan'` (they don't apply); **keep** the CS `Select` (narrows to one card).
- Empty state: if no CS has activity, show "Belum ada aktivitas di window ini."

## 5. Copy teks WA — `components/panel/report-text.ts` (pure, tested)

`reportText(card, labelDate)` produces, exactly:
```
📝 SUMMARY CR
🟠 CS AZELLA

HARI SENIN
22 JUNI 2026

🔰 QURAN MAPPING : 72% (31/43)
🔰 AL-QURAN TAZYIN : 57% (4/7)
...

  . TOTAL LEADS      : 60
  . TOTAL CLOSING : 40
  . CR : 67%

  . Diskon : Rp40.000
  . CP Diskon : 1.000
```
- Indonesian day (`HARI SENIN`) + date (`22 JUNI 2026`) from the close-date, uppercase.
- Thousands separator with `.` (`Rp40.000`, `1.000`).
- CR / CP rounding consistent with the query.
- Mis Rep line **omitted** (CS judgment). Duplikat is shown in the card UI but kept out of the copy text by default (the text is meant to become the CS report; duplikat is a judging aid, not a CS claim). Revisit when CS reporting is retired.
- Copy via `navigator.clipboard.writeText`, with a "Tersalin" toast/checkmark.

## 6. Testing

- **`getDailyReport`** (`convex/analytics.test.ts`): phone dedup; nested per-CS×product; CP Diskon (`40000/40=1000`); internal-phone exclusion; cancelled exclusion; duplicate count (raw−unique); **equivalence:** per-CS + grand-total `leads/closings/cr` equal `computeCsAgg`/`getPeriodReport` for the same window (drift guard).
- **`report-window.ts`:** 4pm WIB math; close-date labeling; `currentReportWindow` for `<16:00` vs `≥16:00`; cutoff clamp + `clamped` flag.
- **`report-text.ts`:** exact string (Indonesian day/month, uppercase, thousands separator, CR/CP rounding, product lines).
- **UI:** light — follow existing panel patterns (no heavy component tests).

## 7. Deferred / future

- Cross-window order fallback for product names (closing today for a lead created before the window) — current fallback is `recap.packageContent`. Add the targeted `orders` lookup (like `getPerformance`) if product names look fragmented.
- Auto-post each CS report to the WA/Telegram group at 16:00 via n8n (overlaps roadmap "Live alerts → Telegram").
- Optional Mis Rep / kendala capture in-panel (only if owner later wants WaFaChat to own the whole report).

## 8. File structure

**Backend**
- `convex/analytics.ts` — add `getDailyReport` query (+ shared rules with `computeCsAgg`).
- `convex/analytics.test.ts` — query tests incl. equivalence.

**Frontend**
- `app/panel/laporan/page.tsx` — route.
- `components/panel/daily-report-dashboard.tsx` — view (window controls, grand strip, cards).
- `components/panel/report-card.tsx` — single CS card + Copy button.
- `components/panel/report-window.ts` (+ `.test.ts`) — 4pm window resolver.
- `components/panel/report-text.ts` (+ `.test.ts`) — WA-format text generator.
- `app/panel/layout.tsx` — add `{ href: '/panel/laporan', label: 'Laporan', icon: ClipboardList }` to `NAV` (import `ClipboardList` from `lucide-react`); hide midnight ranges when on this route.
