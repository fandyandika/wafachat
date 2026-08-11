# Manual Follow-up Runbook

## Scope

WafaChat sends Follow-up manually from the owner/CS workspace. H+1 and H+2 schedule the next stage exactly 24 hours after KirimDev accepts the message. H+3 is the final stage. There is no automatic Follow-up cron.

The n8n order-notification workflow is separate and must not be edited, disabled, or used to test this feature.

## Required setup

1. In **Settings → Konfigurasi CS**, ensure each active CS has the correct KirimDev `providerNumberId`.
2. In **Settings → Template Follow-up**, configure all three approved KirimDev templates:
   - H+1 — first Follow-up.
   - H+2 — reminder.
   - H+3 — final Follow-up.
3. For each template, copy the exact approved template name and language code from KirimDev.
4. Set the positional variables in the same order as the approved template. Supported values are customer name, product name, and order ID.
5. Activate all three templates. Manual sending remains disabled until the setup reports **Siap digunakan**.

Never store or display the KirimDev API key or App Secret in these form fields.

## Queue behavior

- A real customer inbound clears the previous cycle.
- A real CS outbound reply arms H+1 for 24 hours after that inbound.
- Outbound chat biasa tidak memajukan H+1/H+2/H+3. Hanya template yang diterima provider melalui tombol kirim WafaChat yang memajukan tahap.
- A closing, cancellation, done marker, archive, or stale lifecycle transition removes the lead from the actionable queue.
- The workspace reads one indexed, paginated snapshot on load/refresh. Pages after the first 100 are loaded explicitly with **Muat antrean berikutnya**; it is not a continuous heavy Convex query.
- The stage shown on a card comes from the server and cannot be manually changed.

## Safe UAT

Use test number `6285715682110` and a non-production test order.

1. Create an inbound customer message, then a real CS outbound reply.
2. Confirm the conversation materializes as `waiting`, H+1, with the correct CS key and due time.
3. For UAT only, use a controlled due test record or wait until due. Do not edit a real customer's clock/state.
4. Open **Follow-up**, select the card, confirm its chat history, CS, order ID, and exact due stage.
5. Click send once. Confirm KirimDev returns a provider message ID and WafaChat stores one outbound template message.
6. Confirm H+1 advances to H+2 at accepted time +24 hours; H+2 advances to H+3; H+3 becomes complete.
7. Send a customer reply and confirm the pending stage disappears.
8. Complete an order and confirm it does not remain actionable.

## Duplicate and unknown outcomes

Every click uses a request UUID and the provider key:

`fu-{conversationId}-{cycleInboundAt}-{stage}-{requestId}`

- Repeating the same request never starts a second provider send.
- A definite provider rejection is recorded as `failed`.
- A timeout or accepted response without a provider message ID is recorded as `unknown` and blocks further sends.
- A `sending` reservation that is not finalized within two minutes is changed to `unknown`, so it cannot remain hidden or be retried silently.
- Status `sending`, `failed`, and `unknown` are visible in the **Perlu dicek** tab.
- For `unknown`, inspect KirimDev message history using the customer, time, template, and idempotency key. Do not retry with a new request until the provider outcome is reconciled by an operator/developer.

## Recent backfill

Run `followUpMigration.startRecentFollowUpBackfill` once using an authenticated admin context after backend deployment. It processes at most 25 conversations per scheduled page. Observe completion and then read only the first due page/counts; do not export customer PII for verification.

## Rollback

1. Deactivate one or more Follow-up templates to block manual sending immediately.
2. If needed, roll back the WafaChat frontend/backend release together.
3. Do not touch the n8n order-notification workflow.
4. Keep `unknown` reservations blocked until provider history is reconciled.

## Production observation

For the first 24 hours, observe:

- provider acceptance/error/timeout rate;
- duplicate outbound template messages by external message ID;
- waiting/sending/unknown/failed queue state counts;
- Convex I/O for `listDueFollowUps`, `listFollowUpAttention`, and `sendDueFollowUp`;
- continued normal operation of n8n order notifications.
