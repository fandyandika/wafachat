# Scalev integration

WafaChat receives Scalev order events directly through Convex. Berdu remains active and KirimDev remains the source of closing signals.

## Production endpoint

```text
https://helpful-spoonbill-863.convex.site/webhooks/scalev
```

The endpoint verifies `X-Scalev-Hmac-Sha256` against the exact raw request body using `SCALEV_WEBHOOK_SIGNING_SECRET`, stores each event before acknowledging it, deduplicates by Scalev `unique_id`, and processes the event asynchronously.

## Initial Scalev events

Enable these events for WafaChat reporting:

- `order.created`
- `order.updated`
- `order.status_changed`
- `order.payment_status_changed`
- `payment.received`

Closing is not derived from Scalev order status. Existing KirimDev conversation signals remain authoritative so Berdu and Scalev use the same business definition.

## CS attribution

Open **Settings → Konfigurasi CS → Scalev Handler IDs** and store the stable Scalev handler/member ID for each CS. Do not use display names as identity.

An unmapped handler is retained under the handler name or `Scalev <id>` so the lead is not discarded, but per-CS reporting requires the mapping to be configured.

## API key

The real-time path does not require a Scalev API key. Add a separate restricted key later for bounded reconciliation/backfill with `order:read` and `order:list`; do not reuse the checkout key.
