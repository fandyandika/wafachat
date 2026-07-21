# Task 8 implementation report — release/deployment/measurement

Append local gate, broad review, project-target confirmation, deployment, migrations, parity, smoke checks, Vercel status, measurement, documentation, rollback notes, commits, and concerns below. Never include secrets.

## Final-review remediation wave — 2026-07-19

### Scope and starting point

- Assigned branch/path: `perf/convex-io-remediation` in `F:\Projects\whatsapp_cs_automotion\wafachat`.
- Review baseline: `271cff1bfd1efd1e156611ed1aa1ab04dd581ac1`.
- Starting worktree: clean.
- Baseline verification: `rtk npx vitest run` -> 41 files, 360 tests passed.
- Constraints honored: no `convex deploy`, Vercel deploy, push, merge, or PWA work. The required `convex codegen` command did contact the configured Convex deployment while generating bindings, as shown by its own CLI output; no explicit deploy command or production mutation/backfill command was run.

### Finding 1 — response-time tenant/auth/cache isolation

Design:

- Removed the module-global mutable `ConvexHttpClient` and fixed server-admin identity.
- Each request now creates and authenticates its own Convex client from the verified session.
- `responseTime.getResponseTimeAccess` re-resolves the user from Convex data, validates active status, subject and role, obtains the organization from `requireMemberOrg`, forces a CS to the database `csName`, and permits admin-selected scope.
- Cache identity includes verified organization, effective CS scope, and the bucketed half-open range.

TDD evidence:

- RED: the two-org route fixture returned the default organization for both requests; a CS-supplied `body.csName` reached the metric query; the access query did not exist.
- GREEN: focused response route/access suite passed after the request-local/auth/cache changes; final full suite includes 2 route tests and 5 response-time tests.

Files: `app/api/panel/response-times/route.ts`, `app/api/panel/response-times/route.test.ts`, `convex/responseTime.ts`, `convex/responseTime.test.ts`.

Commit: `5a64008 fix: isolate response-time access by tenant`.

### Findings 2 and 5 — exact analytics bounds and half-open windows

Design:

- Rejected additive approximate distinct math. Customer/order identity unions remain exact raw calculations for sealed and live windows.
- Added shared limits: 35-day public range, 900 rows per growing source, 100 exact fallback lookups, and 3,000 response samples.
- Every capped read uses `take(limit + 1)` and throws an explicit narrow-the-range error instead of silently truncating.
- Aligned dashboard, response-time, follow-up effectiveness, rollup-reader raw ranges, and adjacent windows to `[startAt,endAt)`.
- Replaced fallback history scans with indexed descending point reads where exact semantics allowed it.
- Documentation now states that v2 additive facts do not make distinct identity unions composable.

TDD evidence:

- RED: an exact endpoint record was counted in both neighboring windows; a 36-day request and 901-row source were accepted.
- GREEN: `rtk npx vitest run convex/metrics.test.ts convex/responseTime.test.ts convex/followUp.test.ts` -> 38/38 at the finding gate; analytics/rollup-reader/shipping focused gate -> 62/62; Convex TypeScript passed.

Files: `convex/analyticsBounds.ts`, `convex/analytics.ts`, `convex/metrics.ts`, `convex/rollupReaders.ts`, `convex/followUp.ts`, `convex/responseTime.ts`, related tests, and the three roadmap/architecture documents.

Commit: `80f34e3 fix: bound exact analytics reads`.

### Finding 3 — complete v2 parity verification

Design:

- `debugRollupParity` now validates the v2 completeness marker before comparing data.
- It compares every top-level v2 fact, including `cod` and `transfer`, and every product fact: `leads`, `closings`, `leadOrders`, `revenue`, `discount`, `cod`, and `transfer`.
- Raw discovery and recompute use the same half-open window boundary.
- Diagnostic output reports the actual fresh row count and marker version.

TDD evidence:

- RED: 10 independent corruption/marker/boundary cases passed incorrectly or lacked coverage.
- GREEN: `rtk npx vitest run convex/rollups.test.ts --reporter=verbose` -> 45/45.

Files: `convex/rollups.ts`, `convex/rollups.test.ts`.

Commit: `8de8e1d fix: verify every rollup v2 fact`.

### Finding 4 — starvation-free reconciliation

Design:

- Added optional durable `reconcileStates.probeCursor`.
- The full bounded unresolved set (maximum 500) is retained; the probe order rotates from the durable cursor, while the external action still attempts at most 50 counters.
- Commit advances the next probe position only after the attempted batch and preserves tail discovery.
- Final query audit also changed bootstrap from an unbounded daily `.collect()` to a 500-order cursor page; later invocations continue at `nextCounter`.

TDD evidence:

- RED: permanent early gaps starved counters after the first 50 and blocked later tail healing (2 failures).
- GREEN finding gate: reconciliation focused suites 13/13.
- Audit RED: a 501-row bootstrap jumped directly to gap 501 instead of stopping at the bounded cursor page.
- Audit GREEN: `rtk npx vitest run convex/ingest/reconcileState.test.ts convex/orgs.test.ts convex/agents.test.ts --reporter=verbose` -> 37/37.

Files: `convex/schema.ts`, `convex/ingest/reconcileState.ts`, `convex/ingest/reconciler.ts`, and both focused test files.

Commit: `14eaf7b fix: rotate durable reconciliation probes`; final cap hardening is included in the release-evidence commit.

### Finding 6 — bounded, resumable lifecycle work

Design:

- Reduced the production worker budget from 800 to 4 pages, at 25 selected conversations per page.
- Persisted lifecycle cursor/done state immediately after every successful page apply.
- Added `runOrgSweep({orgId})`, which schedules a continuation only when the durable cycle is incomplete.
- Reworked the cron into a bounded 20-organization page that schedules isolated per-org workers and a driver continuation.
- Per-organization scheduling failures are reported without preventing later tenants from being queued.

TDD evidence:

- RED: budget was 800, only one late checkpoint occurred, tenant-isolated scheduling helper was absent, and the continuation action was absent (4 failures).
- GREEN: `rtk npx vitest run convex/conversationLifecycle.test.ts --reporter=verbose` -> 24/24; `rtk npx tsc --noEmit -p convex` -> zero errors.

Files: `convex/conversationLifecycle.ts`, `convex/conversationLifecycle.test.ts`, `convex/orgs.ts`.

Commit: `41f9731 fix: bound lifecycle sweep actions`.

### Findings 7 and 8 — platform provider migration and registry caps

Design:

- Extracted the tenant-independent core into internal `seedKeysForOrg({orgId})`; public `seedKeys` still derives the caller organization through `requireAdminOrg`.
- Added a bounded 20-organization platform driver plus resumable per-org workers. Results distinguish completed, continuing, and failed organizations; `complete` is true only after enumeration finishes with no continuing/failed tenant.
- Replaced active-registry `.collect()` fallbacks in agents, Berdu ingestion, and follow-up candidacy with a shared 50-row proof cap.
- Oversized name/staff resolution throws before a write can silently stamp the wrong immutable key. Ingestion mapping returns no partial map; follow-up provider resolution returns no provider claim.
- A legacy cron helper outside the new drivers now has an explicit 100-organization fail-loud cap; new maintenance work uses cursor-paged organization drivers.

TDD evidence:

- RED: internal org migration, platform driver, and isolation helper were missing; oversized agent, ingest, and follow-up registries still produced claims (6 failures).
- GREEN: `rtk npx vitest run convex/agents.test.ts convex/ingest/core.test.ts convex/followUp.test.ts --reporter=verbose` -> 70/70; Convex TypeScript passed.
- Completion reporting was tightened and reverified: the first all-org call reports incomplete while workers continue; rerunning after scheduled workers reports complete for both organizations.

Files: `convex/agents.ts`, `convex/agents.test.ts`, `convex/ingest/core.ts`, `convex/ingest/core.test.ts`, `convex/followUp.ts`, `convex/followUp.test.ts`, `convex/orgs.ts`, `convex/orgs.test.ts`.

Commit: `6e4d8c9 fix: drive provider migration across tenants`; final completion/cap refinements are included in the release-evidence commit.

### Query/index/cap inventory

Command:

```powershell
rtk run rg -n "\.collect\(\)" convex/conversationLifecycle.ts convex/ingest/reconciler.ts convex/ingest/reconcileState.ts convex/orgs.ts convex/analytics.ts convex/metrics.ts convex/rollupReaders.ts convex/responseTime.ts convex/agents.ts convex/ingest/core.ts convex/followUp.ts
```

Result: only a comment in `followUp.ts`; there are no executable `.collect()` calls in the public analytics/response/agent/ingest/follow-up paths or the lifecycle/reconciliation/organization paths changed for these findings.

Bound inventory:

- Public analytics: 35 days; 900 exact rows/source; 100 fallbacks.
- Response samples: 3,000 exact samples.
- Follow-up candidates/touch histories: 100 rows per bounded source/history.
- Active legacy agent registry: 50 rows plus one overflow probe, then fail closed/loud.
- Provider migration: 50 configs/claims per mutation; 20 organizations per driver action.
- Lifecycle: 25 conversations/page; 4 pages/worker; 20 organizations/driver action.
- Reconciliation: 500 durable gaps/tail/bootstrap rows; 50 external probes/action.
- Legacy cron organization helper: 100 organizations plus one overflow probe, then fail loud.

Remaining `.collect()` calls in `convex/rollups.ts` are organization/index/window-scoped maintenance and parity reads over one 16:00-WIB window, not public hot-path identity readers. They must still be watched during production recompute; a cap failure in the public raw readers is intentionally explicit rather than approximate.

### Final local release gate

All commands were run after implementation; the focused cap refinements were followed by a final full rerun before completion.

| Command | Result |
|---|---|
| `rtk npx vitest run` | PASS — 42 files, 407 tests (final rerun) |
| `rtk npx tsc --noEmit -p convex` | PASS — no errors |
| `rtk npx convex codegen` | PASS — bindings generated; `convex/_generated/api.d.ts` refreshed |
| `rtk npm run build` | PASS — optimized Next.js 14.2.35 build; 30/30 static pages generated |
| `rtk git diff --check` | PASS |

Note: the earlier pre-audit full run was 42 files/405 tests; the two cap-audit regression tests bring the final expected count to 407.

### Deployment and migration order (not executed)

1. Deploy additive indexes, optional `probeCursor`, and optional v2 rollup facts first. Keep code compatible with absent facts.
2. Invoke internal `agents:seedKeysForAllOrganizations` and allow scheduled workers to drain. Rerun the driver until `complete: true`, `organizationEnumerationComplete: true`, and `failedOrganizations: []`.
3. Recompute/true-up every retained 16:00-WIB rollup window, creating v2 completeness markers only after successful recompute.
4. Run `debugRollupParity` for every retained window and require zero mismatches, the expected marker version, and the expected fresh row count.
5. Keep identity-sensitive readers exact raw and half-open. Do not perform an additive distinct cutover or required-field flip in this release.
6. Verify lifecycle scheduled functions drain, reconciliation probes rotate, response cache entries remain tenant/scope isolated, and ingestion replays remain healthy.
7. Record a comparable 24-hour Convex I/O/function-call measurement against the 2026-07-18 baseline of 193.2 MB/day. Primary target is <=135 MB/day; stretch target <=115 MB/day.

### Rollback impact

- Revert code/functions first while retaining additive indexes, optional schema fields, provider claims/runs, rollup markers, lifecycle sweep state, and reconciliation cursor state. These are backward-compatible and preserve retry progress.
- Do not delete migration state to roll back; deleting it would reintroduce repeated work and can lose durable progress.
- Do not restore the fixed cross-tenant response-time principal/cache implementation.
- If exact reader caps trigger in production, narrow the caller window or raise a reviewed cap only after measuring Convex read headroom; do not silently truncate or approximate distinct values.
- A later required-field flip or reader cutover needs a separate deployment and rollback plan after production parity proof.

### Commits

- `5a64008` — `fix: isolate response-time access by tenant`
- `80f34e3` — `fix: bound exact analytics reads`
- `8de8e1d` — `fix: verify every rollup v2 fact`
- `14eaf7b` — `fix: rotate durable reconciliation probes`
- `41f9731` — `fix: bound lifecycle sweep actions`
- `6e4d8c9` — `fix: drive provider migration across tenants`
- `5037dde` — `fix: harden final bounded migrations`
- `495cb2b` — `docs: record remediation release gate`

### Operational status and concerns

- Local correctness gates: green.
- Production deploy: not executed by instruction.
- Production provider migration/backfill: not executed.
- Production rollup recompute/parity: not executed.
- Vercel status/smoke test: not executed because no deployment was authorized.
- 24-hour production measurement: pending deployment and a comparable traffic day.
- Expected operational behavior: accepted exact ranges can now fail loudly at documented caps. This is a correctness safeguard and may require UI guidance or a reviewed cap change if real tenant volume exceeds the current bounds.

## Second final re-review remediation (2026-07-19)

### Approved design and plan

The controller approved the durable migration design before implementation. The design and execution plan are recorded in:

- `.superpowers/sdd/task-8-rereview-design.md`
- `.superpowers/sdd/task-8-rereview-plan.md`

Commit: `2f9bc16 docs: design final rereview remediation`.

### Findings 1–3 — structural response scope, self-only CS payloads, and global period unions

- The response-time route now serializes a discriminated cache scope (`all` versus `cs` plus the full CS name). A real CS named `__all__` cannot share an administrator cache entry.
- CS filtering happens at the indexed sample read before conversation grouping. Both `overall` and `cs` are therefore derived only from the database-verified CS identity. Admin all-agent and admin-filtered payloads retain separate scopes.
- Period headline leads, closing identities, and closed phones now come from report-wide sets. Per-CS rows remain per-CS, but a customer/order crossing agents is counted once in current and previous headline totals and conversion rates.

TDD evidence:

- RED: focused run reported 43 passing and 3 intended failures: the `__all__` collision, CS `overall` count 2 instead of 1, and cross-CS headline count 2 instead of 1.
- GREEN: `rtk vitest run app/api/panel/response-times/route.test.ts convex/responseTime.test.ts convex/rollupReaders.test.ts` -> 46/46.

Commit: `ba12c83 fix: isolate response analytics scopes`.

### Findings 4–5 — durable provider completion and tenant-local `csKey` repair

- Added one durable provider platform run and one audit row per enumerated organization. Enumeration is 20 organizations/page; tenant work reuses the existing 50-row phases.
- Pending, completed, and failed counters persist across pages and retries. A final organization page cannot erase an earlier failure. Global completion requires finished enumeration, zero pending/failures, and completed count equal to enumerated count.
- Scheduled continuations drain pending work but stop on persistent failures. After the data issue is fixed, an operator invocation retries recorded failed tenants.
- `backfillCsKey` now retains the authenticated organization, scans only its organization-prefixed order/recap index, patches at most 500 scanned rows, and returns an explicit continuation cursor. `csKeyCoverage` uses the same bounded tenant-local pagination model.

TDD evidence:

- RED: maintenance run reported 69 passing and 2 intended failures: the provider result had no durable 22-organization proof, and `backfillCsKey` rejected the required cursor/global mutation contract.
- GREEN: `rtk vitest run convex/agents.test.ts convex/rollups.test.ts` -> 71/71; `rtk tsc --noEmit` -> no errors.
- The provider fixture puts a 101-ID failure in the first organization page, completes later pages, proves global incomplete with 21/22 completed, repairs the tenant, retries, and proves 22/22 complete.
- The `csKey` fixture proves two pages repair only organization A while organization B remains untouched.

Commit: `28a2597 fix: make maintenance migrations durable`.

### Finding 6 — document-bounded, tenant-isolated rollup and sample migration

The full-window recompute, delete/recreate sample rebuild, sequential all-tenant true-up, full-window parity, and ten-window mutation loop were replaced by a durable phase engine.

- One immutable run is scoped to `(orgId, windowKey)`. Source work is cursor-paged through existing rollups, orders, recaps, and messages; product finalization and row publication are paged too.
- A mutation processes at most 64 source/staging documents. It returns `runId`, `phase`, `done`, per-call and cumulative document counts, and sample count. A failed transaction leaves the prior phase/cursor and aggregates unchanged.
- Durable identity claims preserve distinct leads, product leads, and closed customers. Durable closing claims apply exact replacement deltas. Product top-50/overflow is finalized across product pages.
- Messages are paired incrementally through durable per-conversation pending state. Samples are written to a run-scoped generation. The completeness marker atomically selects that generation only after every source, aggregate, product, sample, and publish phase finishes.
- Live replies dual-write to the marker-selected generation and any in-progress replacement generation, keyed by source message to prevent duplicates. Live order/recap writes mark an in-progress snapshot dirty; the next step starts a fresh invisible generation rather than publishing a stale snapshot.
- `backfillRange` advances one tenant/window at a time and returns the same key until its run completes, then the next calendar key. This enumerates empty intervening windows rather than skipping them.
- `trueUp` enumerates organizations in 20-row pages and schedules isolated per-tenant/window workers. A tenant failure does not make another tenant share state or a transaction.
- `oldestWindowKey` returns the earlier of the first order and first recap, including recap-only history.
- `debugRollupParity` is an exact two-phase paginated audit: expected staging rows versus published rows, followed by published rows versus expected staging. Each page is capped at 25 rows plus point reads.
- Orphan recap fallback uses the new `(orgId, customerPhone, createdAt)` index and a descending point lookup instead of collecting a phone history.

TDD evidence:

- RED: recap-only history returned null; high-cardinality recompute had no `done`, document budget, durable run ID, or tenant-scoped run (3 intended failures).
- GREEN focused gates: rollup + response suites 54/54, then the broader rollup/response/message/sample/reader set 109/109.
- Regression coverage includes 80-order multi-page resume, marker atomicity, fixed 64-document work bounds, stable cursor/run retry after an intentional transaction failure, tenant isolation, 80-message/40-pair sample pagination, live generation selection, empty intervening windows, recap-only oldest discovery, and parity beyond the first 25-row page.
- Final rollup suite: `rtk vitest run convex/rollups.test.ts` -> 52/52.

Commits:

- `c5b8f7b fix: make rollup migration document bounded`
- `d0d054d fix: bound rollup fallback lookup`

### Operator procedure

1. Deploy additive schema/indexes and compatible code together. No required-field flip is part of this release.
2. Invoke `agents:seedKeysForAllOrganizations`. Let scheduled continuations drain. Accept provider completion only when enumeration is complete, `completedOrganizations === enumeratedOrganizations`, `continuingOrganizations === 0`, and both failure count/list are empty. Fix a failed tenant and invoke again to retry its durable audit row.
3. Per tenant, call `rollups:oldestWindowKey`, choose the retained `toKey`, and loop `rollups:backfillRange`. If `done: false`, repeat `nextFromKey` (the same window). If a window completes, continue with the returned next calendar key until null. Empty windows are expected to receive markers.
4. A healthy marker has schema v2 and `sampleRunId`. Page `debugRollupParity` through every `expected` cursor, then follow `nextSource: stored` through every stored cursor. Require zero mismatches on all pages.
5. Page `backfillCsKey` separately for `orders` and `shippingRecaps`, retaining the authenticated tenant and table-specific cursor. Page `csKeyCoverage` until done and sum page-local missing counts; require zero.
6. Scheduled repair uses `trueUp`; monitor its organization-page continuation and each isolated `runRollupWindow` continuation.

### Rollback

- Stop scheduling provider, `trueUp`, and `runRollupWindow` drivers before reverting code/functions.
- Leave provider audits, migration runs, staging facts, optional marker fields, and additive indexes in place. They preserve retry evidence and are backward-compatible data.
- Incomplete rollup generations are invisible. Readers remain on the last marker-selected sample generation, so no marker edit is needed for an in-progress rollback.
- Do not delete or downgrade a published marker while generation-aware readers are active. If reverting to a legacy response-sample reader, roll back the reader code first and plan legacy sample reconstruction separately.
- Never restore the sentinel cache scope, caller-controlled CS aggregate, global `csKey` mutation, or page-local provider completion behavior.

### Final local release gate

| Command | Result |
|---|---|
| `rtk vitest run` | PASS — 417 tests, zero failures |
| `rtk tsc --noEmit` | PASS — no errors |
| `rtk npx convex codegen` | PASS — bindings refreshed |
| `rtk npm run build` | PASS — optimized Next.js 14.2.35 build; 30/30 static pages |
| `rtk git diff --check` | PASS |

Self-review confirmed that `convex/rollupMigration.ts` has no `.collect()` calls; every migration phase is indexed and cursor-paged. The only remaining `.collect()` calls in `convex/rollups.ts` belong to the existing organization-and-CS-scoped live recompute helper, not recompute/backfill/sample/parity migration entrypoints. Production deploy, scheduled migrations, parity execution against production, Vercel smoke testing, and 24-hour I/O measurement were not executed.
