# Convex State Manager Design

**Goal:** Move WaFaChat support-AI state, history, and realtime panel data from n8n static data into Convex while keeping the existing Order Trigger workflow contract stable.

**Decision:** Convex becomes the source of truth for support AI. n8n remains the workflow/connector layer for Berdu, KirimChat, OpenAI, Telegram, and Google Sheets.

---

## Non-Negotiables

- Do not change the existing Berdu Order Trigger contract.
- `WaFaChat · Order Trigger` may continue calling `POST /webhook/conversation-state` with the same `set_order` payload.
- Support AI is scoped to `CS Aisyah` only.
- CS outside Aisyah may still exist in Order Trigger for non-AI template routing, but must not appear in support-AI panel or Chat Handler AI flow.
- Convex must store history, not only current state.

---

## Architecture

```text
Berdu Order
  -> existing n8n Order Trigger
  -> existing n8n conversation-state webhook
  -> Convex mutation upsertOrder / upsertConversation

KirimChat inbound
  -> n8n Chat Handler
  -> Convex query getConversationContext
  -> if CS Aisyah + active: call OpenAI
  -> save inbound/outbound messages + events to Convex
  -> send WhatsApp reply via KirimChat

Next.js Panel
  -> Convex realtime queries
  -> Convex mutations for Pause / Resume / Done / Reactivate / Global AI
```

Convex HTTP Actions are exposed on the `.convex.site` deployment URL and can serve HTTP endpoints for n8n where needed. Convex also supports direct function calls from controlled clients via SDKs, so the panel should use Convex React hooks instead of hitting n8n for routine data.

---

## Why Convex Here

- Realtime panel: Convex client subscriptions can update panel data without polling.
- Safer state transitions: mutations can enforce idempotent `closed`, `handover`, and `closing` logic in TypeScript.
- Durable history: orders, conversations, messages, and events remain queryable after n8n executions rotate.
- Smaller n8n blast radius: n8n handles external connectors; Convex owns data and business rules.
- Better agent workflow: schema and mutations are easier to review/test than large n8n Code node strings.

---

## Data Model

### `customers`

One document per normalized WhatsApp phone number.

```ts
{
  phone: string,
  name: string,
  firstSeenAt: number,
  lastSeenAt: number,
}
```

Indexes:
- `by_phone`

### `orders`

One document per Berdu order.

```ts
{
  orderId: string,
  customerPhone: string,
  customerName: string,
  assignedCsName: string,
  assignedCsNumber?: string,
  productName: string,
  products: string,
  productsSubtotal: string,
  shippingCost: string,
  total: string,
  shippingAddress: string,
  shippingDistrict: string,
  shippingCity: string,
  source: "berdu",
  aiEligible: boolean,
  createdAt: number,
  updatedAt: number,
}
```

Indexes:
- `by_orderId`
- `by_customerPhone`
- `by_aiEligible_createdAt`

### `conversations`

Current support-AI state for an order/customer.

```ts
{
  orderId: string,
  customerPhone: string,
  customerName: string,
  assignedCsName: string,
  status: "active" | "handover" | "closed",
  aiEnabled: boolean,
  note: string,
  lastMessageAt?: number,
  createdAt: number,
  updatedAt: number,
}
```

Indexes:
- `by_orderId`
- `by_status_updatedAt`
- `by_customerPhone_updatedAt`
- `by_assignedCsName_status`

Rule:
- Only Aisyah conversations are inserted into this support-AI table.
- If a non-Aisyah order is received, Convex records the order only if needed for audit, but does not create an AI conversation.

### `messages`

Persistent chat history for AI context and audit.

```ts
{
  conversationId: Id<"conversations">,
  orderId: string,
  customerPhone: string,
  role: "customer" | "ai" | "cs" | "system",
  direction: "inbound" | "outbound",
  content: string,
  messageType: "text" | "image" | "template" | "button",
  source: "kirimchat" | "panel" | "n8n",
  externalMessageId?: string,
  createdAt: number,
}
```

Indexes:
- `by_conversation_createdAt`
- `by_customerPhone_createdAt`
- `by_orderId_createdAt`

AI context rule:
- Chat Handler fetches the latest 10-20 messages for the active conversation.
- Conversation summaries are out of scope for the first Convex migration. Add them only after the message table is live and prompt size becomes a measured problem.

### `events`

Append-only audit trail.

```ts
{
  conversationId?: Id<"conversations">,
  orderId?: string,
  customerPhone?: string,
  type:
    | "order_upserted"
    | "message_inbound"
    | "ai_reply_sent"
    | "handover"
    | "pause_ai"
    | "resume_ai"
    | "closed"
    | "reactivated"
    | "closing_detected"
    | "global_ai_changed",
  actor: "system" | "ai" | "cs" | "n8n",
  metadata: any,
  createdAt: number,
}
```

Indexes:
- `by_createdAt`
- `by_conversation_createdAt`
- `by_type_createdAt`

### `dailyStats`

Materialized daily stats for fast panel cards.

```ts
{
  date: string, // Asia/Jakarta yyyy-mm-dd
  orders: number,
  closings: number,
  handovers: number,
  closedToday: number,
  orderKeys: string[],
  closingKeys: string[],
  handoverKeys: string[],
  closedKeys: string[],
  updatedAt: number,
}
```

Indexes:
- `by_date`

Rules:
- `orders` dedup by `orderId` when present, fallback `phone:productName`.
- `closings` dedup by `orderId`.
- `handovers` dedup by `orderId`.
- `closedToday` dedup by `orderId`.

### `settings`

Global AI settings.

```ts
{
  key: "global_ai_enabled",
  value: boolean,
  updatedAt: number,
}
```

Indexes:
- `by_key`

---

## Convex Functions

### Public mutations used by panel

- `setGlobalAiEnabled(enabled: boolean)`
- `pauseConversation(conversationId | phone | orderId, note)`
- `resumeConversation(conversationId | phone | orderId)`
- `closeConversation(conversationId | phone | orderId)`
- `reactivateConversation(conversationId | phone | orderId)`

All transition mutations are idempotent.

### Public queries used by panel

- `listConversations({ includeClosedToday: true })`
- `getDailyStats({ date })`
- `getGlobalAiEnabled()`
- `getConversationMessages({ conversationId, limit })`

### n8n adapter functions

The initial migration should keep the current n8n webhook path and make the State Manager workflow an adapter to Convex.

Existing n8n actions map to Convex:

| Current action | Convex target |
|---|---|
| `set_order` | `upsertOrderFromN8n` |
| `get_with_global` | `getConversationContextForN8n` |
| `set` | `setConversationStatusFromN8n` |
| `increment_stat` | `recordStatEventFromN8n` |
| `list_all` | `listConversations` |
| `get_stats` | `getDailyStats` |
| `set_global` | `setGlobalAiEnabled` |
| `get_global` | `getGlobalAiEnabled` |

Implementation can use either:
- Convex HTTP Actions called from n8n HTTP Request nodes; or
- Convex HTTP API / JS client from a lightweight Next.js API adapter.

Preferred first implementation:
- Use Convex HTTP Actions for n8n integration.
- Use Convex React client directly in panel.

---

## Chat Handler Flow

1. Parse KirimChat inbound payload.
2. Save inbound message to Convex.
3. Query Convex context:
   - global AI enabled
   - conversation status
   - assigned CS
   - order context
   - latest messages
4. Guard:
   - if not `CS Aisyah`, skip
   - if global disabled, skip
   - if status is `handover` or `closed`, skip
   - if no order context, skip
5. Build prompt with:
   - system prompt
   - order context
   - product knowledge
   - latest messages
6. Call OpenAI.
7. Save AI reply message to Convex.
8. Send reply via KirimChat.
9. If handover or closing detected, write Convex event and update stats idempotently.

---

## Panel Changes

Panel moves from polling Next.js API routes to Convex realtime queries.

Keep the same first screen:
- stats cards
- active conversations
- handover queue
- closed today
- global AI switch
- Pause / Resume / Done / Reactivate

Remove polling:
- `/api/conversations`
- `/api/stats`
- `/api/global`
- `/api/toggle`

Keep `/api/auth/login` and middleware auth for now.

Add:
- `app/ConvexClientProvider.tsx`
- Convex provider in `app/layout.tsx`
- client hooks in panel page

---

## Migration Plan

### Phase 1: Add Convex and Schema

- Install Convex.
- Create Convex project/deployment.
- Add schema and functions.
- Add env vars:
  - `NEXT_PUBLIC_CONVEX_URL`
  - Convex deployment vars for n8n adapter auth token.

### Phase 2: State Manager Adapter

- Keep `POST /webhook/conversation-state`.
- Replace n8n static data logic with HTTP calls to Convex.
- Preserve existing action names and response shapes so Order Trigger and Chat Handler do not break.

### Phase 3: Chat History

- Chat Handler writes inbound/outbound messages to Convex.
- Chat Handler fetches last 10-20 messages from Convex for AI context.
- Disable n8n memory buffer permanently.

### Phase 4: Realtime Panel

- Panel reads Convex directly with `useQuery`.
- Panel actions call Convex mutations.
- Remove polling and old State Manager API usage from panel.

### Phase 5: Cleanup

- Remove n8n static-data-only actions after all reads/writes are on Convex.
- Keep n8n as connector/orchestration layer.

---

## Security

- n8n-to-Convex HTTP Actions must require a shared secret header.
- Panel auth remains cookie/password initially.
- Convex panel mutations should verify an admin token/session before accepting client-side writes, or route panel mutations through authenticated Next.js routes until proper auth is added.
- KirimChat webhook validation remains separate and should still be added.

---

## Testing

### Unit-level Convex tests

Use Convex tests for:
- duplicate `set_order` does not double count orders
- duplicate closing does not double count closings
- duplicate Done does not double count closedToday
- Pause AI counts handover once
- Reactivate reverses closed state
- non-Aisyah order does not create support-AI conversation

### Integration checks

- Call State Manager adapter with existing `set_order` payload.
- Call `get_with_global` and confirm response shape matches n8n expectations.
- Simulate inbound message for Aisyah active conversation.
- Simulate inbound message for non-Aisyah and confirm AI skip.
- Verify panel updates without polling.

---

## Risks and Controls

| Risk | Control |
|---|---|
| Breaking Order Trigger | Preserve `conversation-state` action contract |
| Double source of truth during migration | Move State Manager to Convex before panel realtime work |
| Convex HTTP Action auth leak | Use server-only secret, never expose in client |
| Panel client mutation security | Keep current auth or route mutations via server until stronger auth |
| n8n response shape mismatch | Adapter tests using real current payloads |
| Long chat history prompt bloat | Fetch latest 10-20 messages first; add summaries only after prompt size is measured in production |

---

## Definition of Done

- Order Trigger still works without node changes.
- Chat Handler reads/writes Convex state.
- Support AI only processes CS Aisyah.
- Panel shows realtime Convex conversations/stats.
- Messages and events are persisted.
- Duplicate orders/closings/handovers/closed actions are idempotent.
- Old n8n static data is no longer the source of truth.
