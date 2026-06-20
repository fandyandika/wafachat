# Fase 4C — CS AI KPIs + listConversations Perf Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the heaviest panel query — bound `listConversations`' closed conversations to "today" (Asia/Jakarta) at the DB index level (kill the unbounded scan) and de-N+1 the per-row order lookups — and add AI-ops KPI cards to the CS AI page.

**Architecture:** `listConversations` (convex/state.ts) currently `.collect()`s every closed conversation ever, then filters to today in JS, and does one order lookup per conversation. Replace with a DB-level `gte("updatedAt", startOfJakartaDayMs())` range on the `by_status_updatedAt` index for closed, and prefetch the (deduped) orders into a Map. Add a `StatCard` KPI row to `app/panel/cs-ai/page.tsx`. Final piece of Fase 4.

**Tech Stack:** Convex 1.39 (`by_status_updatedAt` index already exists), vitest + convex-test (edge-runtime), Next.js 14, the Fase 3 `StatCard`.

## Global Constraints

- **`listConversations` returned shape + "today-only closed" semantics are PRESERVED** — only the *how* changes (DB-bound + de-N+1). (Spec §2)
- **No schema change** — the `(status, updatedAt)` index `by_status_updatedAt` already exists. (Spec §2)
- **Asia/Jakarta start-of-day** for the "today" bound, consistent with the existing `getJakartaDate`. (Spec §6)
- **The `listConversations` fix gets a convex-test unit test** (the one behavior-verifiable change). (Spec §7)
- **CS AI KPIs are presentation-only** (read existing `getDashboardSummary` + conversation counts). (Spec §2, §4)
- **Light-mode**, build on the existing design system. Convex suite stays green (currently 18/18; this plan adds tests). (Spec §7)
- **Repo:** git root `F:/Projects/whatsapp_cs_automotion/wafachat`; branch off `main`; paths repo-relative.

## Testing approach

Task 1 is **TDD** (real red→green convex-test). Task 2 is presentation → `npm run build` + visual review. Commands from repo root `wafachat/`: `npm test` (unit), `npm run build` (typecheck), `npm run dev` → http://localhost:3000/panel/cs-ai.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `convex/lib.ts` | **+** `startOfJakartaDayMs(ts?)` helper (ms timestamp of Asia/Jakarta midnight) | 1 |
| `convex/state.ts` | **Modify** `listConversations` — DB-bound closed-to-today + de-N+1 order prefetch | 1 |
| `convex/state.test.ts` | **New** — convex-test for the closed-today bounding + helper | 1 |
| `app/panel/cs-ai/page.tsx` | **Modify** — add AI-ops KPI `StatCard` row above the queue | 2 |

---

### Task 1: listConversations DB-bound closed + de-N+1 (TDD)

**Files:**
- Modify: `convex/lib.ts` (add helper)
- Modify: `convex/state.ts` (`listConversations` handler ≈ lines 821–887)
- Test: `convex/state.test.ts` (new)

**Interfaces:**
- Produces: `startOfJakartaDayMs(timestamp = Date.now()): number` in `convex/lib.ts`. `listConversations` keeps its exact args (`{ includeClosed?, csName? }`) and returned row shape.

- [ ] **Step 1: Write the failing test**

Create `convex/state.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { startOfJakartaDayMs } from "./lib";

const DAY = 86_400_000;

test("startOfJakartaDayMs: Jakarta midnight <= now and within today", () => {
  const now = Date.now();
  const start = startOfJakartaDayMs(now);
  expect(start).toBeLessThanOrEqual(now);
  expect(now - start).toBeLessThan(DAY);
  // (start + 7h) is exactly a UTC day boundary -> Jakarta 00:00
  expect((start + 7 * 60 * 60 * 1000) % DAY).toBe(0);
});

test("listConversations: closed bounded to today (Jakarta); active+handover always", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  await t.run(async (ctx) => {
    const base = { customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "H", customerPhone: "62812", status: "handover", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CO", customerPhone: "62814", status: "closed", updatedAt: now - 2 * DAY });
  });

  const rows = await t.query(api.state.listConversations, { includeClosed: true });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811"); // active
  expect(phones).toContain("62812"); // handover
  expect(phones).toContain("62813"); // closed TODAY
  expect(phones).not.toContain("62814"); // closed 2 days ago -> excluded by DB bound
});

test("listConversations: includeClosed=false omits closed entirely", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  await t.run(async (ctx) => {
    const base = { customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
  });
  const rows = await t.query(api.state.listConversations, { includeClosed: false });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811");
  expect(phones).not.toContain("62813");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- state`
Expected: FAIL at import — `startOfJakartaDayMs` is not exported from `./lib` yet (module resolution error fails the whole file). This is the RED. (Note: the old handler's JS filter already excludes the 2-days-ago closed by Jakarta-date, so the bounding assertions alone would pass on old code — the helper import is what forces a true red until Step 3.)

- [ ] **Step 3: Add the helper to `convex/lib.ts`**

Append to `convex/lib.ts`:
```ts
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7 (no DST)
const DAY_MS = 86_400_000;

/** Epoch ms of the most recent Asia/Jakarta midnight at or before `timestamp`. */
export function startOfJakartaDayMs(timestamp = Date.now()): number {
  return Math.floor((timestamp + JAKARTA_OFFSET_MS) / DAY_MS) * DAY_MS - JAKARTA_OFFSET_MS;
}
```

- [ ] **Step 4: Rewrite the `listConversations` handler in `convex/state.ts`**

First add `startOfJakartaDayMs` to the existing `import { … } from "./lib";` block (state.ts lines 4–10), and confirm `unique` is in that import (it is used below — add it if missing). Then replace the entire `handler` body of `listConversations` (≈ lines 823–886) with:
```ts
  handler: async (ctx, args) => {
    const startToday = startOfJakartaDayMs();
    const rows: Doc<"conversations">[] = [];

    // active + handover: small, unbounded.
    for (const status of ["handover", "active"] as const) {
      rows.push(
        ...(await ctx.db
          .query("conversations")
          .withIndex("by_status_updatedAt", (q) => q.eq("status", status))
          .order("desc")
          .collect()),
      );
    }
    // closed: bound to TODAY (Asia/Jakarta) at the DB index level — no full-history scan.
    if (args.includeClosed) {
      rows.push(
        ...(await ctx.db
          .query("conversations")
          .withIndex("by_status_updatedAt", (q) => q.eq("status", "closed").gte("updatedAt", startToday))
          .order("desc")
          .collect()),
      );
    }

    const conversations = rows
      .filter((conversation) => !EXCLUDED_PHONES.has(normalizePhone(conversation.customerPhone)))
      .filter((conversation) => !args.csName || conversation.assignedCsName === args.csName);

    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", getJakartaDate()))
      .unique();

    // de-N+1: prefetch each referenced order once (deduped) into a Map.
    const orderIds = unique(conversations.map((c) => c.orderId));
    const orderDocs = await Promise.all(
      orderIds.map((id) =>
        ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", id)).unique(),
      ),
    );
    const orderById = new Map(
      orderDocs.filter((o): o is NonNullable<typeof o> => o !== null).map((o) => [o.orderId, o]),
    );

    return conversations.map((conversation) => {
      const order = orderById.get(conversation.orderId) ?? null;
      const transitionKey = makeTransitionKey({
        orderId: conversation.orderId,
        phone: conversation.customerPhone,
        conversation,
      });
      const manualClosing = Boolean(stats?.manualClosingKeys?.includes(transitionKey));
      const aiClosing = Boolean(stats?.aiClosingKeys?.includes(transitionKey));
      const totalClosing = Boolean(stats?.closingKeys?.includes(transitionKey));
      const cancelled = Boolean(stats?.cancelledKeys?.includes(transitionKey));

      return {
        conversationId: conversation._id,
        phone: conversation.customerPhone,
        status: conversation.status,
        customerName: conversation.customerName,
        productName: order?.productName ?? "",
        products: order?.products ?? "",
        productsSubtotal: order?.productsSubtotal ?? "",
        shippingCost: order?.shippingCost ?? "",
        total: order?.total ?? "",
        shippingAddress: order?.shippingAddress ?? "",
        shippingDistrict: order?.shippingDistrict ?? "",
        shippingCity: order?.shippingCity ?? "",
        csName: conversation.assignedCsName,
        csNumber: order?.assignedCsNumber ?? "",
        order_id: conversation.orderId,
        updatedAt: new Date(conversation.updatedAt).toISOString(),
        note: conversation.note,
        aiEnabled: conversation.aiEnabled,
        salesOutcome: cancelled ? "cancelled" : manualClosing ? "manual_won" : aiClosing || totalClosing ? "ai_won" : "pending",
        closingSource: manualClosing ? "manual" : aiClosing || totalClosing ? "ai" : null,
      };
    });
  },
```
Notes: this drops the old `today`/`getJakartaDate(updatedAt)` JS post-filter (now DB-bound) and the per-row `await` (now a sync `.map` over the prefetched `orderById`). `getJakartaDate` stays for the `dailyStats` lookup. Keep the return-object fields byte-identical to the original (verify against the pre-edit handler) — only the data-fetching strategy changes.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- state`
Expected: PASS (3 tests). Then `npm test` → full suite green (18 prior + 3 new = 21).

- [ ] **Step 6: Build (Convex codegen typecheck)**

Run: `npm run build`
Expected: clean — the handler's return type is unchanged, so `app/panel/cs-ai/page.tsx` still typechecks.

- [ ] **Step 7: Commit**
```bash
git add convex/lib.ts convex/state.ts convex/state.test.ts
git commit -m "perf(convex): bound listConversations closed-to-today at DB level + de-N+1"
```

---

### Task 2: CS AI KPI cards

**Files:**
- Modify: `app/panel/cs-ai/page.tsx` (add a `StatCard` KPI row above the conversation queue)

**Interfaces:**
- Consumes: `StatCard` from `@/components/ui/stat-card` (Plan 3A); the page's existing `summaryData` (`getDashboardSummary` → `closings`, `manualClosings`, `handovers`, `leads`) and the derived `active`/`handover`/`closed` arrays (from Plan 4A Task 6).
- Produces: an AI-ops KPI row on `/panel/cs-ai`.

- [ ] **Step 1: Read `app/panel/cs-ai/page.tsx`** to confirm the available values: the `getDashboardSummary` result variable (likely `summaryData`) and the `active`/`handover`/`closed` arrays. Use the ACTUAL local names found here in Step 3.

- [ ] **Step 2: Add imports** (only the ones not already present) near the top of `app/panel/cs-ai/page.tsx`:
```tsx
import { StatCard } from '@/components/ui/stat-card';
import { Bot, CheckCircle2, CircleAlert, MessageCircle, Clock3 } from 'lucide-react';
```

- [ ] **Step 3: Add the KPI row** immediately above the `<ConversationPanel …/>` render, using the page's actual values:
```tsx
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard
                label="AI Closing"
                value={Math.max((summaryData?.closings ?? 0) - (summaryData?.manualClosings ?? 0), 0)}
                detail="Total − manual"
                icon={Bot}
                tone="positive"
              />
              <StatCard
                label="Manual Closing"
                value={summaryData?.manualClosings ?? 0}
                detail="Marked by CS"
                icon={CheckCircle2}
                tone="lead"
              />
              <StatCard
                label="Handovers"
                value={summaryData?.handovers ?? 0}
                detail={`Rate: ${summaryData && summaryData.leads > 0 ? Math.round((summaryData.handovers / summaryData.leads) * 100) : 0}%`}
                icon={CircleAlert}
                tone="default"
              />
              <StatCard
                label="Active chats"
                value={active.length}
                detail="In queue"
                icon={MessageCircle}
                tone="lead"
              />
              <StatCard
                label="Archived"
                value={closed.length}
                detail="Closed today"
                icon={Clock3}
                tone="default"
              />
            </section>
```
(If the page uses different names — e.g. `summary` not `summaryData` — substitute them. `StatCard`'s `value` is a `number` here; no `AnimatedNumber` needed.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean (EXIT 0; the layout's Suspense covers this page).

- [ ] **Step 5: Visual review**

`npm run dev` → http://localhost:3000/panel/cs-ai: a 5-card KPI row (AI Closing emerald, Manual Closing indigo, Handovers, Active chats, Archived) above the Global AI toggle + queue; numbers respond to the period/CS filter.

- [ ] **Step 6: Commit**
```bash
git add app/panel/cs-ai/page.tsx
git commit -m "feat(panel): CS AI KPI cards (AI/manual closing, handovers, active, archived)"
```

---

## Self-Review

**1. Spec coverage:**
- §2/§5 "`listConversations` fix — bound closed to today at DB level + de-N+1" → Task 1 (`gte("updatedAt", startToday)` on `by_status_updatedAt`; prefetch orders into a Map). ✓
- §6 "Asia/Jakarta start-of-day" → `startOfJakartaDayMs` (UTC+7, no DST). ✓
- §7 "the `listConversations` fix gets a unit test" → Task 1 convex-test (helper + closed-today bounding + includeClosed=false). ✓
- §2 "returned shape preserved" → Task 1 reproduces the exact row object. ✓
- §3.2 "CS AI AI-ops KPIs" → Task 2 (StatCard row). ✓
- §7 "suite stays green, +test" → Task 1 Step 5 (18→21). ✓

**2. Placeholder scan:** Full code for the helper, handler, tests, and KPI JSX. Step 2 honestly notes the helper import is what forces the RED — no hand-waving. No TODO/TBD. ✓

**3. Type/name consistency:** `startOfJakartaDayMs` defined in lib (Task 1), imported in state.ts + the test. Handler return shape unchanged (matches the `Conversation` type `ConversationPanel` consumes). `unique`/`makeTransitionKey`/`getJakartaDate`/`EXCLUDED_PHONES`/`normalizePhone` are existing state.ts symbols. Task 2 uses `StatCard`'s real props. ✓

**Note:** the de-N+1 prefetch keeps one point-read per *unique* orderId (deduped) and removes the per-row `await`; combined with the closed-today bound, N is now small and bounded. No change to the returned data.
