# Manual Follow-up Repair Design

**Date:** 2026-08-11  
**Status:** Approved direction, pending written-spec review

## Goal

Repair Follow-up into a reliable, manual H+1/H+2/H+3 tool for CS. It must stay isolated from the existing n8n automatic order notification and from the Admin Expedition Inbox.

## Decisions

- Follow-up sending is manual. There is no automatic follow-up cron or per-CS auto toggle.
- The funnel has exactly three stages: H+1, H+2, and H+3 as the final follow-up.
- H+1 becomes due 24 hours after the customer's latest inbound message when the latest message is outbound.
- H+2 becomes due 24 hours after a successful H+1 send, provided the customer has not replied and the order has not closed.
- H+3 becomes due 24 hours after a successful H+2 send, provided the customer has not replied and the order has not closed.
- A successful H+3 completes the cycle.
- A new customer inbound resets the cycle. The cycle can be armed again after the CS replies to that new inbound.
- Closing, cancellation, a done marker, manual archive, or inactivity beyond five days removes the conversation from the actionable queue.
- Template names are production configuration, never source-code placeholders.
- The existing n8n order-notification workflow is outside this change and must remain untouched.

## Alternatives Considered

### 1. Raise the current 100-row cap

Rejected. It would make the production error disappear temporarily while increasing Convex reads linearly with traffic. The current N+1 derivation would fail again at a higher volume.

### 2. Store due-state on each conversation (chosen)

Add optional materialized Follow-up fields and indexed read paths to `conversations`. Message and lifecycle writes keep the state current. This provides a bounded, indexed queue without introducing another relationship table.

### 3. Add a separate Follow-up queue table

Valid but unnecessary for the current three-stage funnel. It would add synchronization and retention complexity while duplicating conversation identity fields.

## Data Model

Add optional fields to existing conversation rows so the schema can deploy before backfill:

- `followUpCsKey`: normalized CS identity used by the queue index.
- `followUpCycleInboundAt`: latest inbound timestamp that identifies the current cycle.
- `followUpNextStage`: literal `1`, `2`, or `3`.
- `followUpDueAt`: timestamp when that stage becomes actionable.
- `followUpState`: `waiting`, `sending`, `unknown`, `failed`, `complete`, or `archived`.
- `followUpRequestId`: current client request identifier.
- `followUpProviderMessageId`: accepted provider message identifier.
- `followUpLastError`: safe provider error text.

Indexes:

- `by_org_followUpState_dueAt`: owner/all-CS queue.
- `by_org_followUpCsKey_state_dueAt`: scoped CS queue.

The old `followUpStageOverride` path is removed. Historical stage fields may remain optional during compatibility cleanup but are no longer the source of truth.

## Template Configuration

Create an organization-scoped `followUpTemplates` table with one active row per stage:

- `orgId`, `stage`, `label`, `templateName`, `language`, `variables`, `isActive`, timestamps.
- Variables are an ordered, bounded list of `customer_name`, `product_name`, or `order_id`.
- Owner Settings configures the exact Meta/KirimDev-approved names and variable order.
- Sending is blocked with an explicit readiness message until H+1, H+2, and H+3 are configured.

The CS selects the stage implied by the queue. The CS cannot choose an arbitrary template or force a future stage.

## State Transitions

### Customer inbound

- Store `followUpCycleInboundAt`.
- Clear any previous due stage, request, provider ID, and error.
- Set no actionable state until an outbound CS reply follows.

### Normal CS outbound after an inbound

- Set `followUpNextStage = 1`.
- Set `followUpDueAt = followUpCycleInboundAt + 24 hours`.
- Set `followUpState = waiting`.

### H+1 accepted

- Persist the provider message ID and one outbound template message.
- Set `followUpNextStage = 2`.
- Set `followUpDueAt = acceptedAt + 24 hours`.
- Set `followUpState = waiting`.

### H+2 accepted

- Persist the provider message ID and one outbound template message.
- Set `followUpNextStage = 3`.
- Set `followUpDueAt = acceptedAt + 24 hours`.
- Set `followUpState = waiting`.

### H+3 accepted

- Persist the provider message ID and one outbound template message.
- Clear `followUpNextStage` and `followUpDueAt`.
- Set `followUpState = complete`.

### Reply, closing, cancellation, done marker, archive, or expiry

- Clear actionable stage and due time.
- Set the terminal state appropriate to the event.

## Sending Safety

The client supplies a UUID request ID. An internal reservation mutation atomically verifies:

- organization and CS ownership;
- conversation still open and not closed by recap;
- expected stage and due time;
- template readiness;
- request is not already sending, accepted, or unknown.

The provider idempotency key includes conversation ID, cycle inbound timestamp, stage, and request ID. A finalization mutation records accepted, failed, or unknown exactly once. Unknown outcomes cannot be retried with a new request until provider history is checked, preventing double sends.

## Authorization

- All public Follow-up functions require the signed Convex identity.
- Admin can read and act within the active organization.
- CS can only read messages and act on conversations matching their verified CS key.
- Client-provided organization, actor, or CS identity is never trusted.
- Next.js routes forward a signed Convex token; `PANEL_AUTH_SECRET` is removed from Follow-up operations.
- `messages.listMessages` verifies conversation organization and CS scope before returning PII.
- Template configuration is admin-only.

## Query and I/O Model

- The actionable queue uses the due indexes and cursor pagination.
- No candidate query scans recent conversations or derives stages from message history.
- The page remains on-demand: initial load, manual refresh, and post-action refresh only.
- Chat messages load only for the selected conversation and remain bounded to 50 rows.
- A paginated internal migration initializes due-state for recent open conversations in small batches. It is resumable and does not publish partially derived rows as actionable.

## UI

- Remove Auto and manual stage-move controls.
- Keep tabs: Semua, H+1, H+2, H+3, Closing, Arsip.
- Show due time, customer, product, order, CS, and clear readiness/error status.
- A candidate has one primary action: send the stage currently due.
- Disable sending while reservation/action is in flight.
- Unknown status shows `Perlu dicek` and does not offer another send.
- Template configuration appears in Settings for owner/admin only.

## Rollout

1. Deploy additive schema, indexed queue, auth guards, and inactive template configuration.
2. Disable/remove the auto-follow-up cron and UI controls in the same release.
3. Run the paginated recent-conversation migration.
4. Configure exact approved H+1/H+2/H+3 templates.
5. UAT with an internal test number: H+1, reply reset, H+2/H+3 timing, final-cycle completion, closing removal, duplicate-click protection, and CS isolation.
6. Enable manual sending only after UAT passes. There is no auto-send activation step.

## Testing

- Pure transition tests for inbound, outbound, H+1, H+2, H+3, reply reset, closing, and five-day expiry.
- Convex tests for indexed pagination and more than 100 recent conversations.
- Timing regressions: H+2 is not eligible minutes after a late H+1, and H+3 is not eligible minutes after a late H+2.
- Reservation tests for duplicate request, concurrent request, provider timeout, and definite failure.
- Authorization tests for anonymous, cross-CS, and cross-organization access.
- Route tests proving signed identity forwarding and no `PANEL_AUTH_SECRET` dependency.
- UI tests proving Auto and stage override are absent while H+3 is shown as the final stage.
- Full tests, TypeScript, Convex codegen/deploy validation, production build, and post-deploy smoke checks.

## Success Criteria

- Production Follow-up loads without Server Error at current volume.
- Queue reads stay indexed and paginated.
- A customer receives at most one message for a stage/cycle/request.
- H+2 cannot send until 24 hours after accepted H+1.
- H+3 cannot send until 24 hours after accepted H+2.
- A successful H+3 completes the cycle and produces no further due stage.
- Reply or closing removes the customer before another send.
- CS cannot view or mutate another CS's Follow-up data.
- No code or deployment change touches the n8n automatic order-notification workflow.
