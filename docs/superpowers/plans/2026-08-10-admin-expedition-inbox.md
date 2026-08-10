# Admin Expedition Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only expedition WhatsApp inbox that starts chats with allowlisted KirimDev templates, supports free-form replies inside the 24-hour window, and cancels an exact linked order without affecting sales systems.

**Architecture:** Keep expedition messaging in dedicated tenant-scoped Convex tables, route KirimDev events by the admin channel's unique `phone_number_id`, and expose provider sends through authenticated Next.js server routes. Reuse presentational primitives from the existing Follow-up UI, but do not reuse its sales conversations, lifecycle, AI, or analytics data.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Convex 1.39, Vitest, Tailwind/shadcn, KirimDev WhatsApp API.

## Global Constraints

- Phase one supports exactly one active admin expedition channel per organization.
- Only owner/admin users may read, configure, send, cancel, undo, or archive.
- Only explicitly allowlisted expedition templates may be sent.
- No AI replies, CS assignment, automatic follow-up, bulk campaigns, media sends, template synchronization, or cron jobs.
- Admin expedition data must not affect sales, CS, Queen, follow-up, closing, or response-time metrics.
- Free-form outbound text is server-enforced only until 24 hours after the latest customer inbound.
- All provider sends and webhook writes are idempotent.
- All data access is tenant-scoped and index-backed; thread lists are paginated and messages are bounded.
- Sending remains disabled until the admin channel has a KirimDev `providerNumberId` and the deployment has `KIRIMDEV_API_KEY`.
- Shell commands in this repository are prefixed with `rtk`.

---

## File Structure

### Create

- `convex/adminInboxModel.ts` — pure normalization, window, status, and template validation helpers.
- `convex/adminInboxModel.test.ts` — pure helper boundary tests.
- `convex/adminInbox.ts` — admin channel/template CRUD, inbox queries, send context, send stamping, cancellation bridge, and status updates.
- `convex/adminInbox.test.ts` — Convex authorization, isolation, indexing behavior, sends, inbound routing, dedupe, and cancellation tests.
- `lib/kirimdev.ts` — provider request builder, response parsing, and Indonesian error mapping.
- `lib/kirimdev.test.ts` — provider contract tests without network access.
- `app/api/admin-inbox/send-template/route.ts` — authenticated template-send boundary.
- `app/api/admin-inbox/send-text/route.ts` — authenticated free-form-send boundary.
- `app/api/admin-inbox/routes.test.ts` — route authorization and input tests.
- `app/panel/follow-up/ekspedisi/page.tsx` — admin-only page entry.
- `components/panel/admin-expedition-inbox.tsx` — responsive thread list, conversation pane, start dialog, and composer.
- `components/panel/admin-expedition-inbox.test.tsx` — UI state and accessibility tests.
- `components/panel/admin-expedition-settings.tsx` — channel and allowlisted-template settings.
- `components/panel/admin-expedition-settings.test.tsx` — disabled/readiness/configuration UI tests.
- `docs/runbooks/admin-expedition-inbox.md` — KirimDev registration, configuration, smoke test, and rollback instructions.

### Modify

- `convex/schema.ts` — dedicated admin channel, template, thread, message, and provider-event indexes.
- `convex/http.ts` — fast capture plus routing of admin provider events before sales ingestion.
- `convex/ingest/kirimdevAdapter.ts` — export provider event envelope fields needed for admin routing/status.
- `convex/ingest/kirimdevAdapter.test.ts` — inbound/status parsing coverage.
- `convex/shippingRecaps.ts` — extract exact-order cancellation core and record admin actor metadata.
- `convex/shippingRecaps.test.ts` — exact-order cancellation and undo coverage.
- `components/panel/settings-dashboard.tsx` — render admin expedition settings for admins only.
- `components/panel/settings-dashboard.test.tsx` — settings integration test.
- `app/panel/layout.tsx` — admin-only Ekspedisi sub-navigation.
- `app/panel/layout.test.tsx` — role visibility and route tests.
- `lib/auth-jwt.ts` — explicitly deny CS access to the expedition route.
- `app/ConvexClientProvider.test.tsx` — route guard regression.

---

### Task 1: Dedicated Data Model and Pure Rules

**Files:**
- Create: `convex/adminInboxModel.ts`
- Create: `convex/adminInboxModel.test.ts`
- Modify: `convex/schema.ts`

**Interfaces:**
- Produces: `normalizeAdminRecipient(value: string): string`
- Produces: `adminWindowExpiresAt(lastInboundAt?: number): number | undefined`
- Produces: `isAdminWindowOpen(lastInboundAt: number | undefined, now: number): boolean`
- Produces: `validateTemplateValues(definitions, values): { ok: true; ordered: string[] } | { ok: false; error: string }`
- Produces tables `adminChannels`, `adminTemplates`, `adminThreads`, `adminThreadMessages`, `adminProviderEvents`.

- [ ] **Step 1: Write failing pure-rule tests**

```ts
import { describe, expect, test } from "vitest";
import { adminWindowExpiresAt, isAdminWindowOpen, normalizeAdminRecipient, validateTemplateValues } from "./adminInboxModel";

describe("admin inbox rules", () => {
  test("normalizes Indonesian recipients", () => {
    expect(normalizeAdminRecipient("0857-1568-2110")).toBe("6285715682110");
  });
  test("closes the free-form window at exactly 24 hours", () => {
    const inbound = 1_000;
    expect(adminWindowExpiresAt(inbound)).toBe(inbound + 86_400_000);
    expect(isAdminWindowOpen(inbound, inbound + 86_399_999)).toBe(true);
    expect(isAdminWindowOpen(inbound, inbound + 86_400_000)).toBe(false);
  });
  test("orders required template values", () => {
    expect(validateTemplateValues(
      [{ key: "name", label: "Nama", required: true }, { key: "resi", label: "Resi", required: true }],
      { resi: "JX01", name: "Hasna" },
    )).toEqual({ ok: true, ordered: ["Hasna", "JX01"] });
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `rtk npm test -- convex/adminInboxModel.test.ts`

Expected: FAIL because `adminInboxModel.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers and schema tables**

Use `86_400_000` milliseconds for the window, reject normalized recipients shorter than 10 or longer than 15 digits, trim values, and return `Template <label> wajib diisi.` for empty required variables.

Add tenant-first indexes:

```ts
adminChannels: defineTable({
  orgId: v.id("organizations"), name: v.string(), provider: v.literal("kirimdev"),
  displayPhone: v.optional(v.string()), providerNumberId: v.optional(v.string()),
  isActive: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
}).index("by_org", ["orgId"]).index("by_org_active", ["orgId", "isActive"])
  .index("by_org_providerNumberId", ["orgId", "providerNumberId"]),

adminTemplates: defineTable({
  orgId: v.id("organizations"), channelId: v.id("adminChannels"), label: v.string(),
  templateName: v.string(), language: v.string(), category: v.literal("expedition"),
  variables: v.array(v.object({ key: v.string(), label: v.string(), required: v.boolean() })),
  isActive: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
}).index("by_org_channel", ["orgId", "channelId"])
  .index("by_org_channel_active", ["orgId", "channelId", "isActive"]),
```

Define `adminThreads` with `orgId`, `channelId`, `customerPhone`, optional `customerName`/`orderId`, optional `lastInboundAt`/`lastOutboundAt`, `archivedAt`, and timestamps. Define indexes `by_org_channel_customerPhone`, `by_org_channel_updatedAt`, and `by_org_orderId`.

Define `adminThreadMessages` with direction, `template|text`, content, optional template/provider IDs, `queued|accepted|delivered|read|failed`, optional failure/actor fields, and timestamps. Define indexes `by_org_thread_createdAt` and `by_org_providerMessageId`.

Define `adminProviderEvents` with `orgId`, `providerEventId`, `kind`, raw body, status, and timestamps. Index `by_org_providerEventId`.

- [ ] **Step 4: Run helpers, schema typecheck, and codegen**

Run: `rtk npm test -- convex/adminInboxModel.test.ts && rtk npx convex codegen && rtk npx tsc --noEmit`

Expected: all commands PASS.

- [ ] **Step 5: Commit the data foundation**

```bash
rtk git add convex/schema.ts convex/adminInboxModel.ts convex/adminInboxModel.test.ts convex/_generated
rtk git commit -m "feat: add admin expedition inbox data model"
```

---

### Task 2: Admin Channel and Template Configuration

**Files:**
- Create: `convex/adminInbox.ts`
- Create: `convex/adminInbox.test.ts`
- Create: `components/panel/admin-expedition-settings.tsx`
- Create: `components/panel/admin-expedition-settings.test.tsx`
- Modify: `components/panel/settings-dashboard.tsx`
- Modify: `components/panel/settings-dashboard.test.tsx`

**Interfaces:**
- Consumes: tables and template definitions from Task 1.
- Produces: `api.adminInbox.getSetup(): AdminInboxSetup`
- Produces: `api.adminInbox.upsertChannel({ name, displayPhone?, providerNumberId?, isActive })`
- Produces: `api.adminInbox.upsertTemplate({ channelId, templateId?, label, templateName, language, variables, isActive })`
- Produces: `api.adminInbox.removeTemplate({ templateId })`

- [ ] **Step 1: Write failing Convex authorization/configuration tests**

Test that admins can configure one channel, CS identities are rejected, a second active channel is rejected, duplicate active `providerNumberId` claims fail, template names must match `/^[a-z0-9_]+$/`, and templates must belong to the viewer's organization.

```ts
await expect(asCs.mutation(api.adminInbox.upsertChannel, {
  name: "Admin Ekspedisi", providerNumberId: "pn_admin", isActive: true,
})).rejects.toThrow(/requires admin/);
```

- [ ] **Step 2: Run tests to establish failure**

Run: `rtk npm test -- convex/adminInbox.test.ts`

Expected: FAIL because the public configuration functions do not exist.

- [ ] **Step 3: Implement configuration functions**

Every public handler begins with `requireAdminOrg(ctx, "adminInbox.<function>")`. `getSetup` returns `{ channel, templates, ready, missing }`, where `ready` requires active channel + provider number + at least one active template + `KIRIMDEV_API_KEY` availability exposed only as a boolean.

Keep exact provider template names server-side and return no secret values.

- [ ] **Step 4: Add the settings UI with readiness feedback**

Render a section named `WhatsApp Admin Ekspedisi` with channel phone, provider number ID, active switch, template rows, and variable editor. When incomplete, show the exact missing list and `Pengiriman belum aktif`; never show a generic failure.

- [ ] **Step 5: Run focused backend/UI tests**

Run: `rtk npm test -- convex/adminInbox.test.ts components/panel/admin-expedition-settings.test.tsx components/panel/settings-dashboard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit configuration**

```bash
rtk git add convex/adminInbox.ts convex/adminInbox.test.ts components/panel/admin-expedition-settings.tsx components/panel/admin-expedition-settings.test.tsx components/panel/settings-dashboard.tsx components/panel/settings-dashboard.test.tsx
rtk git commit -m "feat: configure admin expedition channel"
```

---

### Task 3: Paginated Admin Inbox Read Model

**Files:**
- Modify: `convex/adminInbox.ts`
- Modify: `convex/adminInbox.test.ts`

**Interfaces:**
- Produces: `api.adminInbox.listThreads({ channelId, paginationOpts, includeArchived? })`
- Produces: `api.adminInbox.listMessages({ threadId, limit? })`
- Produces: `api.adminInbox.archiveThread({ threadId, archived: boolean })`
- Produces: `internal.adminInbox.upsertInboundMessage(args)` for Task 5.

- [ ] **Step 1: Add failing isolation and pagination tests**

Seed two organizations, more threads than one page, and messages in both. Assert admin A sees only A, the cursor returns the next ordered page, message reads cap at 100, CS is rejected, and archive/unarchive remains tenant-scoped.

- [ ] **Step 2: Run the focused tests**

Run: `rtk npm test -- convex/adminInbox.test.ts`

Expected: FAIL on missing inbox functions.

- [ ] **Step 3: Implement index-backed reads and inbound upsert**

Use Convex `paginationOptsValidator` for thread lists and `by_org_thread_createdAt` with `.order("desc").take(Math.min(args.limit ?? 50, 100))` for messages. `upsertInboundMessage` deduplicates provider message ID, updates `lastInboundAt`, and never touches sales tables.

- [ ] **Step 4: Prove no sales writes occur**

Add a test that snapshots counts for `conversations`, `messages`, `dailyRollups`, and `shippingRecaps`, calls `upsertInboundMessage`, then asserts every count is unchanged.

- [ ] **Step 5: Run and commit**

Run: `rtk npm test -- convex/adminInbox.test.ts`

```bash
rtk git add convex/adminInbox.ts convex/adminInbox.test.ts
rtk git commit -m "feat: add paginated admin expedition threads"
```

---

### Task 4: Idempotent KirimDev Outbound Sending

**Files:**
- Create: `lib/kirimdev.ts`
- Create: `lib/kirimdev.test.ts`
- Create: `app/api/admin-inbox/send-template/route.ts`
- Create: `app/api/admin-inbox/send-text/route.ts`
- Create: `app/api/admin-inbox/routes.test.ts`
- Modify: `convex/adminInbox.ts`
- Modify: `convex/adminInbox.test.ts`

**Interfaces:**
- Produces: `buildTemplatePayload(to, templateName, language, orderedValues)`
- Produces: `buildTextPayload(to, text)`
- Produces: `sendKirimDevMessage({ phoneNumberId, payload, idempotencyKey })`
- Produces: `api.adminInbox.sendTemplate({ authSecret, orgId, actorUserId, actorName, channelId, customerPhone, customerName?, orderId?, templateId, values, clientRequestId })`
- Produces: `api.adminInbox.sendText({ authSecret, orgId, actorUserId, actorName, threadId, text, clientRequestId })`

- [ ] **Step 1: Write failing provider contract tests**

Assert the template payload uses positional body parameters, text payload uses `{ messaging_product: "whatsapp", type: "text" }`, authorization is bearer-based, and provider codes map to the existing Indonesian messages used by Follow-up.

- [ ] **Step 2: Write failing route and action tests**

Cover missing session, CS session, malformed phone/text, unallowlisted template, unconfigured channel, expired free-form window, successful acceptance, provider rejection, provider timeout (`status unknown`), and duplicate `clientRequestId` returning the original message.

- [ ] **Step 3: Run tests and verify failure**

Run: `rtk npm test -- lib/kirimdev.test.ts app/api/admin-inbox/routes.test.ts convex/adminInbox.test.ts`

- [ ] **Step 4: Implement the provider client and server routes**

Routes verify `auth_token` with `verifySession`, require `session.role === "admin"`, and pass the signed session's org/user/name to Convex. They never expose `PANEL_AUTH_SECRET` or `KIRIMDEV_API_KEY`.

Use idempotency keys:

```ts
`admin-template-${orgId}-${clientRequestId}`
`admin-text-${orgId}-${clientRequestId}`
```

The Convex action revalidates configuration and window state immediately before fetch. Stamp the outbound message only once and store the returned provider message ID.

- [ ] **Step 5: Run tests and typecheck**

Run: `rtk npm test -- lib/kirimdev.test.ts app/api/admin-inbox/routes.test.ts convex/adminInbox.test.ts && rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit outbound sending**

```bash
rtk git add lib/kirimdev.ts lib/kirimdev.test.ts app/api/admin-inbox convex/adminInbox.ts convex/adminInbox.test.ts
rtk git commit -m "feat: send admin expedition messages"
```

---

### Task 5: Capture-First Inbound and Delivery-Status Routing

**Files:**
- Modify: `convex/ingest/kirimdevAdapter.ts`
- Modify: `convex/ingest/kirimdevAdapter.test.ts`
- Modify: `convex/adminInbox.ts`
- Modify: `convex/adminInbox.test.ts`
- Modify: `convex/http.ts`

**Interfaces:**
- Consumes: `internal.adminInbox.upsertInboundMessage` from Task 3.
- Produces: `internal.adminInbox.resolveAdminChannel({ orgId, providerNumberId })`
- Produces: `internal.adminInbox.processCapturedProviderEvent({ ingestEventId })`
- Produces: `{ handled: true } | { handled: false }` routing result used by `convex/http.ts`.

- [ ] **Step 1: Add failing adapter fixtures**

Cover KirimDev `message.received`, outbound/status events, `phone_number_id`, customer phone, provider message ID, text content, event timestamp, and delivery statuses `accepted`, `delivered`, `read`, `failed`.

- [ ] **Step 2: Add failing routing tests**

Prove:

- configured admin `phone_number_id` routes to admin storage;
- normal CS IDs continue to `ingest.core.processEvent`;
- unknown admin-like IDs are captured then skipped/quarantined;
- duplicate event IDs and provider message IDs are no-ops;
- an admin inbound never creates a sales message, lifecycle update, AI response, or follow-up candidate.

- [ ] **Step 3: Run tests to verify failure**

Run: `rtk npm test -- convex/ingest/kirimdevAdapter.test.ts convex/adminInbox.test.ts`

- [ ] **Step 4: Implement routing after existing capture**

Keep `/webhooks/kirimdev` signature verification and `ingestEvents.captureEvent` unchanged. After capture, call the admin router first. Only call `internal.ingest.core.processEvent` when the router returns `{ handled: false }`. Continue returning HTTP 200 after capture even when processing fails.

Status callbacks update messages through `by_org_providerMessageId`. Inbound callbacks upsert thread/message through unique provider identifiers and update the 24-hour window.

- [ ] **Step 5: Run tests and Convex codegen**

Run: `rtk npm test -- convex/ingest/kirimdevAdapter.test.ts convex/adminInbox.test.ts && rtk npx convex codegen && rtk npx tsc --noEmit`

- [ ] **Step 6: Commit webhook routing**

```bash
rtk git add convex/http.ts convex/ingest/kirimdevAdapter.ts convex/ingest/kirimdevAdapter.test.ts convex/adminInbox.ts convex/adminInbox.test.ts convex/_generated
rtk git commit -m "feat: route admin expedition webhooks"
```

---

### Task 6: Responsive Admin Expedition Inbox UI

**Files:**
- Create: `app/panel/follow-up/ekspedisi/page.tsx`
- Create: `components/panel/admin-expedition-inbox.tsx`
- Create: `components/panel/admin-expedition-inbox.test.tsx`

**Interfaces:**
- Consumes: configuration/read APIs from Tasks 2–3 and send routes from Task 4.
- Produces: admin page at `/panel/follow-up/ekspedisi`.

- [ ] **Step 1: Write failing static/UI behavior tests**

Assert:

- unconfigured state names the missing provider number;
- empty inbox offers `Hubungi customer`;
- start dialog has labelled phone, name, order ID, template, variables, preview, and confirm controls;
- open/expired window states show the correct composer;
- loading, empty, failure, retry, sending, accepted, and failed states have accessible status feedback;
- mobile controls have at least 44px targets and a back action;
- no AI, CS assignment, auto-follow-up, or bulk-send controls exist.

- [ ] **Step 2: Run the UI test to establish failure**

Run: `rtk npm test -- components/panel/admin-expedition-inbox.test.tsx`

- [ ] **Step 3: Build the responsive shell**

Desktop: 360px thread pane + flexible conversation pane. Mobile: list or conversation, never both. Fetch the first thread page only when the page opens; fetch/subscribe to at most 50 recent messages for the selected thread.

- [ ] **Step 4: Build start/template and composer interactions**

Generate `clientRequestId` once per user send attempt with `crypto.randomUUID()`. Preserve it across retries until a definitive provider result prevents duplicate sends. Render provider errors next to the affected message and keep retry explicit.

- [ ] **Step 5: Run UI tests and production build**

Run: `rtk npm test -- components/panel/admin-expedition-inbox.test.tsx && rtk npm run build`

- [ ] **Step 6: Commit inbox UI**

```bash
rtk git add app/panel/follow-up/ekspedisi/page.tsx components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx
rtk git commit -m "feat: add admin expedition inbox UI"
```

---

### Task 7: Exact-Order Cancellation, Audit, and Undo

**Files:**
- Modify: `convex/shippingRecaps.ts`
- Modify: `convex/shippingRecaps.test.ts`
- Modify: `convex/adminInbox.ts`
- Modify: `convex/adminInbox.test.ts`
- Modify: `components/panel/admin-expedition-inbox.tsx`
- Modify: `components/panel/admin-expedition-inbox.test.tsx`

**Interfaces:**
- Produces: `cancelRecapByExactOrderCore(ctx, { orgId, orderIdBerdu, reason, actor })`
- Produces: `api.adminInbox.cancelLinkedOrder({ threadId, reason })`
- Produces: `api.adminInbox.undoLinkedOrderCancellation({ threadId })`

- [ ] **Step 1: Add failing exact-target tests**

Create two orders sharing one phone. Link the thread to the older order and assert cancellation changes only that order. Assert missing order ID, empty reason, cross-tenant order, already-cancelled duplicate, CS identity, and ambiguous phone-only requests fail safely.

Assert the event metadata contains `{ source: "admin_expedition_inbox", actorUserId, actorName, reason }` and undo records a second audit event.

- [ ] **Step 2: Run cancellation tests to verify failure**

Run: `rtk npm test -- convex/shippingRecaps.test.ts convex/adminInbox.test.ts`

- [ ] **Step 3: Extract and use an exact-order cancellation core**

Preserve existing status behavior: `exported|delivered` becomes `cancelled_after_export`; other eligible rows become `cancelled`. Recompute the same affected rollup pair once. Do not call `markLatestCancelledByPhone` from the admin inbox.

- [ ] **Step 4: Add the confirmation UI**

Display the exact order/customer, require a reason, label the destructive button `Batalkan order <ID>`, announce success/failure, and expose `Batalkan pembatalan` only when undo is valid.

- [ ] **Step 5: Run backend/UI tests**

Run: `rtk npm test -- convex/shippingRecaps.test.ts convex/adminInbox.test.ts components/panel/admin-expedition-inbox.test.tsx`

- [ ] **Step 6: Commit safe cancellation**

```bash
rtk git add convex/shippingRecaps.ts convex/shippingRecaps.test.ts convex/adminInbox.ts convex/adminInbox.test.ts components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx
rtk git commit -m "feat: cancel exact orders from admin inbox"
```

---

### Task 8: Role Guard, Navigation, and Final Consistency

**Files:**
- Modify: `app/panel/layout.tsx`
- Modify: `app/panel/layout.test.tsx`
- Modify: `lib/auth-jwt.ts`
- Modify: `app/ConvexClientProvider.test.tsx`
- Modify: `components/panel/admin-expedition-inbox.tsx`
- Modify: `components/panel/admin-expedition-inbox.test.tsx`

**Interfaces:**
- Consumes: `/panel/follow-up/ekspedisi` page from Task 6.
- Produces: role-safe navigation and consistent accessible UI states.

- [ ] **Step 1: Write failing route and navigation tests**

Assert admins see `Ekspedisi`, CS users do not, and `routeGuard("/panel/follow-up/ekspedisi", csSession)` redirects to `/panel/follow-up` while admin sessions pass.

- [ ] **Step 2: Implement the explicit route deny rule**

Place the expedition-route check before the general CS Follow-up allowance:

```ts
if (session.role === "cs" && pathname.startsWith("/panel/follow-up/ekspedisi")) {
  return { redirect: "/panel/follow-up" };
}
```

Server/Convex authorization remains authoritative; hiding navigation is only UX.

- [ ] **Step 3: Complete consistency and accessibility states**

Use existing WafaChat tokens for spacing, borders, focus rings, destructive colors, typography, and mobile safe-area padding. Verify keyboard navigation, visible focus, labelled controls, `aria-live` send feedback, 44px mobile targets, and non-color-only message status.

- [ ] **Step 4: Run the complete local gate**

Run: `rtk npm test && rtk npx tsc --noEmit && rtk npx convex codegen && rtk npm run build`

Expected: all tests, typecheck, codegen, and production build PASS.

- [ ] **Step 5: Commit consistency changes**

```bash
rtk git add app/panel/layout.tsx app/panel/layout.test.tsx lib/auth-jwt.ts app/ConvexClientProvider.test.tsx components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx convex/_generated
rtk git commit -m "fix: harden admin expedition inbox access"
```

---

### Task 9: KirimDev Rollout, Smoke Test, and Documentation

**Files:**
- Create: `docs/runbooks/admin-expedition-inbox.md`
- Modify: `automations/n8n/README.md` only if the live callback still traverses n8n.

**Interfaces:**
- Consumes: completed application and the real KirimDev admin number/template configuration.
- Produces: repeatable production setup, verification evidence, and rollback procedure.

- [ ] **Step 1: Write the runbook before touching production**

Document exact sequence:

1. Register the admin WhatsApp number in KirimDev.
2. Record its display phone and `phone_number_id` in WafaChat Settings.
3. Point KirimDev message/status callbacks to the existing signed `/webhooks/kirimdev?source=kirimdev-pustakaislam` endpoint unless KirimDev requires a separate source.
4. Add the exact approved expedition template name, language, and ordered variables through Settings.
5. Confirm readiness becomes active without exposing credentials.
6. Send one template to `6285715682110`, reply from that number, send one free-form response, and verify accepted/delivered/read states.
7. Verify the test thread is absent from sales conversations, Follow-up candidates, response-time metrics, Dashboard, Performance, Reports, and Queen Recap.
8. Link a dedicated test order, cancel it, verify the exact order changed, then undo.

Rollback: deactivate the admin channel in Settings. This blocks new sends and routing without deleting threads or changing sales workflows.

- [ ] **Step 2: Run pre-deploy verification**

Run: `rtk git status --short && rtk npm test && rtk npx tsc --noEmit && rtk npx convex codegen && rtk npm run build`

Expected: clean intended diff and all gates PASS.

- [ ] **Step 3: Deploy backend before frontend**

Run: `rtk npx convex deploy`

Expected: schema/functions deploy successfully; the inactive/unconfigured channel changes no production traffic.

- [ ] **Step 4: Deploy frontend and verify production health**

Run the repository's established Vercel deployment command, then verify `/panel/follow-up/ekspedisi` as admin and confirm it shows the disabled setup state before provider configuration.

- [ ] **Step 5: Configure KirimDev and execute the smoke test**

Follow the runbook using the approved template and owner test number. Save timestamps, provider message IDs, Convex event IDs, and screenshots of send/reply/status/isolation checks in the deployment notes.

- [ ] **Step 6: Commit the final runbook**

```bash
rtk git add docs/runbooks/admin-expedition-inbox.md automations/n8n/README.md
rtk git commit -m "docs: add admin expedition inbox runbook"
```

---

## Final Acceptance Gate

- [ ] One admin channel can be configured but remains safely disabled without KirimDev details.
- [ ] Only allowlisted expedition templates can start conversations.
- [ ] Customer inbound replies appear only in the admin expedition inbox.
- [ ] Free-form text succeeds before and fails at/after the exact 24-hour boundary.
- [ ] Duplicate clicks/webhooks do not duplicate messages.
- [ ] Cancel targets an exact linked order, records actor/reason, and supports undo.
- [ ] CS, AI, Follow-up, Dashboard, Performance, Reports, Queen, and response-time data remain unchanged.
- [ ] Desktop/mobile loading, empty, disabled, success, failure, retry, and expired-window states are clear and accessible.
- [ ] Full test, TypeScript, Convex codegen, and production build gates pass.
