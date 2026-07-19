# Task 5 — directional message-read bounds

## Red → green

- Added long-history regressions with 122 alternating messages. The first focused run failed because `messages.by_conversation_direction_createdAt` did not exist; it also showed the global lifecycle page processed only 25 active rows and starved handover.
- The follow-up regression verifies the latest inbound, post-window outbound touch range, candidate card (`H+2`), and `candidacyFor` stage after a long mixed history.
- The lifecycle regression verifies latest-inbound lookup and stale closure after a 122-message mixed history. A separate 25-active + 1-handover regression verifies independent status pages.
- Added CS registry isolation coverage: canonical-key and legacy fallback resolution stay within the requested organization.

## Query changes

- Added `messages.by_conversation_direction_createdAt` on `(conversationId, direction, createdAt)`.
- Replaced every conversation-time message read that filtered `direction` afterward: latest inbound, post-window outbound touch counts, close-time touch count, follow-up candidacy, and lifecycle stale lookup.
- Lifecycle now paginates the org-prefixed `by_org_status_updatedAt` index one status at a time, batch size 25. The sweep advances active and handover cursors independently each iteration, so neither status starves. Each conversation preserves the original decision order: recap/WON, done-marker, then stale.
- Removed global CS registry fallbacks in resolver paths. Canonical keys use `csConfigs.by_org_key`; legacy no-key matching uses org-scoped `by_org_active`. Ingestion registry reads are org-scoped as well.

## Verification

- `rtk npx vitest run convex/followUp.test.ts convex/conversationLifecycle.test.ts convex/messages.test.ts convex/orgIsolation.test.ts` — 45 passed.
- `rtk npx vitest run convex/agents.test.ts` — 7 passed.
- `rtk npx tsc --noEmit -p convex` — no errors.
- `rtk git diff --check` — clean.

## Risks / notes

- `resolveBatch` keeps its original `cursor` argument and defaults `status` to `active` for existing callers; the sweep explicitly invokes both statuses per iteration.
- Convex-test represents a full-page cursor as an ID-like value, so lifecycle normalizes the returned cursor with `String(...)`; production cursors are already strings.
- No PWA files changed.

## Commit

Pending at report creation.
