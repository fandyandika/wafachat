# Admin Expedition Inbox Runbook

## Purpose

This inbox gives the owner/admin a dedicated KirimDev number for expedition support. Its messages are isolated from sales conversations, CS assignment, AI, Follow-up, Dashboard, Performance, Reports, response-time metrics, and Queen Recap.

The feature is safe to deploy before the number exists: sending and admin webhook routing remain disabled until the channel has a `phone_number_id`, at least one approved template, and is explicitly activated.

## Production setup

1. Register the dedicated WhatsApp admin number in KirimDev.
2. Keep the existing signed callback endpoint:

   `https://helpful-spoonbill-863.convex.site/webhooks/kirimdev?source=kirimdev-pustakaislam`

   Use a separate source only if KirimDev requires it. Do not replace the Berdu webhook.
3. In WafaChat, open **Settings → Admin Ekspedisi**.
4. Enter the display number and exact KirimDev `phone_number_id`.
5. Add each approved expedition template using its exact provider name, language, and body variables in positional order.
6. Confirm `KIRIMDEV_API_KEY` and, when non-default, `KIRIMDEV_BASE_URL` exist in the Convex/production environment.
7. Activate the channel only after all readiness items are green.

Never paste the App Secret or API key into WafaChat fields, screenshots, support email, or this document.

## Smoke test

Use a dedicated test order and owner number.

1. From **Inbox**, choose **Hubungi customer** and send one approved template to `6285715682110`.
2. Confirm exactly one outbound row appears and progresses from `Terkirim` to `Diterima`/`Dibaca` when callbacks arrive.
3. Reply from the customer number. Confirm it appears in the same admin thread and opens the 24-hour free-text window.
4. Send one free-text reply. Confirm it is accepted once; repeated clicks with the same attempt must not duplicate it.
5. Confirm the thread is absent from sales conversations, Follow-up candidates, response-time metrics, Dashboard, Performance, Reports, and Queen Recap.
6. Link the dedicated test order, choose **Batalkan order**, verify only that exact order changes, then choose **Batalkan pembatalan** and verify its prior status is restored.
7. Record the timestamp, provider message ID, Convex ingest event ID, and screenshots in the deployment notes.

## Failure interpretation

- **Hanya template**: the last customer inbound is at least 24 hours old. Start again with an approved template.
- **Perlu dicek**: the provider request timed out or returned no message ID. Do not send a new attempt until KirimDev history is checked.
- **Gagal**: KirimDev definitively rejected the request. Correct the template/recipient data, then create a new attempt.
- No inbound message: verify the channel `phone_number_id`, active state, callback URL, signature configuration, and the captured ingest event.

## Rollback

Deactivate **Settings → Admin Ekspedisi → Channel aktif**. This blocks new sends and prevents the number from entering the admin router while preserving thread/audit history. If a frontend rollback is also needed, revert the application deployment after deactivating the channel. Do not delete inbox tables and do not alter the Berdu or existing CS KirimDev callbacks.
