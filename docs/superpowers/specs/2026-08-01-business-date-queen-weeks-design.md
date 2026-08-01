# Business-Date Reports and Four-Week Queen Recap Design

## Goal

Use one Indonesian business-date convention across Laporan and Queen Recap, while guaranteeing exactly four Queen weeks per calendar month.

## Business-Date Convention

- The operational cutoff remains 16:00 WIB.
- A business window is labelled by the WIB calendar date when it closes.
- Example: `31 Jul 16:00 → 1 Aug 16:00` is **1 August**.
- Before its closing cutoff, the current business date is live; after the cutoff it is final.
- Dashboard, Laporan, and Queen continue reading the same underlying 24-hour windows. Only label-date mapping and month/week grouping change.

## Laporan Behaviour

- Date picker values represent closing dates.
- Selecting 1 August queries `31 Jul 16:00 → 1 Aug 16:00`.
- Current-date navigation selects the window whose next cutoff is the relevant closing date.
- Period text continues showing both exact boundaries, so the data interval remains explicit.
- Previous-day comparison steps backward by one complete 24-hour business window.

## Queen Daily Awards

- `queenAwards.windowKey` remains the existing opening-date storage key; no schema rewrite is required.
- API responses expose each award under its derived closing date: the day after `windowKey`.
- Monthly queries translate the selected calendar month into source windows:
  - first source window: day before the first calendar date;
  - last source window: day before the last calendar date.
- A Queen is finalized only after its source window closes at 16:00 WIB.
- Before the first August award is final, August still renders its month and four-week structure with a waiting state.

## Exactly Four Queen Weeks

Every calendar month uses fixed, owner-readable buckets:

1. Pekan 1: dates 1–7
2. Pekan 2: dates 8–14
3. Pekan 3: dates 15–21
4. Pekan 4: dates 22–last day of month

No fifth week is produced. Pekan 4 absorbs the remaining 8–10 calendar dates.

For each bucket:

- `Selesai`: its final date has passed the 16:00 cutoff;
- `Berjalan`: the current business date falls within the bucket;
- `Akan datang`: its first date has not started;
- winner: CS with the most finalized daily Queen wins in that bucket;
- ties remain explicit and list all tied CS names;
- no finalized winner yet: show `Menunggu penutupan 16:00` for the active bucket or `Belum ada Queen` otherwise.

The monthly winner remains the CS with the most finalized daily Queen wins from date 1 through the calendar month's last date.

## Existing July Data

- Existing award rows are preserved.
- July is read using closing-date mapping, so source windows span 30 June through 30 July.
- A bounded, idempotent selected-month backfill schedules only missing closed source windows.
- Future or still-open windows are never captured.
- Re-running backfill does not duplicate award rows because `by_org_windowKey` remains the unique lookup path.

## I/O Boundaries

- Monthly reads remain one indexed range query over `queenAwards`.
- Weekly and monthly standings are derived in memory from at most 31 award rows.
- Backfill reads existing award keys once and schedules only missing closed days.
- No additional live Convex subscription, cron frequency, rollup rebuild, or business-data cache is added.

## UI

- Queen Recap always renders four week cards for a valid selected month.
- Each card shows its date range, status, and current winner or waiting message.
- Daily history displays closing dates.
- Historical months show all buckets as complete.
- Laporan title, picker, period status, exported PNG filename, and detail labels use the same closing date.

## Verification

- Window `31 Jul 16:00 → 1 Aug 16:00` appears as 1 August in Laporan and Queen.
- Before 1 August 16:00, August displays Pekan 1 as running and waiting for finalization.
- After 1 August 16:00, the finalized award appears on 1 August.
- July and August each render exactly four weekly buckets.
- Month-end rollover for 28-, 29-, 30-, and 31-day months maps without gaps or duplicate dates.
- Existing Queen score calculation, eligibility thresholds, and tie rules remain unchanged.
