# Response Time per CS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-CS response-time metrics (first-reply median/p90 + ongoing median) on a derive-on-read Convex query, surfaced in the Laporan card, Performance table, and a Dashboard KPI.

**Architecture:** Derive-on-read. A new `messages.by_createdAt` index lets one query (`getResponseTimes`) scan a window, pair each customer turn with the next non-template CS reply (turn-based walk), join `conversations.assignedCsName`, and aggregate per CS. Pure helpers (`median`/`percentile`/`pairResponseEvents`) are unit-tested; the three UI surfaces merge the result by csName.

**Tech Stack:** Convex 1.39, Next.js 14 ('use client'), vitest 2 (edge-runtime) + convex-test, Tailwind + shadcn.

**Spec:** `docs/superpowers/specs/2026-06-23-response-time-per-cs-design.md`

## Global Constraints

- **A "CS reply"** = `direction==='outbound'` AND `messageType !== 'template'` AND `role !== 'system'`. Never filter on role to *detect* a reply (outbound role is mislabeled ai/cs).
- **A turn:** first customer `inbound` since the last reply sets `pendingInboundAt`; the next CS reply closes it (`gap = reply.createdAt − pendingInboundAt`) and clears it. Template/system outbounds are ignored (do NOT reset pending).
- **Attribution:** by `conversations.assignedCsName`. Display name = `normalizeCsName(raw)` (exported from `convex/shippingRecaps.ts`); also return `csNameRaw` (Performance leaderboard keys on raw).
- **Exclude** internal/CS phones via `isInternalTestPhone(message.customerPhone)` (from `convex/lib.ts`).
- `median` = middle (avg two middles if even); `percentile(nums, p)` = nearest-rank `sorted[ceil(p·n)−1]`; both return `null` for empty. p90 = `percentile(nums, 0.9)`.
- `formatDuration`: `<60s → "Ns"`, `<60m → "Nm"`, else `"Hj Mm"`; `null`/NaN → `"–"`.
- Derive-on-read only — no write-path change, no backfill. Do not touch `getDailyReport`/`getPerformance`/`computeCsAgg`/`getCsLeaderboard` logic.
- TDD per task. Commit after each green task; end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- cwd resets between shells — prefix every command with `cd /f/Projects/whatsapp_cs_automotion/wafachat &&`. Tests: `npx vitest run <file>`. Build gate: `npm run build` (must exit 0).

## File Structure

**Backend**
- `convex/responseTimeMath.ts` (create) — pure `median`, `percentile`, `pairResponseEvents` + `RtMessage` type.
- `convex/responseTimeMath.test.ts` (create).
- `convex/schema.ts` (modify) — add `by_createdAt` index to `messages`.
- `convex/responseTime.ts` (create) — `getResponseTimes` query.
- `convex/responseTime.test.ts` (create).

**Frontend**
- `lib/format.ts` (modify) — add `formatDuration`.
- `lib/format.test.ts` (create) — `formatDuration` tests.
- `components/panel/report-card.tsx` (modify) — `⚡ Respon` line.
- `components/panel/daily-report-dashboard.tsx` (modify) — fetch + merge by csName.
- `app/panel/page.tsx` (modify) — Dashboard `⚡ Avg respon` KPI.
- `app/panel/performance/page.tsx` (modify) — fetch getResponseTimes.
- `components/panel/performance-panel.tsx` (modify) — 2 leaderboard columns.

---

### Task 1: `responseTimeMath.ts` — pure helpers (median, percentile, turn-based pairing)

**Files:**
- Create: `convex/responseTimeMath.ts`
- Test: `convex/responseTimeMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RtMessage = { direction: 'inbound' | 'outbound'; messageType: string; role: string; createdAt: number }`
  - `median(nums: number[]): number | null`
  - `percentile(nums: number[], p: number): number | null`
  - `pairResponseEvents(msgs: RtMessage[]): { firstReplyMs: number | null; allReplyMs: number[] }` (msgs ascending by createdAt)

- [ ] **Step 1: Write the failing test**

Create `convex/responseTimeMath.test.ts`:
```ts
import { expect, test } from "vitest";
import { median, percentile, pairResponseEvents, type RtMessage } from "./responseTimeMath";

test("median: odd, even, empty", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([10, 20, 30, 40])).toBe(25);
  expect(median([])).toBe(null);
});

test("percentile: nearest-rank p90, empty", () => {
  expect(percentile([60000, 120000], 0.9)).toBe(120000); // ceil(0.9*2)=2 -> sorted[1]
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9); // ceil(9)=9 -> sorted[8]
  expect(percentile([], 0.9)).toBe(null);
});

const m = (direction: "inbound" | "outbound", createdAt: number, messageType = "text", role = "cs"): RtMessage =>
  ({ direction, messageType, role, createdAt });

test("pairResponseEvents: greeting -> reply = first; second turn = ongoing", () => {
  const r = pairResponseEvents([
    m("outbound", 0, "template", "cs"),     // auto-template BEFORE greeting -> ignored
    m("inbound", 1000, "text", "customer"), // greeting
    m("outbound", 61000),                   // CS reply 60s later -> first = 60000
    m("inbound", 100000, "button", "customer"), // COD click
    m("outbound", 130000),                  // reply 30s later -> ongoing 2nd
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000, 30000]);
});

test("pairResponseEvents: template/system outbound after inbound is skipped (no false fast)", () => {
  const r = pairResponseEvents([
    m("inbound", 1000, "text", "customer"),
    m("outbound", 1500, "template", "cs"),  // template lands during pending -> skipped, NOT a reply
    m("outbound", 2000, "text", "system"),  // system -> skipped
    m("outbound", 61000, "text", "cs"),     // real reply -> 60000 (not 500)
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000]);
});

test("pairResponseEvents: outbound with no pending inbound emits nothing", () => {
  const r = pairResponseEvents([m("outbound", 0), m("outbound", 5000)]);
  expect(r.firstReplyMs).toBe(null);
  expect(r.allReplyMs).toEqual([]);
});

test("pairResponseEvents: multiple inbounds before a reply use the FIRST", () => {
  const r = pairResponseEvents([
    m("inbound", 1000, "text", "customer"),
    m("inbound", 2000, "text", "customer"),
    m("inbound", 3000, "text", "customer"),
    m("outbound", 61000),                   // 60s from the FIRST inbound
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/responseTimeMath.test.ts`
Expected: FAIL — `Failed to load url ./responseTimeMath`.

- [ ] **Step 3: Write the implementation**

Create `convex/responseTimeMath.ts`:
```ts
// Pure, dependency-free helpers for response-time aggregation. No Convex imports so they
// run plain in vitest. `pairResponseEvents` does the turn-based walk over ONE conversation's
// messages (ascending by createdAt).

export type RtMessage = { direction: "inbound" | "outbound"; messageType: string; role: string; createdAt: number };

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(nums: number[], p: number): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const rank = Math.ceil(p * s.length);
  return s[Math.min(rank, s.length) - 1];
}

export function pairResponseEvents(msgs: RtMessage[]): { firstReplyMs: number | null; allReplyMs: number[] } {
  const allReplyMs: number[] = [];
  let firstReplyMs: number | null = null;
  let pendingInboundAt: number | null = null;
  for (const m of msgs) {
    if (m.direction === "inbound") {
      if (pendingInboundAt === null) pendingInboundAt = m.createdAt;
      continue;
    }
    // outbound
    const isReply = m.messageType !== "template" && m.role !== "system";
    if (isReply && pendingInboundAt !== null) {
      const gap = m.createdAt - pendingInboundAt;
      allReplyMs.push(gap);
      if (firstReplyMs === null) firstReplyMs = gap;
      pendingInboundAt = null;
    }
    // non-reply outbound (template/system): ignore, do NOT reset pending
  }
  return { firstReplyMs, allReplyMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/responseTimeMath.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/responseTimeMath.ts convex/responseTimeMath.test.ts && git commit -m "feat(respon): pure helpers median/percentile/pairResponseEvents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `by_createdAt` index + `getResponseTimes` query

**Files:**
- Modify: `convex/schema.ts` (messages table indexes)
- Create: `convex/responseTime.ts`
- Test: `convex/responseTime.test.ts`

**Interfaces:**
- Consumes: `pairResponseEvents`, `median`, `percentile` (Task 1); `isInternalTestPhone` from `./lib`; `normalizeCsName` from `./shippingRecaps`.
- Produces `api.responseTime.getResponseTimes({ startAt, endAt, csName? })` returning:
```ts
{
  windowStart: number, windowEnd: number,
  overall: { firstReplyMedianMs: number | null, firstReplyCount: number },
  cs: Array<{
    csName: string, csNameRaw: string,
    firstReplyMedianMs: number | null, firstReplyP90Ms: number | null, firstReplyCount: number,
    ongoingMedianMs: number | null, ongoingCount: number,
  }>,
}
```

- [ ] **Step 1: Add the index**

In `convex/schema.ts`, the `messages` table currently ends:
```ts
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_customerPhone_createdAt", ["customerPhone", "createdAt"])
    .index("by_orderId_createdAt", ["orderId", "createdAt"])
    .index("by_externalMessageId", ["externalMessageId"]),
```
Add `by_createdAt` as the first index in that chain:
```ts
    .index("by_createdAt", ["createdAt"])
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_customerPhone_createdAt", ["customerPhone", "createdAt"])
    .index("by_orderId_createdAt", ["orderId", "createdAt"])
    .index("by_externalMessageId", ["externalMessageId"]),
```

- [ ] **Step 2: Write the failing test**

Create `convex/responseTime.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const t0 = 1_750_000_000_000;
const convBase = {
  orderId: "O-1", customerName: "A", status: "active" as const, aiEnabled: false, note: "",
  createdAt: t0, updatedAt: t0,
};
const msgBase = {
  orderId: "O-1", content: "x", source: "n8n" as const, createdAt: t0,
};

test("getResponseTimes: first-reply median/p90 + ongoing, template excluded, per-CS", async () => {
  const t = convexTest(schema);
  let conv1: any, conv2: any, convX: any;
  await t.run(async (ctx) => {
    conv1 = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    conv2 = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62812", assignedCsName: "CS A" });
    convX = await ctx.db.insert("conversations", { ...convBase, customerPhone: "6285715682110", assignedCsName: "CS A" }); // internal phone

    const ins = (conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number, messageType = "text", role = "cs") =>
      ctx.db.insert("messages", { ...msgBase, conversationId, customerPhone, direction, messageType, role, createdAt });

    // conv1: template (skip) -> greeting -> reply 60s -> COD -> reply 30s
    await ins(conv1, "62811", "outbound", t0 + 100, "template", "cs");
    await ins(conv1, "62811", "inbound", t0 + 1000, "text", "customer");
    await ins(conv1, "62811", "outbound", t0 + 61000, "text", "cs");
    await ins(conv1, "62811", "inbound", t0 + 100000, "button", "customer");
    await ins(conv1, "62811", "outbound", t0 + 130000, "text", "cs");
    // conv2: greeting -> reply 120s
    await ins(conv2, "62812", "inbound", t0 + 2000, "text", "customer");
    await ins(conv2, "62812", "outbound", t0 + 122000, "text", "cs");
    // convX (internal phone): greeting -> instant reply (must be EXCLUDED)
    await ins(convX, "6285715682110", "inbound", t0 + 3000, "text", "customer");
    await ins(convX, "6285715682110", "outbound", t0 + 3500, "text", "cs");
  });

  const r = await t.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000 });
  expect(r.cs.length).toBe(1);
  const a = r.cs[0];
  expect(a.csName).toBe("CS A");
  expect(a.csNameRaw).toBe("CS A");
  expect(a.firstReplyCount).toBe(2);                 // conv1 + conv2 (convX internal excluded)
  expect(a.firstReplyMedianMs).toBe(90000);          // median(60000,120000)
  expect(a.firstReplyP90Ms).toBe(120000);            // nearest-rank
  expect(a.ongoingCount).toBe(3);                    // 60000, 30000, 120000
  expect(a.ongoingMedianMs).toBe(60000);
  expect(r.overall.firstReplyMedianMs).toBe(90000);
  expect(r.overall.firstReplyCount).toBe(2);
});

test("getResponseTimes: csName filter", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const cA = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    const cB = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62820", assignedCsName: "CS B" });
    const ins = (conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number) =>
      ctx.db.insert("messages", { ...msgBase, conversationId, customerPhone, direction, messageType: "text", role: "cs", createdAt });
    await ins(cA, "62811", "inbound", t0 + 1000);
    await ins(cA, "62811", "outbound", t0 + 61000);
    await ins(cB, "62820", "inbound", t0 + 1000);
    await ins(cB, "62820", "outbound", t0 + 31000);
  });
  const r = await t.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000, csName: "CS B" });
  expect(r.cs.length).toBe(1);
  expect(r.cs[0].csName).toBe("CS B");
  expect(r.cs[0].firstReplyMedianMs).toBe(30000);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/responseTime.test.ts`
Expected: FAIL — `getResponseTimes` missing on `api.responseTime`.

- [ ] **Step 4: Implement the query**

Create `convex/responseTime.ts`:
```ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { isInternalTestPhone } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile, pairResponseEvents, type RtMessage } from "./responseTimeMath";

export const getResponseTimes = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const msgs = (
      await ctx.db
        .query("messages")
        .withIndex("by_createdAt", (q: any) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
        .collect()
    ).filter((m: any) => !isInternalTestPhone(m.customerPhone));

    // Group by conversation, preserving ascending createdAt order (index already ascending).
    const byConv = new Map<string, RtMessage[]>();
    const convOrder: string[] = [];
    const convIdByKey = new Map<string, any>();
    for (const m of msgs) {
      const key = String(m.conversationId);
      let arr = byConv.get(key);
      if (!arr) { arr = []; byConv.set(key, arr); convOrder.push(key); convIdByKey.set(key, m.conversationId); }
      arr.push({ direction: m.direction, messageType: m.messageType, role: m.role, createdAt: m.createdAt });
    }

    // Join conversation -> raw assignedCsName.
    const csByKey = new Map<string, string>();
    for (const key of convOrder) {
      const conv = await ctx.db.get(convIdByKey.get(key));
      csByKey.set(key, (conv as any)?.assignedCsName || "Unknown");
    }

    const agg = new Map<string, { first: number[]; all: number[] }>();
    const overallFirst: number[] = [];
    for (const key of convOrder) {
      const { firstReplyMs, allReplyMs } = pairResponseEvents(byConv.get(key)!);
      if (firstReplyMs === null && allReplyMs.length === 0) continue;
      const raw = csByKey.get(key) || "Unknown";
      let a = agg.get(raw);
      if (!a) { a = { first: [], all: [] }; agg.set(raw, a); }
      if (firstReplyMs !== null) { a.first.push(firstReplyMs); overallFirst.push(firstReplyMs); }
      a.all.push(...allReplyMs);
    }

    let cs = Array.from(agg.entries()).map(([raw, a]) => ({
      csName: normalizeCsName(raw),
      csNameRaw: raw,
      firstReplyMedianMs: median(a.first),
      firstReplyP90Ms: percentile(a.first, 0.9),
      firstReplyCount: a.first.length,
      ongoingMedianMs: median(a.all),
      ongoingCount: a.all.length,
    }));
    if (args.csName) cs = cs.filter((c) => c.csName === args.csName || c.csNameRaw === args.csName);
    cs.sort((x, y) => y.firstReplyCount - x.firstReplyCount);

    return {
      windowStart: args.startAt,
      windowEnd: args.endAt,
      overall: { firstReplyMedianMs: median(overallFirst), firstReplyCount: overallFirst.length },
      cs,
    };
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/responseTime.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/schema.ts convex/responseTime.ts convex/responseTime.test.ts && git commit -m "feat(respon): getResponseTimes query + messages.by_createdAt index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `formatDuration` in `lib/format.ts`

**Files:**
- Modify: `lib/format.ts`
- Test: `lib/format.test.ts` (create)

**Interfaces:**
- Produces: `formatDuration(ms: number | null | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `lib/format.test.ts`:
```ts
import { expect, test } from "vitest";
import { formatDuration } from "./format";

test("formatDuration: seconds, minutes, hours, null", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(45000)).toBe("45s");
  expect(formatDuration(250000)).toBe("4m");      // 250s -> ~4m
  expect(formatDuration(4_320_000)).toBe("1j 12m"); // 72m
  expect(formatDuration(3_600_000)).toBe("1j");     // exactly 60m
  expect(formatDuration(null)).toBe("–");
  expect(formatDuration(undefined)).toBe("–");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/format.test.ts`
Expected: FAIL — `formatDuration` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `lib/format.ts`:
```ts
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}j ${rem}m` : `${h}j`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/format.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add lib/format.ts lib/format.test.ts && git commit -m "feat(respon): formatDuration helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Surface in Laporan card + Dashboard KPI

No unit tests (UI; logic is in tested helpers/query). Gate = clean `npm run build`.

**Files:**
- Modify: `components/panel/report-card.tsx`
- Modify: `components/panel/daily-report-dashboard.tsx`
- Modify: `app/panel/page.tsx`

**Interfaces:**
- Consumes: `api.responseTime.getResponseTimes` (Task 2); `formatDuration` (Task 3).
- Produces: `RespStat` type + `resp?` prop on `ReportCard`.

- [ ] **Step 1: Add the `⚡ Respon` line to `ReportCard`**

In `components/panel/report-card.tsx`, update the format import:
```tsx
import { formatRupiah, formatDuration } from '@/lib/format';
```
Add the `cn` import (the file does not import it yet) below the existing imports:
```tsx
import { cn } from '@/lib/utils';
```
Change the component signature + add an exported type. From:
```tsx
export function ReportCard({
  card, label, windowLabel, isCurrent,
}: {
  card: ReportCardData;
  label: { y: number; m: number; d: number; dow: number };
  windowLabel: string;
  isCurrent: boolean;
}) {
```
to:
```tsx
export type RespStat = { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number };

export function ReportCard({
  card, label, windowLabel, isCurrent, resp,
}: {
  card: ReportCardData;
  label: { y: number; m: number; d: number; dow: number };
  windowLabel: string;
  isCurrent: boolean;
  resp?: RespStat;
}) {
```
Inside `<CardContent>`, between the products `<div className="space-y-1">…</div>` block and the `<div className="grid grid-cols-2 …">` stats block, insert:
```tsx
        {resp && resp.firstReplyCount > 0 && (
          <div className={cn('flex items-center gap-2 border-t pt-2 text-sm', resp.firstReplyCount < 3 && 'opacity-50')}>
            <span className="text-muted-foreground">⚡ Respon</span>
            <span className="font-medium tabular-nums text-foreground">{formatDuration(resp.firstReplyMedianMs)}</span>
            <span className="text-xs text-muted-foreground">· p90 {formatDuration(resp.firstReplyP90Ms)} (n={resp.firstReplyCount})</span>
          </div>
        )}
```

- [ ] **Step 2: Fetch + merge in `daily-report-dashboard.tsx`**

In `components/panel/daily-report-dashboard.tsx`, after the existing `getDailyReport` query line:
```tsx
  const report = useQuery(api.analytics.getDailyReport, { startAt, endAt });
```
add:
```tsx
  const respData = useQuery(api.responseTime.getResponseTimes, { startAt, endAt });
  const respByCs = new Map((respData?.cs ?? []).map((r) => [r.csName, r]));
```
Change the cards render from:
```tsx
              {cards.map((c) => (
                <ReportCard key={c.csName} card={c} label={label} windowLabel={windowLabel} isCurrent={isCurrent} />
              ))}
```
to:
```tsx
              {cards.map((c) => (
                <ReportCard key={c.csName} card={c} label={label} windowLabel={windowLabel} isCurrent={isCurrent} resp={respByCs.get(c.csName)} />
              ))}
```

- [ ] **Step 3: Add the Dashboard KPI in `app/panel/page.tsx`**

Add `Zap` to the lucide import block:
```tsx
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Wallet,
  Zap,
} from 'lucide-react';
```
Add `formatDuration` to the format import:
```tsx
import { pct, fmtTime, formatRupiah, formatDuration } from '@/lib/format';
```
After the `performanceData` query, add:
```tsx
  const respData = useQuery(api.responseTime.getResponseTimes, { startAt, endAt, csName });
```
Immediately after the `</section>` that closes the KPI grid (the one rendering `cards.map`), add:
```tsx
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Avg respon"
          value={respData?.overall.firstReplyMedianMs != null ? formatDuration(respData.overall.firstReplyMedianMs) : '–'}
          detail={`First-reply median${respData ? ` · n=${respData.overall.firstReplyCount}` : ''}`}
          icon={Zap}
          tone="default"
        />
      </section>
```

- [ ] **Step 4: Verify build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/report-card.tsx components/panel/daily-report-dashboard.tsx app/panel/page.tsx && git commit -m "feat(respon): response-time in Laporan card + Dashboard KPI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Surface in Performance leaderboard (2 columns)

No unit tests (UI). Gate = clean `npm run build`.

**Files:**
- Modify: `app/panel/performance/page.tsx`
- Modify: `components/panel/performance-panel.tsx`

**Interfaces:**
- Consumes: `api.responseTime.getResponseTimes` (Task 2); `formatDuration` (Task 3). Leaderboard rows key on **raw** csName → merge on `csNameRaw`.

- [ ] **Step 1: Fetch in `performance/page.tsx`**

In `app/panel/performance/page.tsx`, after the existing `useQuery` lines add:
```tsx
  const responseTimes = useQuery(api.responseTime.getResponseTimes, { startAt, endAt });
```
Change the `<PerformancePanel … />` render to pass it:
```tsx
    <PerformancePanel
      data={performance}
      csLeaderboard={csLeaderboard ?? undefined}
      productDifficulty={productDifficulty ?? undefined}
      trendData={trendData ?? undefined}
      responseTimes={responseTimes?.cs ?? undefined}
    />
```

- [ ] **Step 2: Add the prop + columns in `performance-panel.tsx`**

Add `formatDuration` to the format import:
```tsx
import { formatRupiah, formatDuration } from '@/lib/format';
```
Add the prop to the destructure + its type. Change:
```tsx
  trendData,
}: {
  data?: PerformanceData;
  csLeaderboard?: Array<{
    csName: string; leads: number; closings: number; cr: number; revenue: number;
    deltaLeads: number; deltaClosings: number; deltaCr: number;
  }>;
  productDifficulty?: Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>;
  trendData?: Array<{ bucket: string; leads: number; closings: number; cr: number }>;
}) {
```
to:
```tsx
  trendData,
  responseTimes,
}: {
  data?: PerformanceData;
  csLeaderboard?: Array<{
    csName: string; leads: number; closings: number; cr: number; revenue: number;
    deltaLeads: number; deltaClosings: number; deltaCr: number;
  }>;
  productDifficulty?: Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>;
  trendData?: Array<{ bucket: string; leads: number; closings: number; cr: number }>;
  responseTimes?: Array<{ csNameRaw: string; firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number }>;
}) {
```
Just before the component's `return (`, add the lookup:
```tsx
  const respByRaw = new Map((responseTimes ?? []).map((r) => [r.csNameRaw, r]));
```
In the Leaderboard table header, insert two `<th>` between the CR and Omzet headers. Change:
```tsx
                    <th className="py-1 pr-3">CR (Δ)</th>
                    <th className="py-1 pr-3">Omzet</th>
```
to:
```tsx
                    <th className="py-1 pr-3">CR (Δ)</th>
                    <th className="py-1 pr-3">Respon</th>
                    <th className="py-1 pr-3">p90</th>
                    <th className="py-1 pr-3">Omzet</th>
```
In the body row, insert the two cells between the CR cell and the Omzet cell. Change:
```tsx
                      <td className="py-1.5 pr-3">{r.cr}% {deltaTag(r.deltaCr, '%')}</td>
                      <td className="py-1.5 pr-3">{formatRupiah(r.revenue)}</td>
```
to:
```tsx
                      <td className="py-1.5 pr-3">{r.cr}% {deltaTag(r.deltaCr, '%')}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{respByRaw.get(r.csName)?.firstReplyCount ? formatDuration(respByRaw.get(r.csName)!.firstReplyMedianMs) : '–'}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{respByRaw.get(r.csName)?.firstReplyCount ? formatDuration(respByRaw.get(r.csName)!.firstReplyP90Ms) : '–'}</td>
                      <td className="py-1.5 pr-3">{formatRupiah(r.revenue)}</td>
```

- [ ] **Step 3: Verify build + full test suite**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build && npx vitest run`
Expected: build exit 0; all tests pass (math 5, responseTime 2, format 1, + existing).

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/panel/performance/page.tsx components/panel/performance-panel.tsx && git commit -m "feat(respon): response-time columns in Performance leaderboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Finishing

1. **Prod sanity (before merge):** run `npx convex run responseTime:getResponseTimes '{"startAt":<4pm-window-start-ms>,"endAt":<4pm-window-end-ms>}' --prod` for the current Laporan window. Confirm per-CS medians look sane (NOT ~0s — that would mean the template wasn't excluded) and counts > 0. If medians are ~0s, inspect a sample to confirm the auto-notif `messageType`.
2. Use **superpowers:finishing-a-development-branch** — merge `response-time-per-cs` → `main` (ff-only).
3. Deploy: `npx convex deploy -y` (new index + query). Then `git push origin main` (Vercel frontend).
4. Manual smoke: `/panel/laporan` shows `⚡ Respon` per CS; `/panel` shows the `Avg respon` KPI; `/panel/performance` leaderboard shows Respon + p90 columns.

## Self-Review

- **Spec coverage:** metric defs + pairing → Task 1; index + query (exclusions, attribution, first/ongoing/overall, csName) → Task 2; formatDuration → Task 3; Laporan line + Dashboard KPI → Task 4; Performance columns → Task 5; prod sanity → Finishing. Non-goals (SLA/unanswered/business-hours/precompute) → not built. ✓
- **Placeholders:** none — full code in every step.
- **Type consistency:** `RtMessage` (Task 1) used by `getResponseTimes` (Task 2); return shape `{overall, cs[]}` fields consumed identically in Task 4 (merge by `csName`) and Task 5 (merge by `csNameRaw`); `RespStat` (Task 4) is the subset ReportCard needs; `formatDuration` signature stable across Tasks 3–5.
