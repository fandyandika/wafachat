# Wafachat UI/UX Targeted Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade every Wafachat route into one professional, calm, accessible operational interface while preserving business behavior and bounded Convex usage.

**Architecture:** Refine the existing Tailwind/shadcn/Base UI foundation first, then update the application shell and each route in independent reviewable tasks. Reuse current data hooks and mutations unchanged; visual state and interaction improvements stay in the presentation layer.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS 3, Base UI/shadcn components, Lucide icons, Convex, Vitest, React server rendering tests.

## Global Constraints

- Preserve the Wafachat logo, Plus Jakarta Sans, routes, role permissions, data flow, webhook behavior, cutoff logic, Queen rules, and report calculations.
- Violet is the only brand accent; semantic success, warning, destructive, information, and Queen-gold colors retain functional meaning.
- Design variance is 4/10, motion intensity is 2/10, and visual density is 6/10.
- No new realtime Convex queries; Performance and Queen remain on-demand and Follow-up retains its bounded snapshot behavior.
- Use the existing Lucide icon family and existing dependencies only.
- Use 12px card radius, smaller consistent button/input radius, 150-200ms state transitions, and 44px minimum touch targets on mobile.
- Keep one page-level heading, visible input labels, keyboard focus, `role="alert"` errors, actionable empty states, and reduced-motion support.
- Do not add dark mode, charts without an operational decision, push notifications, speculative SaaS features, or route changes.
- Every shell command in this repository starts with `rtk`.

---

## File map

- `app/globals.css`: semantic color, surface, focus, and motion foundation.
- `app/panel/layout.tsx`: shared navigation, title, responsive canvas, skip link, and safe-area layout.
- `components/ui/button.tsx`, `card.tsx`, `metric-card.tsx`: shared control and data-surface vocabulary.
- `components/panel/panel-state.tsx`: shared empty/error feedback used by three or more routes.
- `app/panel/page.tsx`: live operational Dashboard.
- `app/panel/performance/page.tsx`, `components/panel/performance-panel.tsx`: on-demand evaluation report.
- `components/panel/daily-report-dashboard.tsx`, `report-card.tsx`, `arena-hero.tsx`: daily report and CS-scoped Queen state.
- `components/panel/queen-recap.tsx`: monthly Queen history.
- `components/panel/follow-up-dashboard.tsx`: bounded CRM workspace.
- `components/panel/settings-dashboard.tsx`: account, organization, team, and CS configuration.
- `app/login/page.tsx`, `app/offline/page.tsx`, `components/panel/pwa-install.tsx`: entry and recovery surfaces.

---

### Task 1: Shared visual foundation and feedback state

**Files:**
- Modify: `app/globals.css`
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/metric-card.tsx`
- Create: `components/panel/panel-state.tsx`
- Create: `components/panel/panel-state.test.tsx`

**Interfaces:**
- Consumes: existing `Button`, `Card`, `MetricCard`, Tailwind semantic tokens, and Lucide icons.
- Produces: `PanelState({ kind, title, description, action })`, where `kind` is `"empty" | "error"`; all later page tasks may reuse it.

- [ ] **Step 1: Write the failing feedback-state test**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PanelState } from "./panel-state";

(globalThis as any).React = React;

test("error state is announced and empty state remains instructional", () => {
  const error = renderToStaticMarkup(
    <PanelState kind="error" title="Data gagal dimuat" description="Periksa koneksi." action={<button>Coba lagi</button>} />,
  );
  const empty = renderToStaticMarkup(
    <PanelState kind="empty" title="Belum ada data" description="Pilih periode untuk mulai." />,
  );

  expect(error).toContain('role="alert"');
  expect(error).toContain("Coba lagi");
  expect(empty).not.toContain('role="alert"');
  expect(empty).toContain("Pilih periode untuk mulai");
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `rtk npx vitest run components/panel/panel-state.test.tsx`

Expected: FAIL because `./panel-state` does not exist.

- [ ] **Step 3: Add the minimal shared state component**

```tsx
import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PanelState({
  kind,
  title,
  description,
  action,
}: {
  kind: "empty" | "error";
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = kind === "error" ? CircleAlert : Inbox;
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className={cn("grid min-h-40 place-items-center rounded-xl border border-dashed px-6 py-10 text-center", kind === "error" && "border-destructive/30")}
    >
      <div className="max-w-sm space-y-2">
        <Icon aria-hidden className={cn("mx-auto size-5 text-muted-foreground", kind === "error" && "text-destructive")} />
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Refine the shared tokens and primitives**

Apply these exact outcomes:

- Remove both decorative `background-image` declarations and `background-attachment` from `body`.
- Keep `Plus Jakarta Sans`; increase muted-text contrast and retain violet as `--primary`.
- Keep `--radius: 0.75rem`; cards use `rounded-xl` and a quiet one-pixel/tinted shadow.
- Replace `transition-all` in `Button` and `MetricCard` with property-specific color, border, shadow, opacity, and transform transitions lasting 150-200ms.
- Remove the automatic hover lift from `MetricCard`; retain a border-color hover only when the card is interactive.
- Make mobile default controls at least `h-11`, with compact `sm:h-9` sizing where the component API permits.

- [ ] **Step 5: Run focused tests**

Run: `rtk npx vitest run components/panel/panel-state.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add app/globals.css components/ui/button.tsx components/ui/card.tsx components/ui/metric-card.tsx components/panel/panel-state.tsx components/panel/panel-state.test.tsx
rtk git commit -m "style: establish Wafachat interface foundation"
```

---

### Task 2: Application shell and responsive navigation

**Files:**
- Modify: `app/panel/layout.tsx`
- Modify: `app/panel/layout.test.tsx`

**Interfaces:**
- Consumes: shared color/control rules from Task 1 and existing `NAV`, `useMe`, and `PwaInstallButton` behavior.
- Produces: `#panel-main` as the stable main-content target and one authoritative route title per panel route.

- [ ] **Step 1: Extend the layout regression test**

```tsx
test("panel shell exposes one accessible content target without legacy global filters", () => {
  const html = renderToStaticMarkup(<PanelLayout><div>Settings content</div></PanelLayout>);
  expect(html).toContain('href="#panel-main"');
  expect(html).toContain('id="panel-main"');
  expect(html).toContain("Lewati navigasi");
  expect(html).not.toContain("30 hari");
  expect(html).not.toContain("Semua CS");
  expect((html.match(/wafachat-wordmark\.png/g) ?? [])).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `rtk npx vitest run app/panel/layout.test.tsx`

Expected: FAIL because the skip link and `#panel-main` target are absent and the wordmark appears twice.

- [ ] **Step 3: Implement the lean shell**

Add the skip link before the flex shell:

```tsx
<a href="#panel-main" className="sr-only fixed left-3 top-3 z-50 rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only">
  Lewati navigasi
</a>
```

Then:

- Keep the sidebar wordmark and remove the duplicate wordmark/divider from the sticky header.
- Change the desktop sidebar width from `w-64` to `w-60`.
- Use an opaque `bg-background` sticky header without backdrop blur.
- Add `id="panel-main"` to `<main>`.
- Use `max-w-[1440px]` for the shared content canvas; retain the tighter Follow-up padding branch.
- Keep role-based navigation and logout behavior unchanged.
- Keep the mobile bottom bar solid and safe-area aware; ensure each item has a 44px minimum target.

- [ ] **Step 4: Run the layout test**

Run: `rtk npx vitest run app/panel/layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add app/panel/layout.tsx app/panel/layout.test.tsx
rtk git commit -m "style: streamline the Wafachat app shell"
```

---

### Task 3: Dashboard hierarchy and dead trend removal

**Files:**
- Modify: `app/panel/page.tsx`
- Create: `app/panel/page.test.tsx`

**Interfaces:**
- Consumes: `PanelState`, `MetricCard`, current snapshot hooks, `WindowModeToggle`, duplicate-order sheet, and existing summary/performance/response data.
- Produces: a six-metric live overview with no `metrics.getTrend` call.

- [ ] **Step 1: Write a dashboard regression test with deterministic hook data**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
const { snapshots } = vi.hoisted(() => ({ snapshots: vi.fn() }));

vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ startAt: 1, endAt: 2, csName: undefined, jakartaDate: "2026-08-02", range: "today" }),
}));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: unknown[]) => snapshots(...args),
}));

import DashboardPage from "./page";

test("dashboard renders the operational snapshot without a disabled trend", () => {
  snapshots
    .mockReturnValueOnce({ data: { leads: 12, closings: 8, manualClosings: 8, cancelled: 0, handovers: 0, revenue: 1_500_000 }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: [], loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: { totalClosing: 8, overallCr: 66.7, cancelled: 0, cs: [], products: [] }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() });

  const html = renderToStaticMarkup(<DashboardPage />);
  expect(html).toContain("Leads");
  expect(html).toContain("Closing Rate");
  expect(html).not.toContain("Trend Harian");
  expect(html).not.toContain("Order Double");
  expect(snapshots).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run the test and verify current behavior fails it**

Run: `rtk npx vitest run app/panel/page.test.tsx`

Expected: FAIL because the page still instantiates the skipped trend query and always renders the disabled duplicate-order action.

- [ ] **Step 3: Remove the dead trend path and simplify metric presentation**

Delete imports and calculations for `TrendChart`, `StatsWidget`, `getTrend`, trend points/series, and momentum. Remove `trendData.refresh()` from refresh handling.

Render:

```tsx
<section aria-label="Ringkasan hari ini" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
  <MetricCard label="Leads" value={<AnimatedNumber value={stats.orders} />} hint={periodLabel} tone="lead" />
  <MetricCard label="Closing" value={<AnimatedNumber value={totalClosing} />} hint={periodLabel} tone="positive" />
  <MetricCard label="Closing Rate" value={`${crPerf.toFixed(1)}%`} hint={periodLabel} tone="positive" />
  {cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
  <MetricCard label="Respon CS" value={respData?.overall.firstReplyMedianMs != null ? formatDuration(respData.overall.firstReplyMedianMs) : "-"} hint="Median balasan pertama, 24 jam" icon={Clock} />
</section>
```

Also:

- Consolidate mode, updated time, refresh, and duplicate-order attention into one toolbar.
- Render the duplicate-order button only when `dupCount > 0`.
- Render query failures through `PanelState kind="error"` with a refresh action.
- Replace Top CS/Product loading paragraphs with shape-matched skeleton rows.
- Keep the duplicate sheet and every current data argument unchanged.

- [ ] **Step 4: Run dashboard and shared tests**

Run: `rtk npx vitest run app/panel/page.test.tsx app/panel/layout.test.tsx components/panel/panel-state.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add app/panel/page.tsx app/panel/page.test.tsx
rtk git commit -m "style: focus the live operations dashboard"
```

---

### Task 4: Performance report filter and result hierarchy

**Files:**
- Modify: `app/panel/performance/page.tsx`
- Modify: `app/panel/performance/page.test.tsx`
- Modify: `components/panel/performance-panel.tsx`
- Modify: `components/panel/performance-panel.test.tsx`

**Interfaces:**
- Consumes: unchanged `getPerformanceReport` arguments and `PerformanceReport` type.
- Produces: accessible presentation tabs and a visible submitted-period summary without additional queries.

- [ ] **Step 1: Extend performance tests**

Add to `page.test.tsx`:

```tsx
expect(html).toContain('aria-label="Filter laporan kinerja"');
expect(html).not.toContain('<h1');
expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, "skip");
```

Add to `performance-panel.test.tsx`:

```tsx
expect(html).toContain('role="tablist"');
expect(html).toContain('aria-selected="true"');
expect(html).toContain("Ringkasan periode");
expect(html).toContain("Rincian pekanan");
```

- [ ] **Step 2: Run focused tests and verify the new semantics fail**

Run: `rtk npx vitest run app/panel/performance/page.test.tsx components/panel/performance-panel.test.tsx`

Expected: FAIL because the filter and result tabs do not yet expose the required semantics and the page repeats its heading.

- [ ] **Step 3: Refine the filter and result UI**

- Remove the local `<h1>Performance</h1>`; keep one short description and the Queen action beside the filter surface.
- Wrap period controls in `aria-label="Filter laporan kinerja"`.
- Preserve native date/month inputs and the local CS select.
- Use `PanelState` for idle, empty, and error outcomes.
- Add `role="tablist"` to the result switcher and `role="tab"`, `aria-selected`, and stable `aria-controls` values to the three buttons.
- Add `role="tabpanel"` to the active result content.
- Change the period header copy to “Ringkasan periode” and show generated time/status as secondary metadata.
- Keep product sorting local and do not call `report.refresh()` when switching tabs or sort order.
- Add `<caption className="sr-only">` to each data table and keep horizontal comparison tables scrollable.
- Use sentence-case labels and tabular metric values.

- [ ] **Step 4: Run performance tests**

Run: `rtk npx vitest run app/panel/performance/page.test.tsx components/panel/performance-panel.test.tsx lib/performance-report.test.ts`

Expected: PASS with the initial query still skipped.

- [ ] **Step 5: Commit**

```powershell
rtk git add app/panel/performance/page.tsx app/panel/performance/page.test.tsx components/panel/performance-panel.tsx components/panel/performance-panel.test.tsx
rtk git commit -m "style: clarify on-demand performance reports"
```

---

### Task 5: Daily report toolbar and quieter CS status

**Files:**
- Modify: `components/panel/daily-report-dashboard.tsx`
- Modify: `components/panel/report-card.tsx`
- Modify: `components/panel/arena-hero.tsx`
- Create: `components/panel/daily-report-dashboard.test.tsx`

**Interfaces:**
- Consumes: current report-window helpers, snapshot hooks, response-time data, Queen computation, capture/export behavior, and role scoping.
- Produces: one report toolbar with unchanged `day` query behavior and quieter owner/CS report hierarchy.

- [ ] **Step 1: Write a loading-state structure test**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/panel/laporan",
}));
vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-me", () => ({ useMe: () => ({ name: "Admin", role: "admin" }) }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ csName: undefined }) }));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: () => ({ data: undefined, loading: true, error: null, lastUpdatedAt: null, refresh: vi.fn() }),
}));

import { DailyReportDashboard } from "./daily-report-dashboard";

test("daily report exposes one labelled toolbar while loading", () => {
  const html = renderToStaticMarkup(<DailyReportDashboard />);
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Kontrol laporan"');
  expect(html).toContain("Periode kerja 16:00");
  expect(html).not.toContain("Snapshot analytics");
});
```

- [ ] **Step 2: Run the focused test and verify the toolbar semantics fail**

Run: `rtk npx vitest run components/panel/daily-report-dashboard.test.tsx`

Expected: FAIL because the controls are not yet grouped as one labelled toolbar.

- [ ] **Step 3: Refine the report view without changing calculations**

- Group date navigation, native date input, CS filter, refresh, and share/export inside `role="toolbar" aria-label="Kontrol laporan"`.
- Label the cutoff succinctly as “Periode kerja 16:00” and keep the exact boundary in secondary text.
- Keep `day` URL behavior, snapshot args, previous-period comparison, response-time bounds, role scoping, and image-capture CSS unchanged.
- Replace repeated loading/error copy with skeletons and `PanelState`/`role="alert"` recovery.
- Reduce `InfoStrip` to actionable duplicate/SLA exceptions; hide it when all counts are zero.
- In `report-card.tsx`, keep metrics and detail action but reduce nested borders and repeated labels.
- In `arena-hero.tsx`, keep Queen score, rank, countdown, and final winner states; shorten support copy to one actionable sentence and reserve confetti for the final winner state.
- Replace visible separator dashes with plain sentences or a single metadata line.

- [ ] **Step 4: Run report, Queen math, and capture-related tests**

Run: `rtk npx vitest run components/panel/daily-report-dashboard.test.tsx components/panel/report-text.test.ts components/panel/report-window.test.ts lib/queen.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add components/panel/daily-report-dashboard.tsx components/panel/daily-report-dashboard.test.tsx components/panel/report-card.tsx components/panel/arena-hero.tsx
rtk git commit -m "style: simplify the daily report workflow"
```

---

### Task 6: Queen recap month-first presentation

**Files:**
- Modify: `components/panel/queen-recap.tsx`
- Modify: `components/panel/queen-recap.test.tsx`

**Interfaces:**
- Consumes: unchanged `QueenRecapData`, `api.queens.getMonth`, and `queueMonthBackfill` mutation.
- Produces: semantic monthly, weekly, standings, and daily-history sections with no extra query or chart.

- [ ] **Step 1: Strengthen the pure-view test**

```tsx
expect(html).toContain('aria-label="Ringkasan Queen bulanan"');
expect(html).toContain('aria-label="Pemenang Queen pekanan"');
expect(html).toContain('aria-label="Riwayat Queen harian"');
expect(html).toContain("4 pekan bonus");
expect((html.match(/Pekan /g) ?? [])).toHaveLength(4);
```

- [ ] **Step 2: Run the Queen component test and verify the new hierarchy fails**

Run: `rtk npx vitest run components/panel/queen-recap.test.tsx`

Expected: FAIL because the current sections lack stable accessible labels and the four-week bonus distinction is implicit.

- [ ] **Step 3: Implement the lean recap hierarchy**

- Keep the native month input and existing July 2026 lower bound.
- Render a compact month toolbar followed by a two-column monthly winner/standings summary.
- Label weekly content explicitly as “4 pekan bonus” and preserve current `complete`, `running`, and `upcoming` calculations.
- Render daily history as a responsive table with an accessible caption.
- Use `PanelState` for loading and no-award cases.
- Keep “Siapkan rekap” visible only when `setupNeeded` is true.
- Do not add a chart, timer, poller, or new Convex call.

- [ ] **Step 4: Run Queen tests**

Run: `rtk npx vitest run components/panel/queen-recap.test.tsx convex/queens.test.ts lib/queen.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add components/panel/queen-recap.tsx components/panel/queen-recap.test.tsx
rtk git commit -m "style: refine the Queen recap hierarchy"
```

---

### Task 7: Follow-up workspace clarity and safe bulk actions

**Files:**
- Modify: `components/panel/follow-up-dashboard.tsx`
- Create: `components/panel/follow-up-dashboard.test.tsx`

**Interfaces:**
- Consumes: current `/api/follow-up/snapshot`, send/archive/unarchive/stage/auto-toggle routes and tab-gated Convex queries.
- Produces: accessible queue tabs, stable search/filter toolbar, desktop split workspace, mobile focused detail, and in-app bulk confirmation.

- [ ] **Step 1: Write the initial workspace semantics test**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ cs: "all" }) }));

import { FollowUpDashboard } from "./follow-up-dashboard";

test("follow-up exposes queue navigation and labelled search", () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Antrean follow-up"');
  expect(html).toContain('aria-label="Cari customer"');
  expect(html).toContain("Semua");
  expect(html).toContain("Arsip");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `rtk npx vitest run components/panel/follow-up-dashboard.test.tsx`

Expected: FAIL because the current queue buttons and search input lack those semantics.

- [ ] **Step 3: Refine the CRM workspace without adding reads**

- Preserve `loadSnapshot`, its triggers, all tab-gated query arguments, and every API payload.
- Add `role="tablist" aria-label="Antrean follow-up"`; give each queue button `role="tab"` and `aria-selected`.
- Add a visible or screen-reader label and `aria-label="Cari customer"` to search.
- Keep search, CS selection, sort, refresh, and auto-send in one stable toolbar.
- Use a 360-420px list column and flexible conversation column on desktop; retain the existing mobile list/detail switch.
- Make overdue/priority, customer identity, stage, last message, and next action the list-row hierarchy.
- Replace the bulk `window.confirm` with the existing `AlertDialog`; confirmation text states action and exact selected count.
- Add `role="status" aria-live="polite"` to bulk progress/success and `role="alert"` to failures.
- Replace silent auto-toggle and restore failures with visible inline feedback.
- Reuse `PanelState` for empty queues and keep message skeletons for loading.

- [ ] **Step 4: Run Follow-up tests and API route tests**

Run: `rtk npx vitest run components/panel/follow-up-dashboard.test.tsx convex/followUp.test.ts convex/autoFollowUp.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add components/panel/follow-up-dashboard.tsx components/panel/follow-up-dashboard.test.tsx
rtk git commit -m "style: sharpen the follow-up workspace"
```

---

### Task 8: Settings information architecture and in-app editing

**Files:**
- Modify: `components/panel/settings-dashboard.tsx`
- Create: `components/panel/settings-dashboard.test.tsx`

**Interfaces:**
- Consumes: existing account endpoint, organization/team mutations, CS configuration mutations, `AlertDialog`, `Switch`, and avatar upload flow.
- Produces: `SettingsSection = "account" | "organization" | "team" | "cs"` navigation and inline edit state; mutation payloads remain unchanged.

- [ ] **Step 1: Write settings regression tests**

```tsx
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("convex/react", () => ({ useQuery: () => [], useMutation: () => vi.fn() }));

import { SettingsDashboard } from "./settings-dashboard";

test("settings uses task sections and no native browser dialogs", () => {
  const html = renderToStaticMarkup(<SettingsDashboard />);
  const source = readFileSync(new URL("./settings-dashboard.tsx", import.meta.url), "utf8");
  expect(html).toContain('aria-label="Bagian pengaturan"');
  expect(html).toContain("Akun");
  expect(html).toContain("Organisasi");
  expect(html).toContain("Tim");
  expect(html).toContain("Konfigurasi CS");
  expect(source).not.toContain("window.prompt");
  expect(source).not.toContain("window.confirm");
  expect(source).not.toMatch(/\balert\(/);
});
```

- [ ] **Step 2: Run the settings test and verify it fails**

Run: `rtk npx vitest run components/panel/settings-dashboard.test.tsx`

Expected: FAIL because settings is one long page and uses native browser dialogs.

- [ ] **Step 3: Add section navigation and progressive disclosure**

```tsx
type SettingsSection = "account" | "organization" | "team" | "cs";
const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: "account", label: "Akun" },
  { value: "organization", label: "Organisasi" },
  { value: "team", label: "Tim" },
  { value: "cs", label: "Konfigurasi CS" },
];
```

Render the section control with `aria-label="Bagian pengaturan"`, `aria-pressed`, and one active content region. Non-admin users see only Account.

- [ ] **Step 4: Replace native dialogs and expose real labels**

- Use inline edit state for rename-user, reset-password, and rename-CS actions; each editor has a visible `<label>`, Save, and Cancel.
- Use `AlertDialog` for delete user, delete CS, and remove internal number.
- Replace `alert()` mutation failures with local `role="alert"` feedback.
- Add visible labels to organization name, internal phone, new-user name/email/role/CS/password, Berdu Staff IDs, and aliases.
- Keep independent switches immediate-save and show an inline failure if `upsert` rejects.
- Keep every existing mutation name and payload unchanged.
- Render CS configuration as a compact list/accordion on mobile and two-column detail grid on wide screens; destructive controls remain separated.

- [ ] **Step 5: Run settings and authorization tests**

Run: `rtk npx vitest run components/panel/settings-dashboard.test.tsx convex/cs.test.ts convex/csConfigs.test.ts convex/orgSettings.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add components/panel/settings-dashboard.tsx components/panel/settings-dashboard.test.tsx
rtk git commit -m "style: organize Wafachat settings by task"
```

---

### Task 9: Login, offline, and PWA consistency

**Files:**
- Modify: `app/login/page.tsx`
- Create: `app/login/page.test.tsx`
- Modify: `app/offline/page.tsx`
- Modify: `app/offline/page.test.tsx`
- Modify: `components/panel/pwa-install.tsx`

**Interfaces:**
- Consumes: existing `/api/auth/login`, `/panel` retry target, browser install prompt behavior, and shared Button/Card styles.
- Produces: labelled entry/recovery surfaces with unchanged authentication and PWA behavior.

- [ ] **Step 1: Add login and recovery assertions**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import LoginPage from "./page";

test("login presents a labelled Wafachat sign-in form", () => {
  const html = renderToStaticMarkup(<LoginPage />);
  expect(html).toContain("Masuk ke Wafachat");
  expect(html).toContain('for="email"');
  expect(html).toContain('for="password"');
  expect(html).toContain('autocomplete="email"');
  expect(html).toContain('autocomplete="current-password"');
});
```

Extend `offline/page.test.tsx`:

```tsx
expect(html).toContain("Periksa koneksi internet");
expect(html).toContain('href="/panel"');
expect(html).toContain("Coba lagi");
```

- [ ] **Step 2: Run entry-state tests and verify new copy/labels fail**

Run: `rtk npx vitest run app/login/page.test.tsx app/offline/page.test.tsx`

Expected: FAIL because the login fields lack explicit `id`/`htmlFor`, current-password autocomplete, and the approved heading.

- [ ] **Step 3: Align entry and recovery UI**

- Use the shared Button and Card vocabulary on Login.
- Keep the wordmark, reduce its scale, use “Masuk ke Wafachat” and one short operational description.
- Add `id`, `htmlFor`, `aria-invalid`, `aria-describedby`, `autoComplete="current-password"`, and `role="alert"` error semantics.
- Preserve the POST payload and router destination.
- Add a network-failure catch that reports “Tidak dapat terhubung. Coba lagi.” and resets loading.
- Keep Offline free of business data and provide one clear retry action.
- Refine `PwaInstallButton` spacing and feedback only; do not add push notification code or change install-prompt behavior.

- [ ] **Step 4: Run login, offline, and manifest tests**

Run: `rtk npx vitest run app/login/page.test.tsx app/offline/page.test.tsx app/manifest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add app/login/page.tsx app/login/page.test.tsx app/offline/page.tsx app/offline/page.test.tsx components/panel/pwa-install.tsx
rtk git commit -m "style: align Wafachat entry and recovery states"
```

---

### Task 10: Bounded visual, accessibility, and release verification

**Files:**
- Modify only files with defects found during this verification pass.

**Interfaces:**
- Consumes: completed Tasks 1-9.
- Produces: one verified UI change set ready for review; no deployment is performed in this task.

- [ ] **Step 1: Run the complete automated gate**

```powershell
rtk npm test
rtk npx tsc --noEmit
rtk npx convex codegen
rtk npm run build
```

Expected: all tests pass, TypeScript exits 0, Convex codegen exits 0, and the production build exits 0.

- [ ] **Step 2: Run the Impeccable detector once over changed UI targets**

```powershell
rtk node C:\Users\fandy\.agents\skills\impeccable\scripts\detect.mjs --json app/globals.css app/panel app/login app/offline components/ui components/panel
```

Expected: no unresolved high-confidence accessibility, interaction, responsive, or visual-system defects. Fix concrete findings in one batch and do not rerun the detector.

- [ ] **Step 3: Perform one desktop/mobile visual pass**

Open these routes with production-like data at 1440x900 and 375x812:

- `/panel`
- `/panel/performance`
- `/panel/laporan`
- `/panel/queen`
- `/panel/follow-up`
- `/panel/settings`
- `/login`
- `/offline`

For each route verify: no horizontal page scroll, no duplicated route heading, solid mobile bottom navigation, visible focus, readable long content, correct loading/empty/error treatment, and no console errors.

- [ ] **Step 4: Correct all visual-pass defects in one batch**

Limit corrections to spacing, wrapping, overflow, state feedback, semantics, and shared-style consistency. Do not add features or change data access during this pass.

- [ ] **Step 5: Confirm the corrected routes once**

Repeat only the viewport and route combinations that showed defects. Stop after this confirmation pass.

- [ ] **Step 6: Run final repository checks**

```powershell
rtk git diff --check
rtk git status --short
rtk npm test
rtk npx tsc --noEmit
rtk npm run build
```

Expected: clean diff check, only intentional files changed, all tests pass, TypeScript exits 0, and build exits 0.

- [ ] **Step 7: Commit verification fixes**

```powershell
rtk git add app components
rtk git commit -m "fix: complete Wafachat UI verification"
```

If Step 4 produced no code changes, skip this commit.
