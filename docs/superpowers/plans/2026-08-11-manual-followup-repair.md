# Manual Follow-up Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken derive-on-read and auto-send Follow-up with a tenant-safe, indexed, manual H+1/H+2/H+3 queue using approved KirimDev templates and atomic send reservation.

**Architecture:** Materialize each conversation's next Follow-up stage and due time on the conversation row, then query the queue exclusively through compound indexes and cursor pagination. Keep pure state transitions in a small model module, persist approved templates per organization, and send through a reserve → provider action → finalize workflow. All public reads and writes use signed Convex identity and verified organization/CS scope.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Convex, convex-test, Vitest, KirimDev REST API, existing shadcn-style UI primitives.

## Global Constraints

- Follow-up is manual only; remove the auto cron and every Auto toggle.
- Stages are H+1, H+2, and final H+3, each separated by at least 24 hours after the preceding accepted send.
- A new inbound, closing, cancellation, done marker, manual archive, or five-day expiry removes the item from the actionable queue.
- Exact approved template name, language, and variable order are organization configuration, never source-code placeholders.
- Do not modify `automations/n8n/workflows/order-trigger-v2-kirimdev.json` or any automatic order-notification path.
- New schema fields must be optional for existing production rows.
- Every Convex function added or changed has `args` and `returns` validators.
- No unbounded `.collect()`, database `.filter()`, or `Date.now()` inside queue queries.
- Each behavior change follows RED → GREEN → refactor before the next behavior.

---

## File Structure

- Create `convex/followUpModel.ts`: pure stage/state transition functions.
- Create `convex/followUpModel.test.ts`: deterministic transition and timing tests.
- Create `convex/followUpTemplates.ts`: admin configuration and member readiness query.
- Create `convex/followUpTemplates.test.ts`: template validation, auth, and tenant tests.
- Create `convex/followUpMigration.ts`: resumable recent-conversation materialization.
- Modify `convex/schema.ts`: optional queue fields, due indexes, and template table.
- Rewrite focused parts of `convex/followUp.ts`: indexed queue, reservation, send, finalization, archive, closing, and KPI functions.
- Modify `convex/followUp.test.ts`: volume, pagination, auth, idempotency, and provider tests.
- Modify `convex/messages.ts`: scoped chat-history read and queue synchronization on inbound/outbound.
- Modify `convex/messages.test.ts`: ownership and queue synchronization tests.
- Modify `convex/shippingRecaps.ts` and tests: clear due Follow-up state on closing/cancellation.
- Modify `convex/crons.ts`: remove automatic Follow-up sweep.
- Delete `convex/autoFollowUp.ts` and `convex/autoFollowUp.test.ts` after replacement tests pass.
- Modify `app/api/follow-up/snapshot/route.ts`, `send/route.ts`, and tests: signed identity, pagination, request IDs.
- Delete `app/api/follow-up/auto-toggle/route.ts` and `set-stage/route.ts`.
- Modify `components/panel/follow-up-dashboard.tsx` and tests: manual queue, H+3 final, no Auto/override.
- Create `components/panel/follow-up-template-settings.tsx` and test.
- Modify `components/panel/settings-dashboard.tsx`: owner template configuration section.
- Create `docs/runbooks/manual-followup.md`: configuration, UAT, failure, rollback.
- Create `convex/followUpRemoval.test.ts`: source-level guard preventing auto-send and override paths from returning.

---

### Task 1: Pure Three-Stage State Machine

**Files:**
- Create: `convex/followUpModel.ts`
- Create: `convex/followUpModel.test.ts`
- Modify: `convex/followUpMath.ts`
- Modify: `convex/followUpMath.test.ts`

**Interfaces:**
- Produces: `FOLLOW_UP_DAY_MS`, `FOLLOW_UP_EXPIRY_MS`, `FollowUpStage`, `FollowUpState`, `resetForInbound`, `armH1AfterOutbound`, `advanceAfterAccepted`, `terminateFollowUp`.
- Consumes: timestamps and current materialized state only; no Convex context.

- [ ] **Step 1: Write failing transition tests**

```ts
test("accepted stages advance only after a fresh 24-hour delay", () => {
  expect(advanceAfterAccepted(1, 1_000)).toMatchObject({ nextStage: 2, dueAt: 1_000 + FOLLOW_UP_DAY_MS });
  expect(advanceAfterAccepted(2, 2_000)).toMatchObject({ nextStage: 3, dueAt: 2_000 + FOLLOW_UP_DAY_MS });
  expect(advanceAfterAccepted(3, 3_000)).toMatchObject({ state: "complete", nextStage: null, dueAt: null });
});

test("new inbound resets the prior cycle", () => {
  expect(resetForInbound(5_000)).toEqual({
    cycleInboundAt: 5_000,
    nextStage: null,
    dueAt: null,
    state: null,
  });
});
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/followUpModel.test.ts --exclude ".worktrees/**"`  
Expected: FAIL because the model exports do not exist.

- [ ] **Step 3: Implement the minimal pure model**

```ts
export type FollowUpStage = 1 | 2 | 3;
export type FollowUpState = "waiting" | "sending" | "unknown" | "failed" | "complete" | "archived";
export const FOLLOW_UP_DAY_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_EXPIRY_MS = 5 * FOLLOW_UP_DAY_MS;

export function advanceAfterAccepted(stage: FollowUpStage, acceptedAt: number) {
  if (stage === 3) return { state: "complete" as const, nextStage: null, dueAt: null };
  return { state: "waiting" as const, nextStage: (stage + 1) as 2 | 3, dueAt: acceptedAt + FOLLOW_UP_DAY_MS };
}
```

- [ ] **Step 4: Remove H+1/H+2/H+3 placeholder templates from `FOLLOWUP_STAGES`**

Keep legacy exports only when tests or callers still require them during this task. The pure model must not contain provider template names.

- [ ] **Step 5: Run GREEN and existing math tests**

Run: `rtk npx vitest run convex/followUpModel.test.ts convex/followUpMath.test.ts --exclude ".worktrees/**"`  
Expected: PASS, including late-H+1 and late-H+2 timing regressions.

- [ ] **Step 6: Commit**

```bash
rtk git add convex/followUpModel.ts convex/followUpModel.test.ts convex/followUpMath.ts convex/followUpMath.test.ts
rtk git commit -m "feat: define manual follow-up state machine"
```

---

### Task 2: Additive Queue and Template Schema

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/followUpTemplates.ts`
- Create: `convex/followUpTemplates.test.ts`

**Interfaces:**
- Produces table `followUpTemplates` and indexes `by_org_stage`, `by_org_active_stage`.
- Produces public `getFollowUpTemplateSetup` and admin mutations `upsertFollowUpTemplate`, `removeFollowUpTemplate`.

- [ ] **Step 1: Write failing template configuration tests**

```ts
test("admin configures one active template for each stage", async () => {
  await asAdmin.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
    stage: 1,
    label: "Follow-up H+1",
    templateName: "approved_followup_h1",
    language: "id",
    variables: ["customer_name", "product_name", "order_id"],
  });
  const setup = await asAdmin.query(api.followUpTemplates.getFollowUpTemplateSetup, {});
  expect(setup.templates[0].templateName).toBe("approved_followup_h1");
});

test("CS cannot change follow-up templates", async () => {
  await expect(asCs.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
    stage: 1,
    label: "Follow-up H+1",
    templateName: "approved_followup_h1",
    language: "id",
    variables: ["customer_name", "product_name", "order_id"],
  })).rejects.toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/followUpTemplates.test.ts --exclude ".worktrees/**"`  
Expected: FAIL because the table and functions do not exist.

- [ ] **Step 3: Add optional conversation fields and indexes**

```ts
followUpCsKey: v.optional(v.string()),
followUpCycleInboundAt: v.optional(v.number()),
followUpNextStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
followUpDueAt: v.optional(v.number()),
followUpState: v.optional(v.union(
  v.literal("waiting"), v.literal("sending"), v.literal("unknown"),
  v.literal("failed"), v.literal("complete"), v.literal("archived"),
)),
followUpRequestId: v.optional(v.string()),
followUpProviderMessageId: v.optional(v.string()),
followUpLastError: v.optional(v.string()),
```

Add four indexes so stage-specific and all-stage reads never filter after `.take()`:

```ts
.index("by_org_followUpState_dueAt", ["orgId", "followUpState", "followUpDueAt"])
.index("by_org_followUpStage_state_dueAt", ["orgId", "followUpNextStage", "followUpState", "followUpDueAt"])
.index("by_org_followUpCsKey_state_dueAt", ["orgId", "followUpCsKey", "followUpState", "followUpDueAt"])
.index("by_org_followUpCsKey_stage_state_dueAt", ["orgId", "followUpCsKey", "followUpNextStage", "followUpState", "followUpDueAt"])
```

Add the organization-scoped template table:

```ts
followUpTemplates: defineTable({
  orgId: v.id("organizations"),
  stage: v.union(v.literal(1), v.literal(2), v.literal(3)),
  label: v.string(),
  templateName: v.string(),
  language: v.string(),
  variables: v.array(v.union(
    v.literal("customer_name"),
    v.literal("product_name"),
    v.literal("order_id"),
  )),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org_stage", ["orgId", "stage"])
  .index("by_org_active_stage", ["orgId", "isActive", "stage"]),
```

- [ ] **Step 4: Add bounded template validators and admin functions**

Accept only stages 1/2/3 and variable literals `customer_name`, `product_name`, `order_id`; reject duplicates and more than three variables. Add explicit return validators to every function.

- [ ] **Step 5: Run GREEN and Convex codegen**

Run: `rtk npx vitest run convex/followUpTemplates.test.ts --exclude ".worktrees/**"`  
Run: `rtk npx convex codegen`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add convex/schema.ts convex/followUpTemplates.ts convex/followUpTemplates.test.ts convex/_generated/api.d.ts
rtk git commit -m "feat: configure approved follow-up templates"
```

---

### Task 3: Indexed and Paginated Due Queue

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Create: `convex/followUpMigration.ts`

**Interfaces:**
- Produces `listDueFollowUps({ stage?, now, paginationOpts })`.
- Produces resumable `startRecentFollowUpBackfill({})` and internal page worker.
- Removes the derive-on-read `followUpCandidatesHandler` from the live read path.

- [ ] **Step 1: Write a failing volume regression**

Seed 150 due conversations for one organization and assert two cursor pages return all unique rows without Server Error:

```ts
const first = await asAdmin.query(api.followUp.listDueFollowUps, {
  now,
  paginationOpts: { numItems: 100, cursor: null },
});
const second = await asAdmin.query(api.followUp.listDueFollowUps, {
  now,
  paginationOpts: { numItems: 100, cursor: first.continueCursor },
});
expect(new Set([...first.page, ...second.page].map((row) => String(row.conversationId))).size).toBe(150);
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/followUp.test.ts -t "150 due conversations" --exclude ".worktrees/**"`  
Expected: FAIL because the paginated indexed query is absent.

- [ ] **Step 3: Implement index selection without post-limit filtering**

Use `paginationOptsValidator`, explicit `now`, and a five-day lower bound on `followUpDueAt`. Select one of the four indexes based on verified CS scope and optional stage. Return only safe card fields plus pagination metadata.

- [ ] **Step 4: Write RED tests for scoped CS and cross-organization pagination**

Assert CS A never sees CS B or another organization's rows even when the client supplies another stage/cursor.

- [ ] **Step 5: Implement resumable recent backfill**

Process at most 25 recent active/handover conversations per mutation page. For each row, derive latest inbound, latest message direction, existing post-window template touches, closing state, and then patch the complete materialized state atomically. Schedule the next cursor with `ctx.scheduler.runAfter(0, internal.followUpMigration.backfillPage, ...)`.

- [ ] **Step 6: Run GREEN**

Run: `rtk npx vitest run convex/followUp.test.ts --exclude ".worktrees/**"`  
Expected: PASS with more than 100 rows and bounded read assertions.

- [ ] **Step 7: Commit**

```bash
rtk git add convex/followUp.ts convex/followUp.test.ts convex/followUpMigration.ts
rtk git commit -m "fix: replace follow-up scans with indexed queue"
```

---

### Task 4: Keep Queue State Correct on Messages and Closings

**Files:**
- Modify: `convex/messages.ts`
- Modify: `convex/messages.test.ts`
- Modify: `convex/shippingRecaps.ts`
- Modify: `convex/shippingRecaps.test.ts`
- Modify: `convex/conversationLifecycle.ts`
- Modify: `convex/conversationLifecycle.test.ts`

**Interfaces:**
- Consumes pure transition helpers from `followUpModel.ts`.
- Produces consistent materialized state on every inbound, outbound, closing, cancellation, done marker, archive, and stale lifecycle transition.

- [ ] **Step 1: Write failing message transition tests**

```ts
test("new inbound clears an old due stage", async () => {
  const after = resetForInbound(5_000);
  expect(after).toMatchObject({ cycleInboundAt: 5_000, nextStage: null, dueAt: null, state: null });
});

test("CS outbound after a new inbound arms H+1 at inbound plus 24 hours", async () => {
  const after = armH1AfterOutbound(5_000, "aisyah");
  expect(after).toMatchObject({ csKey: "aisyah", nextStage: 1, dueAt: 5_000 + FOLLOW_UP_DAY_MS, state: "waiting" });
});
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/messages.test.ts --exclude ".worktrees/**"`.

- [ ] **Step 3: Update the shared ingestion path**

After the message and conversation are resolved, apply one complete patch derived from direction, timestamp, CS key, and done-marker result. Never arm H+1 for system/order-notification traffic; restrict arming to real CS outbound messages associated with a prior inbound.

- [ ] **Step 4: Write and run RED closing tests**

Assert recap closing, cancellation, done marker, and stale lifecycle close remove `followUpNextStage`/`followUpDueAt` and set a non-actionable state.

- [ ] **Step 5: Implement closing cleanup at central transition points**

Do not duplicate cleanup across UI callers; patch it where shipping recap or lifecycle status becomes terminal.

- [ ] **Step 6: Run GREEN**

Run: `rtk npx vitest run convex/messages.test.ts convex/shippingRecaps.test.ts convex/conversationLifecycle.test.ts --exclude ".worktrees/**"`.

- [ ] **Step 7: Commit**

```bash
rtk git add convex/messages.ts convex/messages.test.ts convex/shippingRecaps.ts convex/shippingRecaps.test.ts convex/conversationLifecycle.ts convex/conversationLifecycle.test.ts
rtk git commit -m "fix: synchronize follow-up due state"
```

---

### Task 5: Close Follow-up Auth and Tenant Gaps

**Files:**
- Modify: `convex/messages.ts`
- Modify: `convex/messages.test.ts`
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `app/api/follow-up/snapshot/route.ts`
- Modify: `app/api/follow-up/counts/route.ts`
- Create or modify: route tests under `app/api/follow-up/**`

**Interfaces:**
- Produces scoped `messages.listMessages` and signed one-shot queue routes.
- Removes client authority over organization and another CS's scope.

- [ ] **Step 1: Write failing anonymous and cross-CS message-history tests**

```ts
await expect(t.query(api.messages.listMessages, { conversationId, limit: 50 })).rejects.toThrow();
await expect(asCsA.query(api.messages.listMessages, { conversationId: csBConversation, limit: 50 })).rejects.toThrow();
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/messages.test.ts -t "message history" --exclude ".worktrees/**"`.

- [ ] **Step 3: Guard the conversation document before reading messages**

Load the conversation, require member organization, compare `conversation.orgId`, and for a CS compare verified `csKey` with `assignedCsName`. Only then execute the bounded message index query.

- [ ] **Step 4: Write failing route identity tests**

Assert snapshot/counts pass explicit `now`, force the verified CS scope, and call `convex.setAuth(signConvexToken(session))`. Assert send/archive/unarchive reject unauthorized roles or cross-CS targets through Convex.

- [ ] **Step 5: Remove secret-only authority from Follow-up public operations**

The route must not pass `PANEL_AUTH_SECRET`. Public Convex functions derive organization/role/CS from the signed identity and verify the target conversation.

- [ ] **Step 6: Run GREEN**

Run: `rtk npx vitest run convex/messages.test.ts convex/followUp.test.ts app/api/follow-up --exclude ".worktrees/**"`.

- [ ] **Step 7: Commit**

```bash
rtk git add convex/messages.ts convex/messages.test.ts convex/followUp.ts convex/followUp.test.ts app/api/follow-up
rtk git commit -m "fix: scope follow-up access by tenant and CS"
```

---

### Task 6: Atomic Manual Send and Provider Outcomes

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `lib/kirimdev.ts`
- Modify: `lib/kirimdev.test.ts`
- Modify: `app/api/follow-up/send/route.ts`
- Create: `app/api/follow-up/send/route.test.ts`

**Interfaces:**
- Produces `sendDueFollowUp({ conversationId, stage, requestId })`.
- Internal reservation returns a complete immutable provider payload or a prior result.
- Finalization records `accepted`, `failed`, or `unknown` once.

- [ ] **Step 1: Write failing reservation/idempotency tests**

```ts
test("concurrent retries reserve one provider send", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const first = await reserve(requestId);
  const duplicate = await reserve(requestId);
  expect(first.shouldSend).toBe(true);
  expect(duplicate.shouldSend).toBe(false);
});

test("provider timeout becomes unknown and cannot start a new attempt", async () => {
  const first = await sendWithTimeout("11111111-1111-4111-8111-111111111111");
  expect(first).toMatchObject({ ok: false, status: "unknown" });
  const retry = await reserve("22222222-2222-4222-8222-222222222222");
  expect(retry).toMatchObject({ shouldSend: false, status: "unknown" });
});
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run convex/followUp.test.ts -t "provider|reserve|unknown" --exclude ".worktrees/**"`.

- [ ] **Step 3: Implement atomic reservation**

Verify exact due stage, due timestamp, open conversation, no recap, configured template, CS ownership, and no active/unknown request in one mutation. Build ordered variables from the configured enum mapping.

- [ ] **Step 4: Reuse the hardened KirimDev request helper**

Use a 15-second timeout, Bearer token, `Idempotency-Key`, flexible provider message-ID parsing, and Indonesian error mapping. The key is `fu-{conversationId}-{cycleInboundAt}-{stage}-{requestId}`.

- [ ] **Step 5: Implement finalization**

On accepted H+1/H+2, advance by exactly 24 hours; on accepted H+3, complete. Insert one outbound template message with `externalMessageId`. Definite failure becomes `failed`; timeout/no ID becomes `unknown` and remains blocked.

- [ ] **Step 6: Run GREEN**

Run: `rtk npx vitest run convex/followUp.test.ts lib/kirimdev.test.ts app/api/follow-up/send/route.test.ts --exclude ".worktrees/**"`.

- [ ] **Step 7: Commit**

```bash
rtk git add convex/followUp.ts convex/followUp.test.ts lib/kirimdev.ts lib/kirimdev.test.ts app/api/follow-up/send
rtk git commit -m "feat: send manual follow-ups idempotently"
```

---

### Task 7: Lean Manual Follow-up and Template Settings UI

**Files:**
- Modify: `components/panel/follow-up-dashboard.tsx`
- Modify: `components/panel/follow-up-dashboard.test.tsx`
- Create: `components/panel/follow-up-template-settings.tsx`
- Create: `components/panel/follow-up-template-settings.test.tsx`
- Modify: `components/panel/settings-dashboard.tsx`
- Modify: `components/panel/settings-dashboard.test.tsx`

**Interfaces:**
- Consumes paginated snapshot, template readiness, and `sendDueFollowUp` route.
- Produces owner configuration and manual H+1/H+2/H+3 workspace.

- [ ] **Step 1: Write failing UI removal and H+3 tests**

```ts
expect(html).not.toContain("Auto-send");
expect(html).not.toContain("Pindah:");
expect(html).toContain("H+3 · Follow-up terakhir");
```

- [ ] **Step 2: Run RED**

Run: `rtk npx vitest run components/panel/follow-up-dashboard.test.tsx --exclude ".worktrees/**"`.

- [ ] **Step 3: Replace candidate rendering with due-stage cards**

The stage comes from the server and is not user-selectable. Preserve search, CS filter for admins, Closing, Arsip, selected chat, manual refresh, and Load More. Generate one UUID per send attempt and retain it while status is unknown.

- [ ] **Step 4: Write failing settings readiness tests**

Assert only admin sees template controls, all three stages are required, variables keep positional order, and incomplete setup disables sending with a direct Settings link.

- [ ] **Step 5: Implement template settings with existing UI primitives**

Use `Card`, `Button`, labelled inputs/selects, minimum 44px targets, explicit saving/error feedback, and responsive layout. Do not display API keys or App Secrets.

- [ ] **Step 6: Run GREEN**

Run: `rtk npx vitest run components/panel/follow-up-dashboard.test.tsx components/panel/follow-up-template-settings.test.tsx components/panel/settings-dashboard.test.tsx --exclude ".worktrees/**"`.

- [ ] **Step 7: Commit**

```bash
rtk git add components/panel/follow-up-dashboard.tsx components/panel/follow-up-dashboard.test.tsx components/panel/follow-up-template-settings.tsx components/panel/follow-up-template-settings.test.tsx components/panel/settings-dashboard.tsx components/panel/settings-dashboard.test.tsx
rtk git commit -m "feat: simplify manual follow-up workspace"
```

---

### Task 8: Remove Auto Follow-up and Legacy Override Surface

**Files:**
- Modify: `convex/crons.ts`
- Create: `convex/followUpRemoval.test.ts`
- Delete: `convex/autoFollowUp.ts`
- Delete: `convex/autoFollowUp.test.ts`
- Delete: `app/api/follow-up/auto-toggle/route.ts`
- Delete: `app/api/follow-up/set-stage/route.ts`
- Modify: `convex/cs.ts`
- Modify: `convex/csConfigs.ts`
- Modify: `components/panel/settings-dashboard.tsx`
- Modify relevant tests.

**Interfaces:**
- Removes all executable auto-send and manual stage-override paths.
- Preserves stored legacy optional fields until a later cleanup migration.

- [ ] **Step 1: Write a failing source-level regression**

```ts
test("automatic and override follow-up surfaces are absent", () => {
  const cron = readFileSync(resolve("convex/crons.ts"), "utf8");
  const dashboard = readFileSync(resolve("components/panel/follow-up-dashboard.tsx"), "utf8");
  const settings = readFileSync(resolve("components/panel/settings-dashboard.tsx"), "utf8");
  expect(cron).not.toContain("autoFollowUpSweep");
  expect(dashboard).not.toContain("/api/follow-up/auto-toggle");
  expect(dashboard).not.toContain("/api/follow-up/set-stage");
  expect(settings).not.toContain("autoFollowUpEnabled");
});
```

- [ ] **Step 2: Run RED**

Run the focused cron/layout/settings tests and confirm the legacy strings are still present.

- [ ] **Step 3: Remove the cron, endpoints, flags, and UI controls**

Do not delete the n8n workflow or order automation flags. Keep schema compatibility for historical `autoFollowUpEnabled` until a separate data cleanup is explicitly approved.

- [ ] **Step 4: Verify the n8n workflow is byte-for-byte untouched**

Run: `rtk git diff --exit-code -- automations/n8n/workflows/order-trigger-v2-kirimdev.json`  
Expected: no diff.

- [ ] **Step 5: Run GREEN**

Run: `rtk npx vitest run convex components/panel app/api/follow-up --exclude ".worktrees/**"`.

- [ ] **Step 6: Commit**

```bash
rtk git add -A convex/autoFollowUp.ts convex/autoFollowUp.test.ts convex/crons.ts convex/cs.ts convex/csConfigs.ts app/api/follow-up components/panel
rtk git commit -m "refactor: remove automatic follow-up"
```

---

### Task 9: Runbook, Full Verification, Migration, and Safe Rollout

**Files:**
- Create: `docs/runbooks/manual-followup.md`
- Modify only if generated: `convex/_generated/api.d.ts`

**Interfaces:**
- Documents exact configuration, UAT, unknown-send handling, rollback, and production observation.

- [ ] **Step 1: Write the runbook**

Document exact H+1/H+2/H+3 template fields, the existing per-CS `providerNumberId`, a test using `6285715682110`, expected queue transitions, confirmation that n8n order notification is separate, and rollback by disabling templates/manual sending rather than touching n8n.

- [ ] **Step 2: Run all local gates**

```bash
rtk npx vitest run --exclude ".worktrees/**"
rtk npx tsc --noEmit
rtk npx convex codegen
rtk npm run build
rtk git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Review security and Convex I/O**

Confirm every Follow-up public function has auth, returns validators, ownership checks, indexed/bounded reads, and no `Date.now()` query input. Confirm no Follow-up code path uses `requireDefaultOrgId`.

- [ ] **Step 4: Deploy backend before frontend**

Run from clean `main` after merge: `rtk npx convex deploy -y`.

- [ ] **Step 5: Start the recent backfill**

Invoke the guarded admin start mutation once. Observe each scheduled page and verify the migration completes without read-limit errors. Query the first due page and record counts only, not customer PII.

- [ ] **Step 6: Configure three exact approved templates**

Keep sending blocked until H+1, H+2, and H+3 show ready. If approved names are not yet available, deploy safely with manual send disabled.

- [ ] **Step 7: Push and verify Vercel**

Run: `rtk git push origin main`; wait for production status `Ready`; verify `/panel/follow-up` redirects unauthenticated users and loads for an authenticated owner.

- [ ] **Step 8: Execute UAT**

Test H+1 send, duplicate click, reply reset, forced-time dev tests for H+2/H+3 timing, closing removal, cross-CS denial, unknown provider outcome, and exact final completion. Confirm Dashboard/Performance metrics and n8n order notifications remain unchanged.

- [ ] **Step 9: Commit documentation if changed after UAT**

```bash
rtk git add docs/runbooks/manual-followup.md convex/_generated/api.d.ts
rtk git commit -m "docs: add manual follow-up runbook"
```
