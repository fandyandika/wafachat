# Event-driven Calendar Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rolling-24-hour Follow-up logic with a manual, event-driven H+1/H+2/H+3 state machine using Jakarta calendar days and reliable KirimDev webhooks.

**Architecture:** Persist the current lifecycle snapshot on each conversation and append compact lifecycle transitions to a separate ledger. Message ingestion and manual actions update lifecycle, counters, and previews transactionally. Queue pages read indexed conversation snapshots and per-CS counters; the selected detail alone subscribes to at most 50 messages.

**Tech Stack:** Next.js 14, React 18, TypeScript, Convex 1.39, `convex-test`, Vitest, Tailwind/shadcn, KirimDev Public API.

## Global Constraints

- Follow-up is manual-only; no auto-send cron or toggle.
- A new stage is due at 08:00 WIB on the next Jakarta calendar day.
- Time never advances or removes a stage; overdue customers remain visible.
- Only configured template names, configured text patterns, or explicit user actions advance stages.
- Customer inbound ends the old cycle; a later CS outbound starts a new H+1 cycle.
- H+3 archives Follow-up only and must not create a false sales closing.
- Preserve n8n order notifications and all reporting/closing behavior.
- Do not import historical KirimDev CRM messages.
- Do not hard-delete archived Follow-up, order, report, or message data in this scope.
- Queue reads are tenant-scoped, indexed, paginated, and have no per-row message/order reads.
- Detail reads at most 50 messages, only after selection.
- Every Convex function uses object syntax with `args` and `returns`; every public function enforces existing org/CS authorization.
- Never use an unbounded `.collect()` or `.filter()` instead of an index.
- Preserve unrelated local changes, especially `docs/ROADMAP.md`.

## File Map

New backend units:

- `convex/followUpTriggers.ts` — pure template/text matching.
- `convex/followUpLifecycle.ts` — transactional state/counter/ledger writes.
- `convex/followUpTransitions.ts` — scoped transition-history query.
- `convex/providerChannelHealth.ts` — materialized per-number webhook health.
- `convex/ingest/dispatch.ts` — capture-then-schedule KirimDev ingestion.

New frontend units:

- `components/panel/follow-up/follow-up-status.ts` — due/overdue labels.
- `components/panel/follow-up/follow-up-stage-menu.tsx` — manual stage correction.
- `docs/runbooks/follow-up-live-acceptance.md` — production gate evidence.

Existing files changed by the plan: `convex/schema.ts`, `followUpModel.ts`, `followUpTemplates.ts`, `messages.ts`, `followUpAttempts.ts`, `followUp.ts`, `followUpMigration.ts`, `shippingRecaps.ts`, `state.ts`, `conversationLifecycle.ts`, `ingest/kirimdevAdapter.ts`, `ingest/core.ts`, `http.ts`, their direct tests, and the current Follow-up dashboard/list/detail/settings components and tests.

---

### Task 1: Jakarta Calendar Model and Trigger Matcher

**Files:**
- Modify: `convex/followUpModel.ts`
- Modify: `convex/followUpModel.test.ts`
- Create: `convex/followUpTriggers.ts`
- Create: `convex/followUpTriggers.test.ts`

**Interfaces:**
- Produces: `nextJakartaDueAt(eventAt: number): number`
- Produces: `nextStageAfterDetected(current, detected, eventAt)`
- Produces: `normalizeFollowUpText(value: string): string`
- Produces: `detectFollowUpStage(input): 1 | 2 | 3 | null`

- [ ] **Step 1: Write failing calendar and trigger tests**

```ts
test("next due is 08:00 WIB on the next calendar day", () => {
  const sentAt = Date.UTC(2026, 7, 12, 13, 30); // 12 Aug 20:30 WIB
  expect(nextJakartaDueAt(sentAt)).toBe(Date.UTC(2026, 7, 13, 1, 0));
});

test("higher trigger catches up and H+3 archives", () => {
  expect(nextStageAfterDetected(1, 2, Date.UTC(2026, 7, 12, 2))).toEqual({
    completedStages: [1, 2], nextStage: 3,
    dueAt: Date.UTC(2026, 7, 13, 1), state: "waiting",
  });
  expect(nextStageAfterDetected(2, 3, Date.UTC(2026, 7, 12, 2)).state).toBe("archived");
});

test("template wins, normalized pattern matches, ordinary text does not", () => {
  const rules = [{ stage: 1 as const, templateName: "follow_up_h1", patterns: ["masih berminat kak"] }];
  expect(detectFollowUpStage({ templateName: "follow_up_h1", content: "", rules })).toBe(1);
  expect(detectFollowUpStage({ content: "Masih   berminat, Kak?", rules })).toBe(1);
  expect(detectFollowUpStage({ content: "Terima kasih kak", rules })).toBeNull();
});
```

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUpModel.test.ts convex/followUpTriggers.test.ts`  
Expected: FAIL because the new interfaces do not exist and old tests still assert `+24h`/seven-day expiry.

- [ ] **Step 3: Implement minimal pure logic**

```ts
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;

export function nextJakartaDueAt(eventAt: number): number {
  if (!Number.isFinite(eventAt) || eventAt < 0) throw new Error("Waktu Follow-up tidak valid.");
  const local = new Date(eventAt + JAKARTA_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 8) - JAKARTA_OFFSET_MS;
}

export function normalizeFollowUpText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
```

`nextStageAfterDetected` completes every stage from current through detected, schedules the following stage with `nextJakartaDueAt`, and archives after H+3. `detectFollowUpStage` exact-matches normalized template name first, then a non-empty normalized configured pattern. Remove `FOLLOW_UP_EXPIRY_MS` and the due-time gate from provider-trigger eligibility.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUpModel.test.ts convex/followUpTriggers.test.ts
rtk git add convex/followUpModel.ts convex/followUpModel.test.ts convex/followUpTriggers.ts convex/followUpTriggers.test.ts
rtk git commit -m "feat: add calendar follow-up state rules"
```

---

### Task 2: Additive Lifecycle Schema

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/followUpLifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 stage/state types.
- Produces: optional snapshot fields plus `followUpTransitions`, `followUpCounters`, and `providerChannelHealth`.

- [ ] **Step 1: Add failing schema-use tests**

The test inserts both a legacy conversation without new fields and a new conversation containing `followUpCycleId`, previews, transition timestamp, detected stage/template, outcome, and review reason. It also inserts one row into each new table. Legacy data must remain valid.

- [ ] **Step 2: Verify failure**

Run: `rtk npx convex codegen`  
Expected: new fields/tables referenced by tests do not exist.

- [ ] **Step 3: Add optional fields and indexes**

Add optional conversation fields:

```ts
followUpCycleId: v.optional(v.string()),
followUpCycleStartedAt: v.optional(v.number()),
followUpLastTransitionAt: v.optional(v.number()),
followUpLastInboundPreview: v.optional(v.string()),
followUpLastInboundAt: v.optional(v.number()),
followUpLastOutboundPreview: v.optional(v.string()),
followUpLastOutboundAt: v.optional(v.number()),
followUpLastDetectedStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
followUpLastDetectedTemplate: v.optional(v.string()),
followUpProductName: v.optional(v.string()),
followUpOutcome: v.optional(v.union(
  v.literal("h3_complete"), v.literal("closing"),
  v.literal("cancelled"), v.literal("manual_archive"),
)),
followUpReviewReason: v.optional(v.string()),
```

Add `review` to `followUpState`; add optional `providerTemplateName` to `messages`, optional `matchPatterns` to `followUpTemplates`, and optional `cycleId` to `followUpAttempts`.

Create these tables and exact indexes:

```ts
followUpTransitions: defineTable({
  orgId: v.id("organizations"), conversationId: v.id("conversations"),
  cycleId: v.string(), eventKey: v.string(),
  kind: v.union(v.literal("cycle_armed"), v.literal("stage_completed"),
    v.literal("customer_replied"), v.literal("stage_corrected"),
    v.literal("closing"), v.literal("cancelled"), v.literal("archived")),
  source: v.union(v.literal("provider_template"), v.literal("provider_webhook"),
    v.literal("manual"), v.literal("system")),
  fromStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  toStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  providerMessageId: v.optional(v.string()), templateName: v.optional(v.string()),
  actorUserId: v.optional(v.id("users")), actorName: v.optional(v.string()), createdAt: v.number(),
}).index("by_org_eventKey", ["orgId", "eventKey"])
  .index("by_org_conversation_createdAt", ["orgId", "conversationId", "createdAt"]),

followUpCounters: defineTable({
  orgId: v.id("organizations"), csKey: v.string(),
  h1: v.number(), h2: v.number(), h3: v.number(), review: v.number(), updatedAt: v.number(),
}).index("by_org_csKey", ["orgId", "csKey"]),

providerChannelHealth: defineTable({
  orgId: v.id("organizations"), providerNumberId: v.string(), csKey: v.optional(v.string()),
  channelType: v.union(v.literal("cs"), v.literal("admin"), v.literal("unknown")),
  lastInboundAt: v.optional(v.number()), lastOutboundAt: v.optional(v.number()),
  lastError: v.optional(v.string()), errorAt: v.optional(v.number()), updatedAt: v.number(),
}).index("by_org_providerNumberId", ["orgId", "providerNumberId"]),
```

Add conversation indexes `by_org_followUpState_updatedAt` and `by_org_followUpCsKey_state_updatedAt` for Review/Archive pagination. Keep the existing stage/state/due indexes for active queues.

- [ ] **Step 4: Codegen and commit**

```powershell
rtk npx convex codegen
rtk git add convex/schema.ts convex/_generated convex/followUpLifecycle.test.ts
rtk git commit -m "feat: add follow-up lifecycle storage"
```

---

### Task 3: Transactional Lifecycle Service

**Files:**
- Create: `convex/followUpLifecycle.ts`
- Modify: `convex/followUpLifecycle.test.ts`
- Modify: `convex/followUpAttempts.ts`
- Modify: `convex/followUpAttempts.test.ts`

**Interfaces:**
- Produces: `applyInboundReset`, `applyOutboundLifecycle`, `confirmCurrentStage`, `correctCurrentStage`, `terminateCycle`.
- Produces: one counter row per `(orgId, csKey)` and one idempotent transition per event.

- [ ] **Step 1: Write failing lifecycle tests**

Cover: CS outbound with/without prior inbound arms H+1; early H+1 trigger advances; H+2 catches up from H+1; H+3 archives without closing; inbound resets and decrements counter; duplicate provider ID is a no-op; manual H+1→H+3 correction records actor; a late send finalization after customer reply cannot resurrect the ended cycle.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUpLifecycle.test.ts convex/followUpAttempts.test.ts`  
Expected: FAIL because lifecycle helpers/cycle IDs do not exist.

- [ ] **Step 3: Implement one transactional write boundary**

Use a counter helper with `by_org_csKey`; decrement the previous bucket with `Math.max(0, value - 1)` and increment the next bucket. Never maintain a hot global counter; owner totals will sum bounded per-CS rows. Check `by_org_eventKey` before writes. New attempt keys use `cycleId`; legacy `cycleInboundAt` remains readable during compatibility.

```ts
type CounterBucket = 1 | 2 | 3 | "review" | null;

export type OutboundLifecycleInput = {
  conversation: Doc<"conversations">; messageId: Id<"messages">;
  content: string; templateName?: string; providerMessageId?: string;
  csKey: string; detectedStage: FollowUpStage | null; createdAt: number;
  source: "provider_template" | "provider_webhook" | "system";
};
```

Manual correction makes the target stage actionable at `Date.now()` and records old/new stage. Manual confirmation completes the server-side current stage and schedules the next calendar day.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUpLifecycle.test.ts convex/followUpAttempts.test.ts
rtk git add convex/followUpLifecycle.ts convex/followUpLifecycle.test.ts convex/followUpAttempts.ts convex/followUpAttempts.test.ts
rtk git commit -m "feat: persist follow-up lifecycle transitions"
```

---

### Task 4: Configurable Stage Triggers

**Files:**
- Modify: `convex/followUpTemplates.ts`
- Modify: `convex/followUpTemplates.test.ts`
- Modify: `components/panel/follow-up-template-settings.tsx`
- Modify: `components/panel/follow-up-template-settings.test.tsx`

**Interfaces:**
- Consumes: `normalizeFollowUpText`.
- Produces: at most 10 unique normalized `matchPatterns` per stage, each 8–200 characters.

- [ ] **Step 1: Add failing validation and settings tests**

```ts
await expect(asAdmin.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
  stage: 1, label: "H+1", templateName: "follow_up_h1", language: "id",
  variables: [], matchPatterns: ["halo"], isActive: true,
})).rejects.toThrow(/minimal 8 karakter/i);
```

The component test asserts one textarea labelled `Pola pesan manual H+1`, one pattern per line, and query values restored into the draft.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUpTemplates.test.ts components/panel/follow-up-template-settings.test.tsx`  
Expected: FAIL because patterns are not accepted/rendered.

- [ ] **Step 3: Implement bounded normalization**

```ts
function validatePatterns(values: string[]): string[] {
  if (values.length > 10) throw new Error("Maksimal 10 pola pesan per tahap.");
  const normalized = [...new Set(values.map(normalizeFollowUpText).filter(Boolean))];
  if (normalized.some(value => value.length < 8 || value.length > 200)) {
    throw new Error("Pola pesan harus 8–200 karakter.");
  }
  return normalized;
}
```

Keep exact KirimDev template name as the primary trigger. Saving remains admin-only.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUpTemplates.test.ts components/panel/follow-up-template-settings.test.tsx
rtk git add convex/followUpTemplates.ts convex/followUpTemplates.test.ts components/panel/follow-up-template-settings.tsx components/panel/follow-up-template-settings.test.tsx
rtk git commit -m "feat: configure manual follow-up triggers"
```

---

### Task 5: KirimDev Metadata and Channel Health

**Files:**
- Modify: `convex/ingest/kirimdevAdapter.ts`
- Modify: `convex/ingest/kirimdevAdapter.test.ts`
- Modify: `convex/ingest/core.ts`
- Modify: `convex/ingest/core.test.ts`
- Create: `convex/providerChannelHealth.ts`
- Create: `convex/providerChannelHealth.test.ts`

**Interfaces:**
- Produces: message type `text | template | button`, optional `templateName`, stable message ID, and `phoneNumberId`.
- Produces: `touchProviderChannelHealth` and authenticated `listProviderChannelHealth` without raw webhook bodies.

- [ ] **Step 1: Add failing real-shape tests**

Test outbound dashboard text, outbound template at `message.template.name`, inbound `metadata.phone_number_id`, known CS, known active admin channel writing `adminThreadMessages`, unknown number, and duplicate delivery. Assert:

```ts
expect(parsed.event).toMatchObject({
  messageType: "template", templateName: "follow_up_h2",
  phoneNumberId: "485071188032281", externalMessageId: "wamid.h2",
});
```

Unknown numbers must preserve a resolvable customer message and materialize `Nomor provider belum dipetakan`.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/ingest/kirimdevAdapter.test.ts convex/ingest/core.test.ts convex/providerChannelHealth.test.ts`  
Expected: FAIL because template metadata and health do not exist.

- [ ] **Step 3: Implement parser and health upsert**

```ts
const templateName = m.template?.name ?? m.template_name ?? d.template?.name;
const messageType = templateName ? "template" : (m.type === "button" ? "button" : "text");
```

Upsert health through `by_org_providerNumberId`. Known mappings clear old errors and update the direction timestamp. Unknown mappings use `channelType: "unknown"`, store a safe error, and continue when customer phone resolves an existing conversation.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/ingest/kirimdevAdapter.test.ts convex/ingest/core.test.ts convex/providerChannelHealth.test.ts
rtk git add convex/ingest/kirimdevAdapter.ts convex/ingest/kirimdevAdapter.test.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/providerChannelHealth.ts convex/providerChannelHealth.test.ts
rtk git commit -m "feat: track kirimdev channel health"
```

---

### Task 6: Connect Message and Terminal Events to Lifecycle

**Files:**
- Modify: `convex/messages.ts`
- Modify: `convex/messages.test.ts`
- Modify: `convex/shippingRecaps.ts`
- Modify: `convex/shippingRecaps.test.ts`
- Modify: `convex/state.ts`
- Modify: `convex/state.test.ts`
- Modify: `convex/conversationLifecycle.ts`
- Modify: `convex/conversationLifecycle.test.ts`

**Interfaces:**
- Consumes: lifecycle service and trigger rules.
- Produces: one incremental lifecycle update per inserted message or terminal outcome.

- [ ] **Step 1: Write failing integration tests**

Cover these exact cases with `convexTest` fixtures and explicit conversation/counter/ledger assertions:

- CS outbound without prior inbound arms H+1.
- Ordinary outbound updates preview but does not consume an active stage.
- Configured H+1 text before due advances to H+2.
- Configured H+2 template catches up from H+1.
- New inbound clears the old cycle and stores inbound preview.
- H+3 archive leaves `conversation.status` unchanged.
- Closing and cancellation terminate the counter exactly once.
- Stale sweep skips `waiting`, `sending`, `failed`, `unknown`, and `review`.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/messages.test.ts convex/shippingRecaps.test.ts convex/state.test.ts convex/conversationLifecycle.test.ts`  
Expected: FAIL on no-inbound, early triggers, archive, and stale behavior.

- [ ] **Step 3: Route writes through `followUpLifecycle.ts`**

After message deduplication/insertion:

```ts
if (args.direction === "inbound" && args.role === "customer") {
  await applyInboundReset(ctx, { conversation, messageId, content: args.content, createdAt });
} else if (args.direction === "outbound" && args.role === "cs") {
  const rules = await getActiveFollowUpRules(ctx, args.orgId);
  await applyOutboundLifecycle(ctx, {
    conversation, messageId, content: args.content,
    templateName: args.providerTemplateName, providerMessageId: args.externalMessageId,
    csKey: effectiveCsKey, createdAt,
    source: args.source === "ingest" ? "provider_webhook" : "system",
    detectedStage: detectFollowUpStage({ content: args.content, templateName: args.providerTemplateName, rules }),
  });
}
```

Preview fields truncate to 180 characters. Remove direct legacy due/expiry advancement. Closing and cancellation call `terminateCycle`. Stale lifecycle sweep cannot close `waiting`, `sending`, `failed`, `unknown`, or `review`; explicit won/done-marker behavior remains.

When order ingestion creates or updates a conversation, copy the canonical product name into `followUpProductName`; queue reads use that snapshot instead of querying `orders` per card.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/messages.test.ts convex/shippingRecaps.test.ts convex/state.test.ts convex/conversationLifecycle.test.ts convex/followUpLifecycle.test.ts
rtk git add convex/messages.ts convex/messages.test.ts convex/shippingRecaps.ts convex/shippingRecaps.test.ts convex/state.ts convex/state.test.ts convex/conversationLifecycle.ts convex/conversationLifecycle.test.ts
rtk git commit -m "feat: drive follow-up from message events"
```

---

### Task 7: Indexed Queue, Counts, and Transition History

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Create: `convex/followUpTransitions.ts`
- Create: `convex/followUpTransitions.test.ts`

**Interfaces:**
- Produces: `listFollowUpQueue`, `getFollowUpCounts`, `listFollowUpAttentionPage`, `listArchivedFollowUpsPage`, `listClosedFollowUpsPage`, and `listConversationTransitions`.

- [ ] **Step 1: Write failing query tests**

Test a 60-day-overdue row, due-today row, and future row. All remain returned oldest-due first. Remove order/message fixtures from the queue context test; queue data must still come from the conversation snapshot. Seed 901 rows and verify 30-row cursor pages. Test exact per-CS counter and bounded owner sum. Add cursor tests for Review/Archive through state/updatedAt indexes and Closing through `shippingRecaps.by_org_closedAt`.

```ts
expect(result.page[0]).toMatchObject({
  stage: 1, dueState: "overdue", overdueDays: 60,
  lastInboundPreview: "Masih ada kak?", lastOutboundPreview: "Kami tunggu kabarnya",
});
```

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUp.test.ts convex/followUpTransitions.test.ts`  
Expected: FAIL because current queue has a seven-day lower bound and per-row reads.

- [ ] **Step 3: Implement snapshot-only indexed queries**

```ts
ctx.db.query("conversations")
  .withIndex("by_org_followUpStage_state_dueAt", q => q
    .eq("orgId", orgId).eq("followUpNextStage", args.stage)
    .eq("followUpState", "waiting"))
  .order("asc")
  .paginate({ cursor: args.paginationOpts.cursor, numItems });
```

No lower date bound. Derive `dueState/overdueDays` only for the selected 30 rows. Return both preview directions, product/order snapshot, detected stage/template, and due metadata. CS counts read one counter row; owner totals sum at most 100 per-CS rows and throw above that bound. Review and Archive use the new state/updatedAt indexes, Closing uses the existing recap closedAt index, and all paginate. Transition history checks conversation ownership before an indexed 50-row pagination.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUp.test.ts convex/followUpTransitions.test.ts
rtk git add convex/followUp.ts convex/followUp.test.ts convex/followUpTransitions.ts convex/followUpTransitions.test.ts
rtk git commit -m "feat: add indexed follow-up workspace queries"
```

---

### Task 8: Manual Actions and Safe Template Sending

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `app/api/follow-up/confirm-contact/route.ts` and `.test.ts`
- Modify: `app/api/follow-up/archive/route.ts` and `.test.ts`
- Modify: `app/api/follow-up/unarchive/route.ts` and `.test.ts`
- Modify: `app/api/follow-up/send/route.ts` and `.test.ts`

**Interfaces:**
- Produces: server-current-stage `confirmManualContact`.
- Produces: `correctFollowUpStage({ conversationId, targetStage, requestId })`.
- Produces: archive/unarchive that never invent sales closing.

- [ ] **Step 1: Write failing action tests**

Prove: client cannot claim a different stage; confirmation works early/overdue; correction H+1→H+3 is immediately actionable and audited; accepted H+3 archives without `status="closed"`; duplicate request is idempotent; unknown delivery blocks blind retry; archive/unarchive never changes recap/closing.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUp.test.ts app/api/follow-up/confirm-contact/route.test.ts app/api/follow-up/archive/route.test.ts app/api/follow-up/unarchive/route.test.ts app/api/follow-up/send/route.test.ts`  
Expected: FAIL under strict due/expiry and current archive behavior.

- [ ] **Step 3: Implement via lifecycle service**

Remove client `stage` from confirmation; load `followUpNextStage` server-side. Keep UUID reservation/idempotency. Remove rejection based solely on early or seven-day-old due time.

```ts
args: {
  conversationId: v.id("conversations"),
  targetStage: v.union(v.literal(1), v.literal(2), v.literal(3)),
  requestId: v.string(),
}
```

Manual correction uses `dueAt = Date.now()`. Archive patches lifecycle/outcome only. Unarchive enters `review` with `Dibuka kembali; pilih tahap yang benar` unless a new inbound already left it idle.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUp.test.ts app/api/follow-up/confirm-contact/route.test.ts app/api/follow-up/archive/route.test.ts app/api/follow-up/unarchive/route.test.ts app/api/follow-up/send/route.test.ts
rtk git add convex/followUp.ts convex/followUp.test.ts app/api/follow-up/confirm-contact app/api/follow-up/archive app/api/follow-up/unarchive app/api/follow-up/send
rtk git commit -m "feat: harden manual follow-up actions"
```

---

### Task 9: Bounded Cutover and Counter Rebuild

**Files:**
- Modify: `convex/followUpMigration.ts`
- Modify: `convex/followUpMigration.test.ts`

**Interfaces:**
- Preserves: authenticated `startRecentFollowUpPreparation({ mode })` and run-status query.
- Produces: internal CLI-only `startCutoverBySlug({ orgSlug, mode })` so production cutover does not require fabricated browser identity.
- Produces: resumable 25-row snapshot normalization and exact counter rebuild.

- [ ] **Step 1: Replace message-scan/expiry migration tests**

Test: valid waiting snapshot becomes a calendar cycle; terminal state remains terminal; missing stage/CS/anchor becomes `review` with reason; no external import is scheduled; second apply is idempotent; counter totals equal normalized active rows; dry-run writes nothing.

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/followUpMigration.test.ts`  
Expected: FAIL because current migration scans messages and restricts to seven days.

- [ ] **Step 3: Implement snapshot-only normalization**

Keep `by_org_status_updatedAt` and 25-row cursor pagination. Never query KirimDev or read outbound message tails. For a valid legacy waiting row, choose anchor in order: `followUpStageAt`, `lastMessageAt`, existing `followUpDueAt`; generate `cycleId` deterministically from conversation ID plus anchor. Ambiguous rows become `review` rather than being guessed/deleted.

After conversation pages finish, rebuild only the organization's `followUpCounters`: delete its bounded per-CS rows, page indexed active snapshots, and increment exact buckets. Persist phase/cursor in the run so retries resume safely.

Add an `internalMutation` named `startCutoverBySlug` that resolves the organization through `organizations.by_slug`, rejects a second running preparation, creates the run, and schedules `preparePage`. It is not exported as a public mutation and accepts only `orgSlug` plus `dry_run | apply`.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/followUpMigration.test.ts
rtk git add convex/followUpMigration.ts convex/followUpMigration.test.ts
rtk git commit -m "feat: normalize follow-up state safely"
```

---

### Task 10: Fast KirimDev ACK

**Files:**
- Create: `convex/ingest/dispatch.ts`
- Create: `convex/ingest/dispatch.test.ts`
- Modify: `convex/http.ts`

**Interfaces:**
- Produces: `captureAndScheduleKirimdev(ctx, input): Promise<Id<"ingestEvents">>`.
- Produces: internal action `processScheduledEvent({ eventId })` for rollback-safe failure recording.
- Preserves: Berdu webhook and n8n order notification paths.

- [ ] **Step 1: Write failing ordering test**

```ts
test("captures before scheduling and never processes inline", async () => {
  const calls: string[] = [];
  const ctx = {
    runMutation: vi.fn(async () => { calls.push("capture"); return "event-1"; }),
    scheduler: { runAfter: vi.fn(async () => { calls.push("schedule"); }) },
  };
  await captureAndScheduleKirimdev(ctx as never, input);
  expect(calls).toEqual(["capture", "schedule"]);
  expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
    0, internal.ingest.dispatch.processScheduledEvent, { eventId: "event-1" },
  );
});
```

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run convex/ingest/dispatch.test.ts`  
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement capture-then-schedule**

Await durable `captureEvent`, then schedule `internal.ingest.dispatch.processScheduledEvent`, then return the ID. That internal action calls `internal.ingest.core.processEvent`; if processing throws, the mutation rolls back and the action calls `ingest.events.markFailed` in a separate mutation with a bounded safe error. `/webhooks/kirimdev` returns 200 immediately after scheduling and no longer awaits enrichment. Add a test that a processing error leaves no partial message writes and leaves the raw event replayable with `status: "failed"`. Do not modify `/webhooks/berdu` in this task.

- [ ] **Step 4: Verify pass and commit**

```powershell
rtk npx vitest run convex/ingest/dispatch.test.ts convex/ingest/events.test.ts convex/ingest/core.test.ts
rtk git add convex/ingest/dispatch.ts convex/ingest/dispatch.test.ts convex/http.ts
rtk git commit -m "perf: acknowledge kirimdev webhooks after capture"
```

---

### Task 11: Reactive Follow-up Workspace

**Files:**
- Modify: `components/panel/follow-up/follow-up-types.ts`
- Create: `components/panel/follow-up/follow-up-status.ts` and `.test.ts`
- Create: `components/panel/follow-up/follow-up-stage-menu.tsx` and `.test.tsx`
- Modify: `components/panel/follow-up-dashboard.tsx` and `.test.tsx`
- Modify: `components/panel/follow-up/follow-up-list.tsx` and `.test.tsx`
- Modify: `components/panel/follow-up/follow-up-detail.tsx` and `.test.tsx`
- Modify: `components/panel/follow-up/follow-up-client.ts` and `.test.ts`
- Remove after import audit: snapshot/count/history API routes and their tests.

**Interfaces:**
- Consumes: reactive queue/count/transition/message queries plus `listProviderChannelHealth`.
- Produces: tabs H+1, H+2, H+3, Perlu dicek, Closing, Arsip.

- [ ] **Step 1: Write failing UX tests**

```ts
expect(html).toContain("H+1");
expect(html).toContain("H+2");
expect(html).toContain("H+3");
expect(html).toContain("Perlu dicek");
expect(html).toContain("Closing");
expect(html).toContain("Arsip");
expect(html).not.toContain("Perlu tindakan");
expect(html).not.toContain("Terkirim");
```

List tests assert both customer and CS previews/times, stage, overdue label, detected trigger, and product/order context. Detail tests assert `messages.listMessages` receives `limit: 50`, transition timeline renders, actions remain sticky on mobile, stage correction is accessible, and health errors are explicit.

Status tests:

```ts
expect(formatFollowUpDue(dueAt, dueAt - 1).tone).toBe("scheduled");
expect(formatFollowUpDue(dueAt, dueAt + 60_000).label).toBe("Terlambat hari ini");
expect(formatFollowUpDue(dueAt, dueAt + 2 * 86_400_000).label).toBe("Terlambat 2 hari");
```

- [ ] **Step 2: Verify failure**

Run: `rtk npx vitest run components/panel/follow-up-dashboard.test.tsx components/panel/follow-up/follow-up-list.test.tsx components/panel/follow-up/follow-up-detail.test.tsx components/panel/follow-up/follow-up-status.test.ts components/panel/follow-up/follow-up-stage-menu.test.tsx`  
Expected: FAIL against current five task tabs and single preview.

- [ ] **Step 3: Implement reactive, context-rich UI**

Use `usePaginatedQuery(api.followUp.listFollowUpQueue, args, { initialNumItems: 30 })` only for the active stage and `useQuery(api.followUp.getFollowUpCounts, { csName })` for badges. Closed views/details use `"skip"`. Search remains explicit/on-demand; actions may retain HTTP routes.

Each row shows customer/phone/CS, stage/due badge, both message previews with time, last detected trigger, and product/order context. Actions: Buka WhatsApp, Kirim template, Sudah dihubungi, Ubah tahap, Closing, Batal, Arsip. Opening WhatsApp alone never advances.

Detail subscribes to 50 messages and 50 transition events only after selection. Use existing UI primitives, ≥44px touch targets, visible focus, local loading/error feedback, and a non-transparent sticky mobile action bar.

- [ ] **Step 4: Remove obsolete one-shot queue routes after import audit**

Run: `rtk rg -n "fetchQueue|fetchHistory|/api/follow-up/(snapshot|counts|history)" app components`  
Expected before removal: only obsolete routes/tests. Delete those files, rerun, and expect no production reference.

- [ ] **Step 5: Verify pass and commit**

```powershell
rtk npx vitest run components/panel/follow-up-dashboard.test.tsx components/panel/follow-up/follow-up-list.test.tsx components/panel/follow-up/follow-up-detail.test.tsx components/panel/follow-up/follow-up-status.test.ts components/panel/follow-up/follow-up-stage-menu.test.tsx components/panel/follow-up/follow-up-client.test.ts app/api/follow-up
rtk git add components/panel/follow-up-dashboard.tsx components/panel/follow-up-dashboard.test.tsx components/panel/follow-up app/api/follow-up
rtk git commit -m "feat: rebuild reactive follow-up workspace"
```

---

### Task 12: Verification, Cutover, and Live Gate

**Files:**
- Create: `docs/runbooks/follow-up-live-acceptance.md`
- Modify only when verification exposes a direct defect: Task 1–11 files/tests.

**Interfaces:**
- Produces: green local gates, deployed backend/UI, cutover audit, and per-number production evidence.

- [ ] **Step 1: Run targeted tests**

```powershell
rtk npx vitest run convex/followUpModel.test.ts convex/followUpTriggers.test.ts convex/followUpLifecycle.test.ts convex/followUpAttempts.test.ts convex/followUpTemplates.test.ts convex/followUp.test.ts convex/followUpTransitions.test.ts convex/followUpMigration.test.ts convex/messages.test.ts convex/ingest/kirimdevAdapter.test.ts convex/ingest/core.test.ts convex/ingest/events.test.ts convex/ingest/dispatch.test.ts convex/providerChannelHealth.test.ts convex/shippingRecaps.test.ts convex/state.test.ts convex/conversationLifecycle.test.ts components/panel/follow-up-dashboard.test.tsx components/panel/follow-up-template-settings.test.tsx components/panel/follow-up
```

Expected: PASS.

- [ ] **Step 2: Run full repository gates**

```powershell
rtk npm test
rtk npx tsc --noEmit
rtk npx convex codegen
rtk npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Deploy backward-compatible Convex backend**

Run: `rtk npx convex deploy --yes`  
Expected: optional schema/functions deploy without validation failure.

- [ ] **Step 4: Run authenticated dry-run and apply**

Run the internal CLI-only entry point:

```powershell
rtk npx convex run followUpMigration:startCutoverBySlug '{"orgSlug":"pustakaislam","mode":"dry_run"}' --prod
```

Poll the returned run with a bounded inline query or the authenticated owner status view. Require `failed = 0`, review eligible/review counts, then repeat the exact command with `"mode":"apply"`. Record both run IDs and summaries.

- [ ] **Step 5: Deploy UI and smoke-test**

Run: `rtk vercel --prod`  
Expected: Ready. Open Dashboard, Follow-up, and Settings → Template Follow-up with no client exception.

- [ ] **Step 6: Complete every-number live gate**

Create this runbook table:

```markdown
| Number/CS | inbound live | outbound live | trigger once | duplicate safe | reply reset | closing/batal removed | mapping diagnostic | result |
```

For every CS/admin number, send controlled inbound/outbound messages. Confirm live display without refresh, one advancement, duplicate safety, reply reset, closing/batal removal, and visible unmapped-channel diagnostic. A failure records KirimDev event ID, `phone_number_id`, WafaChat ingest event ID, and safe error; any failure blocks completion.

- [ ] **Step 7: Observe I/O and commit evidence**

Observe one normal work period. Confirm queue calls do not read messages/orders per card, no polling exists, and transition/counter writes stay bounded. Record timestamp and top Follow-up functions.

```powershell
rtk git add docs/runbooks/follow-up-live-acceptance.md
rtk git commit -m "docs: record follow-up production acceptance"
```

Do not declare production complete until every configured number passes.
