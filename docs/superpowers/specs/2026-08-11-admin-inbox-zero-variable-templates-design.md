# Admin Inbox: Zero-Variable Templates and Lean Customer Context

## Goal

Allow the owner/admin to start an expedition-support conversation using the four existing KirimDev/Meta templates that are approved without variables, while retaining a small amount of optional customer context inside WafaChat.

## Approved operator flow

From **Inbox → Hubungi customer**, the admin enters:

- **Nama** — optional.
- **Nomor telepon customer** — required.
- **Produk** — optional.
- **Harga total** — optional.
- **Template** — required and selected from the active allowlist.

The admin reviews the recipient, selected template, and internal context before sending. WafaChat sends only the payload shape approved by Meta. For a template with no variables, WafaChat sends no template parameters even when name, product, or total has been entered.

## Template configuration

The Admin Ekspedisi settings form must support an empty variable list. A template with no variables is valid and can be activated. The UI must provide an explicit **Template tanpa variabel** state instead of forcing a blank variable row.

The existing templates can therefore be configured exactly as approved:

- `no_respons_kurir`
- `penerima_tidak_di_tempat`
- `alamat_belum_lengkap`
- `paket_ditolak`

All use language `id` and an empty variable list.

If a future approved template contains variables, its variable definitions remain positional and are entered in the current template-variable editor. This change does not infer or append variables to an approved provider template.

## Data model

Add optional customer-context fields to the dedicated admin thread:

- `productName?: string`
- `totalAmount?: number`

`customerName` remains optional and `customerPhone` remains required. Inputs are trimmed. The total is stored as a non-negative integer amount in Indonesian rupiah and displayed with Indonesian currency formatting.

The fields are isolated from sales conversations, analytics, Follow-up, reports, Queen Recap, and CS response-time metrics. They are operational notes for the admin inbox only.

## Sending behavior

Starting a conversation continues through the existing guarded path:

`WafaChat Inbox → authenticated Next.js route → Convex reservation → KirimDev API`

The selected allowlisted template determines the provider payload. Internal context fields do not become template parameters unless a future template explicitly defines and maps those variables.

Request UUID idempotency, provider `unknown` handling, exact `phone_number_id`, organization scope, and admin-only authorization remain unchanged.

## Thread behavior

After an accepted template send, the new or existing thread displays the optional customer name, product, and formatted total. Repeated sends to the same admin channel and normalized customer phone update missing/current context without creating a duplicate thread.

Because this flow does not collect an Order ID, a manually started thread is not automatically linked to an order. Exact-order cancellation and undo controls remain unavailable until a thread has a verified order link from another source. WafaChat must not infer an order solely from customer phone.

## UI states

- Zero-variable template: show **Template tanpa variabel** and no value inputs.
- Optional context omitted: send remains enabled when the phone and template are valid.
- Invalid phone: block submission with the existing localized validation.
- Invalid total: block submission and explain that the amount must be a non-negative rupiah value.
- Provider failure/uncertainty: preserve the existing failed/unknown behavior and prevent blind retries.

## Testing

Cover:

- Saving and reading an active template with an empty variable list.
- Sending an empty-parameter template without fabricated values.
- Required phone plus optional name/product/total validation.
- Persisting and displaying product and total in the admin thread.
- Tenant/admin authorization and idempotent thread reuse.
- No order linkage or cancellation capability from phone-only input.
- Regression coverage for existing variable templates and 24-hour free-text replies.

## Out of scope

- Creating or submitting Meta templates for approval.
- Automatically mapping internal context to future template variables.
- Order lookup by phone.
- Changing KirimDev credentials, webhook URLs, n8n, sales Follow-up, or Berdu ingestion.
