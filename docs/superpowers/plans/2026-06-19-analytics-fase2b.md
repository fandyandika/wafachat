# Analytics Fase 2B — Product Difficulty + Trend Sparkline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which products are hardest to close (CR ascending, with ΔCR vs prior window) and a momentum sparkline of leads/closings over time, on the Performance/Analytics tab.

**Architecture:** Derive-on-read. `getProductDifficulty` in `convex/analytics.ts` (reuses `normalizeProductName` exported from `shippingRecaps.ts` to reconcile order `productName` ↔ recap `packageContent`). Trend reuses the existing `getTrend`. Both surface as functional tables/CSS sparklines in `PerformancePanel`.

**Tech Stack:** Convex 1.39, Next.js 14, TypeScript, Vitest + convex-test.

**Spec:** `wafachat/docs/superpowers/specs/2026-06-19-analytics-fase2-design.md`

**Scope note:** Plan 2B. `getPeriodReport` (weekly/monthly report) is Plan 2C.

## Global Constraints

- **Per-product leads = order count (order-granularity, NOT customer-deduped)** per product key; closings = distinct `orderIdBerdu || normalizePhone(customerPhone)` per product. Product key = `normalizeProductName(...)` (orders use `productName || products`; recaps use `packageContent`).
- `cr = closings/leads ×100` guarded; sort by `cr` asc (hardest first); filter to `leads >= minLeads` (default **3**).
- Prior window = `[startAt - (endAt-startAt), startAt - 1]`; `deltaCr = crNow - prevCr` (1-dp).
- Exclude `isInternalTestPhone`; exclude recap status `cancelled`/`cancelled_after_export`.
- Reuse `normalizePhone`/`isInternalTestPhone` from `./lib`, `normalizeProductName` from `./shippingRecaps`, existing `computeCsAgg` pattern.

---

### Task 1: export `normalizeProductName` + `getProductDifficulty` query

**Files:**
- Modify: `wafachat/convex/shippingRecaps.ts` (export `normalizeProductName`)
- Modify: `wafachat/convex/analytics.ts` (add `getProductDifficulty`)
- Test: `wafachat/convex/analytics.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeProductName(value?: string): string` from `./shippingRecaps`.
- Produces: `api.analytics.getProductDifficulty({ startAt: number, endAt: number, minLeads?: number }) => Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>` sorted by `cr` asc then `leads` desc.

- [ ] **Step 1: Export the helper.** In `wafachat/convex/shippingRecaps.ts`, change `function normalizeProductName(` to `export function normalizeProductName(` (single edit; its internal `cleanMarkdown` dependency stays private).

- [ ] **Step 2: Write the failing test** (append to `wafachat/convex/analytics.test.ts`):
```ts
test("getProductDifficulty: per-product CR asc, minLeads filter", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // "Hard": 4 leads, 0 closing -> CR 0 (hardest)
    for (let i = 0; i < 4; i++) await ctx.db.insert("orders", { ...ordBase, orderId: `H${i}`, customerPhone: `6280${i}`, assignedCsName: "CS A", productName: "Hard", createdAt: t0, updatedAt: t0 });
    // "Easy": 4 leads, 4 closings -> CR 100
    for (let i = 0; i < 4; i++) {
      await ctx.db.insert("orders", { ...ordBase, orderId: `E${i}`, customerPhone: `6281${i}`, assignedCsName: "CS A", productName: "Easy", createdAt: t0, updatedAt: t0 });
      await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: `E${i}`, customerPhone: `6281${i}`, customerName: "A", csName: "CS A", closedAt: t0, packageContent: "Easy", total: 1, status: "ready", createdAt: t0, updatedAt: t0 });
    }
    // "Rare": 2 leads -> filtered out (minLeads default 3)
    for (let i = 0; i < 2; i++) await ctx.db.insert("orders", { ...ordBase, orderId: `R${i}`, customerPhone: `6282${i}`, assignedCsName: "CS A", productName: "Rare", createdAt: t0, updatedAt: t0 });
  });
  const rows = await t.query(api.analytics.getProductDifficulty, { startAt: t0 - 1, endAt: t0 + DAY });
  expect(rows.length).toBe(2);               // Hard + Easy (Rare filtered)
  expect(rows[0].productName).toBe("Hard");  // CR asc -> hardest first
  expect(rows[0].cr).toBe(0);
  expect(rows[1].productName).toBe("Easy");
  expect(rows[1].cr).toBe(100);
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (`getProductDifficulty` not found).

- [ ] **Step 4: Implement.** In `wafachat/convex/analytics.ts`, add the import `import { normalizeProductName } from "./shippingRecaps";` to the top, and append:
```ts
async function computeProductAgg(ctx: any, startAt: number, endAt: number) {
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone));

  const leads = new Map<string, number>();
  const closings = new Map<string, Set<string>>();
  for (const o of orders) {
    const p = normalizeProductName(o.productName || o.products);
    leads.set(p, (leads.get(p) ?? 0) + 1);
  }
  for (const r of recaps) {
    const p = normalizeProductName(r.packageContent);
    const s = closings.get(p) ?? new Set<string>();
    s.add(r.orderIdBerdu || normalizePhone(r.customerPhone));
    closings.set(p, s);
  }
  return { leads, closings };
}

export const getProductDifficulty = query({
  args: { startAt: v.number(), endAt: v.number(), minLeads: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const minLeads = args.minLeads ?? 3;
    const len = args.endAt - args.startAt;
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cur = await computeProductAgg(ctx, args.startAt, args.endAt);
    const prev = await computeProductAgg(ctx, args.startAt - len, args.startAt - 1);
    const rows = Array.from(cur.leads.entries())
      .filter(([, leads]) => leads >= minLeads)
      .map(([productName, leads]) => {
        const closings = cur.closings.get(productName)?.size ?? 0;
        const prevLeads = prev.leads.get(productName) ?? 0;
        const prevClosings = prev.closings.get(productName)?.size ?? 0;
        const crNow = cr(closings, leads), prevCr = cr(prevClosings, prevLeads);
        return { productName, leads, closings, cr: crNow, prevCr, deltaCr: Math.round((crNow - prevCr) * 10) / 10 };
      });
    rows.sort((a, b) => a.cr - b.cr || b.leads - a.leads);
    return rows;
  },
});
```

- [ ] **Step 5: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (all tests).

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/analytics.ts wafachat/convex/analytics.test.ts wafachat/convex/shippingRecaps.ts
git commit -m "feat(analytics): getProductDifficulty (hardest-to-close, ranked CR asc)"
```

---

### Task 2: Panel — Product Difficulty table + Trend sparkline

**Files:**
- Modify: `wafachat/app/panel/page.tsx`

**Interfaces:**
- Consumes: `api.analytics.getProductDifficulty` (Task 1) + existing `api.metrics.getTrend`.

- [ ] **Step 1: Wire the queries.** In `page.tsx`, next to `csLeaderboard`, add:
```tsx
  const productDifficulty = useQuery(api.analytics.getProductDifficulty, {
    startAt: selectedDateRange.startAt,
    endAt: selectedDateRange.endAt,
  });
  const trendData = useQuery(api.metrics.getTrend, {
    startAt: selectedDateRange.startAt,
    endAt: selectedDateRange.endAt,
    bucket: 'day',
  });
```

- [ ] **Step 2: Pass them to `PerformancePanel`.** Change the render to:
```tsx
              <PerformancePanel data={performance} csLeaderboard={csLeaderboard} productDifficulty={productDifficulty} trendData={trendData} />
```

- [ ] **Step 3: Add a `Sparkline` component.** Above `function PerformancePanel(`, add:
```tsx
function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-8 items-end gap-0.5">
      {values.map((v, i) => (
        <div key={i} className={cn('w-1.5 rounded-sm', tone)} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={String(v)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Extend `PerformancePanel` props.** Update its signature/type to add (alongside `csLeaderboard`) the two new optional props before `}) {`:
```tsx
  productDifficulty,
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
(Keep the existing `data` + `csLeaderboard` lines exactly; only add `productDifficulty,`/`trendData,` to the destructure and the two type lines.)

- [ ] **Step 5: Add the two sections.** Immediately after the existing `🏆 Leaderboard CS` `</Card>` (and before `{/* Tab content */}`), insert:
```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📉 Produk Tersusah Closing</CardTitle>
          <CardDescription>CR terendah dulu (min {3} leads). ΔCR = perubahan vs periode sebelumnya.</CardDescription>
        </CardHeader>
        <CardContent>
          {productDifficulty === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : productDifficulty.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum cukup data produk di periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 pr-3">Produk</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR (Δ)</th></tr>
                </thead>
                <tbody>
                  {productDifficulty.map((p) => (
                    <tr key={p.productName} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-medium">{p.productName}</td>
                      <td className="py-1.5 pr-3">{p.leads}</td>
                      <td className="py-1.5 pr-3">{p.closings}</td>
                      <td className="py-1.5 pr-3">{p.cr}% {deltaTag(p.deltaCr, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📈 Trend Harian</CardTitle>
          <CardDescription>Leads & closing per hari di periode terpilih.</CardDescription>
        </CardHeader>
        <CardContent>
          {trendData === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : trendData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada data.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div><div className="text-xs text-muted-foreground">Leads</div><Sparkline values={trendData.map((b) => b.leads)} tone="bg-sky-500/70" /></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><Sparkline values={trendData.map((b) => b.closings)} tone="bg-emerald-500/70" /></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-1 pr-3">Hari</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR</th></tr>
                  </thead>
                  <tbody>
                    {trendData.map((b) => (
                      <tr key={b.bucket} className="border-t border-border">
                        <td className="py-1.5 pr-3">{b.bucket}</td>
                        <td className="py-1.5 pr-3">{b.leads}</td>
                        <td className="py-1.5 pr-3">{b.closings}</td>
                        <td className="py-1.5 pr-3">{b.cr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
```
(`deltaTag` is defined in `PerformancePanel` from Plan 2A. `cn` is already imported.)

- [ ] **Step 6: Verify build.** Run: `cd wafachat && npx convex codegen && npm run build`. Expected: clean build.

- [ ] **Step 7: Commit.**
```bash
git add wafachat/app/panel/page.tsx wafachat/convex/_generated/api.d.ts
git commit -m "feat(panel): product-difficulty table + daily trend sparkline"
```

---

## Self-Review

**Spec coverage (2B scope):** product difficulty (CR asc, minLeads, ΔCR, normalized product key) → Task 1 query + Task 2 table. Trend over-time (sparkline + table) → Task 2 (reuses `getTrend`). Period report → **Plan 2C** (noted). ✅

**Placeholder scan:** full code per step; exact commands. `min {3}` in copy renders "min 3" (the spec's default). ✅

**Type consistency:** `getProductDifficulty` fields (`productName/leads/closings/cr/prevCr/deltaCr`) defined Task 1, consumed identically Task 2. `trendData` shape `{bucket,leads,closings,cr}` matches `getTrend`. `Sparkline({values,tone})` + `deltaTag` reused. ✅

**Iteration note:** `Array.from(map.entries())`/`map.get` only — no `for...of`/spread over Map iterators (build TS target). `Math.max(1, ...values)` spreads a plain number[] (fine).
