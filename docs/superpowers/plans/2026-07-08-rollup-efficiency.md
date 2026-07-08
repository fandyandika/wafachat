# Rollup Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace derive-on-read panel analytics (268 MB/day DB I/O) with `dailyRollups` + `responseSamples` maintained compute-on-write, cutting DB I/O ±90% while keeping every metric's meaning and output shape identical.

**Architecture:** Every write touching `orders`/`shippingRecaps` triggers a bounded recompute of ONE `dailyRollups` row (per csKey per 16:00-WIB window) — idempotent, drift-proof. Response-time medians come from a tiny `responseSamples` fact table written during message ingest (pairing state on the conversation doc). A nightly true-up rebuilds yesterday+today from raw as the safety net. Readers switch to rollups only after a parity harness proves old==new.

**Tech Stack:** Convex 1.39 (internalMutation/internalAction/cron), Next.js 14, vitest edge-runtime, convex-test.

**Spec:** `docs/superpowers/specs/2026-07-08-rollup-efficiency-design.md` (read once before starting).

## Global Constraints

- Repo root: `cd /f/Projects/whatsapp_cs_automotion/wafachat` — cwd resets between Bash calls; prefix every command.
- Fact-Forcing Gate quote (verbatim): `"Yes, harus roll up dulu ya... berikan suggestion atau rekomendasi terbaik dan implementasikan saja langsung"`.
- **Metric semantics are frozen.** Filters copied exactly from existing code: exclude `isInternalTestPhone` (convex/lib.ts:43), exclude recap status `cancelled`/`cancelled_after_export`, closing dedup key = `orderIdBerdu ?? customerPhone` (latest wins), grouping by `csKey` (convex/lib.ts:12), reply = outbound with `messageType !== "template" && role !== "system"`, gap = active-minutes with wall-clock fallback (convex/responseTimeMath.ts:66-67), SLA breach = `isSlaBreach` (>15 business-min).
- **Output shapes of public queries are frozen** — FE must not need changes except Task 10 (window unification). Legacy implementations stay as `*Legacy` internal queries until Task 11 cleanup.
- windowKey = "YYYY-MM-DD" label date of the 16:00→16:00 WIB window (the date the window OPENS). `fourPmWibMs(y,mIdx,d) = Date.UTC(y,mIdx,d,9,0,0)`.
- Auth enforcement LIVE: new public functions (`backfillRange`, `oldestWindowKey`, `debugRollupParity`) call `requireAdmin`. Readers keep their existing guards unchanged. Engine fns are internal or plain exported helpers.
- Existing 195 tests must stay green. `convex/_generated` is TRACKED — include in commits when codegen changes it.
- `git add` specific files only (never `-A`). Subagents do NOT deploy or push — the controller deploys at milestone gates.
- Controller deploy discipline: `npm run build` exit 0 → `npx vitest run` green → `npx convex deploy -y`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `convex/lib.ts` | modify | + `fourPmWibMs`, `windowKeyFor(ms)`, `windowRangeForKey(key)`, `windowKeyToday(now)` |
| `convex/schema.ts` | modify | + `dailyRollups`, `responseSamples`, `conversations.rtPendingInboundAt` |
| `convex/rollups.ts` | create | engine: `computeRollupRow`, bump helpers, `recomputeWindow`, true-up, backfill, parity |
| `convex/rollupReaders.ts` | create | rollup-based reader impls (one per legacy query, identical output shapes) |
| `convex/state.ts`, `convex/shippingRecaps.ts` | modify | instrument every order/recap write site with bump calls |
| `convex/messages.ts` | modify | sample extraction in `appendMessageCore` |
| `convex/responseTimeMath.ts` | modify | + `pairResponsePairs` (all pairs, not just first) |
| `convex/crons.ts` | modify | + nightly true-up 20:00 UTC |
| `convex/responseTime.ts`, `analytics.ts`, `metrics.ts`, `followUp.ts`, `shippingRecaps.ts` | modify (Task 9) | public bodies → rollup readers; legacy kept internal |
| `components/panel/report-window.ts`, `app/panel/page.tsx`, `app/panel/performance/page.tsx` | modify (Task 10) | single 16:00-WIB boundary + re-exported helpers |

---

# Milestone M1 — Engine + write-path instrumentation (readers untouched; zero risk)

### Task 1: Window helpers in `convex/lib.ts`

**Files:** Modify `convex/lib.ts` · Test: extend `convex/lib.test.ts` if it exists, else create it.

**Interfaces — Produces (all later tasks consume):**
```ts
export function fourPmWibMs(y: number, mIdx: number, d: number): number;
export function windowKeyFor(ms: number): string;
export function windowRangeForKey(key: string): { startAt: number; endAt: number };
export function windowKeyToday(now?: number): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { fourPmWibMs, windowKeyFor, windowRangeForKey, windowKeyToday } from "./lib";

describe("report window helpers (16:00 WIB)", () => {
  test("fourPmWibMs = 09:00 UTC of that date", () => {
    expect(fourPmWibMs(2026, 6, 8)).toBe(Date.UTC(2026, 6, 8, 9, 0, 0));
  });
  test("windowKeyFor: 15:59 WIB belongs to yesterday's window; 16:00 to today's", () => {
    expect(windowKeyFor(Date.UTC(2026, 6, 8, 8, 59, 59))).toBe("2026-07-07");
    expect(windowKeyFor(Date.UTC(2026, 6, 8, 9, 0, 0))).toBe("2026-07-08");
  });
  test("windowRangeForKey roundtrips", () => {
    const r = windowRangeForKey("2026-07-08");
    expect(r.startAt).toBe(fourPmWibMs(2026, 6, 8));
    expect(r.endAt).toBe(fourPmWibMs(2026, 6, 9));
    expect(windowKeyFor(r.startAt)).toBe("2026-07-08");
    expect(windowKeyFor(r.endAt - 1)).toBe("2026-07-08");
  });
  test("windowKeyToday delegates to windowKeyFor", () => {
    const now = Date.UTC(2026, 6, 8, 3, 0, 0); // 10:00 WIB -> window opened 7 Jul 16:00
    expect(windowKeyToday(now)).toBe("2026-07-07");
  });
  test("year boundary", () => {
    expect(windowKeyFor(Date.UTC(2026, 0, 1, 1, 0, 0))).toBe("2025-12-31");
  });
});
```

- [ ] **Step 2:** `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/lib.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement** — append to `convex/lib.ts`:

```ts
// ── Report-window helpers (16:00→16:00 WIB business day) ─────────────────────
// Single source of truth; components/panel/report-window.ts re-exports these (Task 10).
export function fourPmWibMs(y: number, mIdx: number, d: number): number {
  return Date.UTC(y, mIdx, d, 9, 0, 0); // 16:00 WIB == 09:00 UTC
}

/** Label date ("YYYY-MM-DD") of the 16:00-WIB window containing `ms` (date the window OPENS). */
export function windowKeyFor(ms: number): string {
  const shifted = new Date(ms - 9 * 3_600_000); // 16:00 WIB becomes UTC midnight
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function windowRangeForKey(key: string): { startAt: number; endAt: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { startAt: fourPmWibMs(y, m - 1, d), endAt: fourPmWibMs(y, m - 1, d + 1) };
}

export function windowKeyToday(now = Date.now()): string {
  return windowKeyFor(now);
}
```

- [ ] **Step 4:** Run test → PASS; `npx vitest run` full suite green.
- [ ] **Step 5:** `git add convex/lib.ts convex/lib.test.ts && git commit -m "feat(rollup): 16:00-WIB window helpers in convex/lib (single source of truth)"`

---

### Task 2: Schema — `dailyRollups`, `responseSamples`, `conversations.rtPendingInboundAt`

**Files:** Modify `convex/schema.ts`

- [ ] **Step 1:** Add after the `alertState` table:

```ts
  // ── Rollup efficiency (specs/2026-07-08-rollup-efficiency-design.md) ──────
  // 1 row per (csKey, 16:00-WIB window). Recomputed-bounded on every order/recap
  // write; idempotent (row = pure function of raw rows) -> drift impossible.
  dailyRollups: defineTable({
    windowKey: v.string(),
    csKey: v.string(),
    csName: v.string(),
    orgId: v.optional(v.string()),
    leadOrders: v.number(),
    leadsCust: v.number(),
    closings: v.number(),
    closedCust: v.number(),
    cancelled: v.number(),
    manualClosings: v.number(),
    delivered: v.number(),
    revenue: v.number(),
    discount: v.number(),
    fuClosings: v.number(),
    fuH1: v.number(),
    fuH2: v.number(),
    fuH3: v.number(),
    byProduct: v.array(v.object({ product: v.string(), leads: v.number(), closings: v.number() })),
    updatedAt: v.number(),
  })
    .index("by_window_cs", ["windowKey", "csKey"])
    .index("by_windowKey", ["windowKey"]),

  // Tiny fact row per detected reply pair. NO first/ongoing tag: "first" is
  // window-dependent (earliest pair per conversation WITHIN the queried window),
  // so readers derive it — exactly reproducing pairResponseEvents semantics.
  responseSamples: defineTable({
    csKey: v.string(),
    csName: v.string(),
    conversationId: v.id("conversations"),
    deltaMs: v.number(),
    inboundAt: v.number(),
    slaBreach: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_cs_createdAt", ["csKey", "createdAt"]),
```

And inside the existing `conversations` table add one optional field:
```ts
    rtPendingInboundAt: v.optional(v.number()), // response-time pairing state (first inbound of current streak)
```

- [ ] **Step 2:** `npm run build && npx vitest run` → green.
- [ ] **Step 3:** `git add convex/schema.ts && git commit -m "feat(rollup): schema — dailyRollups, responseSamples, conversations.rtPendingInboundAt"`

---

### Task 3: Rollup engine — `convex/rollups.ts`

**Files:** Create `convex/rollups.ts` · Test `convex/rollups.test.ts`

**Interfaces — Produces:**
```ts
export async function computeRollupRow(ctx: any, csKeyArg: string, windowKey: string): Promise<void>; // recompute + upsert one row; delete row when all counters zero
export async function bumpForOrderDoc(ctx: any, before: any | null, after: any | null): Promise<void>;
export async function bumpForRecapDoc(ctx: any, before: any | null, after: any | null): Promise<void>;
export const recomputeWindow = internalMutation({ args: { windowKey: v.string() } }); // all csKeys in window (incl. stale rollup rows)
```

**Aggregation contract (THE critical port):** `computeRollupRow` reproduces `analytics.getDailyReport` (convex/analytics.ts:296-427) scoped to one csKey+window. Implementer MUST read that function first and port its loops EXACTLY: orders `by_createdAt` bounded to `windowRangeForKey(windowKey)` filtered to csKey + `!isInternalTestPhone`; recaps `by_closedAt` same bounds excluding `cancelled`/`cancelled_after_export` for closing counts (cancelled counted separately); orphan-recap CS/product attribution via `by_orderId` then `by_customerPhone` order lookups (analytics.ts:331-343); closing dedup latest-wins by `orderIdBerdu ?? customerPhone`; `closedCust` = distinct customerPhone among closings; revenue `total ?? codValue ?? nonCodItemPrice`; discount sum; `manualClosings` = closings without `sourceMessageId`; `delivered` = included recaps with status "delivered"; `fuClosings`/`fuH1`/`fuH2`/`fuH3` from `followUpTouchesAtClose` (>=1 / ==1 / ==2 / >=3); `byProduct` per-product leads+closings, cap 50 entries + overflow bucket `"lainnya"`; `csName` = most frequent raw name among the window's rows for the csKey.

- [ ] **Step 1: Write the failing tests** (`convex/rollups.test.ts`):

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { windowRangeForKey } from "./lib";

const W = "2026-07-08";
const t0 = windowRangeForKey(W).startAt + 3_600_000;

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-1", customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-2", customerPhone: "6281000000001", customerName: "A", assignedCsName: "Azelia", productName: "Buku Sirah", createdAt: t0 + 1, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-3", customerPhone: "6281000000002", customerName: "B", assignedCsName: "Azelia", productName: "Quran Medis", createdAt: t0 + 2, updatedAt: t0 } as any);
    await ctx.db.insert("orders", { orderId: "O-4", customerPhone: "6281385708799", customerName: "T", assignedCsName: "Azelia", productName: "Buku Sirah", createdAt: t0 + 3, updatedAt: t0 } as any); // internal test phone -> excluded
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000001", csName: "Azelia", orderIdBerdu: "O-1", status: "exported", total: 100000, discount: 5000, followUpTouchesAtClose: 2, sourceMessageId: "m1", packageContent: "Buku Sirah", closedAt: t0 + 10, createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000002", csName: "Azelia", orderIdBerdu: "O-3", status: "delivered", total: 200000, packageContent: "Quran Medis", closedAt: t0 + 11, createdAt: t0, updatedAt: t0, version: 1 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000005", csName: "Azelia", orderIdBerdu: "O-9", status: "cancelled", total: 50000, packageContent: "Buku Sirah", closedAt: t0 + 12, createdAt: t0, updatedAt: t0, version: 1 } as any);
  });
}

test("computeRollupRow reproduces getDailyReport aggregation rules", async () => {
  const t = convexTest(schema);
  await seed(t);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    windowKey: W,
    leadOrders: 3, leadsCust: 2,
    closings: 2, closedCust: 2, cancelled: 1,
    manualClosings: 1, delivered: 1,
    revenue: 300000, discount: 5000,
    fuClosings: 1, fuH1: 0, fuH2: 1, fuH3: 0,
  });
  const prods = Object.fromEntries(rows[0].byProduct.map((p: any) => [p.product, p]));
  expect(prods["Buku Sirah"]).toMatchObject({ leads: 2, closings: 1 });
  expect(prods["Quran Medis"]).toMatchObject({ leads: 1, closings: 1 });
});

test("empty window produces no row", async () => {
  const t = convexTest(schema);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: "2026-07-01" });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", "2026-07-01")).collect());
  expect(rows).toHaveLength(0);
});

test("orphan recap attributed via order fallback like legacy", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-7", customerPhone: "6281000000007", customerName: "C", assignedCsName: "Lila", productName: "Buku Sirah", createdAt: t0, updatedAt: t0 } as any);
    await ctx.db.insert("shippingRecaps", { customerPhone: "6281000000007", orderIdBerdu: "O-7", status: "ready", total: 90000, packageContent: "Buku Sirah", closedAt: t0 + 5, createdAt: t0, updatedAt: t0, version: 1 } as any);
  });
  await t.mutation(internal.rollups.recomputeWindow, { windowKey: W });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("dailyRollups").withIndex("by_windowKey", (q) => q.eq("windowKey", W)).collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].closings).toBe(1);
});
```

**NOTE for implementer:** legacy behavior is the contract. Read `analytics.getDailyReport` and the `shippingRecaps`/`orders` schema FIRST; if any assertion above contradicts actual legacy behavior or actual field names, FIX THE TEST to match legacy and record it in your report.

- [ ] **Step 2:** RED (module missing).
- [ ] **Step 3: Implement.** Structure:

```ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { csKey as csKeyOf, isInternalTestPhone, windowKeyFor, windowRangeForKey } from "./lib";

const PRODUCT_CAP = 50;

export async function computeRollupRow(ctx: any, csKeyArg: string, windowKey: string): Promise<void> {
  const { startAt, endAt } = windowRangeForKey(windowKey);
  // [PORT of analytics.getDailyReport loops, single-CS scoped — see Aggregation contract]
  // 1) collect orders + recaps in window for this csKey (incl. orphan attribution)
  // 2) aggregate every schema field
  // 3) upsert via by_window_cs; delete existing row when all counters are zero
}

export async function bumpForOrderDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.createdAt) continue;
    const k = csKeyOf(doc.assignedCsName);
    const w = windowKeyFor(doc.createdAt);
    pairs.set(`${k}|${w}`, { k, w });
  }
  for (const { k, w } of pairs.values()) await computeRollupRow(ctx, k, w);
}

export async function bumpForRecapDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.closedAt) continue;
    const k = csKeyOf(doc.csName);
    const w = windowKeyFor(doc.closedAt);
    pairs.set(`${k}|${w}`, { k, w });
  }
  for (const { k, w } of pairs.values()) await computeRollupRow(ctx, k, w);
}

export const recomputeWindow = internalMutation({
  args: { windowKey: v.string() },
  handler: async (ctx, args) => {
    const { startAt, endAt } = windowRangeForKey(args.windowKey);
    const keys = new Set<string>();
    // csKeys from: orders in window, recaps in window (incl. orphan attribution),
    // AND existing dailyRollups rows for the window (so stale rows get zeroed/deleted).
    // then: for (const k of keys) await computeRollupRow(ctx, k, args.windowKey);
    return { windowKey: args.windowKey, csKeys: keys.size };
  },
});
```

The two `[PORT...]`/comment bodies are ports of analytics.ts:296-427 — the implementer writes them from the legacy source; the tests above plus Task 8's parity regression are the acceptance gates.

- [ ] **Step 4:** GREEN + full suite green.
- [ ] **Step 5:** `git add convex/rollups.ts convex/rollups.test.ts && git commit -m "feat(rollup): engine — computeRollupRow (getDailyReport-parity), bump helpers, recomputeWindow"`

---

### Task 4: Instrument every order/recap write site

**Files:** Modify `convex/state.ts`, `convex/shippingRecaps.ts` · Test: extend `convex/rollups.test.ts`

**Known sites (implementer MUST re-run `grep -n 'db.insert("orders"\|db.insert("shippingRecaps"\|db.patch\|db.delete' convex/state.ts convex/shippingRecaps.ts` and cover ALL hits that touch orders/shippingRecaps rows; reviewer verifies completeness against the grep):**
- `state.ts`: ~131 (order insert in the legacy upsert path — verify), 293/298 (`upsertOrderCore` patch/insert), ~795 (order delete in `deleteOrder`)
- `shippingRecaps.ts`: 426/431, 507/509, 583/586 (recap upserts), 679, 796, 810, 823, 850, 877, 905, 926, 937, 952, 990 (status/flags/delivered/exported/cancel/undo patches), 1069/1075 (`importBerduVerifiedRows`), 1139, 1338 (recap CS reassign), 1347 (order CS reassign)

**Pattern per site:** capture `before` (`await ctx.db.get(id)` — most patch sites already hold the doc), do the write, then `await bumpForRecapDoc(ctx, before, await ctx.db.get(id))` (or `bumpForOrderDoc`; insert → before=null; delete → after=null). One import per file: `import { bumpForOrderDoc, bumpForRecapDoc } from "./rollups";`. Simple rule: bump on EVERY write to these two tables (idempotent + cheap; do not micro-optimize which fields changed).

- [ ] **Step 1: Failing tests** — exercise the REAL mutation entry points (not `t.run`), 5 focused tests:
  1. `internal.state.upsertOrderFromN8n` (new order) → rollup row `leadOrders: 1`.
  2. `internal.messages.appendMessageFromN8n` outbound "PEMESANAN BERHASIL..." (creates recap via closing detection) → rollup `closings: 1`.
  3. The cancel mutation (find the public/internal name at shippingRecaps.ts:952 area, e.g. markCancelled/cancelRecap) → `cancelled: 1`, `closings: 0`.
  4. The undo/restore mutation (≈:990) → back to `closings: 1`.
  5. The recap CS-reassign mutation (≈:1338) → old csKey row zeroed/deleted, new csKey row has the closing.
- [ ] **Step 2:** RED → **Step 3:** instrument all sites → **Step 4:** GREEN + full suite green (existing 195 prove no behavior change).
- [ ] **Step 5:** `git add convex/state.ts convex/shippingRecaps.ts convex/rollups.test.ts && git commit -m "feat(rollup): bump rollups from every order/recap write path"`

---

### Task 5: Response samples — streaming extraction in `appendMessageCore`

**Files:** Modify `convex/messages.ts` · Test: create `convex/responseSamples.test.ts`

**Mechanism:** in `appendMessageCore`, after externalMessageId dedup and message insert, extend the existing conversation patch:
- inbound message → if `conversation.rtPendingInboundAt` undefined, add `rtPendingInboundAt: createdAt` to the patch.
- outbound with `messageType !== "template" && role !== "system"` and `rtPendingInboundAt` defined → insert `responseSamples` row `{ csKey: csKeyOf(conversation.assignedCsName ?? args.csName ?? "Unknown"), csName: conversation.assignedCsName ?? args.csName ?? "Unknown", conversationId, deltaMs, inboundAt: pending, slaBreach: isSlaBreach(pending, createdAt), createdAt }` where `deltaMs = Math.round(businessMinutesBetween(pending, createdAt) * 60_000) || (createdAt - pending)` (exact pairResponseEvents formula), then add `rtPendingInboundAt: undefined` to the patch.
- Imports: `businessMinutesBetween`, `isSlaBreach` from `./responseTimeMath`; `csKey` from `./lib`.

- [ ] **Step 1: Failing tests** via `internal.messages.appendMessageFromN8n`:
  (a) inbound→outbound (overnight timestamps → wall-clock fallback) = 1 sample, correct deltaMs;
  (b) inbound,inbound,outbound = 1 sample paired to FIRST inbound;
  (c) outbound template → no sample, pending preserved;
  (d) outbound with no pending → no sample;
  (e) replay same externalMessageId → no duplicate sample;
  (f) 20-min gap inside business hours (`Date.UTC(2026,6,8,3,0)` +20min) → `slaBreach: true`.
- [ ] **Step 2-4:** RED → implement → GREEN + full suite green.
- [ ] **Step 5:** `git add convex/messages.ts convex/responseSamples.test.ts && git commit -m "feat(rollup): streaming response-sample extraction (pairing state on conversation)"`

---

# Milestone M2 — True-up + backfill

### Task 6: `pairResponsePairs` + nightly true-up

**Files:** Modify `convex/responseTimeMath.ts`, `convex/rollups.ts`, `convex/crons.ts` · Tests: extend `convex/responseTimeMath.test.ts` + `convex/rollups.test.ts`

**Interfaces — Produces:**
```ts
// responseTimeMath.ts
export function pairResponsePairs(msgs: RtMessage[]): Array<{ inboundAt: number; replyAt: number; gapMs: number }>;
// pairResponseEvents reimplemented ON TOP of pairResponsePairs (existing tests prove equivalence)

// rollups.ts
export const rebuildSamplesForWindow = internalMutation({ args: { windowKey: v.string() } });
// delete responseSamples in window range; re-derive per conversation via pairResponsePairs over
// that conversation's messages in the window (group messages by conversationId exactly like
// legacy getResponseTimes does, same csName attribution), insert one sample per pair.
export const trueUp = internalAction({ args: {} });
// for windowKeys [yesterday, today]: runMutation rebuildSamplesForWindow + recomputeWindow
```

Cron: `crons.daily("rollup true-up", { hourUTC: 20, minuteUTC: 0 }, internal.rollups.trueUp, {})` (03:00 WIB).

- [ ] **Step 1: Failing tests:** (a) `pairResponsePairs([in,out,in,out])` → 2 pairs with correct gaps; existing responseTimeMath tests still green after reimplement; (b) corrupt one rollup field + insert one bogus sample via `t.run` → `t.action(internal.rollups.trueUp, {})` → rollup corrected, bogus sample gone, correct samples present.
- [ ] **Step 2-4:** RED → implement → GREEN + full suite.
- [ ] **Step 5:** `git add convex/responseTimeMath.ts convex/rollups.ts convex/crons.ts convex/rollups.test.ts convex/responseTimeMath.test.ts && git commit -m "feat(rollup): nightly true-up — exact sample rebuild + window recompute"`

---

### Task 7: Backfill (batched, admin) + parity harness

**Files:** Modify `convex/rollups.ts` · Test: extend `convex/rollups.test.ts`

**Interfaces — Produces:**
```ts
export const oldestWindowKey = query({ args: {} });
// requireAdmin. windowKeyFor(first order by_createdAt asc); null when no orders.
export const backfillRange = mutation({ args: { fromKey: v.string(), toKey: v.string() } });
// requireAdmin. Iterate windowKeys fromKey..toKey inclusive, CAP 40 per call (caller loops):
// per window run the rebuildSamplesForWindow logic + recomputeWindow logic (call their shared
// plain-fn implementations — extract `rebuildSamplesForWindowImpl(ctx, key)` and
// `recomputeWindowImpl(ctx, key)` so both the internalMutations and backfill share them).
// Returns { processed: string[], nextFromKey: string | null }.
export const debugRollupParity = query({ args: { windowKey: v.string() } });
// requireAdmin. For the window: recompute all csKey aggregates IN MEMORY (same pure logic, no
// writes) and diff against stored dailyRollups rows field-by-field.
// Returns { windowKey, mismatches: Array<{ csKey, field, stored, fresh }>, storedRows, freshRows }.
```

- [ ] **Step 1: Failing tests:** backfill over 2 seeded windows creates both + `nextFromKey: null`; cap honored (>40-window range returns nextFromKey); oldestWindowKey correct + null-empty case; debugRollupParity: clean data → `mismatches: []`, corrupt a stored field → 1 mismatch naming the field; all three reject non-admin (`rejects.toThrow(/unauthorized|admin/)`).
- [ ] **Step 2-4:** RED → implement (requires extracting shared `*Impl` plain fns) → GREEN + full suite.
- [ ] **Step 5:** `git add convex/rollups.ts convex/rollups.test.ts && git commit -m "feat(rollup): batched admin backfill + parity harness"`

**CONTROLLER GATE (after Task 7):** deploy M1+M2 → run backfill via `_admin.mjs` (`oldestWindowKey`, then loop `backfillRange` per ≤40 windows) → `debugRollupParity` on the last 7 windows → 0 mismatches required before M3.

---

# Milestone M3 — Readers switch (parity-gated)

### Task 8: `convex/rollupReaders.ts` + legacy-parity regression tests

**Files:** Create `convex/rollupReaders.ts` · Test `convex/rollupReaders.test.ts`

**Interfaces — Produces (plain exported async fns; each output DEEP-EQUALS its legacy query for the same args):**
```ts
export async function responseTimesFromSamples(ctx, args: { startAt: number; endAt: number; csName?: string });
export async function dailyReportFromRollups(ctx, args: { startAt: number; endAt: number });
export async function trendFromRollups(ctx, args: { startAt: number; endAt: number; bucket: "day" | "week" | "month"; csName?: string });
export async function dashboardSummaryFromRollups(ctx, args: { startAt: number; endAt: number; csName?: string }); // handovers + activeChats: COPY the two legacy reads (events by_type_createdAt; conversations active) — still derived
export async function leaderboardFromRollups(ctx, args);        // current + prior period sums
export async function productDifficultyFromRollups(ctx, args);
export async function periodReportFromRollups(ctx, args);
export async function performanceFromRollups(ctx, args);
export async function followUpEffectivenessFromRollups(ctx, args: { startAt: number; endAt: number; csName?: string });
```
Shared range helper inside the file: `windowKeysForRange(startAt, endAt): string[]` (from `windowKeyFor(startAt)` to `windowKeyFor(endAt - 1)`), rows via `by_windowKey` / `by_window_cs`. `responseTimesFromSamples`: fetch samples `by_createdAt` in range (or `by_cs_createdAt`), group by conversationId, earliest-in-range = the conversation's FIRST pair (its deltaMs feeds firstReply median/p90/count, its slaBreach feeds slaBreaches), remaining = ongoing; per-CS merge by csKey; `lastReplyAt` = max sample createdAt per csKey. Output field names/shapes must match `responseTime.getResponseTimes` exactly.

- [ ] **Step 1: Failing regression-parity tests** — for a rich synthetic dataset (extend Task 3 seed: second CS, second window, messages producing 3+ reply pairs incl. template/system noise, followUpTouchesAtClose variety), assert for EVERY fn: `expect(await rollupImpl).toEqual(await legacyPublicQuery)` for (a) full-window args, (b) csName-filtered, (c) multi-window range. Legacy called via admin identity on the existing public queries; rollup fns via `t.run(ctx => fn(ctx, args))`. Run backfill logic first (recomputeWindow + rebuildSamplesForWindow on the seeded windows).
- [ ] **Step 2-4:** RED → implement → GREEN + full suite.
- [ ] **Step 5:** `git add convex/rollupReaders.ts convex/rollupReaders.test.ts && git commit -m "feat(rollup): rollup readers with legacy-parity regression tests (deepEqual old==new)"`

---

### Task 9: Switch the public queries (legacy kept as `*Legacy` internal)

**Files:** Modify `convex/responseTime.ts`, `convex/analytics.ts`, `convex/metrics.ts`, `convex/followUp.ts`, `convex/shippingRecaps.ts`

For each of `getResponseTimes`, `getDailyReport`, `getTrend`, `getDashboardSummary`, `getCsLeaderboard`, `getProductDifficulty`, `getPeriodReport`, `getPerformance`, `getFollowUpEffectiveness`:
1. Rename current implementation to `export const <name>Legacy = internalQuery({ args: <same>, handler: <same minus the requireX guard> });`
2. Re-declare the public query with the ORIGINAL name/args/guard; body delegates to the matching `*FromRollups`/`FromSamples` fn.
3. Names, args, output shapes unchanged → zero FE edits.

- [ ] **Step 1:** Full suite green is the regression proof (every existing test that exercises these queries now runs through rollups). Add 1 smoke test: seeded data → public `analytics.getDailyReport` returns the Task 3 expected closings via the new path.
- [ ] **Step 2-3:** implement → `npm run build && npx vitest run` green.
- [ ] **Step 4:** `git add convex/responseTime.ts convex/analytics.ts convex/metrics.ts convex/followUp.ts convex/shippingRecaps.ts && git commit -m "feat(rollup): switch panel readers to rollups (legacy kept internal)"`

**CONTROLLER GATE (after Task 9):** deploy → live spot-check panel vs `_admin.mjs` reads + `debugRollupParity` last 7 windows → watch Convex Usage collapse. Rollback = redeploy prior commit.

---

# Milestone M4 — Window unification + closeout

### Task 10: One day-boundary everywhere (16:00 WIB)

**Files:** Modify `components/panel/report-window.ts`, `app/panel/page.tsx`, `app/panel/performance/page.tsx`, plus every builder of range args (implementer greps `startOfJakartaDayMs|periodRange|bucketKey|rangeArgs` under `app/` + `components/panel/`).

- `report-window.ts`: replace the local `fourPmWibMs` with `export { fourPmWibMs, windowKeyFor, windowRangeForKey, windowKeyToday } from "@/convex/lib";` — keep `reportWindowForLabelDate`/`wibDateParts`/`currentReportLabelDate` implemented on top. If the Next build rejects importing from `convex/lib.ts` client-side, extract the four helpers to `lib/report-window-core.ts` and have BOTH convex/lib and report-window re-export from it (still one source of truth; duplication is NOT acceptable).
- Dashboard + Performance range pickers: ranges snap to whole windows (`windowRangeForKey`); "Hari ini" = currently-open window (`windowKeyToday`). URL param shape (`?range&cs`) unchanged. Trend bucket labels = windowKey dates.
- [ ] **Step 1:** `npm run build` exit 0 + `npx vitest run` green.
- [ ] **Step 2:** `git add <touched files> && git commit -m "feat(rollup): unify all pages on the 16:00-WIB business window"`

---

### Task 11: Closeout (controller checklist — not a subagent dispatch)

- [ ] After ≥2 clean days (`debugRollupParity` + Convex Usage graph): dispatch one small subagent to delete the `*Legacy` internalQueries + commit.
- [ ] Edit spec §8 with MEASURED before/after DB I/O numbers; commit.
- [ ] Update ledger + project memory.

## Definition of Done

- [ ] Panel numbers identical pre/post switch (parity harness + live spot-checks).
- [ ] Convex Usage: panel-query DB I/O collapsed (target ≥85% total reduction).
- [ ] True-up cron live; backfill complete; all tests green; build green.
- [ ] One day-boundary (16:00 WIB) across Laporan/Dashboard/Performance/Trend.
