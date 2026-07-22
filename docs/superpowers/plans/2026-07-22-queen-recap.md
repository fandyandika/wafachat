# Queen Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist daily Queen winners and show owner-only weekly/monthly recaps based only on daily win counts.

**Architecture:** `queenAwards` is a compact per-org, per-16:00-WIB-window snapshot. A scheduled internal action creates new snapshots from existing daily rollups plus response samples. The owner Performance page reads selected-month snapshots and derives weekly/monthly standings without rescanning orders or recaps.

**Tech Stack:** Next.js App Router, Convex schema/query/mutation/action/cron, Vitest with convex-test, existing `lib/queen.ts`.

## Global Constraints

- Preserve `lib/queen.ts` scoring and its eligibility gates exactly.
- Week/month rank strictly by daily-win count; equal counts are ties.
- Use existing `windowKeyFor`/`windowRangeForKey` business-day semantics.
- Read no raw orders or shipping recaps for the normal recap path.
- Keep the recap admin-only; do not alter CS Laporan/Arena.
- Do not add graphs, PWA, bonus payment, or new dependencies.

---

### Task 1: Queen snapshot backend

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/queens.ts`
- Create: `convex/queens.test.ts`
- Modify: `convex/crons.ts`

**Interfaces:**
- Produces `internal.queens.captureWindow({ orgId, windowKey })` and `internal.queens.captureClosedWindows({ cursor? })`.
- Produces `api.queens.getMonth({ month })` and `api.queens.queueCurrentMonthBackfill({})`.
- `getMonth` returns `{ awards, monthly, weekly, setupNeeded }`.

- [ ] **Step 1: Write failing backend tests**

```ts
test("captureWindow stores exactly one existing Queen winner", async () => {
  // Seed one completed rollup window, two eligible dailyRollups, responseSamples,
  // and a rollupWindows marker. Invoke captureWindow twice.
  // Assert one queenAwards row, winner from computeQueenCs, and no duplicate win.
});

test("getMonth ranks only daily wins and exposes a tie", async () => {
  // Seed three won days: A wins two, B wins one; then seed another week where A/B
  // each win once. Assert monthly A=2 and weekly winners contain both tied names.
});

test("CS cannot read or queue Queen recap", async () => {
  // Query/mutate with a CS identity and assert unauthorized.
});
```

- [ ] **Step 2: Run backend tests to verify RED**

Run: `rtk npx vitest run convex/queens.test.ts`  
Expected: FAIL because `api.queens` and `queenAwards` do not exist.

- [ ] **Step 3: Add the compact snapshot table**

```ts
queenAwards: defineTable({
  orgId: v.id("organizations"), windowKey: v.string(), status: v.union(v.literal("won"), v.literal("no_winner")),
  winnerCsKey: v.optional(v.string()), winnerCsName: v.optional(v.string()),
  score: v.optional(v.number()), leads: v.optional(v.number()), closings: v.optional(v.number()),
  cr: v.optional(v.number()), respMedianMs: v.optional(v.number()), sealedAt: v.number(),
}).index("by_org_windowKey", ["orgId", "windowKey"]),
```

- [ ] **Step 4: Implement snapshot and recap functions**

```ts
// captureWindow: require a completed rollupWindows marker; read dailyRollups via
// by_org_windowKey; combine responseTimesFromSamples(...) with the existing
// computeQueenCs/computeQueenScores; patch-or-insert one queenAwards row.
// getMonth: requireAdminOrg, index-read month keys, count status === "won" rows,
// group each row by Monday week key, and return all tied leaders.
// queueCurrentMonthBackfill: requireAdminOrg and schedule captureWindow only for
// completed, missing month windows.
```

- [ ] **Step 5: Schedule the daily capture**

```ts
crons.daily("queen daily snapshot", { hourUTC: 10, minuteUTC: 0 }, internal.queens.captureClosedWindows, {});
```

- [ ] **Step 6: Run backend tests to verify GREEN**

Run: `rtk npx vitest run convex/queens.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit backend**

```bash
git add convex/schema.ts convex/queens.ts convex/queens.test.ts convex/crons.ts convex/_generated/
git commit -m "feat: persist daily queen awards"
```

### Task 2: Owner recap panel

**Files:**
- Create: `components/panel/queen-recap.tsx`
- Modify: `app/panel/performance/page.tsx`
- Create: `components/panel/queen-recap.test.tsx`

**Interfaces:**
- Consumes `api.queens.getMonth` and `api.queens.queueCurrentMonthBackfill`.
- Produces an owner-only `QueenRecap` section rendered under Performance data.

- [ ] **Step 1: Write failing component tests**

```tsx
test("shows monthly winner, weekly tie, and a dated daily winner row", () => {
  render(<QueenRecap recap={fixture} onBackfill={vi.fn()} />);
  expect(screen.getByText("Queen Bulan Ini")).toBeInTheDocument();
  expect(screen.getByText("Seri")).toBeInTheDocument();
  expect(screen.getByText("Azelia")).toBeInTheDocument();
});

test("shows setup action only while completed days are missing", () => {
  render(<QueenRecap recap={{ ...fixture, setupNeeded: true }} onBackfill={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Siapkan rekap bulan ini" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run component tests to verify RED**

Run: `rtk npx vitest run components/panel/queen-recap.test.tsx`  
Expected: FAIL because `QueenRecap` does not exist.

- [ ] **Step 3: Implement the minimal recap component**

```tsx
// Show monthly leader/tie, weekly leader/tie cards, standings by daily wins,
// and a compact daily table. Render no chart. Use the existing Button and Card
// primitives; format an absent winner as "Tidak ada Queen".
```

- [ ] **Step 4: Wire it into Performance**

```tsx
// Query getMonth with the current YYYY-MM, call queueCurrentMonthBackfill only
// from the explicit setup button, and refresh the snapshot after scheduling.
// Performance is already admin-only in the panel shell/middleware.
```

- [ ] **Step 5: Run component tests to verify GREEN**

Run: `rtk npx vitest run components/panel/queen-recap.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit UI**

```bash
git add components/panel/queen-recap.tsx components/panel/queen-recap.test.tsx app/panel/performance/page.tsx
git commit -m "feat: add owner queen recap"
```

### Task 3: Full verification and production bootstrap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run all local gates**

Run: `rtk npx vitest run; rtk npx tsc --noEmit; rtk npx convex codegen; rtk npm run build`  
Expected: all commands exit 0.

- [ ] **Step 2: Deploy backend and frontend**

Run the established Convex production deploy and push the committed branch to trigger Vercel.

- [ ] **Step 3: Bootstrap the current month once**

Open Performance as owner and use `Siapkan rekap bulan ini`; wait for the small scheduled job set to complete, then refresh.

- [ ] **Step 4: Smoke test**

Verify the month contains one row per completed business day, weekly/monthly winners match daily-win counts, and a CS account cannot visit Performance or query `queens.getMonth`.

- [ ] **Step 5: Record completion**

Mark Queen recap complete in `docs/ROADMAP.md` and commit the final documentation update.
