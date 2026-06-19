# Duplicate Order Detection ("Order Dobel") — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design)
**Scope:** Minor, lean feature — cross-check tool for data accuracy. No new tables, no state.

## 1. Goal

Surface customers who placed **>1 order in a period** (potential accidental double-submit → double charge/ship risk) so CS can cross-check and cancel one in Berdu. Purpose is data-accuracy assurance, not a workflow.

## 2. Decisions (locked during brainstorming)

- **Definition:** all repeats — same `normalizePhone(customerPhone)` with **≥2 orders** in the selected range. Internal test phones excluded.
- **Smart badge:** `likelyAccidental = sameProduct OR nearConsecutive`, where `sameProduct` = all orders in the group share one `productName`, and `nearConsecutive` = any pair of order_id numeric sequences differ by **≤ 3** (e.g. `…000146`/`…000147`). This is the strong signal for an unintended double-submit.
- **Surface:** a section **"⚠️ Order Dobel"** on the **Dashboard tab**, below the metric cards. Real-time (`useQuery`); follows the panel's selected **date range + CS filter**.
- **Action:** **display only** — no dismiss/resolve state. Berdu reference = **`order_id` (copyable)**; no clickable invoice link (the `orders` table doesn't store the Berdu url).

## 3. Architecture

Derive-on-read (same pattern as the 1A metrics). One Convex query + one panel section. No schema change.

- New query `getDuplicateOrders` in `convex/metrics.ts`, **replacing the throwaway `reconcileLeadsToday`** diagnostic.
- New section in `app/panel/page.tsx` Dashboard view.

## 4. Query contract

`getDuplicateOrders({ startAt: number, endAt: number, csName?: string })` →
```
Array<{
  phone: string;
  customerName: string;
  csName: string;
  count: number;
  sameProduct: boolean;
  nearConsecutive: boolean;
  likelyAccidental: boolean;
  orders: Array<{ orderId: string; productName: string; total: string; createdAt: number }>;
}>
```
- Read `orders` in `[startAt, endAt]` via `by_createdAt`; exclude `isInternalTestPhone`; optional `csName` filter on `assignedCsName`.
- Group by `normalizePhone(customerPhone)`; keep groups with `count ≥ 2`.
- `nearConsecutive`: parse each order_id's trailing digits (`parseInt(orderId.replace(/\D/g, ""))`); true if any pair differs by ≤ 3.
- Sort groups: `likelyAccidental` first, then `count` desc, then latest order desc.

## 5. Panel section

- `const duplicateOrders = useQuery(api.metrics.getDuplicateOrders, { startAt, endAt, csName });`
- Rendered under the Dashboard metric cards. Each group: `Nama · HP · CS · count · [badge]` and its orders (`orderId · produk · total · jam`).
- Badge: amber **"⚠ kemungkinan accidental"** when `likelyAccidental`, else neutral "repeat customer".
- Empty / loading: `undefined` → skeleton/loading; `[]` → "Tidak ada order dobel di periode ini ✅".
- Styling matches existing dashboard cards (dark theme for now; visual redesign is Fase 3).

## 6. Testing (convex-test)

- 2 orders, same phone + same product → one group, `likelyAccidental === true`.
- 2 orders, same phone, different product, non-consecutive order_ids → one group, `likelyAccidental === false`.
- 1 order for a phone → not returned.
- Test phone (`isInternalTestPhone`) excluded; `csName` filter respected.

## 7. Error handling / edge cases

- Empty range → `[]`. Optional `csName` → no filter when absent. Test phones excluded everywhere. No divide-by-zero (counts only).

## 8. Scope boundary (YAGNI)

In: the query + the Dashboard section + `order_id` reference. **Out:** dismiss/resolve state, Berdu clickable link (would need a `url` feed addition), any new table, visual redesign (Fase 3).
