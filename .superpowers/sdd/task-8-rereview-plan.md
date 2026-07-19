# Task 8 Final Re-review Implementation Plan

Date: 2026-07-19

## 1. Response-time and period correctness

- Add route tests for a literal sentinel-like CS name and distinct all/CS cache scopes.
- Add Convex tests proving a CS user's `overall` and per-CS payload derive only from that CS while admins retain all/filtered behavior.
- Add cross-CS period fixtures proving report headlines use global distinct unions.
- Implement the smallest route/query/reader changes and run the focused suites.

## 2. Tenant-local maintenance

- Add a two-organization failing test for `backfillCsKey` and cursor completion.
- Retain the authenticated organization and paginate organization indexes.
- Add provider tests with more than twenty organizations and an earlier-page pending/failure followed by the final page.
- Add platform-run/audit schema and bounded resumable orchestration around the existing per-tenant worker.

## 3. Bounded rollup migration

- Add high-cardinality, multi-page, retry, marker-atomicity, recap-only-oldest, empty-window, and tenant-isolation tests first.
- Add migration-run and staging schema with indexes for source claims, agent/product/name/identity aggregates, expected rollups, conversations, generated samples, and audit pages.
- Implement bounded phase mutations and one-step tenant workers.
- Change response-time reads to select only a marker-published sample generation for migrated windows, with legacy fallback for unmarked windows.
- Replace the full-window recompute/sample/backfill path with run creation/resume and bounded scheduling.
- Add paginated exact parity and a bounded compatibility wrapper.

## 4. Operational documentation and verification

- Update the runbook/API contracts with start, resume, status, retry, parity, rollback, and work-limit behavior.
- Run focused tests after each GREEN, then all tests, Convex TypeScript/codegen, lint if configured, and production build.
- Review the complete diff for tenant boundaries, cursor atomicity, cache separation, and accidental unbounded reads.
- Append RED/GREEN evidence, commits, migration/rollback instructions, and final gate output to `task-8-report.md`.
