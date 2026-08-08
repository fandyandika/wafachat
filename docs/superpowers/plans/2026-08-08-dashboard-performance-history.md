# Dashboard History and Performance Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Meta-style one-day history view to Dashboard, a preset-driven period selector with selectable daily basis to Performance, and complete the P2A.1 design corrections without increasing recurring Convex usage.

**Architecture:** A dependency-free period model resolves all draft selections into exact Jakarta calendar or 16:00 work-window bounds. Dashboard continues to use its existing bounded snapshot readers and only changes submitted ranges after Apply; Performance extends its single on-demand report query with a daily basis branch while retaining rollups for week/month/custom. URL parameters provide a validated Dashboard-to-Performance handoff, while presentation components remain query-free.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Convex 1.39, Tailwind CSS 3.4, Base UI/shadcn primitives, Lucide icons, Vitest, authenticated browser smoke testing.

## Global Constraints

- Dashboard remains the current operational cockpit; it only adds a single-day historical lookup.
- A calendar day is exactly 00:00–24:00 Asia/Jakarta.
- A selected CS work date is exactly 16:00 WIB on that date through 16:00 WIB the following date.
- Week, month, and custom Performance reports retain the existing 16:00 report semantics and totals.
- Custom ranges remain capped at 35 inclusive days.
- Historical Dashboard hides `Perlu perhatian / Order ganda`.
- Queen Recap, webhook ingestion, n8n notifications, authentication, and Convex schema remain unchanged.
- No polling, automatic historical refresh, long raw scan, new cron, chart dependency, or duplicate rollup family.
- Draft filter changes never query; Apply and explicit Refresh are the only query triggers.
- Touch controls are at least 44×44 px, keyboard reachable, labeled, and root layouts must not overflow horizontally.
- Desktop and mobile expose the same report values and product payment counts/ratios.

---

## File Structure

- Create `lib/history-period.ts` — dependency-free Jakarta date, preset, basis, URL parsing, and range-resolution contract.
- Create `lib/history-period.test.ts` — exhaustive boundary and preset tests.
- Create `components/panel/dashboard/dashboard-history-filter.tsx` — Dashboard draft date/basis controls and applied-state copy.
- Create `components/panel/dashboard/dashboard-history-filter.test.tsx` — filter semantics and accessibility rendering tests.
- Modify `components/panel/dashboard/use-dashboard-data.ts` — accept an explicit submitted range instead of deriving owner history implicitly.
- Modify `components/panel/dashboard/owner-home.tsx` — own draft/applied history state, hide operational alerts in history, and deep-link to Performance.
- Modify `components/panel/dashboard/cs-home.tsx` — pass its unchanged current work range through the explicit range contract.
- Delete `components/panel/window-mode-toggle.tsx` after its owner-only toggle is replaced and no imports remain.
- Modify `components/panel/dashboard/owner-home.test.tsx` and `app/panel/page.test.tsx` — Dashboard history behavior coverage.
- Modify `lib/performance-report.ts` and `lib/performance-report.test.ts` — add daily period/basis types and exact report range rules.
- Modify `convex/rollupReaders.ts` — preserve raw product/CS payment counts needed by calendar-day reports.
- Modify `convex/shippingRecaps.test.ts` and `convex/rollupReaders.test.ts` — raw payment aggregation coverage.
- Modify `convex/performanceReports.ts` and `convex/performanceReports.test.ts` — daily calendar/work branches and response summary.
- Create `components/panel/performance-filter.tsx` — preset-driven, on-demand Performance filter.
- Create `components/panel/performance-filter.test.tsx` — rendering, draft, URL, and submitted-argument coverage.
- Modify `app/panel/performance/page.tsx` and `app/panel/performance/page.test.tsx` — compose filter, snapshot query, and retained-result state.
- Create `components/panel/performance-summary.tsx` — ruled metric matrix and loading skeleton.
- Create `components/panel/performance-summary.test.tsx` — summary hierarchy, skeleton, and number formatting coverage.
- Modify `components/panel/performance-panel.tsx` and its tests — daily context, response metric, status stamps, and extracted summary.
- Modify `components/panel/performance-breakdowns.tsx` and its tests — raw COD/Transfer counts plus ratio parity.
- Modify `lib/format.ts` and `lib/format.test.ts` — shared Indonesian number/percentage/point formatters.
- Update `docs/superpowers/specs/2026-08-08-dashboard-performance-history-design.md` only if implementation reveals a factual correction; do not broaden scope.

---

### Task 1: Canonical date, basis, preset, and deep-link model

**Files:**
- Create: `lib/history-period.ts`
- Create: `lib/history-period.test.ts`
- Modify: `lib/performance-report.ts`
- Modify: `lib/performance-report.test.ts`

**Interfaces:**
- Produces: `DayBasis = "calendar" | "work"`.
- Produces: `PerformancePreset = "today" | "yesterday" | "date" | "this_week" | "last_week" | "week" | "this_month" | "last_month" | "month" | "custom"`.
- Produces: `resolveDashboardDay(date: string, basis: DayBasis, now?: number): ResolvedDay`.
- Produces: `resolvePerformanceSelection(selection: PerformanceSelection, today: string, now?: number): ResolvedPerformanceSelection`.
- Produces: `parsePerformanceDeepLink(search: URLSearchParams, today: string): PerformanceSelection`.
- Extends: `PerformancePeriod` to `"day" | "week" | "month" | "custom"` and `PerformanceReport.basis` to `DayBasis`.

- [ ] **Step 1: Write failing tests for exact daily boundaries**

```ts
import { describe, expect, test } from "vitest";
import { resolveDashboardDay } from "./history-period";

describe("resolveDashboardDay", () => {
  test("resolves a Jakarta calendar date", () => {
    expect(resolveDashboardDay("2026-08-07", "calendar")).toMatchObject({
      startAt: Date.parse("2026-08-07T00:00:00+07:00"),
      endAt: Date.parse("2026-08-08T00:00:00+07:00"),
      basis: "calendar",
    });
  });

  test("resolves a selected opening date as one CS work window", () => {
    expect(resolveDashboardDay("2026-08-07", "work")).toMatchObject({
      startAt: Date.parse("2026-08-07T16:00:00+07:00"),
      endAt: Date.parse("2026-08-08T16:00:00+07:00"),
      basis: "work",
    });
  });
});
```

- [ ] **Step 2: Run the boundary tests and verify failure**

Run: `npm test -- lib/history-period.test.ts`

Expected: FAIL because `lib/history-period.ts` does not exist.

- [ ] **Step 3: Implement strict ISO-date parsing and exact ranges**

```ts
import { windowRangeForKey } from "@/lib/report-window-core";

export type DayBasis = "calendar" | "work";
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) throw new Error("Tanggal tidak valid");
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error("Tanggal tidak valid");
  }
  return value;
}

export function resolveDashboardDay(date: string, basis: DayBasis, now = Date.now()) {
  requireIsoDate(date);
  const range = basis === "work"
    ? windowRangeForKey(date)
    : {
        startAt: Date.parse(`${date}T00:00:00+07:00`),
        endAt: Date.parse(`${date}T00:00:00+07:00`) + DAY_MS,
      };
  if (range.startAt > now) throw new Error("Tanggal belum dimulai");
  return { date, basis, ...range, running: range.endAt > now };
}
```

- [ ] **Step 4: Add failing tests for every Performance preset and invalid deep links**

Cover these exact expectations:

```ts
expect(resolvePerformanceSelection({ preset: "today", date: "2026-08-08", basis: "calendar" }, "2026-08-08"))
  .toMatchObject({ period: "day", basis: "calendar", startDate: "2026-08-08", endDate: "2026-08-08" });
expect(resolvePerformanceSelection({ preset: "today", basis: "work" }, "2026-08-08", Date.parse("2026-08-08T11:00:00+07:00")))
  .toMatchObject({ period: "day", basis: "work", startDate: "2026-08-07", endDate: "2026-08-07" });
expect(resolvePerformanceSelection({ preset: "last_week", date: "2026-08-08", basis: "work" }, "2026-08-08"))
  .toMatchObject({ period: "week", basis: "work", startDate: "2026-07-27", endDate: "2026-08-02" });
expect(resolvePerformanceSelection({ preset: "last_month", date: "2026-08-08", basis: "work" }, "2026-08-08"))
  .toMatchObject({ period: "month", basis: "work", startDate: "2026-07-01", endDate: "2026-07-31" });
expect(() => resolvePerformanceSelection({ preset: "custom", startDate: "2026-06-01", endDate: "2026-08-08", basis: "work" }, "2026-08-08"))
  .toThrow("Maksimal 35 hari");
expect(parsePerformanceDeepLink(new URLSearchParams("period=day&date=bad&basis=oops"), "2026-08-08"))
  .toMatchObject({ preset: "this_week", basis: "work" });
```

- [ ] **Step 5: Implement preset resolution and safe URL parsing**

Use exported discriminated data rather than component state conventions:

```ts
export type PerformancePreset = "today" | "yesterday" | "date" | "this_week" | "last_week" | "week" | "this_month" | "last_month" | "month" | "custom";

export type PerformanceSelection = {
  preset: PerformancePreset;
  basis: DayBasis;
  date?: string;
  anchorDate?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
};

export type ResolvedPerformanceSelection = {
  period: "day" | "week" | "month" | "custom";
  basis: DayBasis;
  startDate: string;
  endDate: string;
};
```

Daily presets preserve the requested basis. `today/work` resolves with `windowKeyToday(now)` and `yesterday/work` resolves the preceding opening-window key; `date/work` uses the entered opening date directly. Every non-daily preset must force `basis: "work"`. Direct/invalid links fall back to `{ preset: "this_week", basis: "work", anchorDate: today }`.

- [ ] **Step 6: Extend the shared report types and range helpers**

```ts
export type PerformancePeriod = "day" | "week" | "month" | "custom";

export type PerformanceReport = {
  period: PerformancePeriod;
  basis: DayBasis;
  startDate: string;
  endDate: string;
  effectiveEndDate: string;
  status: "running" | "complete";
  generatedAt: number;
  responseNotice?: string;
  summary: MetricRow & {
    responseMedianMs: number | null;
    deltaLeads: number;
    deltaClosings: number;
    deltaCr: number;
    deltaRevenue: number;
  };
  cs: CsMetricRow[];
  products: ProductMetricRow[];
  weeks: Array<DateRange & {
    partial: boolean;
    status: "upcoming" | "running" | "complete";
    metrics: MetricRow;
  }>;
};
```

Update `resolvePerformanceRange` and `previousPerformanceRange` so `day` requires identical start/end dates and compares to the immediately preceding same-basis day. Existing week/month/custom expectations must remain unchanged.

- [ ] **Step 7: Run the focused date-model tests**

Run: `npm test -- lib/history-period.test.ts lib/performance-report.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the canonical period model**

```bash
git add lib/history-period.ts lib/history-period.test.ts lib/performance-report.ts lib/performance-report.test.ts
git commit -m "feat: define dashboard and performance periods"
```

---

### Task 2: Dashboard one-day history controls and submitted range

**Files:**
- Create: `components/panel/dashboard/dashboard-history-filter.tsx`
- Create: `components/panel/dashboard/dashboard-history-filter.test.tsx`
- Modify: `components/panel/dashboard/use-dashboard-data.ts`
- Modify: `components/panel/dashboard/owner-home.tsx`
- Modify: `components/panel/dashboard/cs-home.tsx`
- Delete: `components/panel/window-mode-toggle.tsx`
- Modify: `components/panel/dashboard/owner-home.test.tsx`
- Modify: `app/panel/page.test.tsx`

**Interfaces:**
- Consumes: `DayBasis` and `resolveDashboardDay()` from Task 1.
- Produces: `DashboardDaySelection = { date: string; basis: DayBasis; startAt: number; endAt: number; running: boolean }`.
- Changes: `useDashboardData({ range, csName, includeDuplicates, includePerformance })`, where `range` is explicit and stable until Apply.

- [ ] **Step 1: Write failing filter rendering tests**

```tsx
const html = renderToStaticMarkup(
  <DashboardHistoryFilter
    today="2026-08-08"
    applied={{ date: "2026-08-07", basis: "calendar" }}
    onApply={() => undefined}
  />,
);
expect(html).toContain('type="date"');
expect(html).toContain("Hari kalender");
expect(html).toContain("Periode kerja CS 16:00");
expect(html).toContain("Terapkan");
expect(html).toContain("min-h-11");
```

Also verify the date input receives `max="2026-08-08"`, all controls have visible labels, and toggling draft values alone does not call `onApply`.

- [ ] **Step 2: Run the filter test and verify failure**

Run: `npm test -- components/panel/dashboard/dashboard-history-filter.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the compact filter with separate draft state**

```tsx
export function DashboardHistoryFilter({ today, applied, onApply }: Props) {
  const [draftDate, setDraftDate] = useState(applied.date);
  const [draftBasis, setDraftBasis] = useState<DayBasis>(applied.basis);
  const dirty = draftDate !== applied.date || draftBasis !== applied.basis;
  return (
    <div aria-label="Pilih tanggal Dashboard" className="grid gap-3 sm:grid-cols-[minmax(11rem,14rem)_auto_auto] sm:items-end">
      <label className="grid gap-1.5 text-sm font-medium">
        Tanggal
        <input type="date" max={today} value={draftDate} onChange={(event) => setDraftDate(event.target.value)} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Basis hari</legend>
        <button type="button" aria-pressed={draftBasis === "calendar"} onClick={() => setDraftBasis("calendar")}>Hari kalender</button>
        <button type="button" aria-pressed={draftBasis === "work"} onClick={() => setDraftBasis("work")}>Periode kerja CS 16:00</button>
      </fieldset>
      <Button disabled={!dirty} onClick={() => onApply({ date: draftDate, basis: draftBasis })}>Terapkan</Button>
    </div>
  );
}
```

Use text labels, not icon-only affordances. Keep controls 44 px on touch and 36 px from `sm` upward.
When the applied selection is the current calendar day and the user switches the draft basis to `work`, set the draft date to `windowKeyToday(now)` so the current work window remains selectable before 16:00 WIB.

- [ ] **Step 4: Write failing hook tests for explicit submitted bounds**

Assert that:

- the hook passes the supplied `startAt/endAt` to summary, performance, and response-time sources;
- `includeDuplicates: false` passes `"skip"` to `metrics.getDuplicateOrders`;
- changing draft React state without changing the submitted range cannot alter hook query arguments.

- [ ] **Step 5: Refactor `useDashboardData` to consume an explicit range**

Replace `mode`-based implicit time calculation for the owner path with:

```ts
type DashboardRange = {
  startAt: number;
  endAt: number;
  basis: DayBasis;
  date: string;
  running: boolean;
};

export function useDashboardData({ range, csName, includeDuplicates, includePerformance = true }: {
  range: DashboardRange;
  csName?: string;
  includeDuplicates: boolean;
  includePerformance?: boolean;
}) {
  const { startAt, endAt } = range;
  // preserve snapshot queries and refresh behavior
}
```

Keep the CS-home call on its existing current work window by resolving `windowRangeForKey(windowKeyToday())` before invoking the hook. Do not expose date-history controls to CS users. Remove `window-mode-toggle.tsx` only after `rtk rg "WindowModeToggle|WindowMode"` returns no remaining imports.

- [ ] **Step 6: Write failing owner-home behavior tests**

Cover:

```tsx
expect(todayHtml).toContain("Perlu perhatian");
expect(historyHtml).toContain("Mode histori");
expect(historyHtml).toContain("7 Agustus 2026");
expect(historyHtml).not.toContain("Perlu perhatian");
expect(historyHtml).not.toContain("Order ganda");
expect(historyHtml).toContain("/panel/performance?period=day&amp;date=2026-08-07&amp;basis=calendar");
```

- [ ] **Step 7: Compose applied history state in `OwnerHome`**

Initialize with `{ date: jakartaToday, basis: "calendar" }`. Resolve it once into an applied range; only `onApply` replaces that state. Define historical mode as `!appliedRange.running`, not by comparing date strings, because the current work window can open on the previous calendar date. Render:

- `DashboardHistoryFilter` in the context area;
- `Mode histori` plus exact boundary when `!appliedRange.running`;
- current-action section only when `appliedRange.running`;
- `Lihat analisis lengkap` for both current and historical snapshots.

Keep current manual Refresh behavior. Do not add timers.

- [ ] **Step 8: Run focused Dashboard tests**

Run: `npm test -- components/panel/dashboard/dashboard-history-filter.test.tsx components/panel/dashboard/owner-home.test.tsx app/panel/page.test.tsx components/panel/dashboard/ledger.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit Dashboard history**

```bash
git add components/panel/dashboard components/panel/window-mode-toggle.tsx app/panel/page.test.tsx
git commit -m "feat: add dashboard daily history"
```

---

### Task 3: Daily calendar/work Performance backend without recurring reads

**Files:**
- Modify: `convex/rollupReaders.ts`
- Modify: `convex/rollupReaders.test.ts`
- Modify: `convex/shippingRecaps.test.ts`
- Modify: `convex/performanceReports.ts`
- Modify: `convex/performanceReports.test.ts`
- Regenerate: `convex/_generated/api.d.ts`

**Interfaces:**
- Consumes: `PerformancePeriod`, `DayBasis`, and resolved date strings from Task 1.
- Extends: `performanceFromRaw()` CS/product rows with `cod`, `transfer`, `codPct`, and `transferPct`.
- Extends: `getPerformanceReport({ period, basis, startDate, endDate, csName? })`.
- Produces: `PerformanceReport.summary.responseMedianMs`.
- Produces private mapper: `mapRawPerformanceReport(input: { args: PerformanceReportArgs; currentRaw: RawPerformance; previousRaw: RawPerformance; response: PerformanceResponseResult; generatedAt: number }): PerformanceReport`.

- [ ] **Step 1: Write failing raw payment aggregation tests**

Seed one COD and one Transfer closing under the same product and CS, then assert:

```ts
expect(result.products[0]).toMatchObject({ cod: 1, transfer: 1, codPct: 50, transferPct: 50 });
expect(result.cs[0]).toMatchObject({ cod: 1, transfer: 1, codPct: 50, transferPct: 50 });
```

- [ ] **Step 2: Run the raw aggregation tests and verify failure**

Run: `npm test -- convex/rollupReaders.test.ts convex/shippingRecaps.test.ts`

Expected: FAIL because the row shapes omit payment counts.

- [ ] **Step 3: Extend `performanceFromRaw` maps without extra database queries**

Track payment on the existing recap pass:

```ts
type RawBreakdown = {
  leads: number;
  closing: number;
  revenue: number;
  discount: number;
  cod: number;
  transfer: number;
};

if (r.paymentMethod === "cod") row.cod += 1;
if (r.paymentMethod === "transfer") row.transfer += 1;
```

Return `codPct` and `transferPct` from those counts. Do not add a new table read or fallback lookup.

- [ ] **Step 4: Write failing Performance report tests for both daily bases**

Seed events around boundaries and assert:

```ts
const calendar = await admin.query(api.performanceReports.getPerformanceReport, {
  period: "day", basis: "calendar", startDate: "2026-08-07", endDate: "2026-08-07",
});
expect(calendar.basis).toBe("calendar");
expect(calendar.summary.leads).toBe(2);

const work = await admin.query(api.performanceReports.getPerformanceReport, {
  period: "day", basis: "work", startDate: "2026-08-07", endDate: "2026-08-07",
});
expect(work.basis).toBe("work");
expect(work.summary.leads).toBe(3);
```

Also assert another organization is excluded, future daily dates fail, prior-day deltas use the same basis, and existing week/month/custom fixtures remain unchanged.

- [ ] **Step 5: Run the report tests and verify failure**

Run: `npm test -- convex/performanceReports.test.ts`

Expected: FAIL because `day` and `basis` are not accepted.

- [ ] **Step 6: Extend validators and choose the bounded reader by basis**

Implement the handler split:

```ts
if (args.period === "day" && args.basis === "calendar") {
  const currentBounds = jakartaCalendarBounds(args.startDate);
  const previousBounds = shiftBounds(currentBounds, -1);
  const [current, previous, response] = await Promise.all([
    performanceFromRaw(ctx, orgId, { ...currentBounds, csName: args.csName }),
    performanceFromRaw(ctx, orgId, { ...previousBounds, csName: args.csName }),
    responseTimesForPerformanceReport(ctx, orgId, { ...currentBounds, csName: args.csName }),
  ]);
  return mapRawPerformanceReport({
    args,
    currentRaw,
    previousRaw,
    response,
    generatedAt: Date.now(),
  });
}
```

For `period === "day" && basis === "work"`, read the single `dailyRollups` window whose opening key equals `startDate`; calculate response bounds with `windowRangeForKey(startDate)`. Week/month/custom keep the existing `windowKeyForBusinessDate` rollup mapping and force `basis: "work"`.

Use the current response sample cap. If limited, return `responseNotice` and `responseMedianMs: null`; do not fall back to unbounded message scans.

- [ ] **Step 7: Map raw and rollup data to one stable report shape**

Create small private pure mappers inside `performanceReports.ts`:

```ts
function rawMetricRow(raw: RawPerformance, scope?: RawBreakdown): MetricRow;
function reportDeltas(current: MetricRow, previous: MetricRow): Pick<PerformanceReport["summary"], "deltaLeads" | "deltaClosings" | "deltaCr" | "deltaRevenue">;
```

Do not make the React layer merge multiple query payloads.

- [ ] **Step 8: Run backend tests and code generation**

Run: `npm test -- convex/performanceReports.test.ts convex/rollupReaders.test.ts convex/shippingRecaps.test.ts`

Run: `npx convex codegen`

Expected: all tests PASS and generated API types accept `day` plus `basis`.

- [ ] **Step 9: Commit the daily report backend**

```bash
git add convex/rollupReaders.ts convex/rollupReaders.test.ts convex/shippingRecaps.test.ts convex/performanceReports.ts convex/performanceReports.test.ts convex/_generated/api.d.ts
git commit -m "feat: add bounded daily performance reports"
```

---

### Task 4: Meta-style Performance period filter and Dashboard deep link

**Files:**
- Create: `components/panel/performance-filter.tsx`
- Create: `components/panel/performance-filter.test.tsx`
- Modify: `app/panel/performance/page.tsx`
- Modify: `app/panel/performance/page.test.tsx`
- Modify: `components/panel/performance-panel.tsx`

**Interfaces:**
- Consumes: `PerformanceSelection`, `PerformancePreset`, `DayBasis`, `parsePerformanceDeepLink()`, and `resolvePerformanceSelection()` from Task 1.
- Produces: `PerformanceFilter.onSubmit(args: SubmittedArgs)` where `SubmittedArgs` includes `basis`.
- Produces private helpers: `isDailyPreset(preset: PerformancePreset): boolean`, `CustomRangeFields(props: CustomRangeProps)`, `DayBasisControl(props: { value: DayBasis; onChange(value: DayBasis): void })`, and `CsScopeSelect(props: CsScopeProps)`.
- Produces constant: `presetItems: Array<{ value: PerformancePreset; label: string }>` containing the ten approved labels in the spec order.
- Preserves: `submitPerformanceRequest()` exact-argument refresh behavior and retained-result association.

- [ ] **Step 1: Write failing filter tests for progressive disclosure**

Render each selection and assert:

```tsx
expect(dailyHtml).toContain("Basis data");
expect(dailyHtml).toContain("Hari kalender");
expect(customHtml).toContain("Mulai");
expect(customHtml).toContain("Sampai");
expect(customHtml).not.toContain("Basis data");
expect(weekHtml).not.toContain("Mulai");
```

Also verify the preset list includes all ten approved options, `Tampilkan laporan` is the only submit action, and changing selection does not invoke `onSubmit`.

- [ ] **Step 2: Run the filter test and verify failure**

Run: `npm test -- components/panel/performance-filter.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the filter as a controlled draft form**

```tsx
export function PerformanceFilter({ today, initial, csList, loading, onSubmit }: Props) {
  const [draft, setDraft] = useState<PerformanceSelection>(initial);
  const [csName, setCsName] = useState("");
  const setPreset = (preset: PerformancePreset) => setDraft((value) => ({ ...value, preset }));
  const setDate = (event: React.ChangeEvent<HTMLInputElement>) => setDraft((value) => ({ ...value, date: event.target.value }));
  const setAnchorDate = (event: React.ChangeEvent<HTMLInputElement>) => setDraft((value) => ({ ...value, anchorDate: event.target.value }));
  const setMonth = (event: React.ChangeEvent<HTMLInputElement>) => setDraft((value) => ({ ...value, month: event.target.value }));
  const setBasis = (basis: DayBasis) => setDraft((value) => ({ ...value, basis }));
  const setCustomRange = (range: Pick<PerformanceSelection, "startDate" | "endDate">) => setDraft((value) => ({ ...value, ...range }));
  const submit = () => onSubmit(resolvePerformanceSelection(draft, today));
  return (
    <Card>
      <CardContent>
        <label>Periode<Select value={draft.preset} onValueChange={setPreset}>{presetItems}</Select></label>
        {isDailyPreset(draft.preset) ? <label>Tanggal<input type="date" value={draft.date ?? today} max={today} onChange={setDate} /></label> : null}
        {draft.preset === "week" ? <label>Tanggal dalam pekan<input type="date" value={draft.anchorDate ?? today} onChange={setAnchorDate} /></label> : null}
        {draft.preset === "month" ? <label>Bulan<input type="month" value={draft.month ?? today.slice(0, 7)} onChange={setMonth} /></label> : null}
        {draft.preset === "custom" ? <CustomRangeFields value={draft} onChange={setCustomRange} /> : null}
        {isDailyPreset(draft.preset) ? <DayBasisControl value={draft.basis} onChange={setBasis} /> : null}
        <CsScopeSelect value={csName} rows={csList} onChange={setCsName} />
        <Button onClick={submit} disabled={loading}>{loading ? "Menyiapkan…" : "Tampilkan laporan"}</Button>
      </CardContent>
    </Card>
  );
}
```

Use a visible `Periode` label and concise helper copy. Avoid an always-expanded calendar or a second navigation row.

- [ ] **Step 4: Write failing page tests for safe deep links and on-demand query arguments**

Assert:

- `/panel/performance?period=day&date=2026-08-07&basis=calendar` pre-fills daily calendar but still waits for explicit submit;
- an invalid link pre-fills Pekan ini/work;
- submitted daily arguments contain `{ period: "day", basis: "calendar", startDate: "2026-08-07", endDate: "2026-08-07" }`;
- identical re-submit calls refresh once;
- preset/basis/CS changes before submit do not change snapshot arguments.

- [ ] **Step 5: Replace page-local period controls with `PerformanceFilter`**

Keep the page responsible only for:

1. reading and validating initial search parameters;
2. owning `submitted` and retained `displayed` results;
3. invoking `useConvexSnapshotQuery` with `submitted ?? "skip"`;
4. composing filter, refresh, and result region.

Remove the old four-tab filter and duplicated date state from `page.tsx`.

- [ ] **Step 6: Add `basis` to retained-result equality and status context**

`submitPerformanceRequest()` must treat otherwise-identical day requests with different bases as different submissions. `DisplayedPerformanceResult.submitted` must retain the basis used by the visible data.

- [ ] **Step 7: Run focused Performance interaction tests**

Run: `npm test -- components/panel/performance-filter.test.tsx app/panel/performance/page.test.tsx components/panel/performance-panel.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the Performance filter**

```bash
git add components/panel/performance-filter.tsx components/panel/performance-filter.test.tsx app/panel/performance/page.tsx app/panel/performance/page.test.tsx components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx
git commit -m "feat: add preset performance periods"
```

---

### Task 5: P2A.1 ruled summary, response context, and payment parity

**Files:**
- Create: `components/panel/performance-summary.tsx`
- Create: `components/panel/performance-summary.test.tsx`
- Modify: `components/panel/performance-panel.tsx`
- Modify: `components/panel/performance-panel.test.tsx`
- Modify: `components/panel/performance-breakdowns.tsx`
- Modify: `components/panel/performance-breakdowns.test.tsx`
- Modify: `lib/format.ts`
- Modify: `lib/format.test.ts`

**Interfaces:**
- Consumes: `PerformanceReport` with `basis` and `summary.responseMedianMs` from Task 3.
- Produces: `PerformanceSummary({ summary, loading? })` using the existing WafaChat ledger components.
- Produces: shared `formatNumberId`, `formatPercentId`, and `formatPointsId` helpers.

- [ ] **Step 1: Write failing shared formatter tests**

```ts
expect(formatNumberId(1733)).toBe("1.733");
expect(formatPercentId(67.2)).toBe("67,2%");
expect(formatPointsId(2.7)).toBe("2,7 poin");
```

- [ ] **Step 2: Implement and adopt the shared formatters**

Use module-level `Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 })` instances. Replace duplicate `number`, `pct`, and `points` definitions in Performance files.

- [ ] **Step 3: Write failing summary composition tests**

Assert the summary:

- uses one ruled matrix container instead of ten independent shadow cards;
- renders Leads, Closing, Conversion Rate, Omzet, Respons CS, Diskon, COD, Transfer, Rasio pembayaran, Terkirim, and Dibatalkan;
- formats revenue deltas as Rupiah and CR deltas as points;
- uses `tabular-nums` and `tracking-[0.12em]` for metric labels;
- renders six cell-shaped skeletons with the same grid boundaries during first load.

- [ ] **Step 4: Implement `PerformanceSummary` using the ledger grammar**

```tsx
export function PerformanceSummary({ summary }: { summary: PerformanceReport["summary"] }) {
  return (
    <LedgerSection title="Kinerja periode" description="Snapshot laporan terpilih">
      <LedgerMetricGrid>
        <LedgerMetric label="Leads" value={formatNumberId(summary.leads)} />
        <LedgerMetric label="Closing" value={formatNumberId(summary.closings)} tone="positive" />
        <LedgerMetric label="Conversion Rate" value={formatPercentId(summary.cr)} tone="positive" />
        <LedgerMetric label="Omzet" value={formatRupiah(summary.revenue)} />
        <LedgerMetric label="Respons CS" value={formatDuration(summary.responseMedianMs)} />
        <LedgerMetric label="Diskon" value={formatRupiah(summary.discount)} />
        <LedgerMetric label="COD" value={formatNumberId(summary.cod)} />
        <LedgerMetric label="Transfer" value={formatNumberId(summary.transfer)} />
        <LedgerMetric label="Rasio pembayaran" value={`COD ${formatPercentId(summary.codPct)} · Transfer ${formatPercentId(summary.transferPct)}`} />
        <LedgerMetric label="Terkirim" value={formatNumberId(summary.delivered)} />
        <LedgerMetric label="Dibatalkan" value={formatNumberId(summary.cancelled)} tone="negative" />
      </LedgerMetricGrid>
    </LedgerSection>
  );
}
```

Do not introduce gradients, floating KPI cards, decorative animation, or another card vocabulary.

- [ ] **Step 5: Write failing product payment parity tests**

For both desktop and mobile markup assert that a row with `cod: 9`, `transfer: 6`, `codPct: 60`, `transferPct: 40` displays all of:

```text
COD 9
Transfer 6
60% / 40%
```

- [ ] **Step 6: Restore raw payment counts in both responsive presentations**

Desktop columns: `COD`, `Transfer`, `Rasio`. Mobile definition rows: `COD`, `Transfer`, `Rasio pembayaran`. Every value uses `tabular-nums`; desktop and mobile map the same sorted `products` array.

- [ ] **Step 7: Replace status pill and first-load text with design-system states**

- Render status with the existing `StatusStamp` minimum height rather than `rounded-full`.
- For daily reports, render `Hari kalender · 00.00–24.00 WIB` or `Periode kerja CS · 16.00–16.00 WIB`.
- Replace `Menyiapkan laporan…` with a `PerformanceSummarySkeleton` inside a polite status region.
- Preserve the previous successful report during refresh/error exactly as current tests require.

- [ ] **Step 8: Run all presentation tests**

Run: `npm test -- lib/format.test.ts components/panel/performance-summary.test.tsx components/panel/performance-panel.test.tsx components/panel/performance-breakdowns.test.tsx app/panel/performance/page.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit P2A.1 corrections**

```bash
git add lib/format.ts lib/format.test.ts components/panel/performance-summary.tsx components/panel/performance-summary.test.tsx components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx components/panel/performance-breakdowns.tsx components/panel/performance-breakdowns.test.tsx app/panel/performance/page.test.tsx
git commit -m "fix: complete performance report presentation"
```

---

### Task 6: Integrated regression, accessibility, and query-economy coverage

**Files:**
- Modify: `app/panel/page.test.tsx`
- Modify: `app/panel/performance/page.test.tsx`
- Modify: `components/panel/dashboard/owner-home.test.tsx`
- Modify: `components/panel/performance-breakdowns.test.tsx`
- Modify: `convex/performanceReports.test.ts`
- Modify: `docs/superpowers/specs/2026-08-08-dashboard-performance-history-design.md` only for confirmed factual corrections.

**Interfaces:**
- Consumes all Tasks 1–5.
- Produces a release gate proving no draft-query loop, no tenant leak, and responsive data parity.

- [ ] **Step 1: Add an integrated no-query-before-Apply test**

Use the existing mocked snapshot hook and assert:

```ts
expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, "skip");
// mutate draft controls
expect(snapshotMock).toHaveBeenCalledTimes(1);
// submit
expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, expectedArgs);
```

Dashboard tests must similarly prove only the applied range reaches `useDashboardData`.

- [ ] **Step 2: Add responsive parity assertions**

Render one CS and product fixture and verify desktop-table plus mobile-ledger sections contain the same labels and numeric strings in the same sorted order. Verify the mobile controls contain `min-h-11`, tables are hidden below `md`, mobile ledgers are hidden at `md`, and no component declares a fixed width wider than its container.

- [ ] **Step 3: Add authorization and tenant-isolation regression assertions**

In `convex/performanceReports.test.ts`, verify:

- another organization’s calendar-day raw rows are absent;
- a CS identity cannot call the admin report unless existing authorization explicitly permits it;
- non-day reports reject `basis: "calendar"`;
- a date before the product data cutoff follows existing clamping/error policy rather than reading unrestricted history.

- [ ] **Step 4: Run all focused tests**

Run: `npm test -- lib/history-period.test.ts lib/performance-report.test.ts components/panel/dashboard/dashboard-history-filter.test.tsx components/panel/dashboard/owner-home.test.tsx app/panel/page.test.tsx components/panel/performance-filter.test.tsx components/panel/performance-summary.test.tsx components/panel/performance-panel.test.tsx components/panel/performance-breakdowns.test.tsx app/panel/performance/page.test.tsx convex/performanceReports.test.ts convex/rollupReaders.test.ts convex/shippingRecaps.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit integrated coverage**

```bash
git add app components lib convex docs/superpowers/specs/2026-08-08-dashboard-performance-history-design.md
git commit -m "test: cover dashboard and performance history"
```

---

### Task 7: Full verification, review, merge, and production smoke test

**Files:**
- No planned production-code changes; only fix concrete failures discovered by this gate.

**Interfaces:**
- Consumes the complete feature branch.
- Produces a reviewed, merged, deployed, and smoke-tested production release.

- [ ] **Step 1: Run repository-wide tests**

Run: `npm test`

Expected: all test files and tests PASS; baseline was 63 files / 493 tests before this feature.

- [ ] **Step 2: Run generated-type and static gates**

Run: `npx convex codegen`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: all exit 0 with no TypeScript or production-build error.

- [ ] **Step 3: Run bounded design checks**

Run the Impeccable detector once against the changed UI files. Inspect Dashboard and Performance together at desktop and mobile widths. Fix all concrete findings in one batch, then perform at most one confirmation pass.

Required visual checks:

- no root horizontal overflow;
- mobile controls are at least 44 px;
- historical Dashboard hides operational alerts;
- exact boundary copy changes with basis;
- Performance daily deep link is prefilled correctly;
- desktop/mobile product payment values match;
- retained results remain visible during explicit refresh;
- empty/loading/error states preserve layout.

- [ ] **Step 4: Request independent code and spec review**

Review the complete branch diff against:

- authorization and organization isolation;
- query bounds and absence of polling;
- selected-date boundary correctness;
- existing week/month/custom parity;
- spec coverage and scope discipline;
- responsive/accessibility design rules.

Resolve every P0/P1 issue and every straightforward P2 regression before release.

- [ ] **Step 5: Commit verification-only corrections**

```bash
git add -u
git commit -m "fix: harden dashboard performance history"
```

Skip this commit if no files changed.

- [ ] **Step 6: Publish and merge**

Push `feat/performance-history`, open a pull request with the design/spec and verification evidence, wait for required checks, then merge to `main` without force-pushing or rewriting history.

- [ ] **Step 7: Deploy and smoke-test production**

Deploy Convex functions first if their API changed, then deploy Vercel. Verify authenticated production flows:

1. Dashboard today/calendar.
2. Dashboard historical/calendar.
3. Dashboard historical/work.
4. Dashboard-to-Performance deep link.
5. Performance daily/calendar and daily/work.
6. Existing week/month/custom report.
7. Per CS and Per Product desktop/mobile.
8. Production runtime logs contain no new server/client errors.

- [ ] **Step 8: Report the release**

Provide the merge commit, production URLs/status, exact test totals, browser checks, any intentionally deferred non-blockers, and confirmation that webhook/notif/Queen paths were not changed.
