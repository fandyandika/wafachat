# WaFaChat Shipping Recap Export Design

Date: 2026-05-28

## Goal

Build a WaFaChat tool that removes the manual admin copy-paste step from WhatsApp closing messages into the shipping bulk-upload Excel file.

When AI or CS sends a final `PEMESANAN BERHASIL` message in WhatsApp, WaFaChat should parse it, store the latest shipping-ready snapshot in Convex, show it in a dashboard table, and let admin download an Excel file in the platform upload format.

## Non-Goals

- Do not change `WaFaChat - Order Trigger`.
- Do not auto-submit shipments directly to the shipping platform in v1.
- Do not auto-cancel an order only because a customer uses ambiguous cancel-like wording.
- Do not remove historical records when an order is cancelled.

## Current Context

WaFaChat already stores order, conversation, message, event, and daily stats data in Convex. n8n remains the connector/orchestration layer for KirimChat webhooks, OpenAI, and WhatsApp sends.

The support AI can be active, handover, or closed. Shipping recap extraction must not depend on AI being active. If CS manually sends a `PEMESANAN BERHASIL` message and KirimChat emits a `Message Sent` webhook, the recap should still be created or updated.

## Recommended Approach

Use WaFaChat + Convex as the source of truth for shipping recaps.

Add a new Convex table, tentatively named `shippingRecaps`, that stores one current exportable row per order/customer plus source message and audit metadata. The dashboard reads this table in realtime and supports filters, search, sorting, status changes, corrections, and Excel export.

This is safer than an n8n-only spreadsheet generator because the panel can show mismatch flags, allow corrections before export, and keep audit history.

## Data Model

Add `shippingRecaps` with these fields:

- `orderIdBerdu`: string, optional when unavailable.
- `conversationId`: optional Convex conversation id.
- `customerPhone`: WhatsApp phone.
- `customerName`: customer/order name.
- `csName`: sender/CS name.
- `csPhone`: sender/CS phone.
- `orderedAt`: timestamp from original order data when available.
- `closedAt`: timestamp from final closing message.
- `recipientName`: required for export.
- `recipientPhone`: required for export.
- `recipientAddress`: required for export.
- `recipientDistrict`: required for export.
- `recipientCity`: required for export.
- `packageContent`: product/package contents.
- `paymentMethod`: `cod` or `transfer`.
- `nonCodItemPrice`: number, used for transfer/non-COD.
- `codValue`: number, used for COD.
- `shippingCost`: number.
- `total`: number.
- `discount`: optional number.
- `bumpOrder`: optional text.
- `upsell`: optional text.
- `specialBonus`: optional text.
- `shippingInstruction`: optional text.
- `status`: `ready`, `needs_review`, `exported`, `cancelled`, `cancelled_after_export`.
- `flags`: array of structured flags.
- `sourceMessageId`: optional external message id.
- `sourceMessageText`: original `PEMESANAN BERHASIL` text.
- `version`: number, increments when the recap is replaced by a newer closing message.
- `exportedAt`: optional timestamp.
- `exportBatchId`: optional string.
- `cancelledAt`: optional timestamp.
- `cancelReason`: optional text.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

Indexes:

- by `orderIdBerdu`
- by `customerPhone`
- by `closedAt`
- by `status` and `closedAt`
- by `paymentMethod` and `closedAt`

## Latest Snapshot Rule

Only one active recap row should exist for the same final order identity.

Identity priority:

1. `orderIdBerdu`
2. `conversationId`
3. `customerPhone + latest active order`

If another `PEMESANAN BERHASIL` message arrives for the same identity, update the existing recap instead of creating a duplicate. Increment `version` and keep the new `sourceMessageText` as the latest export source.

This handles cases where CS changes address, price, payment method, or product detail after the first closing message.

## Parser

The parser should accept the current WhatsApp format:

```text
PEMESANAN BERHASIL

Detail pesanan:
Produk: Quran Mapping (1x)
Harga: Rp179.000
Ongkir: Rp15.000
Total: Rp194.000

Dikirim ke:
Wawan Hermawan | 6283111337625
Kmp sukaati..., Rancabali, Kab. Bandung

PEMBAYARAN COD
```

Parser responsibilities:

- Detect `PEMESANAN BERHASIL`.
- Extract product/package content.
- Extract prices as numbers.
- Detect payment method from `PEMBAYARAN COD`, `ORDER COD`, `TRANSFER`, or equivalent final closing labels.
- Extract recipient name and phone from the `Nama | phone` line.
- Extract address, district, and city.
- Preserve the full original source message for audit.

If parsing confidence is low, create or update the recap as `needs_review`, not `ready`.

## Mismatch Flags

Compare final recap values against original Convex order values when available.

Flags:

- `ADDRESS_CHANGED`: final address differs from original order address.
- `TOTAL_CHANGED`: final total differs from original total.
- `PHONE_CHANGED`: final recipient phone differs from customer phone/order phone.
- `PAYMENT_METHOD_CHANGED`: final payment method differs from earlier known method.
- `MISSING_DISTRICT`: district is missing or cannot be parsed.
- `MISSING_CITY`: city is missing or cannot be parsed.
- `PARSE_LOW_CONFIDENCE`: parser could not confidently map fields.

Flagged rows default to `needs_review`. Admin can edit and mark them ready.

## Dashboard UX

Add a `Rekap Pengiriman` view in WaFaChat.

Default view:

- Date range: `Hari ini`
- Status: all non-cancelled, non-exported rows
- Sort: latest `closedAt` first

Controls:

- Date range: `Hari ini`, `Kemarin`, `7 Hari`, `Custom`
- Status filter: `Siap Export`, `Perlu Cek`, `Sudah Export`, `Cancel`, `Cancel After Export`
- Payment filter: `Semua`, `COD`, `Transfer`
- Search: recipient name, WhatsApp number, Berdu order id, product, city
- Sort: closing date, total/COD value, city, payment method, status

Main columns:

- Tanggal closing
- Nama penerima
- No WA
- Isi paket
- Metode bayar
- Total / Nilai COD
- Kecamatan / Kota
- Status
- Flag
- Aksi

Long fields such as full address, source message, bonuses, and instructions should open in a detail drawer, not crowd the table.

Large data handling:

- Server-side filtering and pagination/infinite loading through Convex queries.
- Default to today so old orders do not clutter the active workflow.
- Export only the filtered/selected rows.

## Performance Dashboard Extension

After `shippingRecaps` exists, add a `Performance` view that summarizes lead, closing, conversion rate, product performance, and discount usage from clean Convex data.

This should use these source-of-truth rules:

- `Total Leads`: unique Berdu orders from Convex `orders`.
- `Total Closing`: unique final recaps from `shippingRecaps`, not raw chat messages.
- Overall CR: `Total Closing / Total Leads * 100`.
- Product leads: unique leads grouped by product name.
- Product closing: unique `ready`, `exported`, or reviewed final recaps grouped by product/package.
- Product CR: product closing divided by product leads.
- CS discount: sum of explicit `discount` on final recaps, grouped by CS.

Lead identity priority:

1. `orderId`
2. `customerPhone + productName + Jakarta order date`

Closing identity priority:

1. `orderIdBerdu`
2. `conversationId`
3. `customerPhone + packageContent + Jakarta closing date`

Performance filters:

- `Hari ini`
- `Kemarin`
- `7 Hari`
- `Bulan ini`
- `Custom date`
- Product
- CS
- Payment method: `Semua`, `COD`, `Transfer`

Performance cards:

- Total leads
- Total closing
- Overall CR
- Total COD
- Total transfer
- Closing revenue
- Total discount
- Cancelled orders

Performance tables:

- Product table: product, leads, closing, CR, revenue, discount.
- CS table: CS, leads, closing, CR, revenue, discount.

Discount rules:

- Prefer explicit `discount` from `shippingRecaps`.
- If discount is not explicit but the final total is lower than the original order total, calculate `inferredDiscount` and flag the row with `INFERRED_DISCOUNT`.
- Do not mix inferred discount into final CS discount totals unless the admin enables an `Include inferred` toggle.

Performance should be implemented after the recap/export workflow because accurate closing and discount analytics depend on the latest final recap snapshot.

## Status Workflow

Statuses:

- `ready`: valid and ready for Excel export.
- `needs_review`: parser or mismatch flags require admin attention.
- `exported`: included in an Excel export.
- `cancelled`: cancelled before export.
- `cancelled_after_export`: cancelled after it had already been exported.

Admin actions:

- Edit fields.
- Mark ready.
- Mark cancelled with a required reason.
- Undo cancel.
- Download Excel.
- Mark exported automatically after successful download.

Cancellation policy:

- Do not delete recap rows.
- Cancelled rows are hidden from default export.
- If a row is already exported, cancelling it changes status to `cancelled_after_export` so admin knows manual action may be needed in the shipping platform.

Optional automatic cancel detection:

- If customer says `cancel`, `batal`, `tidak jadi`, or similar after closing, mark the row `needs_review` with a possible-cancel flag.
- Do not auto-cancel in v1 because wording can be ambiguous.

## Excel Export

The first version should export the platform bulk-upload Excel format.

Required output columns:

- `Nama Pengirim`
- `No Telp. Pengirim`
- `Nama Penerima`
- `Alamat Penerima`
- `No Telp. Penerima`
- `Kecamatan Penerima`
- `Kota Penerima`
- `Isi Paket`
- `Metode Bayar`
- `Harga Barang (jika non-COD)`
- `Nilai COD (Jika COD)`
- `Diskon (opt)`
- `Instruksi Pengiriman (opt)`
- `Tanggal customer order`
- `Tanggal closing`
- `Order ID Berdu`
- `Bump Order/Upsale/Bonus Khusus (opt)`

Export behavior:

- Export selected rows or current filtered rows.
- Exclude `needs_review`, `cancelled`, and `cancelled_after_export` by default unless admin explicitly includes them.
- After export succeeds, set exported rows to `exported` and assign an `exportBatchId`.

## Data Freshness

Expected dashboard update time is near realtime:

- KirimChat webhook: usually seconds.
- n8n parse and Convex write: seconds.
- Convex realtime dashboard update: immediate after write.

Practical expectation: 1-5 seconds under normal webhook conditions.

## Error Handling

- If parser fails, create `needs_review` row with `PARSE_LOW_CONFIDENCE`.
- If Excel export fails, do not mark rows as exported.
- If a recap update arrives after a row was exported, set status back to `needs_review` and flag it because the exported data may be stale.
- If no original order exists, still create a recap from message data and flag missing order context.

## Test Plan

- Unit test parser with COD and transfer closing templates.
- Unit test parser with changed address and changed total.
- Unit test latest snapshot replacement and `version` increment.
- Unit test cancel and undo-cancel status transitions.
- Unit test export column mapping.
- Verify Convex query filters by date, status, payment method, search, and sort.
- Simulate AI closing and CS manual closing while conversation is handover.
- Verify only latest closing per order/customer appears in default export.
- Verify exported rows are marked with `exportedAt` and `exportBatchId`.

## Rollout Plan

1. Add Convex schema and mutations/queries for `shippingRecaps`.
2. Add parser and tests.
3. Patch n8n Chat Handler to call Convex recap mutation when `PEMESANAN BERHASIL` is sent.
4. Add dashboard `Rekap Pengiriman` table with filters/search/sort/detail drawer.
5. Add Excel export endpoint/action.
6. Deploy and verify with real examples.
