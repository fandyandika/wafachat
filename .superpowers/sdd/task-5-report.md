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

- At that revision, the legacy one-page mutation kept its original cursor argument and defaulted status to active; this contract was removed in the final P1 follow-up below.
- Convex-test represents a full-page cursor as an ID-like value, so lifecycle normalizes the returned cursor with `String(...)`; production cursors are already strings.
- No PWA files changed.

## Commit

`fadbb37` — `perf: index directional message reads`

## P1 follow-up — tenant-scoped Berdu fallback

- Red regression: two organizations without active `berduStaffIds` both received tenant-1's baked `Aisyah` mapping. The test expected the default org to remain `Aisyah` and tenant two to resolve neutrally as `Staff B-1apQSy`.
- Green fix: `resolveBerduStaffMap` still reads `csConfigs.by_org_active`; only when that org-scoped map is empty does it resolve the default organization through indexed `organizations.by_slug`. `DEFAULT_BERDU_STAFF_MAP` is returned only when the event org is the actual default org; all other unconfigured orgs receive `{}`.
- Production internal flow remains direct: `processCapturedEvent` passes `event.orgId` into the resolver, with no global/unindexed growing-table scan.
- Verification: ingest core + Berdu adapter + agents + focused Task 5 suites — 72 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `9a335e6` — `fix: scope Berdu fallback to default org`.

## P2 rereview — production sweep and legacy no-key isolation

- Replaced the direct one-page starvation check with a production `cronArchiveSweep` regression containing 26 active rows and one handover row. It asserts the exact 27-row totals and verifies every stored row closes, covering the point where handover is terminal while active needs another iteration.
- The production-boundary regression exposed an index-cursor invalidation bug: closing the first 25 active rows removed them from the paginated status index and skipped row 26. The sweep now tracks terminal status streams independently and resets only a mutated stream's cursor, so terminal streams are not rerun and remaining indexed rows are not skipped.
- Added a true legacy fallback isolation regression with identical canonical names and absent `key` fields in two organizations. It asserts the requested organization resolves its own document ID, which fails under a plausible global-row fallback.
- Verification: ingest core + Berdu adapter + agents + focused Task 5 suites — 73 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `e35594c` — `fix: prevent lifecycle sweep cursor skips`.

## P1 rereview — immutable scan, bounded atomic apply

- Strict TDD red: a production sweep with retained active rows before and between stale candidates reported 33 considerations for 31 unique open rows. Resetting the mutated status cursor revisited the retained rows even though it reached and closed all 29 stale rows.
- Production sweeping now has two phases. Read-only `scanOpenBatch` pages the org/status index without changing indexed rows and collects unique IDs. Bounded `processConversationIds` mutations then re-read each conversation and evaluate recap/WON, done-marker, and stale rules in the same transaction as any close patch.
- Active and handover scans alternate fairly while both have work. The 800-page budget is total per organization across both statuses, with 25 rows per page and therefore at most 20,000 unique rows selected per run; a two-page regression proves exactly 25 rows from each status are processed.
- Coverage also verifies production dry-run behavior, fresh activity arriving between scan and apply, trailing stale rows beyond the first page, and retained rows remaining open.
- Verification: ingest core + Berdu adapter + agents + focused Task 5 suites — 77 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `6457c2e` — `fix: scan lifecycle rows before closing`.

## Final P1 — remove the unsafe mutation-cursor API

- Repository audit confirmed there were no production callers of the legacy one-page mutation. The export was removed because a continuation cursor cannot safely be chained after the same mutation removes rows from the indexed active/handover status range.
- All classification tests now use the explicit replacement contract: read every org/status page through `scanOpenBatch`, then pass bounded 25-ID chunks to `processConversationIds`. Production continues to cover both active and handover through the alternating two-phase sweep.
- Removed the misleading default-active wrapper behavior and updated the historical efficiency note to name the lifecycle sweep rather than the removed API.
- Verification: `rtk rg` audit — zero repository references; ingest core + Berdu adapter + agents + focused Task 5 suites — 76 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `133f9d1` — `refactor: remove unsafe lifecycle batch cursor`.

## Final P1 hardening — bounded apply and immutable scan order

- Strict TDD red showed the apply mutation accepted and processed 26 IDs, silently tolerated a duplicate ID, and lost one of 30 scanned rows when an unscanned conversation's `updatedAt` moved behind the first-page cursor.
- `processConversationIds` now rejects more than 25 IDs and rejects duplicate IDs before reading or patching any conversation. Coverage includes both rejection cases and a normal 25-ID batch that closes successfully.
- Added `conversations.by_org_status` on `(orgId, status)`. `scanOpenBatch` now uses this index, whose remaining order is Convex's immutable creation-time order, so message-ingestion updates cannot move open rows across page cursors. The regression backdates row 30 between pages and still observes all 30 original IDs exactly once.
- Index audit found no name conflict: the new name appears only in its conversations-schema declaration and lifecycle scanner. `rtk npx convex codegen` completed schema bundling, binding generation, and its TypeScript check without generated-file changes.
- Verification: ingest core + Berdu adapter + agents + focused Task 5 suites — 80 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `afceb3d` — `fix: harden lifecycle scan and apply batches`.

## Agent active-only P1 and lifecycle transition SLA

- Strict TDD red proved that phone, Berdu staff, exact name, alias, and legacy no-key paths ignored an inactive row, but the canonical key-shaped name path still returned it. The exact org/key query now applies the same explicit `isActive === true` policy as every other resolver path; its already-bounded org/key range does not warrant another compound index.
- Regression coverage includes inactive provider/staff/name/alias/key/legacy forms and confirms an active org-local canonical row still resolves by its key-shaped name.
- Lifecycle status scans remain deliberately bounded and eventual-consistent across query transactions. A handover→active transition can move behind the active cursor after the handover range has already been observed; no row is deleted or lost, and the next scheduled production sweep processes it.
- The SLA regression simulates that transition, proves the row is absent from the first cycle's collected IDs and remains open, then proves the next real cron sweep considers the one remaining row and closes it. A separate durable transition queue or sweep snapshot could provide same-run capture, but is a future architectural enhancement outside this I/O-remediation scope; a status-independent historical scan would double growing-table reads.
- Verification: ingest core + Berdu adapter + agents + focused Task 5 suites — 82 passed; `rtk npx tsc --noEmit -p convex` — no errors; `rtk git diff --check` — clean.
- Commit: `b62f215` — `fix: keep agent resolution active-only`.
