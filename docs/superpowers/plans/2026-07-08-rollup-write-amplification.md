# Rollup Write-Amplification Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the per-write rollup recompute read only the target CS's slice of a window (via a stored `csKey` + compound index) instead of scanning the whole window, so `processEvent` DB-I/O drops (~77→~20 MB) and per-write cost is independent of other CS's volume and tenant size.

**Architecture:** Denormalize `csKey = csKey(rawName)` onto `orders` and `shippingRecaps` (mirrors the existing `responseSamples.by_cs_createdAt` pattern). Populate on write + backfill existing docs, then switch `computeRollupValues` reads to the new `by_csKey_*` indexes. Parity guards byte-identical rollup output.

**Tech Stack:** Convex 1.39, Next.js 14, vitest + convex-test.

## Global Constraints

- `csKey` field is `v.optional(v.string())` (existing docs lack it until backfilled; a required field would fail schema validation on deploy).
- The invariant: for every row, `csKey === csKey(rawName)` where rawName is `assignedCsName` (orders) / `csName` (recaps). Any write that sets the raw name MUST set `csKey`.
- `csKey` helper is `import { csKey } from "./lib"` (aliased `csKeyOf` inside rollups.ts).
- Rollup output MUST stay byte-identical (parity discipline from the Rollup Efficiency project).
- Deploy discipline: `npm run build` + `npx tsc --noEmit -p convex` + `npx vitest run` + `npx convex deploy -y`. **Controller deploys at milestone gates; subagents do NOT deploy/push.**
- cwd resets → prefix `cd /f/Projects/whatsapp_cs_automotion/wafachat`. `git add` specific files (never `-A`). `convex/_generated` IS tracked.
- Backfill bounded per run (windowed chunks, reuse `BACKFILL_WINDOW_CAP` pattern) to avoid the 10-min action / mutation-size limits.
- `recomputeWindowImpl` (daily trueUp) stays whole-window — DO NOT change it.

---

### Task 1: Schema `csKey` + write-path population

**Files:**
- Modify: `convex/schema.ts` (orders + shippingRecaps)
- Modify: `convex/state.ts` (`upsertOrderCore`)
- Modify: `convex/shippingRecaps.ts` + `convex/messages.ts` (every `insert("shippingRecaps"...)` / recap patch that sets `csName`)
- Test: `convex/state.test.ts`, `convex/shippingRecaps.test.ts`

**Interfaces:**
- Produces: `orders.csKey` + index `by_csKey_createdAt (["csKey","createdAt"])`; `shippingRecaps.csKey` + index `by_csKey_closedAt (["csKey","closedAt"])`. Task 3 consumes these indexes.

- [ ] **Step 1: Schema — add fields + indexes**

In `convex/schema.ts`, `orders` table: add `csKey: v.optional(v.string()),` to the field block and append `.index("by_csKey_createdAt", ["csKey", "createdAt"])` to its index chain. `shippingRecaps` table: add `csKey: v.optional(v.string()),` and append `.index("by_csKey_closedAt", ["csKey", "closedAt"])`.

- [ ] **Step 2: Populate on order write**

In `convex/state.ts` `upsertOrderCore`: wherever the order doc is built for insert/patch (the objects that set `assignedCsName: args.csName`), add `csKey: csKey(args.csName)`. Import `csKey` from `./lib` if not already imported. Cover BOTH the insert and every patch site that writes `assignedCsName`.

- [ ] **Step 3: Populate on recap write**

Grep every recap write: `rg 'insert\("shippingRecaps"' convex/` and `rg 'csName:' convex/shippingRecaps.ts convex/messages.ts`. For EACH `insert("shippingRecaps", {...})` and each patch that sets `csName`, add `csKey: csKey(<sameCsNameValue>)`. Import `csKey` from `./lib`. Note: `upsertRecapFromMessage` derives csName from the conversation — set `csKey` from that same resolved csName.

- [ ] **Step 4: Write the failing tests**

In `convex/state.test.ts`: after `upsertOrderCore` with `csName: "CS Aisyah"`, assert the stored order has `csKey === csKey("CS Aisyah")`. In `convex/shippingRecaps.test.ts`: after a recap-creating mutation with a raw name variant, assert stored recap `csKey === csKey(rawName)`.

- [ ] **Step 5: Run tests → fail, implement, run → pass**

Run: `npx vitest run convex/state.test.ts convex/shippingRecaps.test.ts`. Expect fail → after Steps 2-3 → pass.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p convex` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/state.ts convex/shippingRecaps.ts convex/messages.ts convex/state.test.ts convex/shippingRecaps.test.ts convex/_generated
git commit -m "feat(rollup): add csKey to orders+recaps + by_csKey_* indexes, populate on write"
```

**[CONTROLLER GATE — M1a]** Controller runs `npm run build` + `npx convex deploy -y`. New writes now carry `csKey`; existing docs still `undefined`.

---

### Task 2: Backfill `csKey` on existing docs + coverage gate

**Files:**
- Modify: `convex/rollups.ts` (or a new `convex/backfillCsKey.ts`) — add `backfillCsKey` mutation + `csKeyCoverage` query
- Test: `convex/rollups.test.ts`

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: `backfillCsKey({ table, cursorMs?, limit? })` (admin) and `csKeyCoverage()` (admin) returning `{ ordersMissing, recapsMissing }`.

- [ ] **Step 1: Coverage query**

Add admin query `csKeyCoverage`: count `orders` where `csKey === undefined` and `shippingRecaps` where `csKey === undefined`, via a bounded scan (or `by_createdAt`/`by_closedAt` walk). Return both counts.

- [ ] **Step 2: Backfill mutation (bounded)**

Add admin mutation `backfillCsKey({ table: "orders"|"recaps", cursorMs?: number, limit?: number })`: walk the table by `by_createdAt` (orders) / `by_closedAt` (recaps) ascending from `cursorMs`, take `limit` (default 500) rows with `csKey === undefined`, patch each with `csKey: csKey(assignedCsName|csName)`. Return `{ patched, nextCursorMs }` for the controller to iterate until drained.

- [ ] **Step 3: Test backfill + coverage**

In `convex/rollups.test.ts`: seed orders/recaps WITHOUT csKey (via `t.run` raw insert), run `backfillCsKey`, assert every row now has `csKey === csKey(rawName)` and `csKeyCoverage` returns 0/0.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run convex/rollups.test.ts` then `npx tsc --noEmit -p convex`.

- [ ] **Step 5: Commit**

```bash
git add convex/rollups.ts convex/rollups.test.ts convex/_generated
git commit -m "feat(rollup): backfillCsKey + csKeyCoverage for existing orders/recaps"
```

**[CONTROLLER GATE — M1b]** Controller deploys, then runs `backfillCsKey` in chunks (both tables) via `_admin.mjs` until drained, then `csKeyCoverage` → **must be `{0,0}` before Task 3.**

---

### Task 3: Switch `computeRollupValues` to csKey indexes + merge recap reads

**Files:**
- Modify: `convex/rollups.ts` (`computeRollupValues` reads, rollups.ts:38-51)
- Test: `convex/rollups.test.ts` (parity old-vs-new)

**Interfaces:**
- Consumes: `by_csKey_createdAt` / `by_csKey_closedAt` (Task 1), backfilled data (Task 2).

- [ ] **Step 1: Parity test FIRST**

In `convex/rollups.test.ts`, add a test that seeds a window with multiple CS (raw-name variants) + csKey set, computes rollup rows the OLD way (capture current output as the expected snapshot) and the NEW way, and asserts byte-identical `computeRollupValues` output per csKey. (Seed via mutations so csKey is populated.)

- [ ] **Step 2: Switch the reads**

Replace rollups.ts:38-51 reads:
```ts
const orders = (
  await ctx.db.query("orders")
    .withIndex("by_csKey_createdAt", (q: any) => q.eq("csKey", csKeyArg).gte("createdAt", startAt).lte("createdAt", endAt))
    .collect()
).filter((o: any) => !isInternalTestPhone(o.customerPhone));

const recapsAll = (
  await ctx.db.query("shippingRecaps")
    .withIndex("by_csKey_closedAt", (q: any) => q.eq("csKey", csKeyArg).gte("closedAt", startAt).lte("closedAt", endAt))
    .collect()
).filter((r: any) => !isInternalTestPhone(r.customerPhone));
const recaps = recapsAll.filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export");
const allCancelled = recapsAll.filter((r: any) => r.status === "cancelled" || r.status === "cancelled_after_export");
```
Delete the now-redundant `csKeyOf(...) === csKeyArg` JS filters (the index already scopes to csKey) and the second whole-window recap read. Everything downstream is unchanged.

- [ ] **Step 3: Run parity test + full suite + typecheck**

Run: `npx vitest run convex/rollups.test.ts convex/rollupReaders.test.ts` then `npx tsc --noEmit -p convex`. Expect all pass (parity byte-identical).

- [ ] **Step 4: Commit**

```bash
git add convex/rollups.ts convex/rollups.test.ts convex/_generated
git commit -m "perf(rollup): computeRollupValues reads csKey slice not whole window (+merge recap reads)"
```

**[CONTROLLER GATE — M2]** Controller deploys, then runs `rollups.debugRollupParity` over the live window range → **0 mismatches.** Confirms production rollups unchanged.

---

### Task 4: Throttle health-check cron 5 → 15 min (M3)

**Files:**
- Modify: `convex/crons.ts`

- [ ] **Step 1: Change interval**

In `convex/crons.ts`, the `"ingest silence detector"` cron: change `{ minutes: 5 }` to `{ minutes: 15 }`. (Silence threshold is 45 min → 15-min cadence still detects in time; ~12→4 MB/day.)

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit -p convex`.
```bash
git add convex/crons.ts convex/_generated
git commit -m "perf(ingest): health-check cron 5m -> 15m (45m silence threshold; ~8MB/day saved)"
```

**[CONTROLLER GATE — M3]** Controller deploys.

---

## Self-Review

- **Spec coverage:** M1 (schema+write-path+backfill) → Tasks 1-2; M2 (reader switch+parity) → Task 3; M3 (health cron) → Task 4. ✅
- **Sequencing:** csKey index read (Task 3) requires backfill complete (Task 2 gate `{0,0}`) — enforced by controller gate. ✅
- **Type consistency:** `csKey` field name + `csKey()` helper used consistently; indexes `by_csKey_createdAt` / `by_csKey_closedAt` referenced identically in schema (Task 1) and reader (Task 3). ✅
- **No behavior change:** parity test (Task 3 Step 1) is the gate; downstream aggregation untouched. ✅
