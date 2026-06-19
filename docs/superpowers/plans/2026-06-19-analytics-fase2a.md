# Analytics Fase 2A — CS Leaderboard (juara/lesu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CS leaderboard ranked juara→lesu with ▲▼ deltas vs the prior equal-length window, on the panel's Performance/Analytics tab.

**Architecture:** Derive-on-read. New `convex/analytics.ts` with `getCsLeaderboard` (computes per-CS metrics for the selected window AND the immediately-preceding equal-length window, diffs them). A self-contained "Leaderboard CS" section in the panel reads it.

**Tech Stack:** Convex 1.39, Next.js 14, TypeScript, Vitest + convex-test.

**Spec:** `wafachat/docs/superpowers/specs/2026-06-19-analytics-fase2-design.md`

**Scope note:** This is Plan 2A. `getProductDifficulty` + trend surfacing + period report are Plan 2B (product difficulty needs order↔recap product-name reconciliation, handled there).

## Global Constraints

- Metric definitions match Fase 1: leads = distinct `normalizePhone(customerPhone)` in `orders` per `assignedCsName`; closings = distinct `orderIdBerdu || normalizePhone(customerPhone)` in non-cancelled `shippingRecaps` per `csName`; CR = closings/leads ×100 guarded; revenue = Σ `total ?? codValue ?? nonCodItemPrice` of non-cancelled closings.
- Exclude `isInternalTestPhone` everywhere; exclude recap status `cancelled`/`cancelled_after_export`.
- Prior window = `[startAt - (endAt-startAt), startAt - 1]` (exclusive of `startAt`, so no boundary double-count). `delta* = current - prev`.
- Reuse `normalizePhone` + `isInternalTestPhone` from `./lib`.

---

### Task 1: `getCsLeaderboard` query

**Files:**
- Create: `wafachat/convex/analytics.ts`
- Test: `wafachat/convex/analytics.test.ts`

**Interfaces:**
- Produces: `api.analytics.getCsLeaderboard({ startAt: number, endAt: number }) => Array<{ csName: string; leads: number; closings: number; cr: number; revenue: number; prevLeads: number; prevClosings: number; prevCr: number; deltaLeads: number; deltaClosings: number; deltaCr: number }>` sorted by `closings` desc then `leads` desc.

- [ ] **Step 1: Write the failing test** `wafachat/convex/analytics.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const DAY = 86_400_000;
const t0 = 1_750_000_000_000;
const ordBase = {
  customerName: "A", products: "", productsSubtotal: "", shippingCost: "", total: "",
  shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const, aiEligible: true,
};
const recBase = {
  recipientName: "A", recipientPhone: "x", recipientAddress: "", recipientDistrict: "", recipientCity: "",
  packageContent: "Q", paymentMethod: "cod" as const, flags: [], sourceMessageText: "", version: 1,
};

test("getCsLeaderboard: per-CS metrics + delta vs prior window, ranked", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // current window [t0, t0+DAY]: CS A = 2 leads 1 closing; CS B = 1 lead 0 closing
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "CS B", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 100000, status: "ready", createdAt: t0, updatedAt: t0 });
    // prior window [t0-DAY, t0-1]: CS A = 1 lead 0 closing
    await ctx.db.insert("orders", { ...ordBase, orderId: "O-0", customerPhone: "62810", assignedCsName: "CS A", productName: "Q", createdAt: t0 - DAY / 2, updatedAt: t0 });
  });

  const rows = await t.query(api.analytics.getCsLeaderboard, { startAt: t0, endAt: t0 + DAY });
  expect(rows[0].csName).toBe("CS A"); // most closings first
  const a = rows.find((r) => r.csName === "CS A")!;
  expect(a.leads).toBe(2);
  expect(a.closings).toBe(1);
  expect(a.cr).toBe(50);
  expect(a.revenue).toBe(100000);
  expect(a.deltaLeads).toBe(1);    // 2 - 1
  expect(a.deltaClosings).toBe(1); // 1 - 0
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL ("Could not find module for: analytics").

- [ ] **Step 3: Implement `wafachat/convex/analytics.ts`:**
```ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, isInternalTestPhone } from "./lib";

type CsAgg = { leads: Set<string>; closings: Set<string>; revenue: number };

async function computeCsAgg(ctx: any, startAt: number, endAt: number): Promise<Map<string, CsAgg>> {
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

  const map = new Map<string, CsAgg>();
  const get = (cs: string) => {
    let a = map.get(cs);
    if (!a) { a = { leads: new Set(), closings: new Set(), revenue: 0 }; map.set(cs, a); }
    return a;
  };
  for (const o of orders) get(o.assignedCsName).leads.add(normalizePhone(o.customerPhone));
  for (const r of recaps) {
    const a = get(r.csName);
    a.closings.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
    a.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
  }
  return map;
}

export const getCsLeaderboard = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, args) => {
    const len = args.endAt - args.startAt;
    const cur = await computeCsAgg(ctx, args.startAt, args.endAt);
    const prev = await computeCsAgg(ctx, args.startAt - len, args.startAt - 1);
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const names = Array.from(new Set(Array.from(cur.keys()).concat(Array.from(prev.keys()))));
    const rows = names.map((csName) => {
      const c = cur.get(csName) ?? { leads: new Set(), closings: new Set(), revenue: 0 };
      const p = prev.get(csName) ?? { leads: new Set(), closings: new Set(), revenue: 0 };
      const leads = c.leads.size, closings = c.closings.size;
      const prevLeads = p.leads.size, prevClosings = p.closings.size;
      const crNow = cr(closings, leads), prevCr = cr(prevClosings, prevLeads);
      return {
        csName, leads, closings, cr: crNow, revenue: c.revenue,
        prevLeads, prevClosings, prevCr,
        deltaLeads: leads - prevLeads,
        deltaClosings: closings - prevClosings,
        deltaCr: Math.round((crNow - prevCr) * 10) / 10,
      };
    });
    rows.sort((a, b) => b.closings - a.closings || b.leads - a.leads);
    return rows;
  },
});
```

- [ ] **Step 4: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (all tests).

- [ ] **Step 5: Commit.**
```bash
git add wafachat/convex/analytics.ts wafachat/convex/analytics.test.ts
git commit -m "feat(analytics): getCsLeaderboard (per-CS metrics + prior-window deltas)"
```

---

### Task 2: "Leaderboard CS" section on the Performance/Analytics tab

**Files:**
- Modify: `wafachat/app/panel/page.tsx` (wire the query + add a section in the Performance-tab view)

**Interfaces:**
- Consumes: `api.analytics.getCsLeaderboard` from Task 1.

- [ ] **Step 1: Wire the query.** In `page.tsx`, near the other `useQuery(api.metrics...)` calls, add:
```tsx
  const csLeaderboard = useQuery(api.analytics.getCsLeaderboard, {
    startAt: selectedDateRange.startAt,
    endAt: selectedDateRange.endAt,
  });
```

- [ ] **Step 2: Add a delta indicator helper.** Near the other derived helpers (e.g. next to `fmtTime`), add:
```tsx
  const deltaTag = (d: number, suffix = '') => {
    if (d > 0) return <span className="text-emerald-500">▲{d}{suffix}</span>;
    if (d < 0) return <span className="text-destructive">▼{Math.abs(d)}{suffix}</span>;
    return <span className="text-muted-foreground">–</span>;
  };
```

- [ ] **Step 3: Add the section.** Locate the Performance-tab JSX block (the `panelView === 'performance'` conditional — find the existing PerformancePanel render). Immediately **before** that existing content, insert:
```tsx
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle className="text-base">🏆 Leaderboard CS</CardTitle>
                    <CardDescription>Ranking juara→lesu untuk periode terpilih, dengan perubahan ▲▼ vs periode sebelumnya yang sama panjang.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {csLeaderboard === undefined ? (
                      <p className="text-sm text-muted-foreground">Memuat…</p>
                    ) : csLeaderboard.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Belum ada data di periode ini.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-3">#</th>
                              <th className="py-1 pr-3">CS</th>
                              <th className="py-1 pr-3">Leads (Δ)</th>
                              <th className="py-1 pr-3">Closing (Δ)</th>
                              <th className="py-1 pr-3">CR (Δ)</th>
                              <th className="py-1 pr-3">Omzet</th>
                            </tr>
                          </thead>
                          <tbody>
                            {csLeaderboard.map((r, i) => (
                              <tr key={r.csName} className="border-t border-border">
                                <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                                <td className="py-1.5 pr-3 font-medium">{r.csName || '—'}</td>
                                <td className="py-1.5 pr-3">{r.leads} {deltaTag(r.deltaLeads)}</td>
                                <td className="py-1.5 pr-3">{r.closings} {deltaTag(r.deltaClosings)}</td>
                                <td className="py-1.5 pr-3">{r.cr}% {deltaTag(r.deltaCr, '%')}</td>
                                <td className="py-1.5 pr-3">{formatRupiah(r.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
```
(`Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` and `formatRupiah` are already used in `page.tsx`. If the Performance content lives in a child component rather than inline in `page.tsx`, add the section + the `csLeaderboard` prop there instead — keep the exact JSX above.)

- [ ] **Step 4: Verify build.** Run: `cd wafachat && npx convex codegen && npm run build`. Expected: clean build (`api.analytics.getCsLeaderboard` typechecks; `/panel` compiles).

- [ ] **Step 5: Commit.**
```bash
git add wafachat/app/panel/page.tsx wafachat/convex/_generated/api.d.ts
git commit -m "feat(panel): CS leaderboard (juara/lesu) section with prior-window deltas"
```

---

## Self-Review

**Spec coverage (2A scope):** CS leaderboard with leads/closing/CR/revenue + prior-window deltas, ranked juara→lesu → Task 1 query + Task 2 panel. Metric defs match Fase 1, exclusions applied → Task 1 Global Constraints + code. Functional (table + ▲▼, no chart lib) → Task 2. Product difficulty / trend / report → **Plan 2B** (noted). ✅

**Placeholder scan:** every code step shows full code; commands exact. Task 2 Step 3 notes the section may live in a child component — that is an integration locator, not a placeholder (the exact JSX is given). ✅

**Type consistency:** `getCsLeaderboard` return fields (`csName/leads/closings/cr/revenue/prev*/delta*`) defined in Task 1 and consumed identically in Task 2's table. `deltaTag(number, suffix?)` defined once, used for leads/closings/CR. ✅

**Iteration note:** all `Map` iteration uses `Array.from(...)` (no `for...of`/spread over Map iterators) to satisfy the build's TS target — same fix pattern as Fase 1.
