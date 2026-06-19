# Analytics Fase 2C — Period Report (Laporan Mingguan/Bulanan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly/monthly report — totals (leads/closing/CR/omzet/cancelled) with Δ vs the previous week/month, plus a per-CS breakdown — on the Performance/Analytics tab.

**Architecture:** Derive-on-read. `getPeriodReport` in `convex/analytics.ts` reuses the existing `computeCsAgg` for per-CS aggregates and unions the sets for totals; week/month ranges computed in Asia/Jakarta (UTC+7). A self-contained "Laporan" Card in `PerformancePanel` with a week/month toggle reads it.

**Tech Stack:** Convex 1.39, Next.js 14, TypeScript, Vitest + convex-test.

**Spec:** `wafachat/docs/superpowers/specs/2026-06-19-analytics-fase2-design.md` (this completes Fase 2).

## Global Constraints

- Reuse `computeCsAgg(ctx, start, end)` (already in `analytics.ts`) → `Map<csName, { leads:Set, closings:Set, revenue:number }>`. Totals = union of per-CS sets (a customer/order counted once overall). CR = closings/leads ×100 guarded.
- Asia/Jakarta = UTC+7 (no DST). `week` = Monday–Sunday containing anchor; `month` = calendar month. Prior = previous week / previous calendar month.
- `cancelled` = recaps with status `cancelled`/`cancelled_after_export` and `closedAt` in range, excluding test phones.
- Exclude `isInternalTestPhone` everywhere (already enforced inside `computeCsAgg`).

---

### Task 1: `getPeriodReport` query

**Files:**
- Modify: `wafachat/convex/analytics.ts`
- Test: `wafachat/convex/analytics.test.ts` (extend)

**Interfaces:**
- Produces: `api.analytics.getPeriodReport({ period: "week" | "month", anchor?: number }) => { label: string; rangeStart: number; rangeEnd: number; leads: number; closings: number; cr: number; revenue: number; cancelled: number; prevLeads: number; prevClosings: number; prevCr: number; prevRevenue: number; perCs: Array<{ csName: string; leads: number; closings: number; cr: number; revenue: number }> }`. `perCs` sorted by closings desc.

- [ ] **Step 1: Write the failing test** (append to `wafachat/convex/analytics.test.ts`):
```ts
test("getPeriodReport: week period, current vs prior week + per-CS", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // current week (anchor day): CS A = 2 leads, 1 closing, revenue 50000
    await ctx.db.insert("orders", { ...ordBase, orderId: "C1", customerPhone: "62811", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("orders", { ...ordBase, orderId: "C2", customerPhone: "62812", assignedCsName: "CS A", productName: "Q", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("shippingRecaps", { ...recBase, orderIdBerdu: "C1", customerPhone: "62811", customerName: "A", csName: "CS A", closedAt: t0, total: 50000, status: "ready", createdAt: t0, updatedAt: t0 });
    // prior week (anchor - 7 days): 1 lead
    await ctx.db.insert("orders", { ...ordBase, orderId: "P1", customerPhone: "62820", assignedCsName: "CS A", productName: "Q", createdAt: t0 - 7 * DAY, updatedAt: t0 });
  });
  const r = await t.query(api.analytics.getPeriodReport, { period: "week", anchor: t0 });
  expect(r.leads).toBe(2);
  expect(r.closings).toBe(1);
  expect(r.revenue).toBe(50000);
  expect(r.prevLeads).toBe(1);
  expect(r.perCs[0].csName).toBe("CS A");
  expect(r.perCs[0].closings).toBe(1);
  expect(r.label).toMatch(/^Minggu /);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (`getPeriodReport` not found).

- [ ] **Step 3: Implement.** In `wafachat/convex/analytics.ts`, append:
```ts
const JAK_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
function startOfJakartaDay(ts: number) {
  return Math.floor((ts + JAK_MS) / DAY_MS) * DAY_MS - JAK_MS;
}
function periodRange(period: "week" | "month", anchor: number): { start: number; end: number; prevStart: number; prevEnd: number; label: string } {
  const dayStart = startOfJakartaDay(anchor);
  const jak = new Date(dayStart + JAK_MS); // Jakarta wall-clock midnight of anchor's day
  if (period === "week") {
    const dow = jak.getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7;
    const start = dayStart - mondayOffset * DAY_MS;
    const end = start + 7 * DAY_MS - 1;
    const mon = new Date(start + JAK_MS);
    const label = `Minggu ${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
    return { start, end, prevStart: start - 7 * DAY_MS, prevEnd: start - 1, label };
  }
  const y = jak.getUTCFullYear(), m = jak.getUTCMonth();
  const start = Date.UTC(y, m, 1) - JAK_MS;
  const end = Date.UTC(y, m + 1, 1) - JAK_MS - 1;
  const prevStart = Date.UTC(y, m - 1, 1) - JAK_MS;
  const label = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end, prevStart, prevEnd: start - 1, label };
}

export const getPeriodReport = query({
  args: { period: v.union(v.literal("week"), v.literal("month")), anchor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { start, end, prevStart, prevEnd, label } = periodRange(args.period, args.anchor ?? Date.now());
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cur = await computeCsAgg(ctx, start, end);
    const prev = await computeCsAgg(ctx, prevStart, prevEnd);
    const totals = (m: Map<string, CsAgg>) => {
      const leads = new Set<string>(), closings = new Set<string>();
      let revenue = 0;
      m.forEach((a) => {
        a.leads.forEach((p) => leads.add(p));
        a.closings.forEach((c) => closings.add(c));
        revenue += a.revenue;
      });
      return { leads: leads.size, closings: closings.size, revenue };
    };
    const curT = totals(cur), prevT = totals(prev);
    const cancelled = (
      await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", start).lte("closedAt", end)).collect()
    ).filter((r: any) => (r.status === "cancelled" || r.status === "cancelled_after_export") && !isInternalTestPhone(r.customerPhone)).length;
    const perCs = Array.from(cur.entries())
      .map(([csName, a]) => ({ csName, leads: a.leads.size, closings: a.closings.size, cr: cr(a.closings.size, a.leads.size), revenue: a.revenue }))
      .sort((a, b) => b.closings - a.closings);
    return {
      label, rangeStart: start, rangeEnd: end,
      leads: curT.leads, closings: curT.closings, cr: cr(curT.closings, curT.leads), revenue: curT.revenue, cancelled,
      prevLeads: prevT.leads, prevClosings: prevT.closings, prevCr: cr(prevT.closings, prevT.leads), prevRevenue: prevT.revenue,
      perCs,
    };
  },
});
```
(`computeCsAgg` and the `CsAgg` type already exist in `analytics.ts` from Plan 2A.)

- [ ] **Step 4: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (all tests).

- [ ] **Step 5: Commit.**
```bash
git add wafachat/convex/analytics.ts wafachat/convex/analytics.test.ts
git commit -m "feat(analytics): getPeriodReport (weekly/monthly totals + prior-period deltas + per-CS)"
```

---

### Task 2: "Laporan" Card in PerformancePanel (week/month toggle)

**Files:**
- Modify: `wafachat/app/panel/page.tsx`

**Interfaces:**
- Consumes: `api.analytics.getPeriodReport` from Task 1. Uses `useQuery`, `useState`, `formatRupiah`, `deltaTag`, `cn` (all already in scope).

- [ ] **Step 1: Add report state + query inside `PerformancePanel`.** Right after the existing `const [perfTab, setPerfTab] = useState<'summary' | 'cs' | 'product'>('summary');` line, add:
```tsx
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('week');
  const report = useQuery(api.analytics.getPeriodReport, { period: reportPeriod });
```

- [ ] **Step 2: Add the Laporan Card.** Immediately after the `📈 Trend Harian` `</Card>` (and before `{/* Tab content */}`), insert:
```tsx
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">🧾 Laporan {reportPeriod === 'week' ? 'Mingguan' : 'Bulanan'}</CardTitle>
              <CardDescription>{report ? report.label : '…'} — total + Δ vs periode sebelumnya.</CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
              {(['week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setReportPeriod(p)}
                  className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', reportPeriod === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  {p === 'week' ? 'Mingguan' : 'Bulanan'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {report === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div><div className="text-xs text-muted-foreground">Leads</div><div className="font-semibold">{report.leads} {deltaTag(report.leads - report.prevLeads)}</div></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><div className="font-semibold">{report.closings} {deltaTag(report.closings - report.prevClosings)}</div></div>
                <div><div className="text-xs text-muted-foreground">CR</div><div className="font-semibold">{report.cr}% {deltaTag(Math.round((report.cr - report.prevCr) * 10) / 10, '%')}</div></div>
                <div><div className="text-xs text-muted-foreground">Omzet</div><div className="font-semibold">{formatRupiah(report.revenue)}</div></div>
                <div><div className="text-xs text-muted-foreground">Dibatalkan</div><div className="font-semibold text-destructive">{report.cancelled}</div></div>
              </div>
              {report.perCs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr><th className="py-1 pr-3">CS</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR</th><th className="py-1 pr-3">Omzet</th></tr>
                    </thead>
                    <tbody>
                      {report.perCs.map((c) => (
                        <tr key={c.csName} className="border-t border-border">
                          <td className="py-1.5 pr-3 font-medium">{c.csName || '—'}</td>
                          <td className="py-1.5 pr-3">{c.leads}</td>
                          <td className="py-1.5 pr-3">{c.closings}</td>
                          <td className="py-1.5 pr-3">{c.cr}%</td>
                          <td className="py-1.5 pr-3">{formatRupiah(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Verify build.** Run: `cd wafachat && npx convex codegen && npm run build`. Expected: clean build.

- [ ] **Step 4: Commit.**
```bash
git add wafachat/app/panel/page.tsx wafachat/convex/_generated/api.d.ts
git commit -m "feat(panel): weekly/monthly report card (toggle, totals + deltas + per-CS)"
```

---

## Self-Review

**Spec coverage (2C scope):** `getPeriodReport` (week/month, totals + prior deltas + per-CS + cancelled + label) → Task 1. Laporan view with week/month toggle → Task 2. This completes the spec's 4th analytics component → Fase 2 done. Export/PDF stays out (spec scope boundary). ✅

**Placeholder scan:** full code per step; exact commands. ✅

**Type consistency:** `getPeriodReport` fields (`label/rangeStart/rangeEnd/leads/closings/cr/revenue/cancelled/prev*/perCs[]`) defined Task 1, consumed identically in Task 2. `deltaTag`/`formatRupiah`/`cn` reused. ✅

**Iteration note:** totals use `Map.forEach`/`Set.forEach` and `Array.from(map.entries())` — no `for...of`/spread over Map/Set iterators (build TS target).
