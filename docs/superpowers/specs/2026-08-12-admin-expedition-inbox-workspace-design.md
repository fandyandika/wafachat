# Admin Expedition Inbox Workspace

## Goal

Turn the existing admin expedition inbox into a clear desktop support workspace. Admins must be able to find a customer, understand the shipping context, send an approved template, continue an open 24-hour conversation, and manage a linked cancellation without searching across multiple screens.

This is a presentation and workflow refinement. KirimDev delivery behavior, existing Convex records, and cancellation semantics remain unchanged.

## Scope

- Desktop-first layout, usable down to the existing responsive breakpoint.
- Compact command header with connection status and the primary `Hubungi customer` action.
- Search and local view filters for `Semua`, `Belum dibalas`, and `24 jam aktif`.
- Scannable conversation rows with customer identity, last-message preview, time, and a clear window/unread state.
- Three-region desktop workspace:
  1. conversation list;
  2. message history and composer;
  3. compact customer/order context panel.
- Message-level delivery and failure feedback.
- Clear loading, empty, error, selected, disabled, and sending states.

## Out of Scope

- New polling, background refresh loops, or live-query amplification.
- A general-purpose CRM.
- Automated replies or automated follow-up.
- Changes to KirimDev API contracts, templates, webhook ingestion, or message retention.
- New database tables or migrations.
- Mobile redesign beyond preserving a functional fallback.

## Information Architecture

### Command Header

The header contains the page title, a concise `Live via webhook` health label, and one primary action: `Hubungi customer`. Secondary explanations are removed from the main visual hierarchy.

### Conversation Rail

The left rail contains a search field and three local filters. Filtering uses the already-loaded paginated results and causes no additional Convex subscription. Each row shows:

- customer name or phone fallback;
- last-message preview or available order/product context;
- last activity time;
- `Balasan aktif` or `Template` state;
- unread/reply-needed emphasis when the latest known message is inbound.

Pagination remains cursor-based through the existing `Muat lainnya` action.

### Conversation Workspace

The center column contains a sticky customer header, scrollable message history, and a stable composer. Incoming and outgoing messages remain visually distinct. Delivery state is shown beside the timestamp. A failed or unknown delivery is attached to its message and offers clear retry guidance without presenting a misleading global failure after another message succeeds.

If the 24-hour window is open, the composer accepts free text. If closed, the composer becomes a compact explanation with a `Kirim template` action.

### Context Panel

The right panel displays only known facts: phone number, product, total, order ID, and linked order status. Missing values use an unobtrusive dash. Cancellation and undo actions live next to the linked order context rather than competing with messaging controls.

## Data and Performance

- Reuse `adminInbox.getSetup`, paginated thread results, selected-thread messages, and linked-order query.
- Add no interval, polling, or broad collection.
- Search and view filters are client-side over the loaded page. The UI explicitly keeps `Muat lainnya` so it does not imply a full-history search.
- Preserve existing reactive updates from Convex webhooks.
- Do not expose additional customer or order fields.

## Error Handling

- Setup errors remain a dedicated configuration state with a link to Settings.
- Thread-list and message loading use bounded skeletons/placeholders.
- Delivery failures remain attached to the failed message.
- Page-level feedback is reserved for actions without a message row, such as validation, cancellation, or a request rejected before persistence.
- Buttons show disabled/sending feedback and prevent duplicate submission using the existing request IDs.

## Accessibility

- Search and filters have programmatic labels.
- Conversation rows expose selected state.
- Message status is available as text, not color alone.
- Keyboard focus follows the existing visible focus system.
- Primary controls keep at least a 44px target where practical.

## Acceptance Criteria

1. An admin can identify a relevant thread and its reply/window state without opening it.
2. Selecting a thread shows messages and customer/order context simultaneously on desktop.
3. Open-window and template-only sending paths are unmistakable.
4. A message failure is associated with that message; a stale global red banner does not remain after success.
5. Existing template send, free-text reply, cancel, and undo behavior continues to work.
6. No recurring client query or polling is introduced.
7. Focused component tests, full tests, TypeScript, Convex codegen, and production build pass before deployment.

