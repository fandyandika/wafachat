# Performance P2A Operational Ledger Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning

## 1. Objective

Improve the existing Performance page so an owner can scan, compare, and evaluate CS and product performance quickly on desktop and mobile. The change is a presentation refinement over the on-demand report that is already live; it must preserve its calculations, request behavior, authorization, and Convex I/O profile.

This is the first page-specific phase of P2. Laporan, Follow-up, Settings, and the final cross-page consistency pass remain separate later phases.

## 2. Production baseline observed

The live P1 page was checked with real production data on 2026-08-08:

- weekly on-demand generation completed without a client console error;
- the summary, Per CS, and Per Product results were populated from one submitted period;
- comparison deltas used the correct count, percentage-point, and Rupiah formatting;
- the current desktop table communicates the data accurately;
- the mobile page does not overflow at root level, but the 820-pixel tables require bounded horizontal scrolling and are unnecessarily difficult to scan.

The redesign therefore addresses information hierarchy and responsive presentation, not a data defect.

## 3. Locked product decisions

- Keep `Pekanan`, `Bulanan`, and `Rentang khusus`.
- Keep the existing CS selector, `Tampilkan laporan`, and manual refresh behavior.
- Continue separating draft filters from the submitted report. Changing a field must not query Convex.
- Keep the existing `Ringkasan`, `Per CS`, and `Per Produk` result views.
- Keep the current period semantics, 16:00 WIB business-day cutoff, comparison period, sorting, metric formulas, and authorization.
- Keep desktop tables for dense comparison.
- Replace mobile dependence on horizontally scrolled tables with compact ledger rows.
- Reuse the existing UI primitives and visual language. Do not introduce a new design system or dependency.
- Queen Recap remains a separate destination and is not redesigned in P2A.

## 4. Non-goals

P2A does not add:

- Convex queries, mutations, indexes, schema fields, rollups, or background jobs;
- client polling, automatic refresh, prefetching, or live subscriptions;
- charts, graphs, exports, saved report snapshots, goals, scores, rankings, or new metrics;
- changes to metric definitions or comparison calculations;
- changes to Dashboard, Laporan, Follow-up, Settings, navigation, or global shell styling;
- speculative component abstractions that are not needed by this page.

## 5. Page information architecture

The page remains one linear workflow:

1. page context and the Queen Recap shortcut;
2. report controls;
3. submitted-period status;
4. result navigation;
5. the selected result.

### 5.1 Page context

Retain the short explanation that the report loads only when requested. Present it as supporting text rather than a competing banner. Keep the Queen Recap shortcut visible to owners but visually secondary to report generation.

### 5.2 Report controls

The controls remain inside one compact surface:

- period tabs first;
- period input as the primary field;
- CS selector as the secondary field;
- `Tampilkan laporan` as the only primary action;
- refresh as a quiet icon action available only after a successful report.

On desktop, fields align to a consistent grid and baseline. On mobile, each field uses the available width and the primary action is full width. Labels remain upright and directly above their controls; `CS` must not appear rotated, italicized, detached, or visually misaligned.

### 5.3 Submitted-period status

After generation, show a restrained status band containing:

- human-readable date range;
- selected CS scope;
- `Berjalan` or `Selesai` status;
- data cutoff or generated timestamp when available.

This band identifies the data currently on screen. Editing draft filters must not change it until the owner submits again.

### 5.4 Result navigation

Keep `Ringkasan`, `Per CS`, and `Per Produk` as compact tabs directly above the result. The active state must be obvious without oversized fills or decorative motion.

## 6. Ringkasan presentation

Retain every current summary metric. Use a responsive metric grid with a calm hierarchy:

- primary: leads, closing, conversion rate, and revenue;
- secondary: discount, COD, transfer, payment ratio, delivered, and cancelled.

Comparison deltas remain attached to their corresponding primary value but use readable labels, including units:

- counts: `+190`;
- conversion rate: `+2,7 poin`;
- revenue: `+Rp33.703.258`.

The delta component must never expose an unformatted raw integer such as `33703258`. Its accessible label states that the value is a comparison with the preceding equivalent period. Neutral or unavailable deltas are visually quiet.

## 7. Per CS presentation

### 7.1 Desktop

Keep a comparison table. Its scan order is:

1. CS identity;
2. leads;
3. closing;
4. conversion rate and comparison delta;
5. median first-response time;
6. revenue;
7. COD and transfer split.

CS identity stays anchored on the left. Numeric columns align consistently and do not compete through colored pills. Color is reserved for meaningful positive, negative, warning, or unavailable states.

### 7.2 Mobile

Render the same result set as ledger rows rather than a compressed desktop table. Each row contains:

- header: CS name and optional rank/order cue already supplied by the result;
- primary line: closing, conversion rate, and conversion-rate delta;
- secondary line: leads and median first-response time;
- tertiary line: revenue and COD/transfer split.

The row must be readable without horizontal scrolling. It must not hide any currently available metric or create a second data request. Sorting and values remain identical to desktop.

## 8. Per Product presentation

### 8.1 Desktop

Keep the existing table and sort controls. Its scan order is:

1. product identity;
2. closing;
3. conversion rate;
4. revenue;
5. leads;
6. COD and transfer split.

Long product names wrap to a sensible maximum of two lines before truncation, with the complete name available through the accessible title or equivalent text treatment.

### 8.2 Mobile

Render one ledger row per product:

- header: product name;
- primary line: closing, conversion rate, and revenue;
- secondary line: leads and COD/transfer split.

The active sort remains visible above the ledger. Changing sort rearranges the existing result locally and must not submit a new Convex request.

## 9. Responsive and accessibility behavior

- Desktop breakpoint may retain tables; narrow layouts use ledger rows from the same in-memory result.
- No root-level horizontal overflow is permitted.
- Interactive targets remain at least 44 pixels high on touch layouts.
- Focus states must remain visible for tabs, inputs, selects, buttons, sort controls, and refresh.
- Table headers retain proper semantics on desktop; mobile ledger groups use meaningful text labels rather than relying on visual position alone.
- Status and delta meaning cannot depend on color alone.
- Text contrast, truncation, and wrapping must remain usable with Indonesian names, long product titles, and formatted Rupiah values.

## 10. Loading, empty, and error states

- **Initial:** keep the concise prompt to choose a period and display the report.
- **Loading first report:** show a bounded skeleton or progress state inside the result region; controls stay understandable.
- **Refreshing or resubmitting:** keep the previous successful result visible while the primary action communicates loading.
- **Empty:** state that no data exists for the submitted period and CS; keep the submitted-period band and controls available.
- **Error:** show a compact explanation and one explicit retry action. Do not create an automatic retry loop.
- **Partial response metric:** preserve the existing localized unavailable/capped response-time treatment without failing other results.

Every state must occupy a stable result area so the page does not jump or collapse unexpectedly.

## 11. Data and Convex boundary

All redesigned views consume the result already returned by the current on-demand Performance request. Desktop and mobile variants are presentation choices over the same client-side data.

The implementation must preserve these invariants:

- no request before `Tampilkan laporan`;
- one submitted report request per explicit generation or refresh action;
- draft filter edits do not trigger reads;
- tab changes and product sorting do not trigger reads;
- no timer, focus-refetch loop, or standing subscription is introduced;
- all sections continue to represent the same submitted period and CS scope.

Consequently, P2A should not increase steady-state Convex I/O. Its expected database cost is identical to the current P1 Performance behavior for the same user actions.

## 12. Implementation boundaries

Prefer editing the existing Performance page and its focused presentation helpers. Add only small, page-local components when they remove real duplication between desktop tables and mobile ledger rows. Existing formatting helpers and shared controls must be reused where suitable.

Do not rename backend contracts or reorganize unrelated files. Any code change outside the Performance surface requires a direct justification in the implementation plan.

## 13. Verification and acceptance criteria

Automated verification must cover:

- existing on-demand request behavior remains unchanged;
- submitting, refreshing, and switching result tabs retain existing functionality;
- revenue deltas render as formatted Rupiah, conversion deltas as points, and count deltas as locale numbers;
- Per CS desktop table and mobile ledger expose the same values;
- Per Product desktop table and mobile ledger expose the same values and sort order;
- initial, loading, empty, error, and successful states remain reachable and readable;
- responsive output has no root-level horizontal overflow;
- TypeScript, the full test suite, and the production build pass.

Browser verification uses real production-shaped data at desktop and mobile widths. Acceptance is reached when an owner can identify the strongest or weakest CS/product without deciphering cramped columns, while the generated totals and Convex request count remain unchanged from P1.
