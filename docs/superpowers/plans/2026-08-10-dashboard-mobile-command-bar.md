# Dashboard Mobile Command Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall mobile Dashboard preamble with a compact command bar and bottom-sheet filter so business KPIs appear in the first viewport while desktop behavior and all data semantics remain unchanged.

**Architecture:** Add one mobile-only control component that composes the existing draft/apply filter with the existing Sheet primitive. `OwnerHome` renders this mobile control below `md`, preserves the current context/filter composition from `md` upward, and reorders existing KPI/attention sections using responsive CSS only. The shared panel shell gets a compact mobile header; no data hook, query, route, schema, or business calculation changes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Base UI Sheet primitive, Lucide icons, Vitest, React server rendering tests.

## Global Constraints

- Preserve every existing Dashboard metric, cutoff, exact boundary, history rule, duplicate-order rule, permission, route, and query contract.
- No new Convex query, realtime subscription, polling, cron, prefetch, or backend change.
- Draft filter changes must remain request-free; only `Terapkan` invokes `onApply`.
- Mobile controls require visible labels/focus and minimum 44×44 px targets.
- Preserve Wafachat Operational Ledger: warm paper, continuous ruled bands, blue-black ink, restrained violet action/selection, no decorative shadow.
- Desktop inline controls and owner KPI/attention rail remain functionally unchanged.
- Support 320–767 px mobile without root horizontal overflow and preserve fixed bottom-nav safe area.

---

## File map

- Create `components/panel/dashboard/dashboard-mobile-command-bar.tsx`: mobile snapshot context, refresh action, filter trigger, bottom-sheet composition.
- Create `components/panel/dashboard/dashboard-mobile-command-bar.test.tsx`: contract tests for labels, touch targets, active basis/date, refresh state, sheet actions, and callbacks.
- Modify `components/panel/dashboard/dashboard-history-filter.tsx`: allow an optional submit callback so a successful mobile apply can close the sheet; retain desktop markup and selection logic.
- Modify `components/panel/dashboard/dashboard-history-filter.test.tsx`: lock the submit callback contract while preserving no-query draft behavior.
- Modify `components/panel/dashboard/owner-home.tsx`: responsive composition, KPI-first mobile order, compact attention row.
- Modify `components/panel/dashboard/owner-home.test.tsx`: verify mobile/desktop visibility classes, section order, history behavior, and Performance handoff.
- Modify `components/panel/dashboard/ledger.tsx`: add a compact attention presentation primitive only if OwnerHome extraction proves useful; do not alter metric semantics.
- Modify `app/panel/layout.tsx`: compact mobile route header and mobile role metadata.
- Modify `app/panel/layout.test.tsx`: verify organization context remains on desktop while mobile header exposes compact role context.

---

### Task 1: Mobile command bar and filter sheet

**Files:**
- Create: `components/panel/dashboard/dashboard-mobile-command-bar.tsx`
- Create: `components/panel/dashboard/dashboard-mobile-command-bar.test.tsx`
- Modify: `components/panel/dashboard/dashboard-history-filter.tsx`
- Test: `components/panel/dashboard/dashboard-history-filter.test.tsx`

**Interfaces:**
- Consumes: `DashboardDayDraft`, `DashboardDayRange`, `DashboardHistoryFilter`, `dashboardPerformanceHref`, `formatDashboardBoundary`.
- Produces:

```ts
export type DashboardMobileCommandBarProps = {
  today: string;
  currentWorkDate: string;
  applied: DashboardDayDraft;
  range: DashboardDayRange;
  periodLabel: string;
  updatedAt: string;
  loading: boolean;
  onApply(selection: DashboardDayDraft): void;
  onRefresh(): void;
};

export function DashboardMobileCommandBar(props: DashboardMobileCommandBarProps): React.ReactElement;
```

- Extends `DashboardHistoryFilter` with `onApplied?: () => void`; invoke only after form submission calls `onApply`.

- [ ] **Step 1: Write failing command-bar tests**

Create tests using `renderToStaticMarkup` and a local mock for `@/components/ui/sheet`. Assert:

```tsx
const html = renderToStaticMarkup(
  <DashboardMobileCommandBar
    today="2026-08-10"
    currentWorkDate="2026-08-09"
    applied={{ date: "2026-08-10", basis: "calendar" }}
    range={{
      date: "2026-08-10",
      basis: "calendar",
      startAt: Date.parse("2026-08-10T00:00:00+07:00"),
      endAt: Date.parse("2026-08-11T00:00:00+07:00"),
      running: true,
    }}
    periodLabel="Hari kalender"
    updatedAt="14.01.10"
    loading={false}
    onApply={() => undefined}
    onRefresh={() => undefined}
  />,
);

expect(html).toContain("10 Agu");
expect(html).toContain("Hari kalender");
expect(html).toContain("Diperbarui 14.01.10");
expect(html).toContain("Atur");
expect(html).toContain('aria-label="Refresh Dashboard"');
expect(html).toContain("min-h-11");
expect(html).toContain("Buka Performance");
```

Add historical input and assert `Mode histori` plus exact boundary. Add loading input and assert refresh disabled/spinning state.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
rtk npm test -- --exclude ".worktrees/**" components/panel/dashboard/dashboard-mobile-command-bar.test.tsx components/panel/dashboard/dashboard-history-filter.test.tsx
```

Expected: FAIL because `dashboard-mobile-command-bar.tsx` and `onApplied` contract do not exist.

- [ ] **Step 3: Implement minimal mobile command bar**

Use `CalendarDays`, `RefreshCw`, and `SlidersHorizontal`. Build one ruled `md:hidden` band. Summary copy:

```tsx
<p className="font-semibold tabular-nums text-ledger-ink">
  {shortDate(applied.date)} · {applied.basis === "calendar" ? "Hari kalender" : "Cutoff CS · 16.00"}
</p>
<p className="truncate text-xs text-muted-foreground">
  {range.running ? periodLabel : "Mode histori"} · Diperbarui {updatedAt}
</p>
```

Add two 44 px icon/text actions: `Atur` opens `Sheet side="bottom"`; Refresh invokes `onRefresh` and disables while loading. Sheet content uses rounded top corners, max-height with overflow, safe-area footer, exact boundary, `DashboardHistoryFilter`, and a link using `dashboardPerformanceHref(applied)` labelled `Buka Performance`.

Update filter submit:

```ts
onApply({ date: draftDate, basis: draftBasis });
onApplied?.();
```

Do not call `onApplied` from date or basis `onChange`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same focused command. Expected: both files PASS.

- [ ] **Step 5: Commit task**

```powershell
rtk git add components/panel/dashboard/dashboard-mobile-command-bar.tsx components/panel/dashboard/dashboard-mobile-command-bar.test.tsx components/panel/dashboard/dashboard-history-filter.tsx components/panel/dashboard/dashboard-history-filter.test.tsx
rtk git commit -m "feat: add compact mobile dashboard controls"
```

---

### Task 2: KPI-first responsive Dashboard composition

**Files:**
- Modify: `components/panel/dashboard/owner-home.tsx`
- Modify: `components/panel/dashboard/owner-home.test.tsx`
- Modify only if needed: `components/panel/dashboard/ledger.tsx`

**Interfaces:**
- Consumes: `DashboardMobileCommandBar` from Task 1 and existing `useDashboardData` state.
- Produces: Owner Dashboard with separate mobile and desktop control presentations backed by one `selection`, one `range`, and one `useDashboardData` call.

- [ ] **Step 1: Write failing responsive-composition tests**

Extend the current OwnerHome tests. For a running date, assert:

```ts
expect(html).toContain('data-dashboard-mobile-controls="true"');
expect(html).toContain('data-dashboard-desktop-controls="true"');
expect(html).toContain('data-dashboard-section="metrics"');
expect(html).toContain('data-dashboard-section="attention"');
expect(html.indexOf('data-dashboard-section="metrics"'))
  .toBeLessThan(html.indexOf('data-dashboard-section="attention"'));
expect(html).toContain("md:hidden");
expect(html).toContain("hidden md:block");
```

Retain existing assertions that historical mode omits attention/order-ganda and preserves Performance query parameters.

- [ ] **Step 2: Run OwnerHome tests and confirm RED**

```powershell
rtk npm test -- --exclude ".worktrees/**" components/panel/dashboard/owner-home.test.tsx
```

Expected: FAIL because responsive markers/composition do not exist.

- [ ] **Step 3: Integrate mobile and desktop control compositions**

In `OwnerHome`:

- Render `DashboardMobileCommandBar` inside `data-dashboard-mobile-controls="true"` and `md:hidden`.
- Wrap current `DashboardContextBar` plus inline filter/link in `data-dashboard-desktop-controls="true"` and `hidden md:block`.
- Keep errors after controls.
- Move the `Kinerja bisnis` section before attention in DOM.
- Keep desktop asymmetric grid using `xl:col-start-*` / `xl:row-start-*` classes.
- Render attention after KPI and style mobile as one compact row; from `xl`, restore current section/rail presentation.
- Keep historical omission unchanged.
- Keep one `DuplicateSheet` instance.

No duplicate call to `useDashboardData`, `useQuery`, or any refresh function.

- [ ] **Step 4: Run Dashboard tests and confirm GREEN**

```powershell
rtk npm test -- --exclude ".worktrees/**" components/panel/dashboard/owner-home.test.tsx components/panel/dashboard/dashboard-mobile-command-bar.test.tsx components/panel/dashboard/dashboard-history-filter.test.tsx components/panel/dashboard/ledger.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit task**

```powershell
rtk git add components/panel/dashboard/owner-home.tsx components/panel/dashboard/owner-home.test.tsx components/panel/dashboard/ledger.tsx
rtk git commit -m "refactor: prioritize dashboard metrics on mobile"
```

---

### Task 3: Compact mobile panel header

**Files:**
- Modify: `app/panel/layout.tsx`
- Test: `app/panel/layout.test.tsx`

**Interfaces:**
- Consumes: existing `title`, `organizationName`, and `roleLabel` from PanelShell.
- Produces: one-line compact mobile route header; unchanged desktop organization metadata.

- [ ] **Step 1: Write failing shell test**

Assert two explicit responsive contexts:

```ts
expect(html).toContain('data-panel-mobile-role="true"');
expect(html).toContain('data-panel-desktop-org="true"');
expect(html).toContain("md:hidden");
expect(html).toContain("hidden md:block");
```

Continue asserting `Pustaka Islam` and `Owner` remain present in rendered markup for desktop.

- [ ] **Step 2: Run shell test and confirm RED**

```powershell
rtk npm test -- --exclude ".worktrees/**" app/panel/layout.test.tsx
```

Expected: FAIL because responsive context markers do not exist.

- [ ] **Step 3: Implement compact header**

- Change mobile header padding to `py-2.5`; preserve `md:px-8 md:py-3`.
- Keep `h1` at `text-xl` mobile and `text-2xl` desktop.
- Add mobile-only role text/stamp with `data-panel-mobile-role="true"` and `md:hidden`.
- Wrap organization plus role in `data-panel-desktop-org="true"` and `hidden md:block`.
- Reduce non-Follow-up page mobile canvas padding to `p-3 pb-24 sm:p-4 md:p-6 md:pb-8`.
- Do not change navigation order, permissions, bottom-nav height, or safe-area behavior.

- [ ] **Step 4: Run shell test and confirm GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit task**

```powershell
rtk git add app/panel/layout.tsx app/panel/layout.test.tsx
rtk git commit -m "refactor: compact mobile panel header"
```

---

### Task 4: Full verification and bounded visual correction

**Files:**
- Modify only defects found in: `components/panel/dashboard/dashboard-mobile-command-bar.tsx`, `components/panel/dashboard/dashboard-history-filter.tsx`, `components/panel/dashboard/owner-home.tsx`, `components/panel/dashboard/ledger.tsx`, `app/panel/layout.tsx`, and their tests.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: release-ready responsive Dashboard with verification evidence.

- [ ] **Step 1: Run complete automated gates**

```powershell
rtk npm test -- --exclude ".worktrees/**"
rtk npx tsc --noEmit
rtk npm run build
rtk git diff --check
```

Expected: all tests PASS, TypeScript exit 0, production build exit 0, diff check empty.

- [ ] **Step 2: Start production-like local app and run one visual batch**

Use existing app start/browser workflow. Inspect authenticated Dashboard once at desktop and once each at 390×844 and 320×700. Verify:

- KPI heading/first metric visible in first mobile viewport;
- compact command bar does not wrap badly;
- filter sheet opens, traps focus, scrolls internally, applies selection, and closes;
- refresh feedback works while prior data remains;
- historical mode shows exact boundary and hides attention;
- duplicate alert opens existing sheet;
- no horizontal overflow or console error;
- desktop context/filter/attention rail remains intact.

- [ ] **Step 3: Run Impeccable detector once**

```powershell
rtk node C:\Users\fandy\.agents\skills\impeccable\scripts\detect.mjs --json components/panel/dashboard/dashboard-mobile-command-bar.tsx components/panel/dashboard/dashboard-history-filter.tsx components/panel/dashboard/owner-home.tsx components/panel/dashboard/ledger.tsx app/panel/layout.tsx
```

Expected: JSON findings reviewed. Fix actionable target-size, contrast, overflow, hierarchy, or banned-pattern defects in one batch.

- [ ] **Step 4: Confirm corrections once**

Re-run affected tests plus `rtk npx tsc --noEmit`. Perform at most one final mobile/desktop screenshot batch, following Impeccable bounded-pass rule.

- [ ] **Step 5: Commit verified implementation**

```powershell
rtk git add app/panel/layout.tsx app/panel/layout.test.tsx components/panel/dashboard
rtk git commit -m "feat: surface dashboard metrics faster on mobile"
```

- [ ] **Step 6: Report release state**

Report commits, tests, TypeScript/build status, measured first-viewport result, query impact (`none`), and any remaining deployment step. Do not push/deploy unless the user authorizes publishing.
