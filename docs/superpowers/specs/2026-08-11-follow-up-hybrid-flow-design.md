# WafaChat Hybrid Follow-up Flow Design

**Date:** 2026-08-11  
**Status:** Approved written specification  
**Scope:** Repair and simplify the Follow-up module for daily CS operations.

## 1. Goal

The Follow-up page should help a CS agent identify customers who need attention, continue the conversation from the agent's phone, and use a KirimDev-approved template only when direct messaging is unavailable or restricted.

The system is an operational assistant, not an autonomous sender. It must not send follow-ups automatically, alter order closing state, or depend on n8n.

Success means:

- eligible customers appear without requiring repeated manual searches;
- each suggestion explains why it exists and how long the customer has been waiting;
- activity performed from the CS phone is reflected when KirimDev emits the outbound webhook;
- a CS can explicitly mark a contact as handled when the provider webhook is missing;
- approved-template delivery is guarded against duplicates and ambiguous outcomes;
- queries remain tenant-scoped, indexed, bounded, paginated, and on demand.

## 2. Operating Model

WafaChat uses a hybrid flow:

1. WafaChat builds a prioritized queue from conversation lifecycle state.
2. The CS normally selects **Buka WhatsApp** and continues from their own phone.
3. If the CS cannot send a normal message, the CS selects **Kirim template** and uses an approved KirimDev template.
4. An outbound KirimDev webhook records a phone or API follow-up and advances the lifecycle.
5. If that webhook does not arrive, the CS may use **Tandai sudah dihubungi** with explicit confirmation.

n8n remains responsible only for the existing new-order notification flow. Manual follow-up delivery is direct:

`WafaChat UI -> Next.js API -> Convex action -> KirimDev API`

## 3. Information Architecture

The Follow-up page has five task-oriented views:

1. **Perlu tindakan** — eligible customers due now.
2. **Cari customer** — on-demand lookup by name or phone number.
3. **Terkirim** — recent accepted template sends and confirmed manual contacts.
4. **Perlu dicek** — failed, unknown, or incomplete delivery attempts.
5. **Selesai** — recent conversations closed after a follow-up or lifecycle completed.

H+1, H+2, and H+3 are filters and badges inside these views, not primary navigation tabs. This keeps the page aligned with the user's task instead of exposing internal state as the main workflow.

The owner can view all configured CS agents. A CS account is limited to its own assigned conversations.

## 4. Eligibility Rules

A conversation enters **Perlu tindakan** only when all of these conditions are true:

- it belongs to the active organization;
- it is not internal, closed, canceled, archived, or stale;
- the customer has sent at least one inbound message in the active cycle;
- a CS reply exists after that inbound message;
- the latest relevant message is from the CS, meaning the customer has not replied again;
- the appropriate waiting interval has elapsed;
- the stage has not already been completed for the current inbound cycle;
- the due time is within the active seven-day operational horizon.

Stages are:

- **H+1:** due 24 hours after the CS reply that arms the current cycle;
- **H+2:** due 24 hours after a confirmed H+1 contact;
- **H+3:** due 24 hours after a confirmed H+2 contact and is the final stage.

A new customer reply resets the cycle. A closing, cancellation, archival, or stale lifecycle event removes the conversation from the actionable queue. H+3 completion ends the cycle unless a new customer inbound starts another one.

## 5. Queue Presentation

Each actionable card shows only information needed to decide and act:

- customer name and normalized phone number;
- assigned CS and product/order context when available;
- stage badge: H+1, H+2, or H+3;
- elapsed silence, for example **Diam 28 jam**;
- a plain-language reason, for example **CS terakhir membalas, customer belum merespons**;
- a short preview of the latest relevant message;
- primary action **Buka WhatsApp**;
- secondary action **Kirim template**;
- overflow action **Tandai sudah dihubungi**.

The mobile layout prioritizes the reason, elapsed time, and actions above secondary metadata. Buttons must have adequate touch targets and clear loading, success, disabled, and error states.

An empty queue is a valid state and must say that no customer currently meets the follow-up rules. It must not imply that data is broken.

## 6. Actions and State Transitions

### 6.1 Buka WhatsApp

This opens the customer's normalized `wa.me` destination. Opening WhatsApp does not by itself advance the lifecycle because WafaChat cannot prove that a message was sent.

When KirimDev later emits the matching outbound webhook, WafaChat records the contact and advances H+1 to H+2, H+2 to H+3, or H+3 to complete.

### 6.2 Kirim template

Only active, approved templates configured for the organization are selectable. WafaChat recommends a template matching the current stage but lets the user select another eligible approved template.

Before sending, the confirmation view shows:

- recipient name and number;
- sender CS and configured `phone_number_id`;
- template name, language, and rendered variable preview;
- the lifecycle stage that will be credited if delivery is accepted.

The send operation requires a stable idempotency key derived from organization, conversation, inbound cycle, stage, and template attempt. Repeated clicks or retries must not create a second provider request for the same attempt.

Provider outcomes are stored as:

- **accepted** — KirimDev accepted the request; advance the stage once;
- **failed** — provider rejected it; keep it in **Perlu dicek** with a retry-safe action;
- **unknown** — timeout or indeterminate result; do not retry automatically and require reconciliation or user review.

### 6.3 Tandai sudah dihubungi

This is a fallback for a phone follow-up whose outbound webhook is missing. The action requires confirmation and records actor, timestamp, stage, and reason `manual_confirmation`.

It advances the stage exactly once and is visible in **Terkirim**. It does not create a synthetic WhatsApp message or claim provider delivery.

## 7. Search and Historical Views

**Cari customer** performs an explicit, on-demand search. It may return customers outside the seven-day actionable horizon, but it does not silently insert them into **Perlu tindakan**.

**Terkirim**, **Perlu dicek**, and **Selesai** are operational previews, not unlimited exports. They return newest-first paginated results with a bounded date window and page size. Large historical reporting belongs in the Laporan module and is outside this scope.

## 8. One-time State Preparation

To avoid an empty queue caused by lifecycle fields introduced after older conversations already existed, production receives a one-time, bounded preparation pass over the most recent seven days.

The preparation process:

- is tenant-scoped and paginated;
- derives follow-up state from existing inbound/outbound message history;
- writes only missing or demonstrably stale lifecycle fields;
- never sends a message;
- never changes order closing or cancellation state;
- is resumable and idempotent;
- records scanned, updated, skipped, and failed counts;
- stops at a configured page/read budget and continues from a cursor.

After preparation, normal webhook ingestion maintains lifecycle state incrementally. No recurring full-table reconciliation is introduced.

## 9. Data and Query Boundaries

The design reuses the existing conversation lifecycle fields and indexed access patterns. Any added delivery-attempt data must include organization ownership and stable attempt identity.

Required safeguards:

- authorize every query, mutation, and action against organization and role;
- use compound indexes for organization, state, stage, CS, and due time;
- filter by organization and lifecycle state before pagination;
- use fixed page-size caps and explicit cursors;
- avoid `.collect()` on unbounded production datasets;
- avoid persistent live subscriptions for large history panels;
- load counts and lists only when the Follow-up page or relevant view is opened;
- debounce customer search and require a minimum useful query length;
- keep the seven-day actionable horizon separate from historical search.

## 10. Error Handling and Recovery

Errors must remain local to the affected view or action. One failing history panel must not crash the Follow-up page.

- Queue load failure: show a retryable error state while preserving navigation.
- Template validation failure: block sending and identify the missing sender, template, or variable.
- Provider rejection: store a failed attempt with a safe, user-facing reason.
- Provider timeout: mark unknown and prohibit blind retry.
- Duplicate action: return the existing attempt/result without sending again.
- Missing outbound webhook: allow manual confirmation; do not infer success merely from opening WhatsApp.
- Stale card: revalidate lifecycle state server-side before any send or manual confirmation.

Technical provider details remain available to the owner in diagnostic context but are translated into concise instructions for CS users.

## 11. Testing and Release Verification

### Backend tests

- eligibility for H+1, H+2, and H+3;
- reset on new customer inbound;
- removal on closing, cancellation, archival, and stale state;
- tenant and CS isolation;
- seven-day horizon and pagination boundaries;
- idempotent send and manual confirmation;
- accepted, failed, unknown, and duplicate provider outcomes;
- stale-card revalidation;
- preparation job resumability and idempotency;
- high-volume regression above Convex's exact-row limits.

### UI tests

- correct view/filter behavior;
- mobile card hierarchy and touch actions;
- empty, loading, error, disabled, and success states;
- confirmation contents before template delivery;
- no lifecycle advancement from merely opening WhatsApp;
- retry behavior for failed loads and failed/unknown sends.

### Production verification

- run preparation in a dry-run/count mode first;
- execute the bounded seven-day preparation and record its summary;
- compare a small sample with actual KirimDev conversation history;
- send one approved template to a controlled number;
- verify accepted state, webhook ingestion, stage advancement, and duplicate protection;
- observe error logs and Convex I/O after deployment.

## 12. Explicit Non-goals

This scope does not include:

- automatic or scheduled follow-up sending;
- arbitrary free-text API messages outside WhatsApp's allowed conversation rules;
- replacing KirimDev or adding Chatwoot/Meta Cloud API;
- changing n8n order notification workflows;
- Admin Expedition messaging;
- unlimited historical export;
- changing order closing rules;
- AI-written follow-up messages.

These can be designed separately after the manual hybrid flow is stable.
