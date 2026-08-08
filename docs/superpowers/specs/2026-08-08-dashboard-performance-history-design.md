# Dashboard History and Performance Period Design

## Job and audience

WafaChat owners need two related views without mixing their purposes:

- **Dashboard** answers “what is happening now?” and provides a quick historical lookup for one selected day.
- **Performance** answers “how did the business perform, and why?” across a day, week, month, or bounded custom range.

The feature is owner/admin-only wherever the existing Performance authorization already applies. CS access and existing tenant isolation remain unchanged.

## Outcome and product truth

An owner can choose a past date on Dashboard and see the same core business snapshot that is available for today. From that snapshot, the owner can open Performance with the same date and daily basis preselected for deeper CS and product analysis.

WafaChat has two valid definitions of a day:

- **Calendar day:** 00:00–23:59 WIB.
- **CS work period:** 16:00 WIB on the selected date through 15:59 WIB the following date.

The interface must always name the active basis and actual time boundary. It must never label a 16:00 work period as an ordinary calendar day.

## Selected direction

### Dashboard: current operations with a one-day history mode

Add a compact Meta-style date control to the Dashboard context bar:

- Default selection is today.
- The user can select one past date, but not a future date.
- A basis selector offers **Hari kalender** and **Periode kerja CS 16:00**.
- In work-basis mode the selected date names the date the 16:00 window opens. Before 16:00 WIB, the current work period therefore shows the previous calendar date and an explicit cross-date boundary.
- Editing the picker does not query. The selection is applied explicitly.
- Today remains the ordinary operational state.
- Any past date shows a visible `Mode histori` status with the selected date and exact boundary.
- Historical mode hides **Perlu perhatian / Order ganda** because that block represents current action, not historical KPI evaluation.
- Historical mode keeps Leads, Closing, Closing Rate, Omzet, Dibatalkan, Respons CS, Top CS, and Top Produk.
- A `Lihat analisis lengkap` action opens Performance with `period=day`, the selected date, and the selected basis.

The Dashboard must not gain week, month, or arbitrary-range controls. Those belong to Performance.

### Performance: one period control with presets

Replace the four always-visible period tabs with one compact **Periode** control. It exposes:

- Hari ini
- Kemarin
- Pilih tanggal
- Pekan ini
- Pekan lalu
- Pilih pekan
- Bulan ini
- Bulan lalu
- Pilih bulan
- Rentang khusus

Only `Rentang khusus` reveals start and end fields. Its maximum remains 35 inclusive days.

Daily presets and `Pilih tanggal` expose a **Basis data** choice:

- Hari kalender
- Periode kerja CS 16:00

`Hari ini` in work-basis mode means the currently open work window, even before 16:00 WIB; its resolved opening date may therefore be yesterday. `Kemarin` means the work window immediately before it. `Pilih tanggal` always names the opening date directly.

Week, month, and custom reports continue to use the established 16:00 CS-report boundary. This preserves the meaning of existing reports and keeps their rollup-backed query path.

Opening Performance directly defaults to **Pekan ini** on the 16:00 CS-report boundary, matching the existing report semantics rather than silently rewriting older numbers. Opening it from Dashboard inherits the Dashboard date and basis through validated URL parameters.

Choosing a preset, date, month, week, CS, or basis only changes draft filters. Data is fetched after `Tampilkan laporan`, or once after explicit refresh with the same submitted arguments.

### Performance result hierarchy

- The status band names the actual date range, daily basis, CS scope, data-through time, running/completed state, and generated time.
- Summary uses the WafaChat ruled metric matrix rather than separate floating cards.
- Primary metrics: Leads, Closing, Conversion Rate, and Omzet.
- Supporting metrics: Diskon, COD, Transfer, payment ratio, Terkirim, and Dibatalkan.
- Daily results also make the dashboard-equivalent response metric available without duplicating Top CS and Top Product blocks.
- `Per CS` and `Per produk` remain the detailed drill-downs.
- Product rows show raw COD count, raw Transfer count, and their percentages on desktop and mobile.

## Data flow and efficiency

### Calendar-day snapshots

Calendar-day Dashboard and daily Performance use one exact WIB midnight-to-midnight range. The query is a snapshot, is bounded to one day, and uses the existing exact indexed readers used by Dashboard because a calendar day does not align with the 16:00 rollup window.

### Work-period and longer reports

Daily work-period, weekly, monthly, and custom Performance reports use existing daily rollups and organization/window indexes. Custom ranges remain capped at 35 days. Sorting and tab changes stay client-side.

### Query rules

- No polling for historical Dashboard or Performance.
- Draft date navigation never queries.
- Apply performs one bounded request per required snapshot source.
- Refresh repeats the submitted request once.
- The existing small CS-list subscription remains acceptable.
- No new recurring cron, duplicate rollup family, or raw full-history scan is introduced.

## States and edge cases

- First load uses skeletons shaped like the eventual ruled metric matrix.
- Empty results identify the selected date, basis, and CS scope.
- Errors remain local to the failing result region and expose retry.
- A refresh retains the previous successful result until replacement data arrives.
- Invalid/future dates and custom ranges over 35 days are rejected before querying.
- A deep link with invalid period/date/basis parameters falls back to safe defaults without querying unexpected ranges.
- Ongoing calendar-day and work-period reports are labeled `Berjalan`; closed historical periods are `Selesai`.

## Responsive and accessibility contract

- Controls have visible labels, keyboard focus, and at least 44×44 px targets on touch layouts.
- The date/range popover is keyboard-operable and does not require hover.
- Desktop breakdown tables and mobile ledger rows expose the same values and sort order.
- Numeric values use tabular figures.
- No root horizontal overflow at supported mobile widths.
- Loading and errors use appropriate live-region semantics without repeatedly announcing retained data.

## P2A.1 corrections included

- Restore raw product COD and Transfer counts alongside percentages.
- Replace floating KPI cards with the ruled metric matrix defined by `DESIGN.md`.
- Replace the text-only first-load placeholder with composition-matching skeletons.
- Align status stamps, label tracking, and numeric formatting with the design system.
- Remove duplicated formatting helpers where a shared formatter already exists or is warranted.
- Add automated coverage for period resolution, deep-link validation, daily basis behavior, product payment parity, and responsive rendering contracts.

## Scope boundaries and non-goals

- Queen Recap remains fixed to its existing 16:00 cutoff and bonus rules.
- Webhooks, Berdu ingestion, KirimDev ingestion, n8n notification flows, authentication, and Convex schema are not redesigned.
- Historical duplicate-order investigation is not added.
- Calendar-basis week/month/custom reports are not added; the one-day calendar snapshot covers the approved need without introducing costly long raw scans.
- No automatic refresh, chart package, new recurring job, or speculative SaaS setting is introduced.

## Success criteria

1. A selected Dashboard date returns the correct one-day snapshot for its named basis.
2. Historical Dashboard never presents current-action duplicate alerts.
3. Dashboard-to-Performance navigation preserves date and basis.
4. Performance daily calendar and work-period reports use exact, non-overlapping boundaries.
5. Existing weekly/monthly/custom 16:00 reports retain their totals and behavior.
6. Performance requests remain on-demand and bounded.
7. Desktop and mobile show payment counts and ratios without overflow.
8. TypeScript, Convex code generation, production build, unit tests, and authenticated browser smoke checks pass before release.
