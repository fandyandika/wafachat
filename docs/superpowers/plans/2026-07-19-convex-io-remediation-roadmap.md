# Convex I/O Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce WaFaChat production database I/O from the 18 July 2026 baseline without changing business metrics, weakening capture-first ingestion, or breaking tenant isolation.

**Architecture:** Apply the safest high-return reductions first: deterministic tests, indexed point reads for scheduled jobs, stable cache buckets, and direction-aware message indexes. Then complete the existing rollup architecture for analytics. Ingestion is optimized last because its raw-event write and replay guarantees are intentional; only redundant registry/rule reads may be removed.

**Tech Stack:** Next.js App Router, TypeScript, Convex, convex-test, Vitest, Vercel `unstable_cache`.

## Global Constraints

- Production baseline is **193.2 MB database I/O/day** on 18 July 2026.
- Preserve `ingestEvents.rawBody` and replay capability for the full configured retention period.
- Every growing-table query must be scoped by `orgId` and an index range.
- Public metric results must remain equal to the existing raw implementation for equivalent windows.
- Partial live windows use exact raw ranges; sealed 16:00-WIB windows use rollups.
- No PWA changes are part of this plan; PWA receives its own design and implementation plan after this gate passes.
- Run shell commands through `rtk` in this workspace.

---

## Baseline and priority

| Function group | 18 Jul I/O | Share | Decision |
|---|---:|---:|---|
| `ingest/core.processEvent` | 90.86 MB | 47.0% | Preserve capture-first; optimize redundant lookups after safer wins |
| Response time | 17.09 MB | 8.8% | Normalize cache keys to two-minute buckets |
| Follow-up public/internal/candidacy | 17.63 MB | 9.1% | Composite message index and bounded reads |
| Order counter reconciler | 9.89 MB | 5.1% | Replace repeated full-day scan with incremental state |
| Period report | 9.30 MB | 4.8% | Remove raw recap scan already represented by rollups |
| Ingest health monitor | 7.53 MB | 3.9% | Replace 50-large-document scan with indexed point read |
| Conversation lifecycle | 7.13 MB | 3.7% | Scope pagination to org/open status; use direction index |
| Performance + product difficulty | 10.06 MB | 5.2% | Complete product rollup fields and exact partial-window fallback |

The top eight entries shown in the dashboard account for about **82.5%** of daily I/O. At a steady rate, the current deployment projects to roughly **5.8 GB/month**. This is not financially dangerous today, but it scales roughly with traffic and tenant count, so it must be addressed before external multi-tenant growth.

---

### Task 1: Restore deterministic green test baseline

**Files:**
- Modify: `convex/followUp.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `convex/orgProvisioning.test.ts`

**Interfaces:**
- Produces: `getArchivedFollowUps({ csName?, nowOverride? })`
- Preserves: production callers omit `nowOverride` and receive `Date.now()` behavior.

- [ ] **Step 1: Make archived follow-up time injectable**

Change the query argument and clock selection:

```ts
export const getArchivedFollowUps = query({
  args: {
    csName: v.optional(v.string()),
    nowOverride: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getArchivedFollowUps");
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const now = args.nowOverride ?? Date.now();
    // existing indexed query remains unchanged
  },
});
```

- [ ] **Step 2: Anchor both tests to their fixtures**

Pass the existing fixed `now` to `getArchivedFollowUps`. In provisioning, define the order timestamp once and derive both `created_at` and the metric range from that timestamp:

```ts
const orgTwoOrderAt = Date.parse("2026-07-14T09:15:00+07:00");
const range = {
  startAt: orgTwoOrderAt - 86_400_000,
  endAt: orgTwoOrderAt + 86_400_000,
};
```

- [ ] **Step 3: Verify the two original failures and the full suite**

Run:

```powershell
rtk npx vitest run convex/followUp.test.ts convex/orgProvisioning.test.ts --reporter=verbose
rtk npx vitest run
```

Expected: both targeted files pass; full suite reports zero failed tests.

- [ ] **Step 4: Commit**

```powershell
rtk git add convex/followUp.ts convex/followUp.test.ts convex/orgProvisioning.test.ts
rtk git commit -m "test: make time-window coverage deterministic"
```

---

### Task 2: Make ingest health monitoring O(1) per organization

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/ingest/monitor.ts`
- Modify: `convex/ingest/monitor.test.ts`

**Interfaces:**
- Produces indexes: `ingestEvents.by_org_kind_status_receivedAt`, `ingestEvents.by_org_status_receivedAt`, `alertState.by_org_alertKey`.
- Produces: `getHealthSnapshot({ orgId, nowMs })`.

- [ ] **Step 1: Write a two-organization isolation test**

Seed processed message events and failed events in two organizations. Assert that each snapshot sees only its organization and that the most recent processed message is found without reading unrelated event kinds.

- [ ] **Step 2: Add org-scoped health indexes**

```ts
ingestEvents: defineTable({
  // existing fields
})
  .index("by_status_receivedAt", ["status", "receivedAt"])
  .index("by_receivedAt", ["receivedAt"])
  .index("by_org_kind_status_receivedAt", ["orgId", "kind", "status", "receivedAt"])
  .index("by_org_status_receivedAt", ["orgId", "status", "receivedAt"]),

alertState: defineTable({
  // existing fields
}).index("by_org_alertKey", ["orgId", "alertKey"]),
```

- [ ] **Step 3: Replace the 50-document scan with a point range**

```ts
const lastMsg = await ctx.db
  .query("ingestEvents")
  .withIndex("by_org_kind_status_receivedAt", (q) =>
    q.eq("orgId", args.orgId)
      .eq("kind", "message.event")
      .eq("status", "processed"),
  )
  .order("desc")
  .first();

const failed = await ctx.db
  .query("ingestEvents")
  .withIndex("by_org_status_receivedAt", (q) =>
    q.eq("orgId", args.orgId)
      .eq("status", "failed")
      .gte("receivedAt", args.nowMs - SPIKE_WINDOW_MS),
  )
  .collect();
```

Loop through `internal.orgs.listOrgsInternal` in `checkHealth`, pass `orgId` to the snapshot and cooldown mutation, and include the organization name/slug in Telegram text.

- [ ] **Step 4: Verify**

Run `rtk npx vitest run convex/ingest/monitor.test.ts convex/orgIsolation.test.ts`.

Expected: both pass, with no global cross-tenant health state.

- [ ] **Step 5: Commit**

```powershell
rtk git add convex/schema.ts convex/ingest/monitor.ts convex/ingest/monitor.test.ts
rtk git commit -m "perf: index ingest health snapshots per organization"
```

---

### Task 3: Make response-time cache keys reusable

**Files:**
- Create: `lib/response-time-cache.ts`
- Create: `lib/response-time-cache.test.ts`
- Modify: `app/api/panel/response-times/route.ts`

**Interfaces:**
- Produces: `bucketResponseTimeRange(startAt: number, endAt: number, bucketMs?: number)`.
- Default bucket: 120,000 ms, matching the existing two-minute cache lifetime.

- [ ] **Step 1: Write cache bucketing tests**

```ts
expect(bucketResponseTimeRange(1_000, 241_999)).toEqual({ startAt: 0, endAt: 240_000 });
expect(bucketResponseTimeRange(0, 120_000)).toEqual({ startAt: 0, endAt: 120_000 });
expect(() => bucketResponseTimeRange(200_000, 100_000)).toThrow();
```

- [ ] **Step 2: Implement deterministic buckets**

```ts
export function bucketResponseTimeRange(startAt: number, endAt: number, bucketMs = 120_000) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt || bucketMs <= 0) {
    throw new Error("invalid response-time range");
  }
  return {
    startAt: Math.floor(startAt / bucketMs) * bucketMs,
    endAt: Math.floor(endAt / bucketMs) * bucketMs,
  };
}
```

- [ ] **Step 3: Normalize before calling `unstable_cache`**

The route validates the request, buckets the timestamps, then passes the bucketed values and `csName` to `getResponseTimesCached`. This makes page opens inside the same two-minute interval share one Convex read.

- [ ] **Step 4: Verify and commit**

Run `rtk npx vitest run lib/response-time-cache.test.ts` and `rtk npm run build`.

```powershell
rtk git add lib/response-time-cache.ts lib/response-time-cache.test.ts app/api/panel/response-times/route.ts
rtk git commit -m "perf: share response-time snapshots by cache bucket"
```

---

### Task 4: Replace repeated full-day reconciliation scans with an incremental cursor

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/ingest/reconcileState.ts`
- Create: `convex/ingest/reconcileState.test.ts`
- Modify: `convex/ingest/reconciler.ts`
- Modify: `convex/ingest/reconciler.test.ts`
- Remove after cutover: `convex/state.ts:listOrderCountersByPrefix`

**Interfaces:**
- Produces table: `reconcileStates` keyed by `(orgId, datePrefix)`.
- Produces: `prepareReconcileRun({ orgId, datePrefix }) -> { gaps, nextCounter }`.
- Produces: `commitReconcileRun({ orgId, datePrefix, nextCounter, unresolvedCounters })`.

- [ ] **Step 1: Test first run, incremental run, and late gap healing**

The tests must prove:

```ts
// First run sees counters 1,2,4 => gap 3 and nextCounter 5.
// Next run with 5,6 reads only the tail and retains unresolved 3.
// When order 3 appears later, the next run removes it from unresolvedCounters.
```

- [ ] **Step 2: Add bounded reconciliation state**

```ts
reconcileStates: defineTable({
  orgId: v.id("organizations"),
  datePrefix: v.string(),
  nextCounter: v.number(),
  unresolvedCounters: v.array(v.number()),
  updatedAt: v.number(),
}).index("by_org_datePrefix", ["orgId", "datePrefix"]),
```

Cap `unresolvedCounters` at 500 and process at most 50 external detail fetches per run. The first run may scan the current day once; subsequent runs query only the new order-ID tail plus point-check the bounded unresolved list.

- [ ] **Step 3: Switch the reconciler**

Replace `listOrderCountersByPrefix` with `prepareReconcileRun`, fetch the returned gaps, then commit only counters that remain unresolved. Preserve the current 15-minute cron and tenant-1 credential guard.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
rtk npx vitest run convex/ingest/reconcileState.test.ts convex/ingest/reconciler.test.ts convex/state.test.ts
rtk npx tsc --noEmit -p convex
```

Expected: all pass; no production path references `listOrderCountersByPrefix`.

```powershell
rtk git add convex/schema.ts convex/ingest/reconcileState.ts convex/ingest/reconcileState.test.ts convex/ingest/reconciler.ts convex/ingest/reconciler.test.ts convex/state.ts convex/state.test.ts
rtk git commit -m "perf: reconcile Berdu order gaps incrementally"
```

---

### Task 5: Bound follow-up and lifecycle message reads

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/followUp.ts`
- Modify: `convex/messages.ts`
- Modify: `convex/conversationLifecycle.ts`
- Modify: `convex/followUp.test.ts`
- Modify: `convex/conversationLifecycle.test.ts`

**Interfaces:**
- Produces index: `messages.by_conversation_direction_createdAt`.
- Preserves candidate stage calculations and lifecycle closing rules.

- [ ] **Step 1: Add regression tests for long mixed-direction histories**

Create conversations with more than 120 alternating messages. Assert latest inbound lookup, follow-up touch count, candidacy, and stale closure remain identical.

- [ ] **Step 2: Add and use the composite index**

```ts
.index("by_conversation_direction_createdAt", ["conversationId", "direction", "createdAt"])
```

Replace every conversation message query shaped as `.withIndex("by_conversation_createdAt")...filter(direction)` with:

```ts
.withIndex("by_conversation_direction_createdAt", (q) =>
  q.eq("conversationId", conversationId).eq("direction", "inbound"),
)
```

Apply the analogous outbound range for follow-up touches.

- [ ] **Step 3: Scope lifecycle pagination by organization and open status**

Paginate `by_org_status_updatedAt` separately for `active` and `handover`; never paginate the global table and filter `orgId` afterward. Keep the batch at 25 and preserve the marker/recap/stale decision order.

- [ ] **Step 4: Remove global CS registry fallback in candidacy**

Use `csConfigs.by_org_key` for canonical key lookup. If legacy rows without a key still require fallback, use the org-scoped `by_org_active` range and add a coverage assertion before removing the fallback.

- [ ] **Step 5: Verify and commit**

Run `rtk npx vitest run convex/followUp.test.ts convex/conversationLifecycle.test.ts convex/messages.test.ts convex/orgIsolation.test.ts`.

```powershell
rtk git add convex/schema.ts convex/followUp.ts convex/messages.ts convex/conversationLifecycle.ts convex/followUp.test.ts convex/conversationLifecycle.test.ts
rtk git commit -m "perf: index directional message reads"
```

---

### Task 6: Complete rollup-backed analytics

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/rollups.ts`
- Modify: `convex/rollupReaders.ts`
- Modify: `convex/shippingRecaps.ts`
- Modify: `convex/analytics.ts`
- Modify: `convex/rollups.test.ts`
- Modify: `convex/rollupReaders.test.ts`

**Interfaces:**
- Extends `dailyRollups.byProduct` with optional migration fields: `leadOrders`, `revenue`, `discount`, `cod`, `transfer`.
- Adds rollup totals `cod` and `transfer` as optional during migration, required after backfill.
- Produces exact raw fallback for non-aligned live windows.

- [ ] **Step 1: Add parity tests before schema changes**

For sealed one-day, seven-day, CS-filtered, and product-rich fixtures, compare the rollup reader to the existing raw calculation. Add a partial midnight-to-now fixture and assert it uses exact range rows rather than the surrounding 16:00 window.

- [ ] **Step 2: Extend product rollup facts**

```ts
byProduct: v.array(v.object({
  product: v.string(),
  leads: v.number(),
  closings: v.number(),
  leadOrders: v.optional(v.number()),
  revenue: v.optional(v.number()),
  discount: v.optional(v.number()),
  cod: v.optional(v.number()),
  transfer: v.optional(v.number()),
})),
cod: v.optional(v.number()),
transfer: v.optional(v.number()),
```

Compute these values from the order and recap slices already loaded by `computeRollupValues`; do not add another table query.

- [ ] **Step 3: Remove redundant raw analytics reads**

- `periodReportFromRollups`: sum `rollup.cancelled`; remove the `shippingRecaps` query.
- `productDifficultyFromRollups`: use `byProduct.leadOrders` and `closings` for current/previous sealed windows.
- `performanceFromRollups`: use rollup totals and product facts for aligned windows.
- For non-aligned ranges, calculate the complete response from the exact raw orders/recaps already read; never mix whole-window totals with partial raw details.

- [ ] **Step 4: Backfill and enforce**

Deploy optional fields, run the existing bounded rollup backfill/true-up across retained windows, verify `debugRollupParity` has zero mismatches, then flip the new fields to required in a separate commit.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
rtk npx vitest run convex/rollups.test.ts convex/rollupReaders.test.ts convex/analytics.test.ts convex/shippingRecaps.test.ts
rtk npx vitest run
rtk npm run build
```

Expected: zero failures and parity zero for every sealed fixture.

```powershell
rtk git add convex/schema.ts convex/rollups.ts convex/rollupReaders.ts convex/shippingRecaps.ts convex/analytics.ts convex/rollups.test.ts convex/rollupReaders.test.ts
rtk git commit -m "perf: serve sealed analytics entirely from rollups"
```

---

### Task 7: Reduce safe per-event ingestion overhead

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/agents.ts`
- Modify: `convex/ingest/core.ts`
- Modify: `convex/closingRules.ts`
- Modify: `convex/agents.test.ts`
- Modify: `convex/ingest/core.test.ts`

**Interfaces:**
- Produces index: `csConfigs.by_org_providerNumberId`.
- Preserves raw capture, replay, message deduplication, closing detection, and response sampling.

- [ ] **Step 1: Add resolver parity and tenant-collision tests**

Assert that two organizations may reuse the same provider identifier without cross-resolution and that legacy `providerNumberIds` arrays still resolve during migration.

- [ ] **Step 2: Prefer indexed scalar provider resolution**

```ts
.index("by_org_providerNumberId", ["orgId", "providerNumberId"])
```

Thread `orgId` into `resolveAgent` and point-query the scalar provider ID first. Keep an org-scoped registry fallback only for legacy array aliases. Seed/backfill scalar IDs where an unambiguous first provider ID exists.

- [ ] **Step 3: Keep closing-rule reads small and org-scoped**

Continue querying only `closingRules.by_org_active`; do not embed tenant rules in code. Avoid resolving closing phrases for inbound messages or outbound message types that cannot represent a closing signal.

- [ ] **Step 4: Verify capture-first invariants**

Run `rtk npx vitest run convex/agents.test.ts convex/ingest/core.test.ts convex/ingest/events.test.ts convex/orgIsolation.test.ts`.

Expected: raw event remains replayable; duplicate external message IDs remain idempotent; closing and response sample tests pass.

- [ ] **Step 5: Commit**

```powershell
rtk git add convex/schema.ts convex/agents.ts convex/ingest/core.ts convex/closingRules.ts convex/agents.test.ts convex/ingest/core.test.ts
rtk git commit -m "perf: use indexed agent resolution during ingestion"
```

---

### Task 8: Production gate and measurement

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/SAAS-BLUEPRINT.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: measured before/after record and the go/no-go gate for PWA work.

- [ ] **Step 1: Run the local release gate**

```powershell
rtk npx tsc --noEmit -p convex
rtk npx vitest run
rtk npm run build
```

Expected: all commands exit zero.

- [ ] **Step 2: Deploy schema/code in migration-safe order**

Deploy additive indexes and optional fields first. Run bounded backfill/parity checks. Only then deploy required-field enforcement and reader cutover.

- [ ] **Step 3: Record 24-hour production results**

Capture Convex `Database I/O` and `Function Calls` tabs for the first comparable full day. Record:

```text
Baseline date: 2026-07-18
Baseline DB I/O: 193.2 MB
Primary target: <= 135 MB/day at comparable traffic
Stretch target: <= 115 MB/day
Hard correctness gates: 0 test failures; 0 rollup parity mismatches; 0 tenant-isolation regressions
```

If traffic differs, compare bytes per function call instead of raw daily totals.

- [ ] **Step 4: Update roadmap and commit**

Mark completed remediation items and record actual before/after figures. PWA planning begins only after the correctness gates pass; missing the stretch target alone does not block PWA if per-call I/O improved and no function approaches Convex read limits.

```powershell
rtk git add docs/ROADMAP.md docs/SAAS-BLUEPRINT.md
rtk git commit -m "docs: record Convex I/O remediation results"
```

---

## Self-review

- **Spec coverage:** two failing tests → Task 1; health scan → Task 2; response cache → Task 3; counter scan → Task 4; follow-up/lifecycle → Task 5; analytics → Task 6; ingestion → Task 7; measurement/deploy → Task 8.
- **Scope boundary:** PWA, billing, onboarding, and tenant credential storage remain separate projects.
- **Type consistency:** all new indexes are org-prefixed; migration fields are optional until the backfill gate.
- **Reliability:** capture-first ingestion and replay retention are explicitly preserved.

