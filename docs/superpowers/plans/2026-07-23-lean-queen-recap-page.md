# Lean Queen recap page

> **Execution:** inline in the existing `release-main` worktree. This is a small, connected UI change and does not require a new worktree or backend redesign.

**Goal:** Move Queen recap out of Performance into a dedicated owner-only monthly page, while removing the broken raw period report that causes the Performance panel to keep loading.

**Approach:** Reuse the existing bounded `queens:getMonth` snapshot query. The new page requests only its selected month and derives daily, weekly, and monthly presentation from those rows. No graph, new table, background job, or aggregate query is introduced.

## Scope

- Add `/panel/queen`, accessible through a small link from Performance.
- Keep the native month control, bounded from `2026-07` through the current month.
- Show daily winner rows, monthly standings, weekly winners/status, and a monthly ongoing/final label.
- Hide general dashboard filters on this focused page so it does not subscribe to the CS filter list unnecessarily.
- Remove the embedded Queen section from every Performance tab.
- Remove `analytics:getPeriodReport` consumption and the `Laporan Pekanan/Bulanan` card from Performance; the raw query can exceed its safe row cap and is no longer useful there.
- Retain the existing owner authorization enforced by route middleware and `queens:getMonth`.

## Implementation steps

1. Update Queen recap tests to describe the dedicated monthly presentation: selected-month winner, daily rows, and ongoing/completed weekly states. Run the focused test to establish the desired UI contract.
2. Refactor `components/panel/queen-recap.tsx` into the dedicated page content. Keep `queens:getMonth` as the only data source, use the existing backfill action for missing current-period snapshot rows, and avoid extra subscriptions.
3. Add `app/panel/queen/page.tsx`; update panel layout title/filter behavior for this focused route and add an explicit CS route-guard test.
4. Remove `QueenRecap` and the raw `getPeriodReport` hook/card from Performance. Add the lightweight navigation link to `/panel/queen`.
5. Run focused tests, then the project test/typecheck/build gates. Inspect changed files and commit the implementation.
6. Push `main`; Vercel will deploy the frontend. Verify `/panel/performance` no longer loads the raw report and `/panel/queen` renders with production data. No Convex deployment is needed unless a Convex source file changes.

## Verification

```powershell
rtk npm test -- --runInBand components/panel/queen-recap.test.tsx lib/auth-jwt.test.ts
rtk npm test -- --runInBand
rtk npm run typecheck
rtk npm run build
rtk git diff --check
```

Manual production checks:

1. Open `/panel/performance`: no `Laporan Pekanan/Bulanan` spinner or `analytics:getPeriodReport` error; the Queen link is visible.
2. Open `/panel/queen`: current month defaults, past/current month selection works, daily rows and standings agree, the open week is marked `Berjalan`.
3. Sign in as a CS account: `/panel/queen` redirects according to the existing panel route guard.
