# Laporan Harian CS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/panel/laporan` view that shows an accurate, WaFaChat-generated daily CS report on a 16:00→16:00 WIB window, mirroring the CS WA report format, with a per-CS "Copy teks WA" button.

**Architecture:** One new Convex query (`getDailyReport` in `convex/analytics.ts`) that mirrors `computeCsAgg`'s dedup/exclusion rules exactly (so numbers match the Performance page) and adds discount + per-CS×product nesting + duplicate count. All testable display logic lives in two dependency-free client utils (`report-window.ts`, `report-text.ts`). Thin client components render cards. Additive only — nothing in Dashboard/Performance changes.

**Tech Stack:** Convex 1.39, Next.js 14 (App Router, RSC + 'use client'), vitest 2 (edge-runtime) + convex-test, Tailwind + shadcn UI primitives.

**Spec:** `docs/superpowers/specs/2026-06-22-cs-daily-report-design.md`

## Global Constraints

Copied verbatim from the spec — every task implicitly includes these:

- **Window = close-date:** report dated `D` = `[16:00 (D-1), 16:00 D)` WIB. 4pm WIB = `Date.UTC(Y, M, D, 9, 0, 0)` (16−7).
- **Mirror `computeCsAgg` rules exactly** (so totals match Performance): exclude `isInternalTestPhone`; exclude recap status `cancelled` / `cancelled_after_export`; **leads** dedup by `normalizePhone` (Set); **closings** dedup by `orderIdBerdu ‖ normalizePhone` (Set); revenue per closing = `total ?? codValue ?? nonCodItemPrice ?? 0`.
- **Group by RAW `csName`** (`assignedCsName` / `csName`); normalize for **display only** via the exported `normalizeCsName` from `shippingRecaps.ts`.
- `discount = r.discount ?? 0`. `cpDiscount = closings > 0 ? Math.round(discount / closings) : 0`. `cr = l > 0 ? Math.round((c / l) * 1000) / 10 : 0` (query keeps 1 dp; **display rounds to integer** to match the CS format).
- `DATA_CUTOFF_MS = Date.parse('2026-06-22T00:00:00+07:00')`.
- **Additive only.** Do not change Dashboard/Performance query logic.
- TDD per task. Commit after each green task; end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run tests from the `wafachat` dir (cwd resets between shells): `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run <file>`. Build gate: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build` (must exit 0 — check the exit code, not just "Compiled").

## File Structure

**Backend**
- `convex/analytics.ts` (modify) — add `getDailyReport` query next to `computeCsAgg`.
- `convex/shippingRecaps.ts` (modify, 1 line) — `export` the existing `normalizeCsName` (display normalizer).
- `convex/analytics.test.ts` (modify) — add `getDailyReport` tests incl. equivalence vs `getCsLeaderboard`.

**Frontend**
- `components/panel/report-window.ts` (create) — dependency-free 4pm-window math + `DATA_CUTOFF_MS` source of truth.
- `components/panel/report-window.test.ts` (create).
- `components/panel/use-panel-filters.ts` (modify) — import `DATA_CUTOFF_MS` from `report-window` (remove local const).
- `components/panel/report-text.ts` (create) — dependency-free WA-format text generator.
- `components/panel/report-text.test.ts` (create).
- `components/panel/report-card.tsx` (create) — single CS card + Copy button.
- `components/panel/daily-report-dashboard.tsx` (create) — view (window controls, grand strip, cards).
- `app/panel/laporan/page.tsx` (create) — route.
- `app/panel/layout.tsx` (modify) — add `Laporan` nav entry; hide midnight ranges on this route.

---

### Task 1: `report-window.ts` — 4pm window math (pure, tested)

**Files:**
- Create: `components/panel/report-window.ts`
- Test: `components/panel/report-window.test.ts`
- Modify: `components/panel/use-panel-filters.ts:39` (replace local `DATA_CUTOFF_MS` const with an import)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `JAK_MS: number` (= `7*60*60*1000`)
  - `DATA_CUTOFF_MS: number`
  - `fourPmWibMs(y, m, d): number`
  - `reportWindowForLabelDate(y, m, d): { startAt: number; endAt: number }`
  - `wibDateParts(ms): { y: number; m: number; d: number; dow: number }` (WIB Y/0-based-M/D/day-of-week)
  - `currentReportLabelDate(now): { y: number; m: number; d: number }` (0-based month)
  - `clampStartToCutoff(startAt): { startAt: number; clamped: boolean }`

- [ ] **Step 1: Write the failing test**

Create `components/panel/report-window.test.ts`:
```ts
import { expect, test } from 'vitest';
import {
  fourPmWibMs, reportWindowForLabelDate, wibDateParts, currentReportLabelDate, clampStartToCutoff, DATA_CUTOFF_MS,
} from './report-window';

test('fourPmWibMs: 16:00 WIB == 09:00 UTC', () => {
  expect(fourPmWibMs(2026, 5, 22)).toBe(Date.UTC(2026, 5, 22, 9, 0, 0));
});

test('reportWindowForLabelDate: close-date window [4pm D-1, 4pm D)', () => {
  const w = reportWindowForLabelDate(2026, 5, 22); // 22 Jun
  expect(w.startAt).toBe(Date.UTC(2026, 5, 21, 9, 0, 0)); // 4pm 21 Jun
  expect(w.endAt).toBe(Date.UTC(2026, 5, 22, 9, 0, 0));   // 4pm 22 Jun
});

test('reportWindowForLabelDate: rolls over month start', () => {
  const w = reportWindowForLabelDate(2026, 6, 1); // 1 Jul -> start 30 Jun
  expect(w.startAt).toBe(Date.UTC(2026, 5, 30, 9, 0, 0));
  expect(w.endAt).toBe(Date.UTC(2026, 6, 1, 9, 0, 0));
});

test('wibDateParts: returns WIB calendar parts + dow', () => {
  // 4pm 22 Jun 2026 WIB; 22 Jun 2026 is a Monday (dow=1)
  const p = wibDateParts(Date.UTC(2026, 5, 22, 9, 0, 0));
  expect(p).toEqual({ y: 2026, m: 5, d: 22, dow: 1 });
});

test('currentReportLabelDate: before 16:00 WIB -> today', () => {
  // 22 Jun 10:00 WIB = 22 Jun 03:00 UTC
  expect(currentReportLabelDate(Date.UTC(2026, 5, 22, 3, 0, 0))).toEqual({ y: 2026, m: 5, d: 22 });
});

test('currentReportLabelDate: at/after 16:00 WIB -> tomorrow', () => {
  // 22 Jun 18:00 WIB = 22 Jun 11:00 UTC
  expect(currentReportLabelDate(Date.UTC(2026, 5, 22, 11, 0, 0))).toEqual({ y: 2026, m: 5, d: 23 });
});

test('clampStartToCutoff: clamps starts before the data cutoff', () => {
  const before = DATA_CUTOFF_MS - 1000;
  expect(clampStartToCutoff(before)).toEqual({ startAt: DATA_CUTOFF_MS, clamped: true });
  const after = DATA_CUTOFF_MS + 1000;
  expect(clampStartToCutoff(after)).toEqual({ startAt: after, clamped: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run components/panel/report-window.test.ts`
Expected: FAIL — `Failed to resolve import "./report-window"`.

- [ ] **Step 3: Write the implementation**

Create `components/panel/report-window.ts`:
```ts
// Dependency-free 4pm-WIB ("4 sore") daily-report window math. No react/next imports
// so it runs clean in the edge-runtime vitest env. Source of truth for DATA_CUTOFF_MS.

export const JAK_MS = 7 * 60 * 60 * 1000;

// Closing/leads pipeline only fully wired from 2026-06-22 (Asia/Jakarta); earlier data
// is incomplete, so every window's start is clamped to this cutoff.
export const DATA_CUTOFF_MS = Date.parse('2026-06-22T00:00:00+07:00');

/** 16:00 WIB for calendar Y-M-D (m is 0-based) === 09:00 UTC. */
export function fourPmWibMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 9, 0, 0);
}

/** Close-date convention: report labelled D covers [4pm (D-1), 4pm D). */
export function reportWindowForLabelDate(y: number, m: number, d: number): { startAt: number; endAt: number } {
  return { startAt: fourPmWibMs(y, m, d - 1), endAt: fourPmWibMs(y, m, d) };
}

/** WIB calendar parts (0-based month) + day-of-week (0=Sun) for a timestamp. */
export function wibDateParts(ms: number): { y: number; m: number; d: number; dow: number } {
  const w = new Date(ms + JAK_MS);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), dow: w.getUTCDay() };
}

/** Label date of the OPEN window containing `now`: today if before 16:00 WIB, else tomorrow. */
export function currentReportLabelDate(now: number): { y: number; m: number; d: number } {
  const w = new Date(now + JAK_MS);
  const base = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate());
  const labelMs = w.getUTCHours() < 16 ? base : base + 86_400_000;
  const L = new Date(labelMs);
  return { y: L.getUTCFullYear(), m: L.getUTCMonth(), d: L.getUTCDate() };
}

export function clampStartToCutoff(startAt: number): { startAt: number; clamped: boolean } {
  const clamped = startAt < DATA_CUTOFF_MS;
  return { startAt: clamped ? DATA_CUTOFF_MS : startAt, clamped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run components/panel/report-window.test.ts`
Expected: PASS (7 passed).

- [ ] **Step 5: Point `use-panel-filters.ts` at the shared constant**

In `components/panel/use-panel-filters.ts`, delete the local `DATA_CUTOFF_MS` declaration (around line 36-39) and import it instead. At the top with the other imports add:
```ts
import { DATA_CUTOFF_MS } from './report-window';
```
Remove these lines (the comment + const):
```ts
// Closing/leads pipeline only fully wired from 2026-06-22 (Asia/Jakarta). Earlier data
// is incomplete (closing not connected → CR/leads misleading), so hide it: every range's
// start is clamped to this cutoff.
const DATA_CUTOFF_MS = Date.parse('2026-06-22T00:00:00+07:00');
```
(The usage `Math.max(rawStartAt, DATA_CUTOFF_MS)` stays unchanged.)

- [ ] **Step 6: Verify the existing filters still typecheck/build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: exit 0, "Compiled successfully".

- [ ] **Step 7: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/report-window.ts components/panel/report-window.test.ts components/panel/use-panel-filters.ts && git commit -m "feat(laporan): 4pm-WIB report-window util + shared DATA_CUTOFF_MS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `getDailyReport` Convex query (mirrors `computeCsAgg`, adds discount/product/duplicates)

**Files:**
- Modify: `convex/shippingRecaps.ts:212` (add `export` to `normalizeCsName`)
- Modify: `convex/analytics.ts` (add `getDailyReport`; import `normalizeCsName`)
- Test: `convex/analytics.test.ts` (append tests)

**Interfaces:**
- Consumes: `normalizePhone`, `isInternalTestPhone` from `./lib`; `normalizeProductName`, `normalizeCsName` from `./shippingRecaps`.
- Produces query `api.analytics.getDailyReport({ startAt, endAt })` returning:
```ts
{
  windowStart: number, windowEnd: number,
  totals: { leads: number, closings: number, cr: number, revenue: number, discount: number, cpDiscount: number, duplicates: number },
  cs: Array<{
    csName: string, leads: number, closings: number, cr: number,
    revenue: number, discount: number, cpDiscount: number, duplicates: number,
    products: Array<{ product: string, leads: number, closings: number, cr: number }>,
  }>,
}
```

- [ ] **Step 1: Export the display normalizer**

In `convex/shippingRecaps.ts`, change line 212 from:
```ts
function normalizeCsName(value: string | undefined): string {
```
to:
```ts
export function normalizeCsName(value: string | undefined): string {
```
(Body unchanged — it maps bare `aisyah` → `CS Aisyah`, else returns the cleaned name.)

- [ ] **Step 2: Write the failing tests**

Append to `convex/analytics.test.ts` (the file already defines `convexTest`, `DAY`, `t0`, `ordBase`, `recBase`):
```ts
test("getDailyReport: per-CS×product, discount, CP diskon, duplicates", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // CS A: 3 leads on product Q (one is a duplicate phone), 2 closings, discount 40000 total
    await ctx.db.insert("orders", { ...ordBase, orderId: "A1", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "A2", customerPhone: "62812", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "A3", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0 + 1, updatedAt: t0 }); // dup phone of A1
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A1", customerPhone: "62811", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 25000, status: "ready", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A2", customerPhone: "62812", csName: "CS A", packageContent: "QURAN MAPPING 1 PCS", closedAt: t0, total: 100000, discount: 15000, status: "ready", createdAt: t0, updatedAt: t0 });
    // an internal/test phone lead must be excluded
    await ctx.db.insert("orders", { ...ordBase, orderId: "X1", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran Mapping", createdAt: t0, updatedAt: t0 });
    // a cancelled closing must be excluded
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "A9", customerPhone: "62899", csName: "CS A", packageContent: "Quran Mapping", closedAt: t0, total: 100000, status: "cancelled", createdAt: t0, updatedAt: t0 });
  });

  const r = await t.query(api.analytics.getDailyReport, { startAt: t0 - 1, endAt: t0 + DAY });
  const a = r.cs.find((c) => c.csName === "CS A")!;
  expect(a.leads).toBe(2);          // 62811 (deduped) + 62812; internal phone excluded
  expect(a.duplicates).toBe(1);     // A3 shares 62811 with A1
  expect(a.closings).toBe(2);       // A1 + A2; cancelled excluded
  expect(a.cr).toBe(100);           // 2/2
  expect(a.discount).toBe(40000);   // 25000 + 15000
  expect(a.cpDiscount).toBe(20000); // 40000 / 2
  // product grouped under the canonical order name, not the SKU packageContent
  expect(a.products).toEqual([{ product: "Quran Mapping", leads: 2, closings: 2, cr: 100 }]);
  // grand totals
  expect(r.totals.leads).toBe(2);
  expect(r.totals.closings).toBe(2);
  expect(r.totals.discount).toBe(40000);
  expect(r.totals.cpDiscount).toBe(20000);
});

test("getDailyReport: per-CS totals match getCsLeaderboard (no drift)", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
  });
  const report = await t.query(api.analytics.getDailyReport, { startAt: t0, endAt: t0 + DAY });
  const board = await t.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
  for (const row of board) {
    if (row.leads === 0 && row.closings === 0) continue; // omitted in the report
    const card = report.cs.find((c) => c.csName === row.csName);
    expect(card, `card for ${row.csName}`).toBeDefined();
    expect(card!.leads).toBe(row.leads);
    expect(card!.closings).toBe(row.closings);
    expect(card!.cr).toBe(row.cr);
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/analytics.test.ts`
Expected: FAIL — `getDailyReport` is not a function / property missing on `api.analytics`.

- [ ] **Step 4: Implement the query**

In `convex/analytics.ts`, update the `shippingRecaps` import (line 4) to include the normalizer:
```ts
import { normalizeProductName, normalizeCsName } from "./shippingRecaps";
```
Then append the query at the end of the file:
```ts
type ProductAcc = { leads: Set<string>; closings: Set<string> };
type CsReportAcc = {
  leads: Set<string>; closings: Set<string>;
  revenue: number; discount: number; rawLeads: number;
  products: Map<string, ProductAcc>;
};

export const getDailyReport = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    const orders = (
      await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
    const recaps = (
      await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt)).collect()
    ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

    // Resolve a closing's product to the matched in-window order's name (anti-fragmentation),
    // falling back to the recap's own packageContent.
    const latestOrderByPhone = new Map<string, any>();
    for (const o of orders) {
      const p = normalizePhone(o.customerPhone);
      const ex = latestOrderByPhone.get(p);
      if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
    }

    const map = new Map<string, CsReportAcc>();
    const getCs = (cs: string): CsReportAcc => {
      let a = map.get(cs);
      if (!a) { a = { leads: new Set(), closings: new Set(), revenue: 0, discount: 0, rawLeads: 0, products: new Map() }; map.set(cs, a); }
      return a;
    };
    const getProd = (a: CsReportAcc, prod: string): ProductAcc => {
      let p = a.products.get(prod);
      if (!p) { p = { leads: new Set(), closings: new Set() }; a.products.set(prod, p); }
      return p;
    };

    for (const o of orders) {
      const a = getCs(o.assignedCsName);
      a.rawLeads += 1;
      const phone = normalizePhone(o.customerPhone);
      a.leads.add(phone);
      getProd(a, normalizeProductName(o.productName || o.products)).leads.add(phone);
    }
    for (const r of recaps) {
      const a = getCs(r.csName);
      const key = r.orderIdBerdu || normalizePhone(r.customerPhone);
      a.closings.add(key);
      a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      a.discount += r.discount ?? 0;
      const matched = latestOrderByPhone.get(normalizePhone(r.customerPhone));
      getProd(a, normalizeProductName(matched?.productName || matched?.products || r.packageContent)).closings.add(key);
    }

    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cpd = (disc: number, c: number) => (c > 0 ? Math.round(disc / c) : 0);

    const cs = Array.from(map.entries())
      .map(([rawName, a]) => {
        const leads = a.leads.size, closings = a.closings.size;
        const products = Array.from(a.products.entries())
          .map(([product, p]) => ({ product, leads: p.leads.size, closings: p.closings.size, cr: cr(p.closings.size, p.leads.size) }))
          .filter((p) => p.leads > 0 || p.closings > 0)
          .sort((x, y) => y.leads - x.leads || x.product.localeCompare(y.product));
        return {
          csName: normalizeCsName(rawName),
          leads, closings, cr: cr(closings, leads),
          revenue: a.revenue, discount: a.discount, cpDiscount: cpd(a.discount, closings),
          duplicates: a.rawLeads - leads,
          products,
        };
      })
      .filter((c) => c.leads > 0 || c.closings > 0)
      .sort((x, y) => y.closings - x.closings || y.leads - x.leads);

    // Grand totals: global union dedup (matches getPeriodReport totals semantics).
    const gLeads = new Set<string>(), gClos = new Set<string>();
    let gRevenue = 0, gDiscount = 0, gRawLeads = 0;
    for (const o of orders) { gRawLeads += 1; gLeads.add(normalizePhone(o.customerPhone)); }
    for (const r of recaps) {
      gClos.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
      gRevenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
      gDiscount += r.discount ?? 0;
    }

    return {
      windowStart: args.startAt, windowEnd: args.endAt,
      totals: {
        leads: gLeads.size, closings: gClos.size, cr: cr(gClos.size, gLeads.size),
        revenue: gRevenue, discount: gDiscount, cpDiscount: cpd(gDiscount, gClos.size),
        duplicates: gRawLeads - gLeads.size,
      },
      cs,
    };
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/analytics.test.ts`
Expected: PASS (all, including the 2 new tests).

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/analytics.ts convex/analytics.test.ts convex/shippingRecaps.ts && git commit -m "feat(laporan): getDailyReport query (per-CS×product, diskon, duplikat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `report-text.ts` — WA-format text generator (pure, tested)

**Files:**
- Create: `components/panel/report-text.ts`
- Test: `components/panel/report-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `groupThousands(n: number): string` (e.g. `40000` → `"40.000"`)
  - `type ReportCsCard` (structural subset of a `getDailyReport` cs row)
  - `reportText(card: ReportCsCard, label: { y: number; m: number; d: number; dow: number }): string`

- [ ] **Step 1: Write the failing test**

Create `components/panel/report-text.test.ts`:
```ts
import { expect, test } from 'vitest';
import { groupThousands, reportText } from './report-text';

test('groupThousands: dot separators', () => {
  expect(groupThousands(40000)).toBe('40.000');
  expect(groupThousands(1000)).toBe('1.000');
  expect(groupThousands(0)).toBe('0');
  expect(groupThousands(1234567)).toBe('1.234.567');
});

test('reportText: exact WA format', () => {
  const card = {
    csName: 'CS Azella',
    leads: 60, closings: 40, cr: 66.7,
    discount: 40000, cpDiscount: 1000,
    products: [
      { product: 'Quran Mapping', leads: 43, closings: 31, cr: 72.1 },
      { product: 'Al-Quran Tazyin', leads: 7, closings: 4, cr: 57.1 },
    ],
  };
  // 22 Jun 2026 is a Monday (dow=1), month index 5 = JUNI
  const out = reportText(card, { y: 2026, m: 5, d: 22, dow: 1 });
  expect(out).toBe(
`📝 SUMMARY CR
🟠 CS AZELLA

HARI SENIN
22 JUNI 2026

🔰 QURAN MAPPING : 72% (31/43)
🔰 AL-QURAN TAZYIN : 57% (4/7)

  . TOTAL LEADS      : 60
  . TOTAL CLOSING : 40
  . CR : 67%

  . Diskon : Rp40.000
  . CP Diskon : 1.000`
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run components/panel/report-text.test.ts`
Expected: FAIL — `Failed to resolve import "./report-text"`.

- [ ] **Step 3: Write the implementation**

Create `components/panel/report-text.ts`:
```ts
// Dependency-free generator for the CS WA report text. Deterministic formatting
// (no Intl locale dependence) so the exact-string test is stable across envs.

export const DAYS_ID = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
export const MONTHS_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

export function groupThousands(n: number): string {
  const neg = n < 0 ? '-' : '';
  const s = Math.abs(Math.round(n)).toString();
  return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export type ReportCsCard = {
  csName: string;
  leads: number; closings: number; cr: number;
  discount: number; cpDiscount: number;
  products: Array<{ product: string; leads: number; closings: number; cr: number }>;
};

export function reportText(card: ReportCsCard, label: { y: number; m: number; d: number; dow: number }): string {
  const lines: string[] = [
    '📝 SUMMARY CR',
    '🟠 ' + card.csName.toUpperCase(),
    '',
    'HARI ' + DAYS_ID[label.dow],
    `${label.d} ${MONTHS_ID[label.m]} ${label.y}`,
    '',
  ];
  for (const p of card.products) {
    lines.push(`🔰 ${p.product.toUpperCase()} : ${Math.round(p.cr)}% (${p.closings}/${p.leads})`);
  }
  lines.push(
    '',
    `  . TOTAL LEADS      : ${card.leads}`,
    `  . TOTAL CLOSING : ${card.closings}`,
    `  . CR : ${Math.round(card.cr)}%`,
    '',
    `  . Diskon : Rp${groupThousands(card.discount)}`,
    `  . CP Diskon : ${groupThousands(card.cpDiscount)}`,
  );
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run components/panel/report-text.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/report-text.ts components/panel/report-text.test.ts && git commit -m "feat(laporan): WA-format report-text generator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `ReportCard` + `DailyReportDashboard` components

No unit tests (no React testing lib installed; all testable logic lives in the Task 1–3 utils/query). The gate is a clean `npm run build` (typecheck + compile). Keep components thin.

**Files:**
- Create: `components/panel/report-card.tsx`
- Create: `components/panel/daily-report-dashboard.tsx`

**Interfaces:**
- Consumes: `api.analytics.getDailyReport` (Task 2); `reportWindowForLabelDate`, `currentReportLabelDate`, `clampStartToCutoff`, `wibDateParts`, `JAK_MS` (Task 1); `reportText`, `type ReportCsCard` (Task 3); `usePanelFilters` (existing, for `csName`); `formatRupiah` from `@/lib/format`.
- Produces: `ReportCard`, `DailyReportDashboard` (named exports).

- [ ] **Step 1: Create `report-card.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatRupiah } from '@/lib/format';
import { reportText, type ReportCsCard } from '@/components/panel/report-text';

export type ReportCardData = ReportCsCard & { duplicates: number; revenue: number };

export function ReportCard({
  card, label, windowLabel, isCurrent,
}: {
  card: ReportCardData;
  label: { y: number; m: number; d: number; dow: number };
  windowLabel: string;
  isCurrent: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(card, label));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context) — ignore */
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate">🟠 {card.csName}</span>
            {isCurrent && <Badge variant="secondary">berjalan</Badge>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{windowLabel}</div>
        </div>
        <Button size="sm" variant="outline" onClick={onCopy} className="shrink-0 gap-1.5">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Tersalin' : 'Copy teks WA'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {card.products.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada produk.</div>
          ) : (
            card.products.map((p) => (
              <div key={p.product} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{p.product}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round(p.cr)}% ({p.closings}/{p.leads})
                </span>
              </div>
            ))
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
          <Row label="Total Leads" value={card.leads} />
          <Row label="Diskon" value={formatRupiah(card.discount)} />
          <Row label="Total Closing" value={card.closings} />
          <Row label="CP Diskon" value={formatRupiah(card.cpDiscount)} />
          <Row label="CR" value={`${Math.round(card.cr)}%`} />
          <Row label="Duplikat" value={card.duplicates} />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `daily-report-dashboard.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { formatRupiah } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ReportCard, type ReportCardData } from '@/components/panel/report-card';
import {
  JAK_MS, clampStartToCutoff, currentReportLabelDate, reportWindowForLabelDate, wibDateParts,
} from '@/components/panel/report-window';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS_SHORT = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function fmtBoundary(ms: number): string {
  const p = wibDateParts(ms);
  const t = new Date(ms + JAK_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${p.d} ${MONTHS_SHORT[p.m]} ${hh}:${mm}`;
}
function pad(n: number) { return String(n).padStart(2, '0'); }

export function DailyReportDashboard() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { csName } = usePanelFilters();
  const dayParam = sp.get('day');

  const now = Date.now();
  const current = useMemo(() => currentReportLabelDate(now), [now]);
  const labelDate = useMemo(() => {
    if (dayParam) {
      const [y, m, d] = dayParam.split('-').map(Number);
      if (y && m && d) return { y, m: m - 1, d };
    }
    return current;
  }, [dayParam, current]);

  const rawWindow = reportWindowForLabelDate(labelDate.y, labelDate.m, labelDate.d);
  const { startAt, clamped } = clampStartToCutoff(rawWindow.startAt);
  const endAt = rawWindow.endAt;
  const isCurrent = current.y === labelDate.y && current.m === labelDate.m && current.d === labelDate.d;

  const report = useQuery(api.analytics.getDailyReport, { startAt, endAt });

  const label = wibDateParts(endAt);
  const windowLabel = `Periode ${fmtBoundary(startAt)} → ${fmtBoundary(endAt)} WIB`;
  const titleDate = `${DAYS_SHORT[label.dow]} ${label.d} ${MONTHS_SHORT[label.m]} ${label.y}`;
  const dateInputValue = `${label.y}-${pad(label.m + 1)}-${pad(label.d)}`;

  const goTo = (next: { y: number; m: number; d: number }) => {
    const nextIsCurrent = current.y === next.y && current.m === next.m && current.d === next.d;
    const qs = new URLSearchParams(sp.toString());
    if (nextIsCurrent) qs.delete('day');
    else qs.set('day', `${next.y}-${pad(next.m + 1)}-${pad(next.d)}`);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };
  const step = (delta: number) => {
    const L = new Date(Date.UTC(labelDate.y, labelDate.m, labelDate.d) + delta * 86_400_000);
    goTo({ y: L.getUTCFullYear(), m: L.getUTCMonth(), d: L.getUTCDate() });
  };
  const onPick = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    if (y && m && d) goTo({ y, m: m - 1, d });
  };

  const cards = ((report?.cs ?? []) as ReportCardData[]).filter((c) => !csName || c.csName === csName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" className="size-9" onClick={() => step(-1)} aria-label="Hari sebelumnya">
          <ChevronLeft className="size-4" />
        </Button>
        <input
          type="date"
          value={dateInputValue}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button size="icon" variant="outline" className="size-9" onClick={() => step(1)} disabled={isCurrent} aria-label="Hari berikutnya">
          <ChevronRight className="size-4" />
        </Button>
        <div className="ml-1 text-sm font-medium">Laporan {titleDate}</div>
      </div>

      <div className="text-xs text-muted-foreground">
        {windowLabel}
        {isCurrent && ' · berjalan'}
        {clamped && ' · data dari 22 Jun 00:00 (sebelumnya belum akurat)'}
      </div>

      {report === undefined ? (
        <div className="text-sm text-muted-foreground">Memuat…</div>
      ) : (
        <>
          <GrandStrip totals={report.totals} />
          {cards.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Belum ada aktivitas di window ini.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((c) => (
                <ReportCard key={c.csName} card={c} label={label} windowLabel={windowLabel} isCurrent={isCurrent} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GrandStrip({
  totals,
}: {
  totals: { leads: number; closings: number; cr: number; revenue: number; discount: number; cpDiscount: number };
}) {
  const items = [
    { label: 'Total Leads', value: totals.leads },
    { label: 'Total Closing', value: totals.closings },
    { label: 'CR', value: `${Math.round(totals.cr)}%` },
    { label: 'Omzet', value: formatRupiah(totals.revenue) },
    { label: 'Diskon', value: formatRupiah(totals.discount) },
    { label: 'CP Diskon', value: formatRupiah(totals.cpDiscount) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">{it.label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify build (typecheck + compile)**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: exit 0. (The route isn't wired yet — Task 5 — but the components must compile.)

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/report-card.tsx components/panel/daily-report-dashboard.tsx && git commit -m "feat(laporan): ReportCard + DailyReportDashboard components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Route + nav entry + route-scoped range hide

**Files:**
- Create: `app/panel/laporan/page.tsx`
- Modify: `app/panel/layout.tsx` (NAV import + entry; conditional render of midnight ranges)

**Interfaces:**
- Consumes: `DailyReportDashboard` (Task 4).
- Produces: the `/panel/laporan` route + sidebar/mobile nav link.

- [ ] **Step 1: Create the route**

Create `app/panel/laporan/page.tsx`:
```tsx
import { DailyReportDashboard } from '@/components/panel/daily-report-dashboard';

// Client component uses useSearchParams; the panel layout already wraps children in <Suspense>.
export default function Page() {
  return <DailyReportDashboard />;
}
```

- [ ] **Step 2: Add the nav entry**

In `app/panel/layout.tsx`, add `ClipboardList` to the lucide import (line 6):
```ts
import { Bot, LayoutDashboard, BarChart3, ClipboardList } from 'lucide-react';
```
and add the entry to `NAV` (line 14-17):
```ts
const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
  { href: '/panel/laporan', label: 'Laporan', icon: ClipboardList },
] as const;
```

- [ ] **Step 3: Hide the midnight range buttons on `/panel/laporan`**

In `app/panel/layout.tsx`, the header renders the `RANGES` buttons (the `<div className="flex flex-wrap items-center gap-1">` block, ~line 86-100). Wrap that block so it only shows off this route. Replace:
```tsx
                <div className="flex flex-wrap items-center gap-1">
                  {RANGES.map((r) => (
```
with:
```tsx
                {pathname !== '/panel/laporan' && (
                <div className="flex flex-wrap items-center gap-1">
                  {RANGES.map((r) => (
```
and close the conditional right after that div's closing `</div>` (before the `<Select>`):
```tsx
                  ))}
                </div>
                )}
                <Select value={cs} onValueChange={(v) => setParam('cs', v ?? 'all')}>
```
(The CS `Select` stays — it narrows the report to one card.)

- [ ] **Step 4: Verify build + lint**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: exit 0; `/panel/laporan` appears in the route list.

- [ ] **Step 5: Run the full test suite (regression)**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run`
Expected: PASS (all suites — analytics, report-window, report-text, plus pre-existing).

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/panel/laporan/page.tsx app/panel/layout.tsx && git commit -m "feat(laporan): /panel/laporan route + nav + route-scoped range hide

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Finishing

After all tasks pass + build is green:
1. Use **superpowers:finishing-a-development-branch** — verify tests, merge `cs-daily-report` → `main` (`--ff-only` if possible), delete branch.
2. Deploy the new Convex query to prod from `main`: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex deploy -y`.
3. `git push origin main`.
4. Manual smoke: open `/panel/laporan`, confirm window line + cards render, "Copy teks WA" copies the expected text, day stepper works, totals match `/panel/performance` for the same window.

## Self-Review

- **Spec coverage:** §1 architecture → Tasks 4-5. §2 query → Task 2. §3 window → Task 1. §4 UI → Task 4. §5 copy text → Task 3. §6 testing → Tasks 1-3 (utils/query) + build gate (UI). §7 deferred → not built (correct). §8 file structure → matches.
- **Placeholders:** none — every code step has full content.
- **Type consistency:** `ReportCsCard` (Task 3) ⊂ `ReportCardData` (Task 4); `getDailyReport` return (Task 2) feeds `report.cs`/`report.totals` (Task 4); `wibDateParts`/`currentReportLabelDate`/`clampStartToCutoff` signatures (Task 1) match their Task 4 call sites; `normalizeCsName` exported (Task 2 Step 1) before import (Task 2 Step 4).
