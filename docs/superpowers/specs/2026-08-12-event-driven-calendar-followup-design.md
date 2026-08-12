# Event-driven Calendar Follow-up Design

**Date:** 2026-08-12  
**Status:** Approved  
**Authority:** Supersedes the timing, eligibility, expiry, and navigation decisions in the 2026-08-11 Follow-up designs.

## 1. Goal

Make Follow-up a reliable manual workspace for CS agents. Normal follow-up continues from each CS agent's WhatsApp. WafaChat provides an accurate H+1/H+2/H+3 queue, conversation context, and approved-template fallback when WhatsApp restricts direct sending.

The system never sends follow-ups automatically. Time determines when work is due; only a verified message event or an explicit user action advances a stage.

## 2. Locked Operating Rules

- Follow-up is manual-only. There is no auto-send cron or auto-follow-up toggle.
- Stages are H+1, H+2, and H+3.
- Due dates use Jakarta calendar days, not rolling 24-hour intervals.
- A newly armed stage is due at 08:00 WIB on the next calendar day.
- Passing a due time never advances or removes a customer. The customer remains in the same stage and becomes `Terlambat X hari`.
- A customer advances when a stage-specific outbound message is detected or when a CS explicitly marks/corrects the stage.
- H+3 completion archives the follow-up cycle.
- Closing and cancellation terminate the active cycle immediately.
- A customer reply stops the old cycle. After the CS replies again and the customer remains silent, a new H+1 cycle is scheduled.
- There is no recurring full-table reconciliation and no automatic hard deletion.

## 3. State Machine

The current lifecycle is persisted rather than derived from message history on every page load.

```text
Idle
  -> H+1 scheduled/due/overdue
  -> H+2 scheduled/due/overdue
  -> H+3 scheduled/due/overdue
  -> Archived (H+3 complete)

Any active stage -> Closing | Cancelled | Manual archive
Any active stage -> Idle when the customer replies
Idle -> new H+1 cycle after the next qualifying CS outbound
```

### 3.1 H+1 entry gate

A conversation is armed for H+1 when all of the following are true:

- it belongs to the active organization and assigned CS;
- a CS has contacted the lead/order, including leads with no previous WhatsApp inbound;
- the latest relevant message is from the CS;
- the customer has not replied after that message;
- the conversation is not closing, cancelled, or archived.

The H+1 due time is 08:00 WIB on the next Jakarta calendar day.

### 3.2 Stage advancement

- A recognized H+1 message completes H+1 and schedules H+2 for the next calendar day at 08:00 WIB.
- A recognized H+2 message completes H+2 and schedules H+3 for the next calendar day at 08:00 WIB.
- A recognized H+3 message completes the cycle and moves it to Archive.
- A matching message may be sent before the current due time; it still counts and schedules the next stage from the event's calendar date.
- A higher-stage trigger catches up missing stages. For example, an H+2 trigger while the stored stage is H+1 records H+1 and H+2 as completed, then schedules H+3.
- Ordinary outbound messages that match no configured stage trigger do not advance the stage.
- Every transition is idempotent. A retried provider event cannot advance the same cycle twice.

### 3.3 Customer reply and new cycle

A new inbound customer message closes the current silence/follow-up cycle. It does not mark the order closing. After a later CS outbound becomes the latest message and the customer remains silent, WafaChat creates a new cycle starting from H+1.

### 3.4 Manual corrections

CS agents may mark a customer as contacted or change H+1/H+2/H+3 directly. There is no mandatory reason, timed undo, or owner-only correction guardrail. WafaChat still records the actor, timestamp, old stage, new stage, and source so mistakes remain auditable.

## 4. Trigger Configuration

Each organization has explicit rules for H+1, H+2, and H+3:

1. Exact provider `template_name` is the preferred match.
2. Normalized text patterns are a fallback for manual WhatsApp messages.

Patterns are bounded and managed by the owner. Matching is case-insensitive after safe normalization, but it must not use vague keywords that can advance ordinary conversations. The detected rule and stage are recorded with the transition event.

## 5. Data Model and I/O Boundaries

The implementation may reuse compatible current fields, but the logical model has four parts:

### 5.1 Conversation lifecycle snapshot

Each conversation stores only the current operational snapshot:

- organization and assigned CS identity;
- active cycle identity;
- current stage and lifecycle state;
- `dueAt`, last completed stage, and last transition time;
- latest inbound and outbound timestamp plus short preview;
- latest detected template/stage;
- closing, cancellation, and archive outcome.

These fields are updated incrementally during ingestion. Queue reads never scan the message table to derive stage or preview.

### 5.2 Transition history

An append-only, organization-scoped event records stage changes, actor, source, provider event/message identity, and timestamps. This small ledger supports audit and future funnel reporting without scanning chat content.

### 5.3 Messages

Existing message storage remains the single source for chat content; Follow-up does not duplicate it. The detail view loads at most the latest 50 messages for the selected conversation, ordered chronologically. Only new webhook messages after the repaired integration is activated are guaranteed to appear; WafaChat does not import historical KirimDev CRM chat.

### 5.4 Indexed queue and counts

- Active queues use compound indexes scoped by organization, CS, lifecycle state, stage, and due time.
- Results are cursor-paginated and have fixed page-size limits.
- Tab counts use bounded/materialized counters or equally bounded indexed summaries, not full-table scans.
- Search is explicit, debounced, organization-scoped, and bounded.
- Archive and history load only on demand.
- There is no provider polling and no recurring database sweep.

## 6. Webhook Reliability

KirimDev CRM and WafaChat are separate views of provider data. A message visible in KirimDev is not available to WafaChat unless the event reaches and passes WafaChat ingestion.

The ingestion path therefore:

1. authenticates and durably captures an event quickly;
2. acknowledges the provider without waiting for enrichment;
3. processes the event asynchronously;
4. deduplicates by stable provider event/message identity;
5. maps `phone_number_id`, organization, CS, and conversation;
6. updates the message, lifecycle snapshot, previews, and transition ledger atomically where practical.

Unknown phone/channel mappings are never silently discarded. They appear in an actionable diagnostic state with the reason. Each configured phone records the most recent inbound and outbound event time for health visibility.

No historical CRM import is required. Only new events after activation are in scope.

## 7. Follow-up UX

### 7.1 Navigation and ordering

Primary tabs are:

- H+1
- H+2
- H+3
- Perlu dicek
- Closing
- Arsip

Within an active stage, ordering is:

1. longest overdue;
2. due today;
3. scheduled but not yet due.

Overdue customers remain visible until contacted or moved to a terminal outcome.

### 7.2 Queue context

Agents should not need to open 50-message history merely to triage work. Every queue item shows:

- customer name, phone, assigned CS, stage, and due/overdue state;
- latest customer message preview and time;
- latest CS message preview and time;
- latest detected template/stage;
- relevant product/order context when available.

The previews come from the conversation snapshot, so a queue page does not issue per-card message queries.

### 7.3 Actions

Queue and detail actions are:

- **Buka WhatsApp** for the normal manual workflow;
- **Kirim via template** as a KirimDev-approved fallback;
- **Sudah dihubungi** when the outbound webhook is missing;
- **Ubah tahap** for simple CS correction;
- Closing, Batal, and Arsip.

Opening WhatsApp alone never advances a stage. Template delivery uses stable request identity and cannot be sent twice by double-click or retry. Failed and unknown provider outcomes remain in Perlu dicek rather than being reported as sent.

### 7.4 Detail view

The detail view shows:

- a reactive timeline of up to 50 new messages;
- the stage transition history and its source;
- sticky, mobile-safe actions;
- explicit integration health or mapping errors instead of silent stale data.

Reactive updates come from Convex subscriptions on the open queue/detail only. There is no client polling.

## 8. Authorization and Isolation

- Every public query, mutation, and action requires authenticated identity.
- Owner/admin may operate within the active organization.
- CS users may only read and act on their verified assigned conversations.
- Organization, actor, CS, and sender identity are resolved server-side rather than trusted from client input.
- Trigger configuration is owner/admin-only.
- Message and transition history queries verify organization and CS scope before returning customer PII.

## 9. Cutover

- Preserve all existing WafaChat conversations, reports, and messages.
- Normalize valid existing active Follow-up rows once into the new state machine using a bounded, resumable, organization-scoped process.
- Do not fetch historical messages from KirimDev CRM.
- Put ambiguous legacy rows in Perlu dicek instead of guessing or deleting them.
- Deploy backward-compatible backend/schema first, normalize state, deploy the UI, then enable CS access after acceptance testing.
- Archived data is excluded from active queue indexes but retained so reporting and order history remain intact.
- Funnel visualization is deferred until real lifecycle events are proven stable; it will later derive from the transition ledger on demand.

## 10. Failure Handling

- Queue/detail load failures remain local and retryable.
- Stale cards are revalidated server-side before actions.
- Missing sender, template, variables, or channel mapping blocks sending with a specific remedy.
- Definite provider rejection is retryable after correction.
- Unknown provider outcome blocks blind retry until delivery history is checked.
- Duplicate provider events return the existing result.
- Missing outbound webhook permits manual **Sudah dihubungi** without creating a fake provider message.

## 11. Verification and Release Gate

### Automated verification

- calendar-day scheduling at 08:00 WIB;
- early stage triggers and higher-stage catch-up;
- overdue stages never disappearing or auto-advancing;
- customer-reply reset and new-cycle creation;
- no-inbound lead becoming eligible after CS contact;
- H+3 archive, closing, cancellation, and manual corrections;
- trigger matching and non-matching ordinary outbound messages;
- event/send idempotency and concurrent duplicate protection;
- tenant/CS authorization and PII isolation;
- indexed pagination, bounded 50-message detail, and high-volume query regression;
- cutover resumability and ambiguous-row handling.

### Live release gate for every CS and admin phone

1. A new customer inbound appears live in WafaChat.
2. A manual CS outbound appears live in WafaChat.
3. A configured stage trigger advances exactly once.
4. A duplicate/retried webhook creates no duplicate message or transition.
5. A customer reply stops the previous cycle.
6. Closing/cancellation removes the conversation from active stages.
7. An unmapped channel produces a visible diagnostic instead of data loss.

The feature is not considered production-ready until all configured numbers pass this gate.

## 12. Non-goals

- automatic or scheduled follow-up sending;
- historical KirimDev CRM message import;
- continuous provider polling;
- a full CRM replacement;
- AI-written follow-up content;
- changing the n8n new-order notification flow;
- hard deletion or a new retention policy;
- funnel charts before the lifecycle is stable.
