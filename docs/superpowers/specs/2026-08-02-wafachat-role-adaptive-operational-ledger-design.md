# Wafachat Role-Adaptive Operational Ledger Redesign

Date: 2026-08-02

Status: Approved design direction, awaiting written-spec review

## Decision

Replace the current generic SaaS presentation with a role-adaptive operational product using the **Operational Ledger** visual world. Preserve the working product, business rules, data contracts, and Wafachat brand assets while changing the information hierarchy, composition, and interaction language substantially.

This specification supersedes the visual-direction and page-composition decisions in `2026-08-02-wafachat-ui-ux-targeted-evolution-design.md`. It does not reverse the functional, accessibility, data-efficiency, or safety improvements already shipped from that work.

## Objective

Make Wafachat answer two different operational questions immediately:

- **Owner/manager:** What is happening, what needs attention, and where should I act?
- **Customer service:** What should I work on next, and how am I progressing?

The redesign must feel materially different from the current interface rather than like a color or spacing refresh.

## Product truth

- Wafachat is a web/PWA operations product for an Indonesian owner and customer-service team.
- Owner/manager and CS are equal primary user groups.
- Pustaka Islam is a client organization, not the product identity.
- The Wafachat assets `logo-apps-1.png` and `logo-apps-2.png` remain the brand source.
- The product is SaaS-ready through its existing organization, role, permission, and tenant foundations. Billing, commercial onboarding, and tenant switching are not part of this redesign.
- Indonesian operational language must be concise, professional, and understandable without technical knowledge.

## Experience architecture

### Shared shell

Owner and CS use one coherent application shell. Navigation, route authorization, organization context, and account behavior remain shared. The home content changes according to the authenticated role and existing permissions.

CS currently redirects away from `/panel`; Phase 1 intentionally changes that single route permission so a CS can reach the new CS Home. Performance, Queen, and Settings remain admin-only, and every Dashboard read for a CS must be scoped server-side to the CS identity assigned to that account.

The shell contains:

- a clear Wafachat identity;
- one authoritative route title;
- organization and role context;
- only the period or actions that are meaningful on the current route;
- concise update status;
- desktop sidebar and solid, safe-area-aware mobile navigation.

Repeated route titles, decorative headers, inactive filters, and controls that do not alter the displayed data are removed.

### Owner home

The owner home is a decision surface, ordered as follows:

1. **Context bar** — organization, last update, and an explicit time definition such as calendar day or the 16:00 CS operating window.
2. **Needs attention** — at most three high-value exceptions, each with impact, responsible context, and a direct next action. Initial exceptions are derived from already-loaded data and may include duplicate orders, worsening response time, and falling closing rate.
3. **Business matrix** — the existing leads, closing, conversion rate, revenue, cancellation, response-time, and relevant payment metrics, composed as a coherent metric field instead of equal generic cards.
4. **Performance context** — compact Top CS and Top Product diagnostics that support the primary decisions without competing with them.

### CS home

The CS home is a next-work surface, ordered as follows:

1. shift and operating-period status;
2. **Next work**, the largest and most actionable element;
3. H+1/H+2/H+3 queue counts and a direct Follow-up action;
4. personal leads, closing, conversion rate, and response time;
5. Queen or ranking context as secondary motivation rather than the primary task.

Only data and actions permitted for that CS are rendered.

## Time and filter behavior

- The operational Dashboard is a current snapshot, not a general reporting screen.
- Meaningless global period presets are removed from routes where they do not change the query.
- Weekly, monthly, and custom-range analysis stays in Performance and remains explicitly on-demand.
- Normal weekly Performance uses Monday through Sunday. Queen keeps its separate four-period monthly bonus rules.
- CS filters appear only where the data source supports per-CS analysis.
- Existing 16:00 business cutoff semantics remain unchanged and are stated in plain language where relevant.
- Refresh uses the existing mechanism. The redesign adds no polling interval, realtime subscription, or presentation-only query.
- CS queue counts may use one manual-refreshable call to the existing bounded follow-up-candidates query; it must not load the follow-up effectiveness query or start a subscription.

## Interaction and state behavior

### Decisions and deep links

Needs-attention items are derived from the data already loaded for the page whenever possible. Each item links to an existing route or filtered view that can resolve the issue. A decorative alert with no action is not allowed.

### Loading and refreshing

- First load uses skeletons shaped like the final composition.
- Refresh preserves the last valid result while the update is in progress.
- Controls communicate loading and cannot be triggered repeatedly while the same operation is pending.

### Errors

- User-facing errors explain what information or action is affected and offer retry or recovery when possible.
- Convex request IDs and technical detail are available in a secondary disclosure, not used as the primary message.
- A partial failure must not erase unrelated valid data.

### Empty states

Empty states distinguish between no activity, no matching filter result, missing setup, and failed loading. They provide a next step only when one exists.

## Visual world: Operational Ledger

Operational Ledger is inspired by a modern shift ledger and operational daybook, not a retro imitation. It should feel calm, exact, and businesslike.

### Visual signature

- warm paper-white working surfaces;
- blue-black ink for structure and primary text;
- Wafachat violet as a restrained carbon-copy accent;
- green, amber, and red used only for semantic state;
- ruled data bands, ledger dividers, period labels, and compact operational status marks;
- asymmetric composition that gives the primary decision area more weight than supporting information.

The recurring signature is a **ruled operational band plus a stamped status**, used consistently enough to make Wafachat recognizable without adding decoration.

### Typography and numbers

- Reuse the existing UI font; do not add a font dependency.
- Use a compact hierarchy with sentence-case Indonesian copy.
- Use tabular numerals for counts, money, percentages, dates, and times.
- Large numbers communicate priority through scale and placement, not separate card shells.

### Surfaces and grouping

- Cards are reserved for a true task or information group.
- KPI matrices use shared baselines, rules, and spacing rather than six equal floating cards.
- Borders and surface changes express hierarchy; shadows are minimal and never the main organizing device.
- Radius and spacing values come from a small shared token set.

### Color and branding

- Violet marks selected navigation, primary actions, focus, and limited brand moments.
- Semantic meaning never relies on color alone.
- Product surfaces show Wafachat branding only. Organization names appear as context, not replacement branding.

### Motion

- Motion is limited to navigation context, state changes, and action feedback.
- No decorative page-load sequences or continuously animated metrics.
- Reduced-motion preferences are respected.

## Page rollout

### Phase 1 — Foundation and Dashboard

- Establish the Operational Ledger tokens and shared shell.
- Implement role-adaptive owner and CS homes.
- Remove ineffective global period controls from the shell.
- Establish shared loading, error, empty, status, and action-register patterns only where Phase 1 needs them.

This phase is the proof of the new visual world. It must look materially different before the visual system is propagated.

### Phase 2 — Performance, Laporan, and Queen

- Apply the visual system to the existing on-demand Performance report.
- Preserve Monday-Sunday weekly evaluation and custom/monthly reporting.
- Align Laporan with the same period language and information hierarchy.
- Preserve Queen's separate monthly and four-bonus-period calculations.

### Phase 3 — Follow-up

- Reduce control-rail density.
- Prioritize customer identity, urgency, due state, and next action.
- Preserve queues, stages, archive, restore, send behavior, snapshots, bounds, and guardrails.

### Phase 4 — Settings and mobile/PWA completion

- Recompose settings around account, organization, team, and CS configuration tasks.
- Keep existing save semantics and destructive-operation safeguards.
- Complete route-specific mobile composition rather than merely stacking desktop sections.
- Keep mobile bottom navigation opaque, safe-area-aware, and clear of page content.

### Phase 5 — Verification and rollout

- Run visual, responsive, accessibility, role, and functional verification.
- Compare Convex usage before and after the redesign.
- Deploy only after the changed phase passes its gate.

## Data and backend boundaries

- No database schema, webhook, ingest, notification, deduplication, reconciliation, cutoff, Queen, report-formula, or tenant-isolation change is authorized by this redesign.
- The sole route-permission change is CS access to `/panel`. Server-side CS-name scoping is mandatory for every query used by that page; no broader access is granted.
- Reuse existing queries, snapshots, roles, permissions, components, and installed dependencies before adding code.
- Presentation-only needs must be derived from existing results when practical.
- Performance and Queen remain on-demand.
- Follow-up remains bounded and snapshot-based.
- No push notifications are added.
- A backend change requires a separately verified functional defect and explicit justification; visual convenience is insufficient.

## Responsive and accessibility requirements

- Verify at 375px, 768px, 1024px, and 1440px.
- Mobile prioritizes status, next work, and the primary action; secondary diagnostics follow.
- Minimum mobile touch target is 44px.
- There is no horizontal page scrolling except a deliberately bounded comparison table when unavoidable.
- Sticky navigation and controls must not cover content or conflict with PWA safe areas.
- Keyboard navigation, logical focus order, visible focus indicators, semantic headings, labelled controls, live error/status announcements, and WCAG AA contrast are required.
- Information cannot depend on color alone.

## Implementation constraints

- Prefer deletion and reuse over new abstractions.
- Add a shared primitive only when it replaces genuine repetition across the current phase.
- Use existing components, CSS capabilities, and installed dependencies.
- Do not build speculative design-system infrastructure for later phases.
- Each phase should touch the minimum files needed to prove and deliver that phase safely.

## Acceptance criteria

A phase is complete only when:

1. The changed surface visibly belongs to Operational Ledger and is materially different from the previous generic-card composition.
2. Owner and CS priorities are different where the approved experience requires them.
3. Every visible control has a clear label and verifiable effect.
4. Existing business logic, permissions, and data values remain correct.
5. No presentation-only polling or Convex query was added.
6. Loading, refresh, empty, partial-error, and full-error states are understandable.
7. Primary flows work with keyboard and meet contrast and touch-target requirements.
8. Desktop and mobile layouts pass visual inspection at the target widths.
9. Existing tests plus focused tests for changed behavior pass.
10. TypeScript, Convex codegen, and production build pass.
11. The Impeccable detector is run exactly once at the end of the UI implementation and actionable findings are resolved.
12. A production smoke test after deployment shows no client or console errors.
13. Convex I/O shows no material increase attributable to the redesign.

## Non-goals

- Billing, tenant switching, commercial onboarding, or other speculative SaaS features.
- Push notifications.
- New charts without an operational decision they support.
- Dark mode.
- New business metrics, scoring, or report formulas.
- Historical data repair or migration.
- Replacing Wafachat's approved brand assets.
- Redesigning n8n or provider workflows.
