# Wafachat UI/UX Targeted Evolution

Date: 2026-08-02  
Status: Approved design direction, awaiting written-spec review

## Objective

Make every Wafachat surface feel coherent, professional, fast to scan, and safe to operate without changing business rules or increasing Convex usage unnecessarily.

## Product context

Wafachat is an operational application for an owner and customer-service team in Indonesia. The interface supports daily monitoring, staff evaluation, reporting, follow-up work, Queen recap, and administration. Familiarity, speed, data accuracy, and clear recovery paths matter more than novelty.

## Design direction

The chosen direction is **targeted evolution** with an **Operational Calm** visual language.

- Preserve the Wafachat logo, Plus Jakarta Sans, routes, navigation model, data flow, and proven workflows.
- Keep the existing violet brand accent, but reserve it for primary actions, active navigation, selected controls, and focus.
- Use cool neutral surfaces with stronger hierarchy and readable contrast.
- Remove ambient decoration, redundant headings, empty containers, repeated labels, and card shells that do not communicate grouping or elevation.
- Prefer familiar product patterns over experimental layouts.

Design dials:

- Design variance: 4/10
- Motion intensity: 2/10
- Visual density: 6/10

## Shared design system

### Typography

- Keep Plus Jakarta Sans as the single UI family.
- Use a compact, fixed type scale suitable for an operational product.
- Use tabular numbers for metrics, currency, percentages, and time.
- Use sentence case consistently in Indonesian UI copy.

### Color

- Violet remains the only brand accent.
- Neutral surfaces define hierarchy; semantic colors are limited to success, warning, destructive, information, and Queen achievement.
- Color is never the sole status indicator.
- Text, borders, controls, and focus rings must meet WCAG AA contrast.

### Shape and spacing

- Cards use a 12px radius only when they express a real content group.
- Buttons and inputs use a smaller consistent radius within the same system.
- Related elements are grouped tightly; separate tasks receive stronger vertical spacing.
- Content width follows task needs instead of one width for every route.

### Interaction

- Standard transitions last 150-200ms and communicate hover, focus, selection, or state change.
- No decorative page-load animation.
- Every interactive element provides default, hover, focus, active, disabled, and loading states where applicable.
- Minimum mobile touch target is 44px.

### Feedback

- Loading uses skeletons shaped like the final content.
- Errors use `role="alert"`, explain the failure plainly, and provide a recovery action when possible.
- Empty states explain what is missing and what the user can do next.
- Successful mutations receive visible confirmation.
- Destructive operations use the existing accessible alert-dialog system instead of browser `confirm`.
- Rename, reset, and other input actions use labelled in-app forms instead of browser `prompt`.

## Application shell

- Keep the desktop sidebar, collapsible tablet behavior, and solid mobile bottom navigation.
- Remove the repeated wordmark and duplicate route heading from page bodies.
- Keep one authoritative route title in the shell, with an optional short description and contextual actions supplied by the page.
- Use a wider working canvas for dashboards and reports, a focused width for settings forms, and maximum practical width for Follow-up.
- Add a skip-to-content link and preserve logical keyboard order.
- Keep role-based navigation and access behavior unchanged.

## Page decisions

### Dashboard

Purpose: answer what is happening now and what needs attention.

- Keep the meaningful live-day and 16:00 work-period modes with clearer labels.
- Prioritize leads, closing, conversion rate, revenue, payment mix, cancellation, and response time.
- Show duplicate-order attention only when relevant.
- Keep Top CS and Top Product as compact ranked summaries.
- Remove the disabled trend presentation and its unused visual space until a bounded, reliable trend source exists.
- Consolidate refresh and last-updated information into one toolbar.

### Performance

Purpose: evaluate CS and product performance for a requested period.

- Keep reports on-demand to protect Convex usage.
- Present weekly, monthly, and custom periods in one compact filter bar.
- Keep CS selection local to the report.
- Show the active period and filter summary above results.
- Preserve Ringkasan, Per CS, and Per Produk views with clearer metric hierarchy and responsive tables/cards.
- Avoid re-querying when switching presentation tabs.

### Laporan

Purpose: review and share the daily operational report.

- Keep the 16:00 business cutoff and existing data rules.
- Place period and CS controls together with share/export actions.
- Reduce decorative containers and repeated explanatory copy.
- Preserve the CS Queen experience, but simplify long gamification messages and emphasize current status and actionable context.
- Keep desktop capture behavior for shared report images.

### Queen Recap

Purpose: review monthly daily winners and four bonus weeks.

- Keep the month-first, on-demand model.
- Prioritize monthly leader, weekly winners, Queen counts, and daily history.
- Keep the four-week bonus grouping separate from normal Monday-Sunday Performance evaluation.
- Use no additional charts.
- Show ongoing and completed states plainly.

### Follow-up

Purpose: process the next customer action efficiently.

- Keep existing queues, stages, archive, restore, and send behavior.
- Strengthen priority, due state, customer identity, and next action hierarchy.
- Consolidate queue filters and search into a stable toolbar.
- Use a split workspace on desktop and focused stacked/detail views on mobile.
- Keep current snapshot and bounded-query behavior; no new subscriptions.
- Standardize send, archive, restore, move-stage, loading, and failure feedback.

### Settings

Purpose: manage the account, organization, team, and CS configuration safely.

- Keep one route and split content into four in-page sections: Account, Organization, Team, and CS Configuration.
- Use tabs or progressive disclosure so only one administrative task dominates the viewport.
- Replace placeholder-only fields with visible labels and helper text where needed.
- Replace browser dialogs with accessible in-app dialogs.
- Show unsaved changes only where editing is staged; preserve immediate-save behavior for independent switches.
- Group each CS identity, provider mapping, aliases, automation toggles, and lifecycle controls coherently.
- Separate destructive actions visually from routine editing.

### Login, offline, and PWA states

- Align logo scale, typography, controls, feedback, and surface treatment with the authenticated shell.
- Provide clear retry or return actions for offline and authentication failures.
- Keep the current PWA behavior and do not add push notifications.

## Data and backend boundaries

- No new realtime query is introduced for visual polish.
- Dashboard retains only its necessary live reads.
- Performance and Queen remain explicitly on-demand.
- Existing snapshot behavior and query bounds remain intact.
- Webhook ingestion, notification flows, cutoff logic, Queen scoring, report calculations, authorization, and tenant isolation are unchanged.
- A backend change is allowed only if a verified UI defect cannot be fixed safely at the presentation layer; it requires separate justification and tests.

## Component strategy

- Reuse and refine the existing shadcn/Base UI components and Lucide icon family.
- Improve shared Button, Card, Badge, form control, metric, empty-state, and feedback patterns at their common source when all callers benefit.
- Add a shared page-header or toolbar primitive only if it replaces repeated implementations on at least three routes.
- Avoid new dependencies unless an existing component cannot meet accessibility or behavior requirements.

## Responsive behavior

- Verify at 375px, 768px, 1024px, and 1440px.
- Mobile layouts use one primary column, solid bottom navigation, 44px controls, and no horizontal page scrolling.
- Tables collapse into readable row groups or horizontal containers only where comparison requires columns.
- Sticky controls must not cover content or conflict with the PWA safe area.

## Accessibility

- Sequential headings with one page-level heading.
- Visible labels for all inputs.
- Keyboard-operable navigation, tabs, dialogs, filters, and actions.
- Visible focus rings and logical tab order.
- Meaningful icon labels and decorative icons hidden from assistive technology.
- Status and errors announced through semantic live regions.
- Reduced-motion preferences respected.

## Verification

Implementation is complete only after:

1. Functional review of every route with owner and CS role behavior preserved.
2. Desktop, tablet, and mobile visual checks in one bounded pass, followed by at most one correction pass.
3. Loading, empty, error, success, disabled, long-content, and permission-limited states checked where applicable.
4. Keyboard navigation and focus order checked on primary flows.
5. Impeccable detector run once over changed UI targets.
6. Existing tests plus targeted UI tests pass.
7. TypeScript, Convex codegen, and production build pass.
8. Production smoke test shows no client or console errors after deployment.

## Non-goals

- Rebranding Wafachat.
- Changing routes or business terminology solely for style.
- Adding charts without an operational decision they support.
- Adding push notifications.
- Changing database models, webhook behavior, Queen rules, or report formulas.
- Introducing dark mode during this pass.
- Adding speculative SaaS functionality.
