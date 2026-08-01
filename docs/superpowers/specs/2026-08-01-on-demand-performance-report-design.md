# On-Demand Performance Report Design

**Date:** 2026-08-01  
**Status:** Approved for planning

## 1. Goal

Replace the misleading panel-wide date/CS controls with page-local controls, then turn Performance into an owner-only, on-demand evaluation report for normal calendar weeks, calendar months, or a bounded custom range. The report must remain consistent with WaFaChat's 16:00 WIB business-day cutoff and must not create standing Convex reads.

## 2. Root cause in the current UI

The panel layout renders `Hari ini`, `Kemarin`, `7 hari`, `30 hari`, `Bulan ini`, and the CS selector on pages that do not consume those values. Dashboard and Performance also default to local `live` mode; in that mode their query bounds are midnight-to-now and override the selected global range. Performance passes the selected CS only to part of its data sources, so the selector changes some cards but not every table.

The controls therefore look global while their effect is absent, partial, or page-dependent.

## 3. Locked product decisions

- Remove date and CS controls from the shared panel header.
- Navigation links stop carrying `range` and `cs` parameters between unrelated pages.
- Dashboard remains a lightweight operational glance for all CS. Its meaningful local `Kalender hari ini` / `Periode kerja 16:00` toggle may remain.
- Settings has no analytics controls.
- Laporan, Follow-up, and Queen Recap retain their own domain-specific controls.
- Performance owns its date and CS controls.
- Queen's four fixed bonus buckets remain unchanged and apply only to Queen.
- Performance weeks are normal Monday-through-Sunday weeks.
- Performance is one-shot/on-demand: no report query runs until the owner presses `Tampilkan laporan`.
- No chart, export, report snapshot table, cron, automatic generation, or new dependency in the first version.

## 4. Performance controls

The Performance page provides one compact local control card:

1. Period type: `Pekanan`, `Bulanan`, or `Rentang khusus`.
2. Period input:
   - Pekanan: select any date; the app resolves the containing Monday-Sunday week.
   - Bulanan: native month input.
   - Rentang khusus: native start and end date inputs, maximum 35 business dates inclusive.
3. CS: `Semua CS` or one named CS. The literal value `all` is never shown to the user.
4. Primary action: `Tampilkan laporan`.
5. Secondary action after a successful load: `Refresh`.

Changing an input only edits a draft selection. It does not query Convex. The currently displayed report remains visible until `Tampilkan laporan` is pressed again.

## 5. Time and grouping semantics

All selected dates are business-date labels. Business date D covers `[D-1 16:00 WIB, D 16:00 WIB)`. This keeps Performance totals comparable to Laporan and Queen.

- Weekly mode always covers a complete Monday-Sunday set of business-date labels.
- Monthly totals cover business dates 1 through the calendar month's last date.
- A monthly weekly breakdown is clipped at the month edges so its rows sum exactly to the monthly total. Edge rows are marked `Pekan parsial`.
- A month may therefore show four, five, or six weekly rows.
- Custom ranges use their selected inclusive business dates and may not exceed 35 days.
- A currently-running week/month is marked `Berjalan` and includes data available so far.
- Comparison for a running period uses the same elapsed duration in the immediately preceding equivalent period. Completed periods compare against the complete preceding period.

Example for August 2026 monthly breakdown:

- 1-2 August — partial
- 3-9 August
- 10-16 August
- 17-23 August
- 24-30 August
- 31 August — partial

## 6. Report contents

### Ringkasan

- Leads
- Closing
- Conversion rate
- Revenue
- COD count
- Transfer count
- COD/transfer percentages
- Delivered
- Cancelled
- Discount
- Current-versus-previous deltas for leads, closing, conversion rate, and revenue

### Per CS

- CS name
- Leads, closing, conversion rate, and revenue
- COD, transfer, and their percentages
- Median first-response time when the bounded sample budget permits it
- Conversion-rate delta versus the preceding equivalent period

When `Semua CS` is selected, every CS row is returned. Selecting one CS scopes the summary, product, response, and comparison sections consistently.

### Per Product

- Product name
- Leads, closing, and conversion rate
- Revenue
- COD, transfer, and their percentages
- Sort options: closing descending or conversion rate ascending

### Monthly weekly breakdown

Each row shows its date span, partial/complete/running status, leads, closing, conversion rate, revenue, COD, and transfer.

## 7. Metric semantics

The report aggregates the existing `dailyRollups` facts. A lead is distinct within one business day and then additive across the selected period. A customer active on two different business dates therefore represents two lead activities. This deliberately makes a weekly/monthly report equal the sum of its daily Laporan rows and avoids an expensive cross-month raw-order identity scan.

- Closing, revenue, discount, COD, transfer, delivered, and cancelled are additive rollup facts.
- Conversion rate is `closing / leads`, guarded at zero, using the same additive period facts.
- Payment percentages use known COD plus transfer as the denominator. When both are zero, both percentages are zero.
- Products use the canonical product name already stored in each rollup's `byProduct` entries.
- Internal/test-phone exclusions and cancellation rules remain those applied when the rollup is written.

## 8. Convex architecture and I/O budget

Add one owner-only query contract, conceptually:

```ts
getPerformanceReport({
  startDate: "YYYY-MM-DD",
  endDate: "YYYY-MM-DD",
  csName?: string,
  includeComparison: true,
})
```

The server validates both dates, order, 16:00 business-date conversion, and the 35-day maximum. Tenant identity comes from the authenticated owner, never from client arguments.

The core report reads only:

- `dailyRollups` through `by_org_windowKey` for the current range;
- `dailyRollups` through the same index for the equal comparison range;
- `responseSamples` through an organization/time index for optional response metrics.

All reads use explicit hard caps. With five CS, the core rollup read is approximately:

- weekly plus comparison: 70 small rollup documents;
- 31-day month plus comparison: approximately 310 documents;
- 35-day custom maximum plus comparison: approximately 350 documents.

Response samples are the only potentially larger source. The report may read at most 12,000 small sample documents, keeping the whole function below Convex's document-read ceiling after rollups and configuration reads. If the sample cap is exceeded, the core report still succeeds and returns a visible `Response time membutuhkan rentang lebih pendek` notice instead of failing every metric.

No orders, shipping recaps, conversations, or messages are scanned. No table is written. No background job runs.

## 9. Client data flow

The page stores draft controls separately from submitted controls. Until a valid submitted selection exists, the query hook receives `skip`. Submission freezes one argument object and performs one snapshot query. It does not use reactive `useQuery` and does not refetch unless the owner submits a new selection or presses Refresh.

Loading keeps the previous result visible. A request token prevents an older response from overwriting a newer submitted range.

## 10. UI states

- Initial: concise explanation and `Pilih periode lalu tampilkan laporan`.
- Loading: existing report stays visible with a loading indicator on the action.
- Empty: `Belum ada data pada periode ini` while preserving the selected period.
- Validation: inline message for an incomplete or greater-than-35-day range.
- Partial period: `Berjalan · data sampai <timestamp>`.
- Response sample cap: only the response column/section shows its bounded-range notice.
- Query failure: one retry action; no automatic retry loop.

The existing `Ringkasan`, `Per CS`, and `Per Produk` tabs are retained. Tables remain horizontally scrollable on narrow screens and use the existing cards, buttons, tabs, badges, inputs, and select components.

## 11. Authorization

Performance remains owner/admin-only. The Convex report query independently calls the existing admin organization guard. A CS account cannot request another CS's financial or performance data by passing a name.

## 12. Testing and acceptance

Automated checks cover:

- global controls absent from Dashboard, Performance, and Settings layout;
- changing a draft period causes no Convex request;
- submission sends exactly one request with frozen arguments;
- Monday-Sunday resolution across month/year boundaries;
- monthly partial-week breakdown sums to monthly totals;
- running-period comparison uses equal elapsed duration;
- 35-day boundary acceptance and 36-day rejection;
- all-CS and one-CS scoping across every section;
- COD/transfer percentages and zero denominator;
- current/previous aggregation from rollup fixtures;
- response cap degrades only response metrics;
- admin authorization and tenant isolation;
- TypeScript, full tests, Convex codegen/deploy validation, and production build.

Acceptance is reached when the owner can generate weekly, monthly, and custom Performance reports; every displayed section reflects the same selected period/CS; no report reads run while the page is idle; and Settings no longer displays irrelevant analytics controls.

