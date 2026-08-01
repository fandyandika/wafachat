# Business Date Queen Weeks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label 16:00–16:00 report windows by their closing date and show Queen recap in exactly four monthly week buckets.

**Architecture:** Keep stored rollup and `queenAwards.windowKey` values unchanged as source-window keys. Add pure conversion helpers at the existing report-window core boundary, then map source keys to business/closing dates in reports and the Queen query. Reuse the existing bounded Queen backfill and query at most one month of award rows.

**Tech Stack:** Next.js 14, React 18, TypeScript, Convex, Vitest, convex-test.

## Global Constraints

- Business day is `[previous date 16:00 WIB, selected date 16:00 WIB)` and is labeled by the closing date.
- Queen recap always has four buckets: days 1–7, 8–14, 15–21, and 22–month end.
- Stored historical source-window keys are not migrated or rewritten.
- Backfill is bounded to the selected month, idempotent, and only schedules already-closed windows.
- No new dependency, schema table, cron, polling loop, or live Convex subscription.

---

### Task 1: Shared Business-Date Window Mapping

**Files:**
- Modify: `lib/report-window-core.ts`
- Modify: `components/panel/report-window.ts`
- Test: `components/panel/report-window.test.ts`

**Interfaces:**
- Produces: `businessDateKeyForWindowKey(key: string): string`, `windowKeyForBusinessDate(key: string): string`, and close-date behavior from `reportWindowForLabelDate` / `currentReportLabelDate`.

- [ ] **Step 1: Write failing boundary tests**

Assert that June 22 maps to June 21 16:00–June 22 16:00, July 1 crosses the month boundary, before 16:00 uses today, and at/after 16:00 uses tomorrow.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- components/panel/report-window.test.ts`

- [ ] **Step 3: Implement the minimal shared conversions**

Use existing `windowRangeForKey`, `windowKeyFor`, and `fourPmWibMs`; do not introduce another timezone library.

- [ ] **Step 4: Run the focused tests and confirm pass**

Run: `npm test -- components/panel/report-window.test.ts`

- [ ] **Step 5: Commit**

Run: `git add lib/report-window-core.ts components/panel/report-window.ts components/panel/report-window.test.ts && git commit -m "fix: label reports by closing date"`

### Task 2: Apply Closing-Date Labels to Daily Reports

**Files:**
- Modify: `components/panel/daily-report-dashboard.tsx`
- Test: `components/panel/report-window.test.ts`

**Interfaces:**
- Consumes: close-date behavior from Task 1.
- Produces: date picker, report heading, export filename, and visible date labels using the selected business date while retaining explicit 16:00 boundaries.

- [ ] **Step 1: Replace open-date display derivations**

Use the already-selected `labelDate`/window end date; keep query ranges unchanged and remove stale open-date comments.

- [ ] **Step 2: Run the report-window regression tests**

Run: `npm test -- components/panel/report-window.test.ts`

- [ ] **Step 3: Commit**

Run: `git add components/panel/daily-report-dashboard.tsx && git commit -m "fix: align report labels with business dates"`

### Task 3: Four-Bucket Queen Recap and Selected-Month Backfill

**Files:**
- Modify: `convex/queens.ts`
- Modify: `convex/queens.test.ts`

**Interfaces:**
- Consumes: `businessDateKeyForWindowKey` and `windowKeyForBusinessDate` from Task 1.
- Produces: `getMonth({month})` returning closing-date awards and exactly four weekly rows `{week,startKey,endKey,status,winners,winCount,standings}`.
- Produces: `queueMonthBackfill({month})`, admin-only, bounded, idempotent, and closed-window-only.

- [ ] **Step 1: Write failing Convex tests**

Cover: source window July 31 appears as August 1; four buckets use 1–7/8–14/15–21/22–31; tie counts remain intact; future windows are not queued; CS access remains rejected.

- [ ] **Step 2: Run the focused Convex tests and confirm failure**

Run: `npm test -- convex/queens.test.ts`

- [ ] **Step 3: Implement close-month source bounds and four fixed buckets**

Query the source range one day earlier than the selected close-month, map output keys to closing dates, and derive status from current/last-closed business dates.

- [ ] **Step 4: Generalize the existing backfill mutation**

Rename the public mutation to `queueMonthBackfill`, require `{month}`, query only that source range, and schedule only missing windows up to the last closed source key.

- [ ] **Step 5: Run the focused Convex tests and confirm pass**

Run: `npm test -- convex/queens.test.ts`

- [ ] **Step 6: Commit**

Run: `git add convex/queens.ts convex/queens.test.ts && git commit -m "feat: group Queen recap into four weeks"`

### Task 4: Lean Queen Recap UI

**Files:**
- Modify: `components/panel/queen-recap.tsx`
- Modify: `components/panel/queen-recap.test.tsx`

**Interfaces:**
- Consumes: four weekly rows and `queueMonthBackfill({month})` from Task 3.
- Produces: four always-visible cards with `Selesai`, `Berjalan`, or `Akan datang`, plus a waiting message for an active unfinalized day.

- [ ] **Step 1: Write failing UI tests**

Assert four week cards render, week 4 ends on the calendar month end, status labels render, and an active week with no winner says `Menunggu penutupan 16:00`.

- [ ] **Step 2: Run the focused UI tests and confirm failure**

Run: `npm test -- components/panel/queen-recap.test.tsx`

- [ ] **Step 3: Update the UI and backfill call**

Render the four backend rows directly, pass the selected `month` to the mutation, and retain the existing compact visual hierarchy.

- [ ] **Step 4: Regenerate Convex types**

Run: `npx convex codegen`

- [ ] **Step 5: Run focused tests and production gates**

Run: `npm test -- components/panel/report-window.test.ts convex/queens.test.ts components/panel/queen-recap.test.tsx`

Run: `npx tsc --noEmit`

Run: `npm run build`

- [ ] **Step 6: Commit**

Run: `git add components/panel/queen-recap.tsx components/panel/queen-recap.test.tsx convex/_generated && git commit -m "feat: show four-week Queen recap"`
