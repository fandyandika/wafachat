# Queen Recap — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation

## Goal

Show the owner which CS won Queen on every completed business day, then determine
the weekly and monthly Queen only from the number of daily wins. This is a recap
for evaluation and bonus preparation, not a second scoring system.

## Rules

- A daily winner uses the existing `lib/queen.ts` formula unchanged: CR 50%,
  closing 35%, response speed 15%, with its existing eligibility gates.
- A business day is the existing `16:00 WIB → 16:00 WIB` window and is labelled
  with the date on which that window opens.
- The winning snapshot is stored once per organization and completed window.
  A day with fewer than two eligible CS is retained as `no_winner` and does not
  count toward a week or month.
- Weekly Queen is the CS with the most daily wins in the Monday–Sunday week.
  Monthly Queen is the CS with the most daily wins in the calendar month.
- Equal win counts remain a displayed tie. No hidden score, revenue, or closing
  tiebreaker changes a tie into a bonus winner.
- Graphs, PWA, and further SaaS work are explicitly out of scope.

## Data and efficiency

Add one compact `queenAwards` row per `(orgId, windowKey)`. It stores the winner
or no-winner state plus the already-calculated daily score fields needed for audit.
The snapshot worker reads the completed `dailyRollups` window and response samples;
it does not re-scan raw orders or recaps. The owner recap reads at most the selected
month's small snapshot rows, so normal usage is bounded to roughly 31 rows per org.

At 17:00 WIB a cron captures the just-finished daily window for every organization.
A guarded owner action can queue a one-time backfill of missing completed windows in
the current month; it is explicit rather than running a month-wide recomputation on
every page visit.

## Access and UI

The existing daily Queen/Arena in Laporan remains unchanged for CS. Add a compact
owner-only `Queen Recap` section to the existing Performance page, which CS already
cannot open. It shows:

1. Queen Pekan Ini and Queen Bulan Ini, including a clear `Seri` state.
2. Per-CS number of daily Queen wins for the selected month.
3. A dated daily table: date, winner/no winner, score, CR, closings, and response
   median.
4. A `Siapkan rekap bulan ini` action only when completed days are missing.

## Error handling

- Missing rollup publication leaves a window pending; it is retried by the next
  scheduled capture rather than creating a partial award.
- Snapshot creation is idempotent: retrying a day replaces the same row instead of
  creating duplicate wins.
- The backfill action is admin-only and schedules bounded per-day work; it cannot
  run for a future/open window.

## Tests

- Snapshot uses the existing Queen winner and records no-winner when no contest forms.
- A repeated snapshot updates one row, not two wins.
- Month recap counts only daily winner rows and reports ties.
- CS identities cannot query the owner recap or queue a backfill.
- The panel renders recap data, tie text, and the explicit setup control.

## Scope review

No new scoring formula, target configuration, bonus payment, graphs, PWA, or SaaS
integration is included. The implementation reuses `lib/queen.ts`, report-window
keys, daily rollups, response samples, existing panel auth, and the Performance route.
