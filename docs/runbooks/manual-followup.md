# Manual Follow-up Runbook

## Scope and invariants

WafaChat is a manual-first operational assistant. It never sends Follow-up on a cron. n8n remains responsible only for the existing order-notification flow and must not be changed for this release.

- H+1 is due 24 hours after the CS reply that arms the cycle.
- H+2 and H+3 are due 24 hours after the preceding confirmed contact.
- H+3 is final. A new customer inbound starts a new cycle.
- Only actionable cycles from the last seven days appear in the queue.
- Opening WhatsApp does not advance a stage.
- A template accepted by KirimDev, a genuine due outbound webhook, or an explicit manual-contact confirmation advances exactly one stage.
- A provider timeout is `unknown` and must never be retried blindly.

## Required setup

1. In **Settings → Konfigurasi CS**, ensure each active CS has the correct KirimDev `providerNumberId`.
2. In **Settings → Template Follow-up**, configure approved KirimDev templates. Each active template must use the exact provider name, language, and positional-variable order.
3. Supported variables are customer name, product name, and order ID.
4. Keep `KIRIMDEV_API_KEY` only in the Convex production environment. Never place it in a form, browser variable, log, or support message.

The selected stage needs one active template and a configured sender. The other stages may be completed later without blocking a valid current-stage send.

## Workspace and I/O behavior

- **Perlu tindakan** loads one indexed page of at most 30 eligible conversations.
- **Cari customer** stays idle until a user submits at least three characters and returns at most 20 results.
- **Terkirim**, **Perlu dicek**, and **Selesai** stay idle until opened and load at most 50 rows per page.
- All additional pages require an explicit **Muat berikutnya** action. There is no live full-table subscription or recurring Follow-up query.
- CS accounts are forced to their verified CS scope; owner filters cannot override that scope.

## Duplicate and uncertain outcomes

Every contact creates an append-only `followUpAttempts` audit record.

- Repeating the same request UUID returns the existing attempt and never starts a second send.
- A definite provider rejection is `failed` and can be retried only by an explicit user action with a new request UUID.
- A timeout or ambiguous provider response is `unknown`; the UI disables resend and instructs the operator to inspect KirimDev first.
- A `sending` reservation not finalized within two minutes becomes `unknown`.
- A provider outbound webhook is deduplicated by its external message ID.

## Safe release sequence

Do not prepare production data until both deployments are healthy.

1. Deploy the Convex schema and functions.
2. Deploy the Vercel application.
3. Open Follow-up and confirm only **Perlu tindakan** requests data; other views stay idle until opened.
4. From an authenticated owner maintenance session, call `followUpMigration.startRecentFollowUpPreparation` with `{ "mode": "dry_run" }`.
5. Poll `followUpMigration.getFollowUpPreparationRun` with the returned `runId` until `status = "complete"`.
6. Record `scanned`, `eligible`, `updated`, `skipped`, and `failed`. For dry-run, `updated` must be `0`; investigate any `failed > 0` before continuing.
7. Start the same preparation with `{ "mode": "apply" }` and wait for completion. It processes 25 conversations per scheduled page and never sends messages or changes closing state.
8. Sample at least one H+1 candidate against the KirimDev message history.
9. Send one approved template to controlled test number `6285715682110`.
10. Verify one accepted attempt, one lifecycle advancement, and no duplicate after a repeated click.
11. Send one controlled phone outbound after a due time and verify its webhook advances one stage exactly once.
12. Observe Convex logs and Database I/O for 30 minutes while confirming n8n order notifications continue normally.

## Smoke checklist

- Queue card shows the correct customer, product, CS, last-message preview, reason, stage, and due age.
- **Buka WhatsApp** opens `wa.me` and changes no server state.
- **Tandai sudah dihubungi** shows a confirmation and records the authenticated actor.
- Template confirmation shows recipient, configured sender/phone-number ID, selected template, and resolved variables.
- Accepted contacts move to **Terkirim**. Failed/unknown contacts appear in **Perlu dicek**. Closing records appear in **Selesai**.
- Customer inbound removes the old actionable cycle; closing/cancellation remains unchanged.

## Rollback

1. Deactivate the affected Follow-up template(s) to block template sending immediately.
2. Roll back the WafaChat frontend and Convex functions together if required.
3. Do not touch n8n order notifications.
4. Preserve all attempt rows and keep `unknown` attempts blocked until reconciled against KirimDev.
