# On-Demand Performance Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading global analytics filters with an owner-only Performance report that loads weekly, monthly, or bounded custom data only after explicit submission.

**Architecture:** Keep Dashboard operational and page-local, remove analytics state from the shared layout, and let Performance own draft versus submitted filters. One new Convex query aggregates indexed `dailyRollups` for the current and comparison ranges; bounded response samples are optional and may degrade independently.

**Tech Stack:** Next.js App Router, React, TypeScript, Convex 1.39, Vitest, `convex-test`, existing panel UI primitives, native date/month inputs.

## Global Constraints

- Business date `D` means `[D-1 16:00 WIB, D 16:00 WIB)`.
- Performance weeks are Monday through Sunday; Queen's fixed four bonus buckets must not change.
- A custom range is inclusive and may contain at most 35 business dates.
- Draft input changes must not query Convex; only `Tampilkan laporan` and `Refresh` may request the report.
- Use `dailyRollups` via `by_org_windowKey`; do not scan orders, recaps, conversations, or messages.
- Keep every report section scoped to the same authenticated organization, period, and optional CS.
- The query is admin/owner-only and must call `requireAdminOrg`.
- Response-time reads are capped at 12,000 samples and may become unavailable without failing the core report.
- Do not add charts, export, snapshots, cron jobs, auto-generation, dependencies, or background writes.
- Keep Dashboard's local calendar-day/work-period toggle; Settings must show no analytics controls.

---

### Task 1: Shared Performance Period Math

**Files:**
- Create: `lib/performance-report.ts`
- Create: `lib/performance-report.test.ts`

**Interfaces:**
- Consumes: ISO calendar labels in `YYYY-MM-DD` and month labels in `YYYY-MM`.
- Produces:
  - `type PerformancePeriod = 'week' | 'month' | 'custom'`
  - `type DateRange = { startDate: string; endDate: string }`
  - `resolvePerformanceRange(period, input): DateRange`
  - `effectivePerformanceRange(selected, today): DateRange`
  - `previousPerformanceRange(period, selected, effective): DateRange`
  - `splitMonthIntoCalendarWeeks(month): Array<DateRange & { partial: boolean }>`
  - `inclusiveDateCount(range): number`
  - shared `MetricRow`, `CsMetricRow`, `ProductMetricRow`, and `PerformanceReport` types used by Convex and React.

- [ ] **Step 1: Write failing period-math tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  effectivePerformanceRange,
  inclusiveDateCount,
  previousPerformanceRange,
  resolvePerformanceRange,
  splitMonthIntoCalendarWeeks,
} from './performance-report';

describe('performance report periods', () => {
  it('resolves a week across a year boundary', () => {
    expect(resolvePerformanceRange('week', { anchorDate: '2027-01-01' })).toEqual({
      startDate: '2026-12-28', endDate: '2027-01-03',
    });
  });

  it('splits August 2026 into clipped Monday-Sunday rows', () => {
    expect(splitMonthIntoCalendarWeeks('2026-08')).toEqual([
      { startDate: '2026-08-01', endDate: '2026-08-02', partial: true },
      { startDate: '2026-08-03', endDate: '2026-08-09', partial: false },
      { startDate: '2026-08-10', endDate: '2026-08-16', partial: false },
      { startDate: '2026-08-17', endDate: '2026-08-23', partial: false },
      { startDate: '2026-08-24', endDate: '2026-08-30', partial: false },
      { startDate: '2026-08-31', endDate: '2026-08-31', partial: true },
    ]);
  });

  it('compares a running month with the same elapsed days', () => {
    const selected = resolvePerformanceRange('month', { month: '2026-08' });
    const effective = effectivePerformanceRange(selected, '2026-08-05');
    expect(previousPerformanceRange('month', selected, effective)).toEqual({
      startDate: '2026-07-01', endDate: '2026-07-05',
    });
  });

  it('compares a completed month with the complete preceding month', () => {
    const selected = resolvePerformanceRange('month', { month: '2026-03' });
    expect(previousPerformanceRange('month', selected, selected)).toEqual({
      startDate: '2026-02-01', endDate: '2026-02-28',
    });
  });

  it('uses the immediately adjacent equal-length custom range', () => {
    expect(previousPerformanceRange(
      'custom',
      { startDate: '2026-07-10', endDate: '2026-07-14' },
      { startDate: '2026-07-10', endDate: '2026-07-14' },
    )).toEqual({ startDate: '2026-07-05', endDate: '2026-07-09' });
  });

  it('counts inclusive dates at the 35-day boundary', () => {
    expect(inclusiveDateCount({ startDate: '2026-07-01', endDate: '2026-08-04' })).toBe(35);
    expect(inclusiveDateCount({ startDate: '2026-07-01', endDate: '2026-08-05' })).toBe(36);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `rtk npm test -- lib/performance-report.test.ts`

Expected: FAIL because `./performance-report` does not exist.

- [ ] **Step 3: Implement UTC-only calendar helpers**

```ts
export type PerformancePeriod = 'week' | 'month' | 'custom';
export type DateRange = { startDate: string; endDate: string };
type RangeInput = { anchorDate?: string; month?: string; startDate?: string; endDate?: string };

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateMs(value: string): number {
  if (!ISO_DATE.test(value)) throw new Error('Tanggal harus berformat YYYY-MM-DD');
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error('Tanggal tidak valid');
  }
  return ms;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDate(dateMs(value) + days * DAY_MS);
}

export function inclusiveDateCount(range: DateRange): number {
  const count = Math.floor((dateMs(range.endDate) - dateMs(range.startDate)) / DAY_MS) + 1;
  if (count < 1) throw new Error('Tanggal akhir harus sama atau setelah tanggal awal');
  return count;
}

export function resolvePerformanceRange(period: PerformancePeriod, input: RangeInput): DateRange {
  if (period === 'custom') {
    if (!input.startDate || !input.endDate) throw new Error('Lengkapi rentang tanggal');
    const range = { startDate: input.startDate, endDate: input.endDate };
    inclusiveDateCount(range);
    return range;
  }
  if (period === 'week') {
    if (!input.anchorDate) throw new Error('Pilih tanggal pekan');
    const day = new Date(dateMs(input.anchorDate)).getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startDate = addDays(input.anchorDate, mondayOffset);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  if (!input.month || !/^\d{4}-\d{2}$/.test(input.month)) throw new Error('Pilih bulan');
  const startDate = `${input.month}-01`;
  dateMs(startDate);
  return { startDate, endDate: isoDate(Date.UTC(+input.month.slice(0, 4), +input.month.slice(5, 7), 0)) };
}
```

Add these exact helpers to the same file:

```ts
export function effectivePerformanceRange(selected: DateRange, today: string): DateRange {
  dateMs(today);
  if (dateMs(selected.startDate) > dateMs(today)) throw new Error('Periode belum dimulai');
  return { ...selected, endDate: dateMs(selected.endDate) > dateMs(today) ? today : selected.endDate };
}

export function previousPerformanceRange(
  period: PerformancePeriod,
  selected: DateRange,
  effective: DateRange,
): DateRange {
  const elapsed = inclusiveDateCount(effective);
  if (period !== 'month') {
    const endDate = addDays(selected.startDate, -1);
    return { startDate: addDays(endDate, 1 - elapsed), endDate };
  }
  const year = +selected.startDate.slice(0, 4);
  const monthIndex = +selected.startDate.slice(5, 7) - 1;
  const startDate = isoDate(Date.UTC(year, monthIndex - 1, 1));
  const fullPrevious = resolvePerformanceRange('month', { month: startDate.slice(0, 7) });
  if (effective.endDate === selected.endDate) return fullPrevious;
  const elapsedEnd = addDays(startDate, elapsed - 1);
  return {
    startDate,
    endDate: dateMs(elapsedEnd) > dateMs(fullPrevious.endDate) ? fullPrevious.endDate : elapsedEnd,
  };
}

export function splitMonthIntoCalendarWeeks(month: string): Array<DateRange & { partial: boolean }> {
  const monthRange = resolvePerformanceRange('month', { month });
  const rows: Array<DateRange & { partial: boolean }> = [];
  let startDate = monthRange.startDate;
  while (dateMs(startDate) <= dateMs(monthRange.endDate)) {
    const day = new Date(dateMs(startDate)).getUTCDay();
    const daysToSunday = day === 0 ? 0 : 7 - day;
    const naturalEnd = addDays(startDate, daysToSunday);
    const endDate = dateMs(naturalEnd) > dateMs(monthRange.endDate) ? monthRange.endDate : naturalEnd;
    const naturalStart = addDays(startDate, day === 0 ? -6 : 1 - day);
    rows.push({
      startDate,
      endDate,
      partial: naturalStart < monthRange.startDate || naturalEnd > monthRange.endDate,
    });
    startDate = addDays(endDate, 1);
  }
  return rows;
}
```

Add the shared report types directly below the date helpers:

```ts
export type MetricRow = {
  leads: number; closings: number; cr: number; revenue: number;
  cod: number; transfer: number; codPct: number; transferPct: number;
  delivered: number; cancelled: number; discount: number;
};
export type CsMetricRow = MetricRow & {
  csKey: string; csName: string; responseMedianMs: number | null; deltaCr: number;
};
export type ProductMetricRow = MetricRow & { product: string };
export type PerformanceReport = {
  period: PerformancePeriod;
  startDate: string; endDate: string; effectiveEndDate: string;
  status: 'running' | 'complete'; generatedAt: number;
  responseNotice?: string;
  summary: MetricRow & { deltaLeads: number; deltaClosings: number; deltaCr: number; deltaRevenue: number };
  cs: CsMetricRow[];
  products: ProductMetricRow[];
  weeks: Array<DateRange & { partial: boolean; status: 'running' | 'complete'; metrics: MetricRow }>;
};
```

- [ ] **Step 4: Add validation cases for malformed, reversed, and future inputs**

```ts
it('rejects invalid and reversed dates', () => {
  expect(() => resolvePerformanceRange('custom', { startDate: '2026-02-30', endDate: '2026-03-01' })).toThrow('Tanggal tidak valid');
  expect(() => inclusiveDateCount({ startDate: '2026-08-02', endDate: '2026-08-01' })).toThrow('Tanggal akhir');
  expect(() => effectivePerformanceRange(
    { startDate: '2026-08-02', endDate: '2026-08-08' },
    '2026-08-01',
  )).toThrow('Periode belum dimulai');
});
```

The 35-day product limit is enforced by the query and client submission; this helper exposes the exact inclusive count used by both.

- [ ] **Step 5: Run the focused tests**

Run: `rtk npm test -- lib/performance-report.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the period math**

```bash
rtk git add lib/performance-report.ts lib/performance-report.test.ts
rtk git commit -m "feat: add performance report period math"
```

---

### Task 2: Indexed Convex Performance Report Query

**Files:**
- Create: `convex/performanceReports.ts`
- Create: `convex/performanceReports.test.ts`
- Modify: `convex/rollupReaders.ts`
- Modify: `convex/analyticsBounds.ts`

**Interfaces:**
- Consumes:
  - Task 1 period helpers from `lib/performance-report.ts`
  - `businessDateKeyForWindowKey` and `windowKeyForBusinessDate` from `convex/lib.ts`
  - `requireAdminOrg(ctx, 'performanceReports.getPerformanceReport')`
  - indexed `dailyRollups` and canonical response-sample markers.
- Produces:
  - `api.performanceReports.getPerformanceReport`
  - args `{ period, startDate, endDate, csName? }`
  - a result conforming to the shared `PerformanceReport` type from Task 1.
  - `responseTimesForPerformanceReport(ctx, orgId, args)` returning bounded optional response summaries without changing the existing 3,000-row exact-reader behavior.

- [ ] **Step 1: Write failing Convex tests for authorization, aggregation, and scoping**

Create fixtures for two organizations, two CS rows, two dates, and two products. Use `convex-test` with an admin identity and assert:

```ts
const report = await asAdmin.query(api.performanceReports.getPerformanceReport, {
  period: 'custom', startDate: '2026-07-01', endDate: '2026-07-02',
});
expect(report.summary).toMatchObject({
  leads: 30, closings: 15, cr: 50, revenue: 3_000_000,
  cod: 9, transfer: 6, codPct: 60, transferPct: 40,
});
expect(report.cs.map((row) => row.csName)).toEqual(['Aisyah', 'Lila']);
expect(report.products[0].product).toBe('Quran Mapping');
```

Add assertions that:

- a `csName: 'Aisyah'` request scopes summary, CS, product, previous comparison, and response metrics;
- data from organization B never appears;
- a CS identity is rejected;
- 35 dates are accepted and 36 are rejected;
- zero COD plus transfer returns both percentages as zero;
- daily leads are additive across dates;
- an August monthly report returns all six clipped weekly rows and their leads sum to the monthly summary.

- [ ] **Step 2: Run the query test and verify it fails**

Run: `rtk npm test -- convex/performanceReports.test.ts`

Expected: FAIL because `api.performanceReports` does not exist.

- [ ] **Step 3: Add bounded constants without increasing existing readers**

In `convex/analyticsBounds.ts` add:

```ts
export const MAX_PERFORMANCE_ROLLUPS_PER_RANGE = 1_000;
export const MAX_PERFORMANCE_RESPONSE_SAMPLES = 12_000;
```

Keep `MAX_RESPONSE_SAMPLES = 3_000` unchanged for existing analytics functions.

- [ ] **Step 4: Refactor response-sample collection once and add graceful degradation**

In `convex/rollupReaders.ts`, preserve the current `rollupWindows.sampleRunId` routing so migrated windows still read `rollupMigrationSamples`. Extract the current collection loop into a private function that accepts a limit, then retain the existing API and add:

```ts
export async function responseTimesForPerformanceReport(
  ctx: any,
  orgId: Id<'organizations'>,
  args: { startAt: number; endAt: number; csKey?: string },
): Promise<{ data: Awaited<ReturnType<typeof responseTimesFromSamples>> | null; limited: boolean }> {
  try {
    return {
      data: await collectAndSummarizeResponseSamples(ctx, orgId, args, MAX_PERFORMANCE_RESPONSE_SAMPLES),
      limited: false,
    };
  } catch (error) {
    if (error instanceof SampleLimitExceeded) return { data: null, limited: true };
    throw error;
  }
}
```

Use a private `SampleLimitExceeded` class so only the known cap condition degrades. Do not swallow database, authorization, or programming errors. Add one test proving `responseTimesFromSamples` still throws after 3,000 rows and the new helper returns `{ data: null, limited: true }` after 12,000.

- [ ] **Step 5: Define the report validators and pure aggregators**

In `convex/performanceReports.ts`, define validators for every returned field. Use this stable shape:

```ts
const metricFields = {
  leads: v.number(), closings: v.number(), cr: v.number(), revenue: v.number(),
  cod: v.number(), transfer: v.number(), codPct: v.number(), transferPct: v.number(),
  delivered: v.number(), cancelled: v.number(), discount: v.number(),
};

type MetricRow = {
  leads: number; closings: number; cr: number; revenue: number;
  cod: number; transfer: number; codPct: number; transferPct: number;
  delivered: number; cancelled: number; discount: number;
};
```

Import the shared `PerformanceReport` type from Task 1 and keep aggregation helpers pure:

```ts
function aggregateRollups(rows: Doc<'dailyRollups'>[]): MetricRow;
function aggregateCs(current: Doc<'dailyRollups'>[], previous: Doc<'dailyRollups'>[]): CsMetricRow[];
function aggregateProducts(rows: Doc<'dailyRollups'>[]): ProductMetricRow[];
function percent(numerator: number, denominator: number): number;
```

Use `leadsCust`, `closings`, `revenue`, `cod ?? 0`, `transfer ?? 0`, `delivered`, `cancelled`, and `discount`. CR is `closings / leads * 100`; payment ratios use `cod + transfer`. Sort CS by closings descending then name, and products by closings descending then product.

- [ ] **Step 6: Implement one indexed, admin-only query**

```ts
export const getPerformanceReport = query({
  args: {
    period: v.union(v.literal('week'), v.literal('month'), v.literal('custom')),
    startDate: v.string(),
    endDate: v.string(),
    csName: v.optional(v.string()),
  },
  returns: performanceReportValidator,
  handler: async (ctx, args): Promise<PerformanceReport> => {
    const { orgId } = await requireAdminOrg(ctx, 'performanceReports.getPerformanceReport');
    const selected = resolvePerformanceRange(args.period, {
      startDate: args.startDate, endDate: args.endDate,
      anchorDate: args.startDate, month: args.startDate.slice(0, 7),
    });
    if (selected.startDate !== args.startDate || selected.endDate !== args.endDate) {
      throw new Error('Rentang tidak sesuai dengan jenis periode');
    }
    if (inclusiveDateCount(selected) > 35) throw new Error('Maksimal 35 hari');
    const today = businessDateKeyForWindowKey(Date.now());
    const effective = effectivePerformanceRange(selected, today);
    const previous = previousPerformanceRange(args.period, selected, effective);
    const [currentRows, previousRows] = await Promise.all([
      readRollups(ctx, orgId, effective, args.csName),
      readRollups(ctx, orgId, previous, args.csName),
    ]);
    return buildPerformanceReport(ctx, orgId, args.period, selected, effective, currentRows, previousRows);
  },
});
```

Define `readRollups(...)` with the indexed query below and `buildPerformanceReport(...)` as the sole orchestration function around the pure aggregators. Pass `args.csName` through to the response helper as its canonical `csKey`; obtain that key from the already-filtered rollup rows, and return an empty scoped report when no matching rows exist.

For each range, convert the business dates to stored source window keys with `windowKeyForBusinessDate`, then query:

```ts
ctx.db.query('dailyRollups')
  .withIndex('by_org_windowKey', q =>
    q.eq('orgId', orgId).gte('windowKey', firstKey).lte('windowKey', lastKey))
  .take(MAX_PERFORMANCE_ROLLUPS_PER_RANGE + 1)
```

Reject only when the rollup cap is exceeded, with a message instructing the owner to narrow the range or choose one CS. Apply `csName` to both current and comparison rows before every aggregation. Call the bounded response helper only after core rollups pass; set `responseNotice` to `Response time membutuhkan rentang lebih pendek` when limited. Derive each monthly weekly row by filtering current rollups through `businessDateKeyForWindowKey` and the Task 1 week boundaries.

- [ ] **Step 7: Run query and existing reader tests**

Run: `rtk npm test -- convex/performanceReports.test.ts convex/rollupReaders.test.ts`

Expected: PASS, including tenant isolation, range caps, and response-only degradation.

- [ ] **Step 8: Generate Convex types**

Run: `rtk npx convex codegen`

Expected: exit 0 and `_generated/api` includes `performanceReports`.

- [ ] **Step 9: Commit the backend query**

```bash
rtk git add convex/performanceReports.ts convex/performanceReports.test.ts convex/rollupReaders.ts convex/analyticsBounds.ts convex/_generated
rtk git commit -m "feat: add bounded performance report query"
```

---

### Task 3: Remove Misleading Shared Header Filters

**Files:**
- Modify: `app/panel/layout.tsx`
- Create: `app/panel/layout.test.tsx`

**Interfaces:**
- Consumes: current panel navigation and authorization behavior.
- Produces: a shared layout with plain navigation links and no range/CS analytics state.

- [ ] **Step 1: Write a failing layout regression test**

Mock `next/navigation` and `useMe`, render the layout with `renderToStaticMarkup`, and assert:

```ts
expect(html).not.toContain('30 hari');
expect(html).not.toContain('Bulan ini');
expect(html).not.toContain('Semua CS');
expect(html).toContain('href="/panel/performance"');
expect(html).not.toContain('range=');
expect(html).not.toContain('cs=');
```

Use pathname `/panel/settings` so this specifically prevents analytics controls returning to Settings.

- [ ] **Step 2: Run the layout test and verify current controls fail it**

Run: `rtk npm test -- app/panel/layout.test.tsx`

Expected: FAIL because the existing layout renders range buttons and a CS selector.

- [ ] **Step 3: Delete the global filter implementation**

From `app/panel/layout.tsx`, remove `RANGES`, `usePanelFilters`, the CS query/select, `useSearchParams`, `setParam`, and conditional filter rendering. Render only the page title/brand in the top bar. Change navigation links to:

```tsx
<Link href={item.href}>...</Link>
```

Do not remove Dashboard's `WindowModeToggle`; it is page-local in `app/panel/page.tsx` and remains meaningful.

- [ ] **Step 4: Run the layout regression test**

Run: `rtk npm test -- app/panel/layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the layout deletion**

```bash
rtk git add app/panel/layout.tsx app/panel/layout.test.tsx
rtk git commit -m "fix: remove misleading panel filters"
```

---

### Task 4: On-Demand Performance Controls and Data Flow

**Files:**
- Modify: `app/panel/performance/page.tsx`
- Create: `app/panel/performance/page.test.tsx`

**Interfaces:**
- Consumes:
  - `api.performanceReports.getPerformanceReport` from Task 2
  - `resolvePerformanceRange`, `inclusiveDateCount`, and `PerformanceReport` from Task 1
  - existing `useConvexSnapshotQuery(queryRef, args | 'skip')`.
- Produces:
  - separate draft and submitted state;
  - native weekly anchor, month, and custom date controls;
  - submitted `PerformanceReport` data passed to `PerformancePanel`.

- [ ] **Step 1: Write a failing server-render regression test for idle fetching**

Use the existing `renderToStaticMarkup` Vitest pattern to mock `useConvexSnapshotQuery`, `useQuery(api.cs.listCs)`, and the current date. Render the initial page and assert:

```ts
expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, 'skip');
expect(snapshotMock).toHaveBeenCalledTimes(1);
expect(html).toContain('Pilih periode lalu tampilkan laporan');
expect(html).toContain('Semua CS');
expect(html).not.toContain('>all<');
```

Task 1 already tests the exact inclusive day count used by submission. The browser check in Task 6 verifies that draft edits remain idle and a 36-day custom range is blocked; do not install a DOM interaction-test dependency for these two checks.

- [ ] **Step 2: Run the page test and verify it fails against the current auto-fetch page**

Run: `rtk npm test -- app/panel/performance/page.test.tsx`

Expected: FAIL because Performance currently mounts three snapshot queries and has no submitted report state.

- [ ] **Step 3: Replace the old page data sources with one frozen submission**

In `app/panel/performance/page.tsx`:

```ts
type SubmittedArgs = {
  period: PerformancePeriod;
  startDate: string;
  endDate: string;
  csName?: string;
};

const [submitted, setSubmitted] = useState<SubmittedArgs | null>(null);
const report = useConvexSnapshotQuery<PerformanceReport>(
  api.performanceReports.getPerformanceReport,
  submitted ?? 'skip',
);
```

Delete the old `analytics.getCsLeaderboard`, `analytics.getProductDifficulty`, `shippingRecaps.getPerformance`, response-time fetch, and `WindowModeToggle` calls from Performance only. Keep `api.cs.listCs` for the small selector list.

- [ ] **Step 4: Add the compact native control card**

Render:

- three period buttons: `Pekanan`, `Bulanan`, `Rentang khusus`;
- `<input type="date">` for weekly anchor/custom bounds;
- `<input type="month">` for monthly mode;
- existing `Select` with empty value labelled `Semua CS`;
- `Tampilkan laporan` primary button;
- `Refresh` only after a submission.

On submit, call `resolvePerformanceRange`, reject incomplete/reversed/over-35 custom ranges inline, and freeze the resulting args in `submitted`. Draft edits leave both `submitted` and the visible result untouched. Bind Refresh only to `report.refresh`; do not add timers, focus listeners, or automatic retry.

- [ ] **Step 5: Implement explicit page states**

Show these exact states:

```tsx
{!submitted && <EmptyState text="Pilih periode lalu tampilkan laporan" />}
{report.error && <InlineError message={report.error} onRetry={report.refresh} />}
{submitted && report.data && <PerformancePanel report={report.data} />}
```

While loading, retain the prior report and change the submit button copy to `Menyiapkan...`. An empty successful result says `Belum ada data pada periode ini`. Use the cancellation already implemented by `useConvexSnapshotQuery`; do not create a second request-token abstraction.

- [ ] **Step 6: Run the focused page test**

Run: `rtk npm test -- app/panel/performance/page.test.tsx`

Expected: PASS with no snapshot request before submission.

- [ ] **Step 7: Commit the on-demand page flow**

```bash
rtk git add app/panel/performance/page.tsx app/panel/performance/page.test.tsx
rtk git commit -m "feat: make performance reports on demand"
```

---

### Task 5: Lean Report Presentation

**Files:**
- Modify: `components/panel/performance-panel.tsx`
- Create: `components/panel/performance-panel.test.tsx`

**Interfaces:**
- Consumes: `PerformanceReport` from `lib/performance-report.ts`.
- Produces: `PerformancePanel({ report }: { report: PerformanceReport })` with Ringkasan, Per CS, and Per Produk tabs.

- [ ] **Step 1: Write a failing rendering test for the summary and weekly rows**

Build one monthly fixture and render with `renderToStaticMarkup`:

```ts
expect(html).toContain('Berjalan');
expect(html).toContain('67,2%');
expect(html).toContain('COD 60%');
expect(html).toContain('Transfer 40%');
expect(html).toContain('1–2 Agu');
expect(html).toContain('Pekan parsial');
expect(html).toContain('31 Agu');
```

Add a fixture with `responseNotice` and assert only the response notice appears while summary values remain visible.

- [ ] **Step 2: Run the component test and verify the old prop contract fails**

Run: `rtk npm test -- components/panel/performance-panel.test.tsx`

Expected: FAIL because the current component expects three unrelated query results.

- [ ] **Step 3: Rewrite the existing component around one report prop**

Retain the existing Tabs, Card, Badge, and Table primitives. The default Ringkasan tab contains:

- compact KPI cards for leads, closing, CR, revenue, COD, transfer, delivered, cancelled, and discount;
- deltas for leads, closing, CR, and revenue;
- monthly weekly table only when `report.period === 'month'`;
- status badge `Berjalan` or `Selesai` and `data sampai` timestamp.

Use existing Indonesian number/currency formatters if present; otherwise use one local `Intl.NumberFormat('id-ID')` and one currency formatter. Do not add chart packages or animated counters.

- [ ] **Step 4: Add bounded Per CS and Per Produk tables**

Per CS columns: CS, leads, closing, CR, revenue, COD/transfer ratio, median first response, and delta CR. When response is limited, render `Rentang terlalu panjang` in that column only.

Per Produk columns: product, leads, closing, CR, revenue, COD, transfer, and ratio. Add a local sort select with only `Closing terbanyak` and `CR terendah`; sort the already-returned array in memory and never request Convex again.

Wrap tables in the existing horizontal overflow container and keep native focusable buttons/tabs for keyboard accessibility.

- [ ] **Step 5: Run the component test**

Run: `rtk npm test -- components/panel/performance-panel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the report UI**

```bash
rtk git add components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx
rtk git commit -m "feat: present lean performance reports"
```

---

### Task 6: Integration, Regression, and Production Readiness

**Files:**
- Modify only files required by failing checks from Tasks 1-5.

**Interfaces:**
- Consumes: the completed shared math, Convex query, page controls, and report panel.
- Produces: a verified branch ready for a separate push/deploy decision.

- [ ] **Step 1: Run all automated tests**

Run: `rtk npm test`

Expected: every Vitest suite passes. Fix only regressions caused by this feature; do not refactor unrelated files.

- [ ] **Step 2: Run the TypeScript gate**

Run: `rtk npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Re-run Convex code generation**

Run: `rtk npx convex codegen`

Expected: exit 0 with no uncommitted generated drift after staging the intended API update.

- [ ] **Step 4: Run the production build**

Run: `rtk npm run build`

Expected: Next.js production build exits 0 and includes `/panel/performance`.

- [ ] **Step 5: Verify browser behavior locally**

Run the existing app and verify:

1. Dashboard keeps its local day/work-period toggle.
2. Settings has no date or CS controls.
3. Performance starts with no report request and the initial instruction.
4. Editing filters alone keeps the previous report and triggers no request.
5. Weekly, monthly, and a 35-day custom submission each load once.
6. A 36-day range is blocked inline.
7. `Semua CS` and one CS consistently change every report section.
8. Monthly week rows sum to the monthly summary.
9. Mobile tables scroll horizontally and the PWA bottom bar remains opaque.

- [ ] **Step 6: Review the Convex function shape before deployment**

Confirm in code and generated types that:

- both rollup reads use `by_org_windowKey` and `.take(cap + 1)`;
- no raw operational table is queried;
- there is no mutation, cron, subscription, or polling;
- the client passes `skip` before submission;
- response cap degradation cannot hide other errors;
- `requireAdminOrg` is inside the query.

- [ ] **Step 7: Commit final integration fixes**

```bash
rtk git add app components convex lib
rtk git commit -m "test: verify on-demand performance reports"
```

If there are no integration fixes, do not create an empty commit.

- [ ] **Step 8: Stop before external publication**

Report the exact test/build results and branch commits. Push `main`, deploy Convex, and deploy Vercel only after the user explicitly approves publication; those external mutations are not implicit in this implementation plan.
