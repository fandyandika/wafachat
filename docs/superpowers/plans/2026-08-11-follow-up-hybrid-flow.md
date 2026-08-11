# WafaChat Hybrid Follow-up Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reliable, manual-first Follow-up workspace that prioritizes eligible customers, records phone and KirimDev-template contacts exactly once, and remains bounded in Convex I/O.

**Architecture:** Keep `conversations` as the indexed current-state projection, add an append-only `followUpAttempts` audit table for actions/history, and let inbound/outbound webhooks update the projection incrementally. Split the current monolithic Follow-up UI into a small on-demand data client, task-oriented navigation, queue/detail views, and one guarded template dialog; no recurring full-table reads or automatic sends are introduced.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Convex 1.39, convex-test, Vitest, Tailwind CSS, existing shadcn/Base UI components, KirimDev Public API.

## Global Constraints

- The system is an operational assistant, not an autonomous sender.
- Never send a follow-up automatically and never change order closing/cancellation rules.
- n8n remains unchanged and continues to handle only the existing order-notification flow.
- The manual delivery path remains `WafaChat UI -> Next.js API -> Convex action -> KirimDev API`.
- H+1 is due 24 hours after the CS reply that arms a cycle; H+2 and H+3 are each due 24 hours after the preceding confirmed contact.
- H+3 is final; a new customer inbound starts a new cycle.
- The actionable horizon is exactly seven days.
- Every read/write is organization-scoped; CS users can access only their assigned conversations.
- Queue/history queries are indexed, cursor-paginated, capped, and requested only when their view is opened.
- Opening WhatsApp never counts as a completed contact.
- A provider timeout is `unknown`; it must not be retried automatically.
- Existing `followUpStage`, `followUpStageAt`, and conversation-level reservation fields remain readable during migration and are removed only in a separate future cleanup.

---

## File Map

### Backend domain and storage

- Modify `convex/schema.ts` — add the attempt audit table and preparation-run table/indexes.
- Modify `convex/followUpModel.ts` — seven-day horizon and pure transition/idempotency helpers.
- Create `convex/followUpAttempts.ts` — bounded attempt history, manual confirmation, and shared attempt writes.
- Modify `convex/followUp.ts` — enriched queue/search/history queries and template reservation/finalization through attempts.
- Modify `convex/messages.ts` — advance a due stage when a genuine KirimDev outbound webhook arrives.
- Modify `convex/followUpMigration.ts` — dry-run/apply preparation with resumable counters.

### HTTP boundary

- Modify `app/api/follow-up/snapshot/route.ts` — initial queue only; remove the 30-day KPI and eager attention reads.
- Create `app/api/follow-up/search/route.ts` — on-demand customer search.
- Create `app/api/follow-up/history/route.ts` — on-demand sent/review/completed pages.
- Create `app/api/follow-up/confirm-contact/route.ts` — explicit manual confirmation.
- Modify `app/api/follow-up/send/route.ts` — accept the chosen allowlisted template ID.

### UI

- Modify `components/panel/follow-up-dashboard.tsx` — thin workspace state/orchestration.
- Create `components/panel/follow-up/follow-up-types.ts` — shared UI contracts and labels.
- Create `components/panel/follow-up/follow-up-client.ts` — one-shot HTTP functions with typed failures.
- Create `components/panel/follow-up/follow-up-list.tsx` — task navigation, filters, queue/history rows, empty/error states.
- Create `components/panel/follow-up/follow-up-detail.tsx` — conversation context and WhatsApp/manual actions.
- Create `components/panel/follow-up/template-send-dialog.tsx` — template selection, preview, confirmation, send feedback.

### Tests

- Modify `convex/followUpModel.test.ts`, `convex/followUp.test.ts`, `convex/messages.test.ts`, and `convex/followUpTemplates.test.ts`.
- Create `convex/followUpAttempts.test.ts`.
- Modify `app/api/follow-up/send/route.test.ts`, `app/api/follow-up/snapshot/route.test.ts`, and `components/panel/follow-up-dashboard.test.tsx`.
- Create route tests beside each new route and component tests beside each new component.

---

### Task 1: Lock the seven-day lifecycle and attempt audit model

**Files:**
- Modify: `convex/followUpModel.ts`
- Modify: `convex/followUpModel.test.ts`
- Modify: `convex/schema.ts`
- Create: `convex/followUpAttempts.ts`
- Create: `convex/followUpAttempts.test.ts`

**Interfaces:**
- Produces: `FOLLOW_UP_EXPIRY_MS = 7 * FOLLOW_UP_DAY_MS`.
- Produces: `attemptKey(conversationId, cycleInboundAt, stage, method, nonce): string`.
- Changes: `armH1AfterOutbound(cycleInboundAt, csKey, outboundAt)` makes H+1 due 24 hours after the CS reply, not after the earlier customer inbound.
- Produces: `reserveAttempt`, `finalizeAttempt`, and `recordAcceptedAttempt` helpers for provider-send, webhook, and manual-confirm paths.
- Produces tables `followUpAttempts` and `followUpPreparationRuns` with organization-first indexes.

- [ ] **Step 1: Write failing lifecycle and attempt-idempotency tests**

```ts
test("the actionable horizon is exactly seven days", () => {
  expect(FOLLOW_UP_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1_000);
});

test("accepted attempts are idempotent per cycle, stage, and method", async () => {
  const first = await recordAcceptedAttempt(ctx, input);
  const second = await recordAcceptedAttempt(ctx, input);
  expect(first.duplicate).toBe(false);
  expect(second).toEqual({ attemptId: first.attemptId, duplicate: true });
});
```

- [ ] **Step 2: Run the focused tests and confirm the new contracts fail**

Run: `rtk vitest run convex/followUpModel.test.ts convex/followUpAttempts.test.ts`  
Expected: FAIL because the seven-day constant, table, and attempt helper do not exist.

- [ ] **Step 3: Add the pure key helper and append-only schemas**

```ts
export function attemptKey(
  conversationId: string,
  cycleInboundAt: number,
  stage: FollowUpStage,
  method: "provider_template" | "provider_webhook" | "manual_confirmation",
  nonce: string,
) {
  return `${conversationId}:${cycleInboundAt}:${stage}:${method}:${nonce}`;
}
```

For `provider_template` and `manual_confirmation`, `nonce` is the validated request UUID. For `provider_webhook`, `nonce` is the provider's external message ID. This deduplicates retries of the same attempt while allowing an explicit new attempt after a confirmed failure.

Add `followUpAttempts` fields for `orgId`, `conversationId`, `csKey`, `cycleInboundAt`, `stage`, `method`, `status`, `attemptKey`, `requestId`, optional template/provider/error/actor fields, and timestamps. Add indexes:

```ts
.index("by_org_attemptKey", ["orgId", "attemptKey"])
.index("by_org_status_createdAt", ["orgId", "status", "createdAt"])
.index("by_org_csKey_status_createdAt", ["orgId", "csKey", "status", "createdAt"])
.index("by_org_conversation_createdAt", ["orgId", "conversationId", "createdAt"])
.index("by_org_providerMessageId", ["orgId", "providerMessageId"])
```

Add `followUpPreparationRuns` with `orgId`, `mode`, `status`, `cursor`, `nextConversationStatus`, counters, `startedAt`, and `updatedAt`, indexed by organization and start time.

- [ ] **Step 4: Implement `recordAcceptedAttempt` with exact duplicate lookup**

```ts
const existing = await ctx.db
  .query("followUpAttempts")
  .withIndex("by_org_attemptKey", q => q.eq("orgId", input.orgId).eq("attemptKey", key))
  .unique();
if (existing) return { attemptId: existing._id, duplicate: true };
const attemptId = await ctx.db.insert("followUpAttempts", { ...input, attemptKey: key });
return { attemptId, duplicate: false };
```

- [ ] **Step 5: Generate Convex types and run focused tests**

Run: `rtk npx convex codegen`  
Expected: PASS and generated API/data-model types include both tables.  
Run: `rtk vitest run convex/followUpModel.test.ts convex/followUpAttempts.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit the storage boundary**

```bash
rtk git add convex/schema.ts convex/followUpModel.ts convex/followUpModel.test.ts convex/followUpAttempts.ts convex/followUpAttempts.test.ts convex/_generated
rtk git commit -m "feat: add follow-up attempt audit model"
```

### Task 2: Make KirimDev phone activity advance the lifecycle exactly once

**Files:**
- Modify: `convex/messages.ts`
- Modify: `convex/messages.test.ts`
- Modify: `convex/followUpModel.ts`
- Modify: `convex/followUpAttempts.ts`

**Interfaces:**
- Consumes: `recordAcceptedAttempt` and `advanceAfterAccepted`.
- Produces: `applyDueOutboundContact(ctx, conversation, message): Promise<{ advanced: boolean }>`.
- Behavior: only a CS outbound at or after `followUpDueAt` advances the current waiting stage.

- [ ] **Step 1: Add failing webhook lifecycle tests**

```ts
test("H1 becomes due 24 hours after the CS reply", async () => {
  await appendOutbound({ createdAt: inboundAt + HOUR, externalMessageId: "wamid.reply" });
  expect((await loadConversation()).followUpDueAt).toBe(inboundAt + HOUR + DAY);
});

test("a due KirimDev outbound advances H1 and records one provider_webhook attempt", async () => {
  await appendOutbound({ createdAt: dueAt + 1, externalMessageId: "wamid.phone.1" });
  const conversation = await loadConversation();
  expect(conversation).toMatchObject({ followUpNextStage: 2, followUpState: "waiting" });
  expect(await attempts()).toHaveLength(1);
});

test("an outbound before due time does not consume the follow-up stage", async () => {
  await appendOutbound({ createdAt: dueAt - 1, externalMessageId: "wamid.phone.early" });
  expect((await loadConversation()).followUpNextStage).toBe(1);
});
```

Also cover duplicate webhook ID, new inbound reset, closed conversation, internal phone, and H+3 completion.

- [ ] **Step 2: Run the message tests and verify the phone-path failure**

Run: `rtk vitest run convex/messages.test.ts`  
Expected: FAIL because an outbound webhook currently only arms H+1 and does not advance an existing due stage.

- [ ] **Step 3: Implement one guarded transition inside message ingestion**

```ts
const dueStage = conversation.followUpNextStage;
const canAdvance = args.role === "cs"
  && conversation.followUpState === "waiting"
  && dueStage !== undefined
  && conversation.followUpDueAt !== undefined
  && createdAt >= conversation.followUpDueAt
  && conversation.followUpCycleInboundAt !== undefined;
```

When `canAdvance`, record a `provider_webhook` accepted attempt keyed to the current cycle/stage, apply `advanceAfterAccepted`, and update `followUpStage`, `followUpStageAt`, `followUpNextStage`, `followUpDueAt`, and `followUpState`. If the attempt is duplicate, leave the projection unchanged.

- [ ] **Step 4: Run lifecycle and ingestion regression tests**

Run: `rtk vitest run convex/messages.test.ts convex/ingest/core.test.ts convex/conversationLifecycle.test.ts`  
Expected: PASS, including no change to closing detection or inbound reset behavior.

- [ ] **Step 5: Commit phone-webhook lifecycle support**

```bash
rtk git add convex/messages.ts convex/messages.test.ts convex/followUpModel.ts convex/followUpAttempts.ts
rtk git commit -m "feat: track phone follow-ups from provider webhooks"
```

### Task 3: Build bounded queue, search, and operational history queries

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `convex/followUpAttempts.ts`
- Modify: `convex/followUpAttempts.test.ts`

**Interfaces:**
- Produces: `listDueFollowUps` rows with `productName`, `lastMessagePreview`, `lastMessageAt`, and `reason`.
- Produces: `searchFollowUpCustomers({ query, csName?, limit })` capped at 20 results.
- Produces: `listFollowUpHistory({ view, csName?, paginationOpts })`, where `view` is `sent | review | completed`.

- [ ] **Step 1: Add failing query-contract and high-volume tests**

```ts
expect(result.page[0]).toMatchObject({
  productName: "Quran Mapping",
  lastMessagePreview: "Baik kak, kami tunggu kabarnya.",
  reason: "CS terakhir membalas, customer belum merespons",
});
expect(result.page).toHaveLength(30);
```

Seed 901 eligible conversations before the 30-item assertion so the test fails if the query regresses to an exact/unbounded read. Also test tenant scope, CS scope, stage filter, seven-day lower bound, three-character minimum search, exact normalized-phone match, 20-result search cap, and cursor pagination above 900 attempts.

- [ ] **Step 2: Run focused query tests and verify they fail**

Run: `rtk vitest run convex/followUp.test.ts convex/followUpAttempts.test.ts`  
Expected: FAIL on the richer row, search, and history contracts.

- [ ] **Step 3: Enrich only the paginated queue page**

After the indexed conversation page is selected, perform at most one indexed latest-message read and one indexed order read per row. Clamp `numItems` to 30 and map:

```ts
{
  ...base,
  productName: order?.productName ?? "Produk tidak tersedia",
  lastMessagePreview: (lastMessage?.content ?? "").slice(0, 180),
  lastMessageAt: lastMessage?.createdAt ?? base.cycleInboundAt,
  reason: "CS terakhir membalas, customer belum merespons",
}
```

- [ ] **Step 4: Add bounded on-demand search**

Normalize phone-like queries and use `by_org_customerPhone_updatedAt` for an exact phone lookup. For names, inspect only the newest 100 active plus 100 handover conversations inside a 90-day range, apply organization/CS scope before mapping, deduplicate by normalized phone, and return at most 20 rows. Reject trimmed queries shorter than three characters.

- [ ] **Step 5: Add attempt-based operational history**

Map `sent` to accepted attempts, `review` to sending/failed/unknown attempts, and `completed` to the existing bounded closing projection. Each request reads one view only, newest first, with a maximum page size of 50.

- [ ] **Step 6: Run query tests and Convex typecheck**

Run: `rtk vitest run convex/followUp.test.ts convex/followUpAttempts.test.ts`  
Expected: PASS.  
Run: `rtk npx convex codegen && rtk npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit bounded read models**

```bash
rtk git add convex/followUp.ts convex/followUp.test.ts convex/followUpAttempts.ts convex/followUpAttempts.test.ts convex/_generated
rtk git commit -m "feat: add bounded follow-up work views"
```

### Task 4: Move template sends and manual confirmation onto the attempt ledger

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `convex/followUpTemplates.ts`
- Modify: `convex/followUpTemplates.test.ts`
- Modify: `app/api/follow-up/send/route.ts`
- Modify: `app/api/follow-up/send/route.test.ts`
- Create: `app/api/follow-up/confirm-contact/route.ts`
- Create: `app/api/follow-up/confirm-contact/route.test.ts`

**Interfaces:**
- Changes: `sendDueFollowUp({ conversationId, stage, templateId, requestId })`.
- Produces: `confirmManualContact({ conversationId, stage, requestId })`.
- Produces: active-template query results sufficient for recipient/sender/template preview.

- [ ] **Step 1: Add failing send-selection, stale-card, and manual-confirm tests**

```ts
await expect(send({ templateId: foreignTemplateId })).rejects.toThrow(/template/i);
await expect(confirm({ stage: 2 })).rejects.toThrow(/tidak lagi jatuh tempo/i);
expect(await confirm({ stage: 1, requestId })).toMatchObject({ ok: true, duplicate: false });
expect(await confirm({ stage: 1, requestId })).toMatchObject({ ok: true, duplicate: true });
```

Cover inactive template, foreign organization, CS scope mismatch, missing `providerNumberId`, accepted/failed/unknown outcomes, and a customer reply arriving between card load and action.

- [ ] **Step 2: Run focused backend/route tests and confirm failure**

Run: `rtk vitest run convex/followUp.test.ts convex/followUpTemplates.test.ts app/api/follow-up/send/route.test.ts app/api/follow-up/confirm-contact/route.test.ts`  
Expected: FAIL because template choice and manual confirmation are not implemented.

- [ ] **Step 3: Reserve provider sends in `followUpAttempts`**

Build the stable key from organization, conversation, cycle, stage, and `provider_template`; store the user `requestId` separately. Repeated calls return the existing attempt status. Keep the conversation state projection synchronized, but use the attempt row as the authoritative audit record.

```ts
const selected = activeTemplates.find(row => row._id === args.templateId);
if (!selected) throw new Error("Template Follow-up tidak aktif atau tidak tersedia.");
```

- [ ] **Step 4: Implement manual confirmation with server-side revalidation**

Require a due `waiting` conversation, exact current stage/cycle, organization/CS authorization, and no closing recap. Record `manual_confirmation`, actor user ID/name, and accepted timestamp, then advance once through `advanceAfterAccepted`.

- [ ] **Step 5: Update HTTP validation and status mapping**

The send route requires `templateId`; the confirm route requires UUID `requestId`, `conversationId`, and stage 1/2/3. Both sign the Convex token. Return 401 for no session, 400 for malformed input, 403 for scope errors, 409 for stale/duplicate-conflict conditions, 202 for sending, and 502 for failed/unknown provider results.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `rtk vitest run convex/followUp.test.ts convex/followUpTemplates.test.ts app/api/follow-up/send/route.test.ts app/api/follow-up/confirm-contact/route.test.ts`  
Expected: PASS.  
Run: `rtk npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit guarded contact actions**

```bash
rtk git add convex/followUp.ts convex/followUp.test.ts convex/followUpTemplates.ts convex/followUpTemplates.test.ts app/api/follow-up/send app/api/follow-up/confirm-contact
rtk git commit -m "feat: guard manual follow-up contacts"
```

### Task 5: Add resumable seven-day state preparation with dry-run evidence

**Files:**
- Modify: `convex/followUpMigration.ts`
- Create: `convex/followUpMigration.test.ts`
- Modify: `convex/schema.ts`

**Interfaces:**
- Produces: `startRecentFollowUpPreparation({ mode: "dry_run" | "apply" }) -> { runId }`.
- Produces: `getFollowUpPreparationRun({ runId })` with scanned/eligible/updated/skipped/failed counters and cursor/status.
- Internal page size: 25 conversations; active then handover; seven-day lower bound.

- [ ] **Step 1: Add failing dry-run, apply, resume, and safety tests**

```ts
expect(await dryRun()).toMatchObject({ updated: 0, status: "complete" });
expect(await unchangedConversation()).toEqual(before);
expect(await appliedRun()).toMatchObject({ eligible: 1, updated: 1, failed: 0 });
```

Test that internal phones, closed/recapped orders, old conversations, and already-correct projections are skipped; interruption resumes from the stored cursor; a repeated apply makes zero additional state changes.

- [ ] **Step 2: Run migration tests and verify failure**

Run: `rtk vitest run convex/followUpMigration.test.ts`  
Expected: FAIL because run tracking and dry-run mode do not exist.

- [ ] **Step 3: Refactor page derivation into a write/no-write result**

```ts
type PreparationDecision =
  | { kind: "update"; patch: FollowUpProjectionPatch }
  | { kind: "skip"; reason: "internal" | "closed" | "old" | "unchanged" | "ineligible" };
```

Dry-run increments counters without applying `patch`. Apply mode writes only when the derived projection differs from the stored projection. Every page updates the run row before scheduling the next cursor.

- [ ] **Step 4: Add owner-only start/status functions**

Reject a second running preparation for the same organization. Return the run ID immediately; do not hold a single mutation open for the full scan.

- [ ] **Step 5: Run migration tests, codegen, and typecheck**

Run: `rtk vitest run convex/followUpMigration.test.ts convex/followUp.test.ts`  
Expected: PASS.  
Run: `rtk npx convex codegen && rtk npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit preparation workflow**

```bash
rtk git add convex/followUpMigration.ts convex/followUpMigration.test.ts convex/schema.ts convex/_generated
rtk git commit -m "feat: add safe follow-up state preparation"
```

### Task 6: Replace eager snapshot reads with view-specific HTTP clients

**Files:**
- Modify: `app/api/follow-up/snapshot/route.ts`
- Modify: `app/api/follow-up/snapshot/route.test.ts`
- Create: `app/api/follow-up/search/route.ts`
- Create: `app/api/follow-up/search/route.test.ts`
- Create: `app/api/follow-up/history/route.ts`
- Create: `app/api/follow-up/history/route.test.ts`
- Create: `components/panel/follow-up/follow-up-types.ts`
- Create: `components/panel/follow-up/follow-up-client.ts`
- Create: `components/panel/follow-up/follow-up-client.test.ts`

**Interfaces:**
- Produces: `fetchQueue(filters, cursor?)`, `searchCustomers(query, csName?)`, `fetchHistory(view, csName?, cursor?)`, `sendTemplate(input)`, and `confirmContact(input)`.
- Initial snapshot returns queue data only; history/search calls occur only when their view is selected or submitted.

- [ ] **Step 1: Add failing route and one-shot-client tests**

```ts
expect(state.query).toHaveBeenCalledTimes(1);
expect(state.query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paginationOpts: { numItems: 30, cursor: null } }));
expect(state.query).not.toHaveBeenCalledWith(expect.stringContaining("Effectiveness"), expect.anything());
```

Test session rejection, verified CS override, three-character search validation, allowed history-view validation, cursor forwarding, and localized error extraction.

- [ ] **Step 2: Run route/client tests and verify failure**

Run: `rtk vitest run app/api/follow-up/snapshot/route.test.ts app/api/follow-up/search/route.test.ts app/api/follow-up/history/route.test.ts components/panel/follow-up/follow-up-client.test.ts`  
Expected: FAIL because new routes/client do not exist and snapshot still performs five eager queries.

- [ ] **Step 3: Make snapshot queue-only**

Keep session verification and signed Convex auth. Query `listDueFollowUps` once with a page size of 30 and return `{ ok, page, pagination }`; remove KPI and eager sending/failed/unknown reads.

- [ ] **Step 4: Implement validated search/history routes**

Each route derives effective CS scope from the verified session, calls one Convex query, and returns the query cursor unchanged. Do not expose Convex function names or stack traces to the client.

- [ ] **Step 5: Implement the typed one-shot client**

```ts
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new FollowUpClientError(result.error ?? "Permintaan gagal.", response.status);
  return result as T;
}
```

- [ ] **Step 6: Run route/client tests and typecheck**

Run: `rtk vitest run app/api/follow-up/snapshot/route.test.ts app/api/follow-up/search/route.test.ts app/api/follow-up/history/route.test.ts components/panel/follow-up/follow-up-client.test.ts`  
Expected: PASS.  
Run: `rtk npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit on-demand HTTP boundaries**

```bash
rtk git add app/api/follow-up components/panel/follow-up/follow-up-types.ts components/panel/follow-up/follow-up-client.ts components/panel/follow-up/follow-up-client.test.ts
rtk git commit -m "refactor: load follow-up views on demand"
```

### Task 7: Build the task-oriented Follow-up workspace

**Files:**
- Modify: `components/panel/follow-up-dashboard.tsx`
- Modify: `components/panel/follow-up-dashboard.test.tsx`
- Create: `components/panel/follow-up/follow-up-list.tsx`
- Create: `components/panel/follow-up/follow-up-list.test.tsx`
- Create: `components/panel/follow-up/follow-up-detail.tsx`
- Create: `components/panel/follow-up/follow-up-detail.test.tsx`

**Interfaces:**
- Consumes the one-shot client from Task 6.
- Produces five views: `action`, `search`, `sent`, `review`, `completed`.
- Produces filters for stage and CS without restoring H+ stages as primary tabs.

- [ ] **Step 1: Add failing navigation, queue-card, mobile, and empty-state tests**

```tsx
expect(html).toContain("Perlu tindakan");
expect(html).toContain("Cari customer");
expect(html).toContain("Terkirim");
expect(html).toContain("Perlu dicek");
expect(html).toContain("Selesai");
expect(html).not.toContain('role="tab">H+1');
```

Render a candidate and assert customer/product, `Diam 28 jam`, plain-language reason, message preview, H+ badge, `Buka WhatsApp`, `Kirim template`, and `Tandai sudah dihubungi`. Assert 44px mobile targets and keyboard tab navigation.

- [ ] **Step 2: Run component tests and verify the old information architecture fails**

Run: `rtk vitest run components/panel/follow-up-dashboard.test.tsx components/panel/follow-up/follow-up-list.test.tsx components/panel/follow-up/follow-up-detail.test.tsx`  
Expected: FAIL because the page still exposes `Semua/H+1/H+2/H+3/Closing/Arsip` tabs.

- [ ] **Step 3: Extract the list and detail without changing data behavior**

Move presentation code out of the large dashboard. Keep selection, view state, CS filter, cursors, and refresh orchestration in `FollowUpDashboard`; keep row rendering and accessible navigation in `FollowUpList`; keep the selected-customer actions in `FollowUpDetail`.

- [ ] **Step 4: Apply task navigation and stage filters**

Use the five approved labels. H+ stage filtering is a compact select/chip group inside **Perlu tindakan**, **Terkirim**, and **Perlu dicek**. Opening **Cari customer** does not query until the user submits at least three characters.

- [ ] **Step 5: Implement clear states and WhatsApp behavior**

Use the exact empty copy `Tidak ada customer yang memenuhi aturan follow-up saat ini.` Queue/history failures show a local retry. `Buka WhatsApp` uses a normalized `https://wa.me/<number>` target with `target="_blank"` and does not call any mutation.

- [ ] **Step 6: Run component tests and typecheck**

Run: `rtk vitest run components/panel/follow-up-dashboard.test.tsx components/panel/follow-up/follow-up-list.test.tsx components/panel/follow-up/follow-up-detail.test.tsx`  
Expected: PASS.  
Run: `rtk npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit the workspace redesign**

```bash
rtk git add components/panel/follow-up-dashboard.tsx components/panel/follow-up-dashboard.test.tsx components/panel/follow-up
rtk git commit -m "feat: redesign follow-up as an action workspace"
```

### Task 8: Add template preview and manual-contact confirmation UX

**Files:**
- Create: `components/panel/follow-up/template-send-dialog.tsx`
- Create: `components/panel/follow-up/template-send-dialog.test.tsx`
- Modify: `components/panel/follow-up/follow-up-detail.tsx`
- Modify: `components/panel/follow-up/follow-up-detail.test.tsx`
- Modify: `components/panel/follow-up-dashboard.tsx`

**Interfaces:**
- Consumes active template setup and Task 6 client actions.
- Produces one request UUID per visible attempt; the same UUID is reused for a retry while status is `sending` or `unknown`.
- Successful action triggers a queue refresh and opens **Terkirim**.

- [ ] **Step 1: Add failing confirmation-content and duplicate-click tests**

```tsx
expect(html).toContain("Penerima");
expect(html).toContain("Nomor pengirim");
expect(html).toContain("Template");
expect(html).toContain("Preview pesan");
expect(send).toHaveBeenCalledTimes(1);
```

Test recommended current-stage template, selection among active templates, missing sender/template guidance, variable preview, disabled submit while busy, accepted feedback, failed retry, unknown no-blind-retry, stale-card refresh, and manual-confirm actor warning.

- [ ] **Step 2: Run dialog/detail tests and verify failure**

Run: `rtk vitest run components/panel/follow-up/template-send-dialog.test.tsx components/panel/follow-up/follow-up-detail.test.tsx`  
Expected: FAIL because the guarded dialog and manual-confirm flow do not exist.

- [ ] **Step 3: Build the template confirmation dialog**

Default to the active template matching the candidate stage, list other active templates, and render `customer_name`, `product_name`, and `order_id` values. Show the configured CS sender and `phone_number_id`; block send with a settings link when either is absent.

- [ ] **Step 4: Wire provider and manual outcomes**

For `accepted`, show `Template diterima KirimDev` and refresh. For `failed`, preserve the attempt context and expose one explicit retry button with a new UUID. For `unknown`, show `Periksa KirimDev sebelum mencoba lagi` and disable resend. Manual confirmation requires a second confirmation explaining that it records contact without claiming API delivery.

- [ ] **Step 5: Run UI tests and the full Follow-up slice**

Run: `rtk vitest run components/panel/follow-up app/api/follow-up convex/followUp.test.ts convex/followUpAttempts.test.ts convex/messages.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit action UX**

```bash
rtk git add components/panel/follow-up components/panel/follow-up-dashboard.tsx
rtk git commit -m "feat: add guarded follow-up contact actions"
```

### Task 9: Full regression, production preparation, and release verification

**Files:**
- Modify: `docs/runbooks/manual-followup.md`
- Modify only failing implementation/test files required by the verified regression.

**Interfaces:**
- Produces a repeatable release runbook with exact dry-run/apply/smoke steps.
- Does not execute production preparation until application and Convex deployments are healthy.

- [ ] **Step 1: Run all local quality gates**

Run: `rtk vitest run`  
Expected: all tests PASS.  
Run: `rtk npx tsc --noEmit`  
Expected: PASS.  
Run: `rtk npx convex codegen`  
Expected: PASS with no generated diff after a second run.  
Run: `rtk next build`  
Expected: production build PASS.  
Run: `rtk git diff --check`  
Expected: no output.

- [ ] **Step 2: Perform an explicit security/I/O review**

Verify every new public Convex function calls `requireScopedMemberOrg` or `requireAdminOrg`; every query begins with an organization-first index; queue page size is 30, search result size 20, history page size 50, migration page size 25; no new unbounded `.collect()` or recurring cron exists.

- [ ] **Step 3: Write the release runbook**

Document these exact gates:

```text
1. Deploy Convex schema/functions.
2. Deploy Vercel application.
3. Confirm Follow-up page loads and each non-default view stays idle until opened.
4. Start dry_run preparation and wait for status=complete.
5. Record scanned/eligible/updated/skipped/failed; dry_run updated must equal 0.
6. Start apply preparation and wait for status=complete.
7. Sample at least one H+1 candidate against KirimDev history.
8. Send one approved template to the controlled test number.
9. Verify one accepted attempt, one lifecycle advancement, and no duplicate after repeated click.
10. Verify a controlled phone outbound webhook advances one stage.
11. Observe Convex logs and Database I/O for 30 minutes.
```

- [ ] **Step 4: Commit release documentation and final fixes**

```bash
rtk git add docs convex app components
rtk git commit -m "docs: add hybrid follow-up release runbook"
```

- [ ] **Step 5: Request final code review before merge/deploy**

Use `superpowers:requesting-code-review` against the implementation base commit. Resolve only evidence-backed findings, rerun Step 1, then use `superpowers:finishing-a-development-branch` for merge/deploy choice.

---

## Definition of Done

- A due conversation appears under **Perlu tindakan** with an understandable reason and correct H+ stage.
- Phone activity received from KirimDev advances the stage exactly once.
- Opening WhatsApp alone changes no state.
- A manually confirmed contact and an accepted template send each advance exactly once and appear in **Terkirim**.
- Failed/unknown sends appear in **Perlu dicek** without automatic retries.
- Search and history load only on demand and remain bounded above 900 records.
- A seven-day dry-run/apply preparation completes resumably without sending messages or changing closing state.
- Owner and CS authorization, mobile UX, full tests, typecheck, Convex codegen, and production build all pass.
