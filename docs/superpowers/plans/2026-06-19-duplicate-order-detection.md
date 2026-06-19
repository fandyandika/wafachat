# Duplicate Order Detection ("Order Dobel") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on the Dashboard, customers who placed ≥2 orders in the selected period (with a "likely accidental" badge) so CS can cross-check/cancel in Berdu.

**Architecture:** Derive-on-read. One Convex query `getDuplicateOrders` (replaces the throwaway `reconcileLeadsToday`) + one Dashboard section in the panel. No schema change, no state.

**Tech Stack:** Convex 1.39, Next.js 14, TypeScript, Vitest + convex-test.

**Spec:** `wafachat/docs/superpowers/specs/2026-06-19-duplicate-order-detection-design.md`

## Global Constraints

- Repeat = same `normalizePhone(customerPhone)` with **≥2 orders** in range; exclude `isInternalTestPhone`; follow optional `csName` filter (`assignedCsName`).
- `likelyAccidental = sameProduct OR nearConsecutive`; `sameProduct` = one distinct `productName`; `nearConsecutive` = any pair of order_id numeric sequences differ by ≤ 3.
- Display only — no dismiss state, no clickable Berdu link (show `order_id`). Follows the panel's selected date range + CS filter, real-time.
- Reuse `normalizePhone` + `isInternalTestPhone` already imported in `convex/metrics.ts`.

---

### Task 1: `getDuplicateOrders` query (replaces `reconcileLeadsToday`)

**Files:**
- Modify: `wafachat/convex/metrics.ts` (remove `reconcileLeadsToday`, add `getDuplicateOrders`)
- Test: `wafachat/convex/metrics.test.ts` (extend)

**Interfaces:**
- Produces: `api.metrics.getDuplicateOrders({ startAt: number, endAt: number, csName?: string }) => Array<{ phone: string; customerName: string; csName: string; count: number; sameProduct: boolean; nearConsecutive: boolean; likelyAccidental: boolean; orders: Array<{ orderId: string; productName: string; total: string; createdAt: number }> }>`. The panel (Task 2) consumes this.

- [ ] **Step 1: Write the failing test** (append to `wafachat/convex/metrics.test.ts`):
```ts
test("getDuplicateOrders: groups repeat phones, flags accidental, excludes test+single+other-cs", async () => {
  const t = convexTest(schema);
  const base = {
    customerName: "A", products: "", productsSubtotal: "", shippingCost: "", total: "Rp1",
    shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const,
    aiEligible: true, updatedAt: t0,
  };
  await t.run(async (ctx) => {
    // same phone + same product + consecutive ids -> accidental
    await ctx.db.insert("orders", { ...base, orderId: "O-260619000146", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { ...base, orderId: "O-260619000147", customerPhone: "62811", assignedCsName: "CS A", productName: "Quran", createdAt: t0 + 1 });
    // same phone, different product, far-apart ids -> NOT accidental
    await ctx.db.insert("orders", { ...base, orderId: "O-260619000200", customerPhone: "62822", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { ...base, orderId: "O-260619000900", customerPhone: "62822", assignedCsName: "CS A", productName: "Medis", createdAt: t0 + 1 });
    // single order -> not returned
    await ctx.db.insert("orders", { ...base, orderId: "O-260619000999", customerPhone: "62833", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    // test phone -> excluded
    await ctx.db.insert("orders", { ...base, orderId: "O-T1", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran", createdAt: t0 });
    await ctx.db.insert("orders", { ...base, orderId: "O-T2", customerPhone: "6285715682110", assignedCsName: "CS A", productName: "Quran", createdAt: t0 + 1 });
  });

  const dups = await t.query(api.metrics.getDuplicateOrders, { startAt: t0 - 1, endAt: t0 + DAY });
  expect(dups.length).toBe(2);
  const acc = dups.find((d) => d.phone === "62811")!;
  const non = dups.find((d) => d.phone === "62822")!;
  expect(acc.likelyAccidental).toBe(true);   // same product + consecutive
  expect(acc.count).toBe(2);
  expect(non.likelyAccidental).toBe(false);  // diff product + far apart

  // csName filter: no orders for "CS B"
  const none = await t.query(api.metrics.getDuplicateOrders, { startAt: t0 - 1, endAt: t0 + DAY, csName: "CS B" });
  expect(none.length).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (`getDuplicateOrders` not found).

- [ ] **Step 3: Implement.** In `wafachat/convex/metrics.ts`, **delete the `reconcileLeadsToday` query** (the diagnostic block, from its `// Diagnostic:` comment through its closing `});`) and append:
```ts
export const getDuplicateOrders = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orders = (
      await ctx.db
        .query("orders")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
        .collect()
    ).filter((o) => !isInternalTestPhone(o.customerPhone) && (!args.csName || o.assignedCsName === args.csName));

    const groups = new Map<string, typeof orders>();
    for (const o of orders) {
      const p = normalizePhone(o.customerPhone);
      const arr = groups.get(p) ?? [];
      arr.push(o);
      groups.set(p, arr);
    }

    const seq = (orderId: string) => parseInt(orderId.replace(/\D/g, ""), 10);
    const result = [];
    for (const [phone, list] of groups) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
      const sameProduct = new Set(sorted.map((o) => o.productName)).size === 1;
      const seqs = sorted.map((o) => seq(o.orderId)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      let nearConsecutive = false;
      for (let i = 1; i < seqs.length; i++) if (seqs[i] - seqs[i - 1] <= 3) nearConsecutive = true;
      result.push({
        phone,
        customerName: sorted[0].customerName,
        csName: sorted[0].assignedCsName,
        count: sorted.length,
        sameProduct,
        nearConsecutive,
        likelyAccidental: sameProduct || nearConsecutive,
        orders: sorted.map((o) => ({ orderId: o.orderId, productName: o.productName, total: o.total, createdAt: o.createdAt })),
      });
    }
    result.sort(
      (a, b) =>
        Number(b.likelyAccidental) - Number(a.likelyAccidental) ||
        b.count - a.count ||
        (b.orders[0]?.createdAt ?? 0) - (a.orders[0]?.createdAt ?? 0),
    );
    return result;
  },
});
```

- [ ] **Step 4: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (all tests).

- [ ] **Step 5: Commit.**
```bash
git add wafachat/convex/metrics.ts wafachat/convex/metrics.test.ts
git commit -m "feat(metrics): getDuplicateOrders (replaces reconcileLeadsToday diagnostic)"
```

---

### Task 2: "Order Dobel" section on the Dashboard

**Files:**
- Modify: `wafachat/app/panel/page.tsx` (add the query wiring + a section in the `panelView === 'dashboard'` block)

**Interfaces:**
- Consumes: `api.metrics.getDuplicateOrders` from Task 1.

- [ ] **Step 1: Wire the query.** In `page.tsx`, next to the existing `summaryData = useQuery(api.metrics.getDashboardSummary, …)` call, add:
```tsx
  const duplicateOrders = useQuery(api.metrics.getDuplicateOrders, {
    startAt: selectedDateRange.startAt,
    endAt: selectedDateRange.endAt,
    csName: csFilter,
  });
```

- [ ] **Step 2: Add a time formatter + the section.** Above the component `return` (near the other derived values), add the formatter if not already present:
```tsx
  const fmtTime = (ms: number) =>
    new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(ms));
```
Then, inside the `panelView === 'dashboard'` JSX, **immediately after the metric cards grid `<section>` (the block that maps `cards`)**, insert:
```tsx
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">⚠️ Order Dobel</CardTitle>
                    <CardDescription>Customer dengan ≥2 order di periode ini — kroscek di Berdu, cancel jika dobel tak sengaja.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {duplicateOrders === undefined ? (
                      <p className="text-sm text-muted-foreground">Memuat…</p>
                    ) : duplicateOrders.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Tidak ada order dobel di periode ini ✅</p>
                    ) : (
                      duplicateOrders.map((d) => (
                        <div key={d.phone} className="rounded-md border border-border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.customerName || "Tanpa Nama"}</span>
                            <span className="text-muted-foreground">{d.phone}</span>
                            <span className="text-muted-foreground">· {d.csName || "—"}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{d.count}× order</span>
                            {d.likelyAccidental ? (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-500">⚠ kemungkinan accidental</span>
                            ) : (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">repeat customer</span>
                            )}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {d.orders.map((o) => (
                              <li key={o.orderId} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                <code className="text-foreground">{o.orderId}</code>
                                <span>{o.productName || "—"}</span>
                                <span>{o.total || "—"}</span>
                                <span>{fmtTime(o.createdAt)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
```
(`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` are already imported in `page.tsx`.)

- [ ] **Step 3: Verify build.** Run: `cd wafachat && npx convex codegen && npm run build`. Expected: clean build (`api.metrics.getDuplicateOrders` typechecks; `/panel` compiles).

- [ ] **Step 4: Commit.**
```bash
git add wafachat/app/panel/page.tsx wafachat/convex/_generated/api.d.ts
git commit -m "feat(panel): Order Dobel section on Dashboard (duplicate-order cross-check)"
```

---

## Self-Review

**Spec coverage:** definition/grouping/exclusions → Task 1 query + test. Smart badge (sameProduct OR nearConsecutive ≤3) → Task 1. Dashboard section, real-time, follows range+CS filter, order_id display, empty state → Task 2. Display-only, no state, no clickable link, no schema change → honored (YAGNI). Replace `reconcileLeadsToday` → Task 1 Step 3. ✅

**Placeholder scan:** no TBDs; full code in every step; exact commands. ✅

**Type consistency:** `getDuplicateOrders` return shape (`phone/customerName/csName/count/sameProduct/nearConsecutive/likelyAccidental/orders[]`) defined in Task 1 and consumed identically in Task 2's JSX. ✅

**Note (deploy):** after merge, deploy with `npx convex deploy` (from `wafachat/`) then push for Vercel — same ordering as before; removing `reconcileLeadsToday` drops it from prod on that deploy.
