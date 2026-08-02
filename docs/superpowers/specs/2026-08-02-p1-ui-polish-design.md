# P1 UI Polish Design

## Scope

Polish three existing owner-facing UI elements without changing Convex queries, report calculations, or product behavior.

## Dashboard: duplicate orders

- Keep the existing right-side sheet and existing data source.
- Widen it on desktop while preserving full-width behavior on small screens.
- Give each customer a distinct section with name, phone, and duplicate count in one readable header.
- Present each order as a structured row: order ID and time first, product and formatted total below.
- Preserve the instruction to verify the order in Berdu before cancellation.

## Performance: report controls

- Keep the existing period tabs, date inputs, CS selector, submit button, and on-demand loading behavior.
- Align the period input, CS selector, and action on a consistent responsive grid.
- Use the same label styling and control height for every field.
- Stack controls at narrow widths; keep them aligned to the baseline on desktop.

## Performance: metric deltas

- Keep one shared delta component.
- Format deltas according to their metric: locale number for counts, percentage for conversion rate, and Rupiah for revenue.
- Keep the compact positive/negative visual treatment and add an accessible comparison description.

## Verification

- Add focused rendering assertions for currency and percentage deltas.
- Retain existing page behavior tests and run the relevant suites, TypeScript check, and production build.
- Confirm responsive presentation in the browser at desktop and mobile widths.

## Non-goals

- No new backend reads or writes.
- No new dependency or design-system abstraction.
- No redesign of other pages in this patch.
