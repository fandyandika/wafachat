# WaFaChat Dashboard Fase 1A — Metrics Accuracy + Leads Feed (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dashboard metric accurate and live by deriving it from source records, restoring the leads feed, and retiring the fragile `dailyStats` counters.

**Architecture:** Convex derive-on-read. The existing `shippingRecaps.getPerformance` already computes leads (distinct customer) + closings + CR + per-CS/per-product from `orders` + `shippingRecaps`; this plan adds a `getDashboardSummary` + `getTrend` in the same style, points the panel's Dashboard cards at them, restores the n8n→Convex `set_order` feed, and stops writing `dailyStats`.

**Tech Stack:** Convex 1.39, Next.js 14, TypeScript, Vitest + convex-test (added in Task 1), n8n.

**Scope split:** This is Plan 1A of Fase 1. Auto-closing (message pipeline + keyword detector) is Plan 1B (separate). Spec: `wafachat/docs/superpowers/specs/2026-06-18-wafachat-dashboard-fase1-data-foundation-design.md`.

## Global Constraints

- **Stay Convex; derive-on-read** — no stored counters. Metrics = f(records) per query.
- **Lead = distinct `customerPhone`** in `orders`, by `createdAt`. Already implemented as `uniqueOrders` (dedup by `normalizePhone`) in `getPerformance`.
- **Closing = distinct order** in `shippingRecaps` by `closedAt`, status ∉ {cancelled, cancelled_after_export}.
- **CR** = closings ÷ leads, guard ÷0 → 0.
- Exclude internal test phones via the existing `isInternalTestPhone` helper (and `EXCLUDED_PHONES`).
- Don't change `getPerformance`'s contract — extend alongside it. Keep `events` (audit).
- Follow existing Convex file/query patterns in `convex/shippingRecaps.ts` and `convex/state.ts`.

---

### Task 1: Test harness + characterization test that locks the accuracy contract

**Files:**
- Modify: `wafachat/package.json` (add devDeps + `test` script)
- Create: `wafachat/vitest.config.ts`
- Create: `wafachat/convex/metrics.test.ts`

**Interfaces:**
- Produces: a working `npm test` (vitest + convex-test) and a characterization test asserting `shippingRecaps.getPerformance` returns leads=distinct-customer, closings=distinct-order, CR, and excludes cancelled. Later tasks reuse this harness.

- [ ] **Step 1: Add deps + script.** In `wafachat/package.json`, add to `devDependencies`: `"vitest": "^2.1.0"`, `"convex-test": "^0.0.40"`, `"@edge-runtime/vm": "^4.0.0"`; add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`. Run `npm install` in `wafachat/`.

- [ ] **Step 2: Create `wafachat/vitest.config.ts`:**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "edge-runtime", server: { deps: { inline: ["convex-test"] } } },
});
```

- [ ] **Step 3: Write the failing characterization test** `wafachat/convex/metrics.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const DAY = 86_400_000;
const t0 = 1_750_000_000_000; // fixed ms within a single day

test("getPerformance: leads=distinct customer, closing=distinct order, CR, cancelled excluded", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // Same customer, 2 orders -> 1 lead (distinct phone)
    for (const orderId of ["O-1", "O-2"]) {
      await ctx.db.insert("orders", {
        orderId, customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
        productName: "Quran", products: "Quran", productsSubtotal: "", shippingCost: "", total: "",
        shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu", aiEligible: true,
        createdAt: t0, updatedAt: t0,
      });
    }
    // One closing (valid) + one cancelled (excluded)
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 100000, total: 100000,
      status: "ready", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-2", customerPhone: "62811", customerName: "A", csName: "CS Aisyah",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran", paymentMethod: "cod", codValue: 50000, total: 50000,
      status: "cancelled", flags: [], sourceMessageText: "", version: 1, createdAt: t0, updatedAt: t0,
    });
  });

  const perf = await t.query(api.shippingRecaps.getPerformance, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(perf.totalLeads).toBe(1);      // distinct customer
  expect(perf.totalClosing).toBe(1);    // cancelled excluded
  expect(perf.overallCr).toBe(100);     // 1/1
});
```

- [ ] **Step 4: Run it.** Run: `cd wafachat && npm test`. Expected: PASS (this characterizes current correct behavior). If it FAILS, the contract differs from the spec — STOP and reconcile with the spec before continuing.

- [ ] **Step 5: Commit.**
```bash
git add wafachat/package.json wafachat/vitest.config.ts wafachat/convex/metrics.test.ts
git commit -m "test: add vitest+convex-test harness and getPerformance accuracy characterization"
```

---

### Task 2: `getDashboardSummary` — accurate card values derived from records

**Files:**
- Create: `wafachat/convex/metrics.ts`
- Test: `wafachat/convex/metrics.test.ts` (extend)

**Interfaces:**
- Consumes: `orders`, `shippingRecaps`, `conversations`, `events` tables; `isInternalTestPhone`, `normalizePhone` (import from existing modules — `isInternalTestPhone` is defined in `convex/shippingRecaps.ts`; export it there and import, OR move it to `convex/lib.ts` and import in both).
- Produces: `api.metrics.getDashboardSummary({ startAt, endAt, csName? }) => { leads, closings, cr, manualClosings, cancelled, handovers, activeChats, revenue }`. The panel consumes this in Task 5.

- [ ] **Step 1: Make `isInternalTestPhone` shared.** Move the `isInternalTestPhone` function (currently private in `convex/shippingRecaps.ts`) into `convex/lib.ts` and export it; update `convex/shippingRecaps.ts` to import it from `./lib`. Run `npm test` — Task 1 test still PASS.

- [ ] **Step 2: Write the failing test** (append to `metrics.test.ts`):
```ts
test("getDashboardSummary: leads/closings/cr from records, handovers from events", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-1", customerPhone: "62811", customerName: "A",
      assignedCsName: "CS Aisyah", productName: "Quran", products: "Quran", productsSubtotal: "",
      shippingCost: "", total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "",
      source: "berdu", aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A",
      csName: "CS Aisyah", closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "",
      recipientDistrict: "", recipientCity: "", packageContent: "Quran", paymentMethod: "cod",
      codValue: 100000, total: 100000, status: "ready", flags: [], sourceMessageText: "", version: 1,
      createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("events", { type: "handover", actor: "n8n", orderId: "O-1",
      customerPhone: "62811", metadata: {}, createdAt: t0 });
  });
  const s = await t.query(api.metrics.getDashboardSummary, { startAt: t0 - DAY, endAt: t0 + DAY });
  expect(s.leads).toBe(1);
  expect(s.closings).toBe(1);
  expect(s.cr).toBe(100);
  expect(s.handovers).toBe(1);
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL ("api.metrics" / getDashboardSummary not found).

- [ ] **Step 4: Implement `convex/metrics.ts`:**
```ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone } from "./lib";

export const getDashboardSummary = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orders = await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();
    const recaps = await ctx.db.query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();
    const events = await ctx.db.query("events")
      .withIndex("by_type_createdAt", (q) => q.eq("type", "handover").gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const csOk = (cs: string | undefined) => !args.csName || cs === args.csName;
    const leadPhones = new Set(
      orders.filter((o) => !isInternalTestPhone(o.customerPhone) && csOk(o.assignedCsName))
        .map((o) => normalizePhone(o.customerPhone)),
    );
    const validRecaps = recaps.filter(
      (r) => r.status !== "cancelled" && r.status !== "cancelled_after_export" &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName),
    );
    const closingKeys = new Set(validRecaps.map((r) => r.orderIdBerdu || normalizePhone(r.customerPhone)));
    const cancelled = recaps.filter(
      (r) => (r.status === "cancelled" || r.status === "cancelled_after_export") &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName),
    ).length;
    const handovers = new Set(
      events.filter((e) => !isInternalTestPhone(e.customerPhone ?? "")).map((e) => e.orderId ?? e.customerPhone ?? String(e._id)),
    ).size;
    const activeChats = (await ctx.db.query("conversations")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "active")).collect())
      .filter((c) => !isInternalTestPhone(c.customerPhone) && csOk(c.assignedCsName)).length;

    const leads = leadPhones.size;
    const closings = closingKeys.size;
    return {
      leads, closings,
      cr: leads > 0 ? Math.round((closings / leads) * 1000) / 10 : 0,
      manualClosings: validRecaps.filter((r) => r.sourceMessageId === undefined).length,
      cancelled, handovers, activeChats,
      revenue: validRecaps.reduce((s, r) => s + (r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0), 0),
    };
  },
});
```

- [ ] **Step 5: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (both tests).

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/metrics.ts wafachat/convex/lib.ts wafachat/convex/shippingRecaps.ts wafachat/convex/metrics.test.ts
git commit -m "feat(metrics): getDashboardSummary derived from records (accurate, live)"
```

---

### Task 3: `getTrend` — leads/closings bucketed by day/week/month

**Files:**
- Modify: `wafachat/convex/metrics.ts`
- Test: `wafachat/convex/metrics.test.ts` (extend)

**Interfaces:**
- Produces: `api.metrics.getTrend({ startAt, endAt, bucket: "day"|"week"|"month", csName? }) => Array<{ bucket: string; leads: number; closings: number; cr: number }>`. Foundation for weekly/monthly reports (Fase 2/3).

- [ ] **Step 1: Write the failing test** (append):
```ts
test("getTrend: buckets leads by order-date and closings by closing-date", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O-1", customerPhone: "62811", customerName: "A",
      assignedCsName: "CS Aisyah", productName: "Q", products: "Q", productsSubtotal: "", shippingCost: "",
      total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu",
      aiEligible: true, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A",
      csName: "CS Aisyah", closedAt: t0 + DAY, recipientName: "A", recipientPhone: "62811",
      recipientAddress: "", recipientDistrict: "", recipientCity: "", packageContent: "Q",
      paymentMethod: "cod", codValue: 1, total: 1, status: "ready", flags: [], sourceMessageText: "",
      version: 1, createdAt: t0, updatedAt: t0 });
  });
  const trend = await t.query(api.metrics.getTrend, { startAt: t0 - DAY, endAt: t0 + 2 * DAY, bucket: "day" });
  const leadDay = trend.find((b) => b.leads === 1);
  const closeDay = trend.find((b) => b.closings === 1);
  expect(leadDay).toBeDefined();
  expect(closeDay).toBeDefined();
  expect(leadDay!.bucket).not.toBe(closeDay!.bucket); // lead day != closing day
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (getTrend not found).

- [ ] **Step 3: Implement `getTrend`** in `convex/metrics.ts` (append). Use `getJakartaDate` for `day`, ISO-ish week, `YYYY-MM` for `month`; count distinct lead phones per order-date bucket and distinct closing keys per closing-date bucket:
```ts
import { getJakartaDate } from "./lib";
function bucketKey(ts: number, bucket: "day" | "week" | "month"): string {
  const d = getJakartaDate(ts); // YYYY-MM-DD (Asia/Jakarta)
  if (bucket === "month") return d.slice(0, 7);
  if (bucket === "week") {
    const dt = new Date(d + "T00:00:00Z");
    const onejan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86_400_000 + onejan.getUTCDay() + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return d;
}
export const getTrend = query({
  args: { startAt: v.number(), endAt: v.number(),
    bucket: v.union(v.literal("day"), v.literal("week"), v.literal("month")), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const csOk = (cs: string | undefined) => !args.csName || cs === args.csName;
    const orders = (await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt)).collect())
      .filter((o) => !isInternalTestPhone(o.customerPhone) && csOk(o.assignedCsName));
    const recaps = (await ctx.db.query("shippingRecaps")
      .withIndex("by_closedAt", (q) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt)).collect())
      .filter((r) => r.status !== "cancelled" && r.status !== "cancelled_after_export" &&
        !isInternalTestPhone(r.customerPhone) && csOk(r.csName));
    const leadSets = new Map<string, Set<string>>();
    const closeSets = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, k: string, v2: string) => {
      const s = m.get(k) ?? new Set<string>(); s.add(v2); m.set(k, s);
    };
    for (const o of orders) add(leadSets, bucketKey(o.createdAt, args.bucket), normalizePhone(o.customerPhone));
    for (const r of recaps) add(closeSets, bucketKey(r.closedAt, args.bucket), r.orderIdBerdu || normalizePhone(r.customerPhone));
    const buckets = Array.from(new Set([...leadSets.keys(), ...closeSets.keys()])).sort();
    return buckets.map((b) => {
      const leads = leadSets.get(b)?.size ?? 0;
      const closings = closeSets.get(b)?.size ?? 0;
      return { bucket: b, leads, closings, cr: leads > 0 ? Math.round((closings / leads) * 1000) / 10 : 0 };
    });
  },
});
```
(Add `import { getJakartaDate } from "./lib";` to the existing import line.)

- [ ] **Step 4: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add wafachat/convex/metrics.ts wafachat/convex/metrics.test.ts
git commit -m "feat(metrics): getTrend (day/week/month buckets) for reports foundation"
```

---

### Task 4: Restore the leads feed (n8n v2 → Convex `set_order`)

**Files:**
- Modify: live n8n workflow `M16ChgpsZsbDAlqC` node `Normalize Order Data` (via n8n-mcp) + repo `wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json`

**Interfaces:**
- Consumes: existing Convex `upsertOrderFromN8n` reached via `https://n8n.miqra.dev/webhook/conversation-state` (the State Manager workflow forwards to Convex). Same call v1 made.
- Produces: `orders` + `conversations` rows so `getDashboardSummary`/`getPerformance`/`getTrend` have leads.

- [ ] **Step 1: Add the `set_order` call** inside `Normalize Order Data` (after `kirimDevBody` is built, before `return`). Insert this block (mirrors v1's; wrapped so it never blocks the WA send):
```js
try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://n8n.miqra.dev/webhook/conversation-state',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_order', phone, csName: csConfig.senderName,
      productName: (order.products || [])[0]?.name || '', products: productsList,
      productsSubtotal: formatRupiah(productsSubtotal), shippingCost: formatRupiah(shippingCost),
      total: formatRupiah(total), customerName, shippingAddress, shippingDistrict, shippingCity,
      order_id: webhookData.order_id,
    }),
  });
} catch (_) {}
```
Apply via `n8n_update_partial_workflow` (`patchNodeField` on `parameters.jsCode`).

- [ ] **Step 2: Verify.** Run `n8n_test_workflow` on `M16ChgpsZsbDAlqC` with a real Aisyah order payload (`{event_type:"order.new", user_id:"brt9rr55bruefkmnl1_1", order_id:"O-260618000229"}`), then confirm `getDashboardSummary` for today (or the Convex `orders` table) shows the order. Expected: 1 new lead recorded, WA still sends.

- [ ] **Step 3: Sync repo JSON.** Update `wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json` to include the new block. Validate it parses (`ConvertFrom-Json`).

- [ ] **Step 4: Commit.**
```bash
git add wafachat/automations/n8n/workflows/order-trigger-v2-kirimdev.json
git commit -m "feat(feed): restore set_order call in v2 KirimDev -> Convex leads feed"
```

---

### Task 5: Point the panel Dashboard cards at `getDashboardSummary`

**Files:**
- Modify: `wafachat/app/panel/page.tsx` (the `statsData`/`stats` wiring + the `cards` array)

**Interfaces:**
- Consumes: `api.metrics.getDashboardSummary` from Task 2.
- Produces: Dashboard cards rendered from the derived (accurate) source instead of `getDailyStats`.

- [ ] **Step 1: Replace the stats query.** In `page.tsx`, change `const statsData = useQuery(api.state.getDailyStats, { date: selectedJakartaDate });` to `const summaryData = useQuery(api.metrics.getDashboardSummary, { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt, csName: csFilter });`.

- [ ] **Step 2: Rebuild the `stats`/cards source** from `summaryData` (leads, closings, cr, manualClosings, cancelled, handovers, activeChats, revenue). Update the `cards` array to read these fields. Keep the Performance tab (`getPerformance`) untouched. Keep the loading guard using `summaryData === undefined`.

- [ ] **Step 3: Update the "Today formula" helper card** text: Orders="leads (HP unik)", Total Closing="recap non-cancelled (order unik)", Closing rate="closing / leads", Handover="events handover".

- [ ] **Step 4: Verify.** Run `cd wafachat && npm run build` (typecheck). Expected: builds clean. Manually: open panel, confirm cards populate from live data and tick up when an order/closing changes.

- [ ] **Step 5: Commit.**
```bash
git add wafachat/app/panel/page.tsx
git commit -m "feat(panel): dashboard cards read derived getDashboardSummary (accurate)"
```

---

### Task 6: Retire `dailyStats` writes (stop maintaining fragile counters)

**Files:**
- Modify: `wafachat/convex/state.ts`

**Interfaces:**
- Produces: mutations no longer patch `dailyStats`; `events` logging unchanged; conversation/order writes unchanged.

- [ ] **Step 1: Remove the counter calls.** In `convex/state.ts`, delete every call to `patchStatsWithKey(...)` and `patchClosingStatsWithKey(...)` inside the mutations (`upsertOrderFromN8n`, `setConversationStatusFromN8n`, `markConversationNotClosing`, `markConversationCancelled`, `undoConversationCancelled`, `markConversationClosing`, `deleteConversationOrder`, `recordStatEventFromN8n`). Keep the surrounding `ctx.db.insert("events", ...)` and conversation/order patches intact.

- [ ] **Step 2: Mark deprecated.** Above `patchStatsWithKey`, `patchClosingStatsWithKey`, `getOrCreateStats`, `emptyStats`, `getDailyStats`, `repairDailyStats`, add `// DEPRECATED (Fase 1A): metrics derive-on-read via convex/metrics.ts. Kept temporarily; remove after panel fully migrated.` Do NOT delete `getDailyStats` yet (a deploy lag could still call it).

- [ ] **Step 3: Verify.** Run `cd wafachat && npm test` (Task 1–3 tests still pass — they don't depend on dailyStats). Run `npm run build`. Expected: pass + clean build.

- [ ] **Step 4: Commit.**
```bash
git add wafachat/convex/state.ts
git commit -m "refactor(state): stop maintaining dailyStats counters (metrics now derived)"
```

---

## Self-Review

**Spec coverage (Fase 1A scope):** restore leads feed → Task 4. Derive-on-read metrics replacing dailyStats → Tasks 2,3,5,6. Accuracy contract (distinct-customer leads, by-closing-date closings, cancellation-excluded, ÷0 guard) → Tasks 1–3 + characterization test. Deprecate dailyStats → Task 6. Manual closing path unchanged (existing). Auto-closing + message pipeline → **out of 1A (Plan 1B)**. UI redesign/reports/audit → Fase 3. ✅

**Placeholder scan:** no TBDs; every code step shows code; commands are exact. ✅

**Type consistency:** `getDashboardSummary` fields (leads, closings, cr, manualClosings, cancelled, handovers, activeChats, revenue) used identically in Tasks 2 and 5; `getTrend` shape `{bucket,leads,closings,cr}` consistent; `isInternalTestPhone` moved to `lib.ts` and imported in Tasks 2–3. ✅
