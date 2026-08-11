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
5. Add each approved expedition template using its exact provider name and language. Add variables only when the approved Meta template actually defines them.

   The current production templates use language `id` and **Template tanpa variabel**:

   - `no_respons_kurir`
   - `penerima_tidak_di_tempat`
   - `alamat_belum_lengkap`
   - `paket_ditolak`

6. Confirm `KIRIMDEV_API_KEY` and, when non-default, `KIRIMDEV_BASE_URL` exist in the Convex production environment.
7. Activate the channel only after all readiness items are green.

Never paste the App Secret or API key into WafaChat fields, screenshots, support email, or this document.

## Admin send fields

- **Nomor WhatsApp** is required.
- **Nama customer**, **Produk**, and **Harga total** are optional internal WafaChat context.
- Optional context is not sent as a Meta template variable unless the approved template explicitly defines that variable.
- Manual sends do not accept or infer an Order ID from the customer phone.

## Smoke test

Use the owner's controlled test number, not a real customer.

1. From **Inbox**, choose **Hubungi customer**, fill the required phone and any useful optional context, then send one approved template.
2. Confirm exactly one outbound row appears and progresses from `Terkirim` to `Diterima`/`Dibaca` when callbacks arrive.
3. Confirm the name, product, and rupiah total appear only when supplied.
4. Confirm no cancellation action appears for a manually started thread without a verified order link.
5. Reply from the customer number. Confirm it appears in the same admin thread and opens the 24-hour free-text window.
6. Send one free-text reply. Confirm it is accepted once; repeated clicks with the same attempt must not duplicate it.
7. Confirm the thread is absent from sales conversations, Follow-up candidates, response-time metrics, Dashboard, Performance, Reports, and Queen Recap.
8. If another trusted integration supplies a verified `orderId`, verify **Batalkan order** and **Batalkan pembatalan** affect only that exact order.
9. Record the timestamp, provider message ID, Convex ingest event ID, and screenshots in the deployment notes.

## Failure interpretation

- **Hanya template**: the last customer inbound is at least 24 hours old. Start again with an approved template.
- **Perlu dicek**: the provider request timed out or returned no message ID. Do not send a new attempt until KirimDev history is checked.
- **Gagal**: KirimDev definitively rejected the request. Correct the template/recipient data, then create a new attempt.
- No inbound message: verify the channel `phone_number_id`, active state, callback URL, signature configuration, and the captured ingest event.

## Rollback

Deactivate **Settings → Admin Ekspedisi → Channel aktif**. This blocks new sends and prevents the number from entering the admin router while preserving thread/audit history. If a frontend rollback is also needed, revert the application deployment after deactivating the channel. Do not delete inbox tables and do not alter the Berdu or existing CS KirimDev callbacks.
