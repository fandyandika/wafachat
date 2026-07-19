# Task 8 Final Re-review Remediation Design

Date: 2026-07-19  
Status: approved by the controller

## Goals

Close the six final re-review findings without reintroducing unbounded Convex reads or cross-tenant state. The release gate is: collision-safe response-time caching, complete CS payload isolation, globally distinct period headlines, provable platform-wide provider migration completion, tenant-local `csKey` repair, and resumable document-bounded rollup/sample migration.

## Response-time scope and period totals

The route cache key will serialize an explicit discriminated scope (`{ kind: "all" }` or `{ kind: "cs", csName }`) rather than reserving a CS-name sentinel. The Convex response-time query will apply the CS predicate before calculating either `overall` or `cs`, so a CS user receives no aggregate derived from another agent. Admin all-agent and admin filtered requests remain separate cache scopes.

Period headline metrics will use report-wide current/previous phone and closing-identity sets. Per-CS rows retain their own sets, but headline `leads`, `closings`, `closed`, and conversion rate come from global unions, preventing the same customer/order from being counted twice after ownership changes.

## Durable provider migration

A platform run records enumeration state, retry/failure state, and durable totals. One audit row per run/organization records the tenant's status and attempts. The driver enumerates organizations in bounded pages, creates audit rows idempotently, advances each tenant's existing bounded migration, and updates audit status. Completion is true only after enumeration ends and every enumerated audit row is complete with no failures. Failed tenants remain visible and retryable; later organization pages cannot erase earlier pending/failure state.

## Tenant-local `csKey` repair

The public repair endpoint retains the authenticated organization ID and paginates each organization's indexed order and recap streams. A page patches only missing keys in that tenant and returns explicit cursors and completion state. Re-running a page is safe because key derivation is deterministic.

## Rollup and sample state machine

Each organization/window has a durable run with an immutable generation and ordered phases:

1. discover existing rollup keys in bounded pages;
2. scan orders in bounded pages into durable per-agent, identity, product, name, and latest-order staging rows;
3. scan recaps in bounded pages, applying replacement deltas through idempotent closing claims;
4. finalize products and expected rollups in bounded pages;
5. discover conversations from bounded message pages and pair each conversation through bounded message pages into generation-scoped sample staging;
6. compare/publish expected rollups in bounded pages;
7. atomically publish the completed sample generation and rollup marker only after every prior phase is complete.

Every source claim is unique by run and source document, making retries idempotent. Work limits are constants and each mutation handles one bounded page. Tenant/window workers schedule only their own next step. The range driver discovers the oldest timestamp from both orders and recaps, enumerates every intervening window (including empty ones), and schedules isolated workers. Samples remain invisible in their staging table until the marker names their completed generation.

Parity is a paginated exact comparison between retained expected rows and published rows, plus a bounded extra-row scan. The one-shot compatibility API fails before its configured document ceiling and points operators to the paginated audit.

## Failure, retry, and rollback

Run phases and cursors advance only in the same transaction that persists the page's effects. A failed transaction leaves the prior cursor intact. A retry resumes the same generation and cannot double-count claimed documents. The marker is never advanced by an incomplete run.

Rollback is operational rather than destructive: stop scheduling the new drivers and keep readers on the last published marker/generation. Incomplete staging rows are not reader-visible and can be retained for diagnosis or deleted later by a bounded cleanup. Provider failures remain in the platform audit until explicitly retried.

