# Admin Expedition Inbox Design

**Date:** 2026-08-10  
**Status:** Approved concept; awaiting written-spec review  
**Scope:** One admin-only WhatsApp channel for expedition communication

## Goal

Allow an administrator to start and continue an expedition-related WhatsApp conversation from WafaChat:

1. Enter a customer phone number.
2. Select an approved expedition template.
3. Preview its resolved content and send it from the configured admin WhatsApp API number.
4. Receive customer replies in a dedicated admin inbox.
5. Continue with free-form replies while the WhatsApp 24-hour customer-service window is open.
6. Cancel a linked order through an explicit internal action instead of a chat keyword.

The channel is admin-only. Its conversations must not enter CS queues, trigger AI replies, trigger automatic follow-up, or affect sales-performance metrics.

## Product Decisions

- Phase one supports one active admin expedition channel per organization.
- Only expedition templates explicitly allowlisted in WafaChat can be selected.
- Template configuration is manual in phase one; automatic template synchronization is out of scope.
- Customer replies are handled only by admins. There is no CS assignment or AI fallback.
- Free-form outbound messages are allowed only when the latest customer inbound message is within 24 hours.
- Outside the 24-hour window, the composer is disabled and an approved template must be sent.
- The current `-Cancel` chat command remains compatible during transition but is not the primary workflow.
- Registering the admin number in KirimDev can happen later. Until configuration is complete, the UI is usable in read/configuration mode but sending is disabled with a clear explanation.

## Recommended Architecture

Use a separate admin messaging domain instead of extending sales `conversations`, `messages`, or `csConfigs`. This prevents expedition activity from contaminating sales attribution, response-time reporting, follow-up candidacy, closing counts, and Queen calculations.

### Data boundaries

Introduce three tenant-scoped tables:

1. `adminChannels`
   - `orgId`
   - `name`
   - `provider` (`kirimdev` in phase one)
   - `displayPhone`
   - `providerNumberId`
   - `isActive`
   - timestamps
   - unique active provider-number claim within an organization

2. `adminTemplates`
   - `orgId`
   - `channelId`
   - display label
   - exact approved provider template name
   - language code
   - ordered variable definitions
   - `category: "expedition"`
   - `isActive`
   - timestamps

3. `adminThreads` and `adminThreadMessages`
   - Thread identity: organization + channel + normalized customer phone.
   - Thread fields: customer name, optional linked order ID, last inbound/outbound timestamps, 24-hour window expiry, archive state, timestamps.
   - Message fields: direction, type (`template` or `text`), content/summary, provider message ID, delivery status, actor user ID/name, timestamps.

All queries use indexed tenant-first lookups. Inbox reads are paginated and only run while the admin inbox is open.

### Why not reuse sales conversations

Reusing sales tables is initially shorter but creates persistent filtering risk in every dashboard, report, follow-up query, lifecycle job, and AI route. Separate storage makes the safety rule structural rather than dependent on scattered conditions.

## User Experience

### Navigation

Add an admin-only `Ekspedisi` section under the existing Follow-up area. CS users never see or access it.

Desktop uses a two-pane inbox. Mobile uses a thread list followed by a full-screen conversation view.

### Start conversation

The primary action is `Hubungi customer`:

1. Enter and normalize an Indonesian phone number.
2. Optionally enter customer name and order ID.
3. Select an active expedition template.
4. Fill only the variables required by that template.
5. Review recipient, sender, and rendered preview.
6. Confirm and send.

Sending is blocked when the channel, provider number ID, API credential, or selected template is not configured. The UI names the missing requirement instead of returning a generic error.

### Continue conversation

- The header shows customer, normalized number, linked order, sender channel, and window status.
- Within 24 hours of a customer reply, the admin can send text messages.
- A visible countdown communicates when the window closes.
- Outside the window, text input is replaced by `Kirim template`.
- Every send has `sending`, `accepted`, `delivered`, `read`, or `failed` feedback when supported by provider webhooks.
- Failed messages remain visible and can be retried safely.

### Cancel order

When a thread has a linked order, show `Batalkan order` as a secondary destructive action:

1. Display the exact order ID and customer.
2. Require a cancellation reason.
3. Require explicit confirmation.
4. Call the structured Convex cancellation mutation by order ID, never by ambiguous chat text.
5. Record actor, reason, timestamp, and resulting recap status.
6. Show success/failure in the thread and retain the existing undo capability for admins.

If no order is linked, the action stays unavailable until the admin selects an exact order. The system must never silently cancel the latest order merely from a phone number.

## Data Flow

### Template outbound

1. Authenticated admin submits channel, recipient, template, variables, and optional order ID.
2. Server validates admin role, tenant ownership, channel readiness, template allowlist, variables, and normalized phone.
3. Server creates an idempotency key and calls KirimDev using the configured `providerNumberId`.
4. After provider acceptance, Convex upserts the thread and stores the outbound template message.
5. Provider status webhooks update delivery state idempotently.

### Customer inbound

1. KirimDev sends a signed inbound webhook.
2. Ingestion resolves `phone_number_id` against `adminChannels` before entering the normal CS/AI path.
3. Matching events are stored in the admin thread and stop there.
4. The thread's `lastInboundAt` and window expiry are updated.
5. Convex subscriptions update only the open thread; the inbox list remains bounded and paginated.

### Free-form outbound

1. Admin submits text from an open thread.
2. Server rechecks admin role, channel ownership, and the 24-hour window using server time.
3. KirimDev sends the message with an idempotency key.
4. The accepted message and provider ID are stored, then status callbacks update it.

## Security and Integrity

- Owner/admin authorization on every query and mutation.
- Organization scoping on all documents and indexes.
- Provider webhook signature validation before ingestion.
- `phone_number_id` ownership must be unique and fail closed.
- Exact template allowlist; clients cannot submit arbitrary provider template names.
- Server-side 24-hour-window enforcement.
- Idempotency keys for template/text sends and webhook event deduplication.
- Audit actor on sends, cancellation, undo, archive, and configuration changes.
- Secrets remain in Convex/Vercel environment variables, never in browser state or documents.

## Failure Handling

- Unconfigured channel: sending disabled with setup guidance.
- Provider timeout: show `status unknown`; reconcile by idempotency key before retrying.
- Provider rejection: map known KirimDev/Meta error codes to actionable Indonesian messages.
- Duplicate click/webhook: return the existing result without sending or inserting twice.
- Expired window between render and send: reject free-form text and offer the template picker.
- Unknown inbound provider number: quarantine/log it; do not route it to AI or another tenant.
- Missing linked order: prohibit cancellation and request exact order selection.

## I/O Budget

- No polling or background live query for the whole inbox.
- Paginate threads with a conservative default page size.
- Subscribe only to the selected thread's recent messages.
- Fetch template/configuration data once when the page opens and reuse it.
- Use indexed lookups for channel claim, thread identity, message pagination, provider event ID, and linked order ID.
- Do not add cron jobs in phase one.

## Testing and Release

### Automated

- Authorization and cross-tenant isolation tests.
- Phone normalization and template-variable validation tests.
- Channel/provider-number uniqueness tests.
- Template allowlist enforcement tests.
- 24-hour boundary tests using server time.
- Idempotent send and webhook deduplication tests.
- Inbound routing proves admin traffic never reaches CS, AI, follow-up, or analytics.
- Exact-order cancellation, audit, and undo tests.
- Responsive UI states: unconfigured, empty, loading, active window, expired window, error, retry.

### Staged rollout

1. Deploy tables, admin UI, and disabled configuration state.
2. Register the admin number in KirimDev and obtain its `providerNumberId`.
3. Configure one approved expedition template and webhook callbacks.
4. Send to the owner's test number and verify inbound reply, free-form response, delivery status, and isolation from sales metrics.
5. Test cancellation against a dedicated test order and undo it.
6. Enable the channel for real admin use.

## Out of Scope

- AI replies.
- Assignment or handoff to CS.
- Bulk campaigns or customer imports.
- Automatic template synchronization.
- Media/file sending.
- Multiple admin sender numbers.
- Automatic cancellation based on customer wording.
- Automatic expedition follow-up schedules.

## Success Criteria

- An admin can start an expedition conversation using an approved template.
- Customer replies appear in the admin-only inbox and nowhere else.
- Admin can continue free-form replies only inside the valid 24-hour window.
- Cancellation targets an exact order and creates a complete audit trail.
- Duplicate actions cannot create duplicate messages or cancellations.
- Sales, CS, Queen, follow-up, and response-time metrics remain unchanged by admin expedition traffic.
