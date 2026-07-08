# Rollup Write-Amplification Fix — Design

**Date:** 2026-07-08
**Status:** Design (awaiting review)
**Author:** Fandy + Claude

## Goal

Make the rollup compute-on-write path read only the **target CS's slice** of a
window instead of the **entire window**, so per-write cost becomes independent of
other CS's volume and of tenant size. Preserve the drift-proof recompute-on-write
correctness and byte-identical rollup output.

## Problem

`computeRollupValues(ctx, csKeyArg, windowKey)` in `convex/rollups.ts:38-51` is
called on **every** order/recap write via `bumpForOrderDoc` / `bumpForRecapDoc`
(rollups.ts:240-260). It reads:

```
orders:        query.withIndex("by_createdAt", gte(start).lte(end)).collect()   // ALL CS in window
                 .filter(csKeyOf(assignedCsName) === csKeyArg)                   // then filter in JS
shippingRecaps: query.withIndex("by_closedAt", gte(start).lte(end)).collect()   // ALL CS in window
                 .filter(... csKeyOf(csName) === csKeyArg)                       // active
shippingRecaps: query.withIndex("by_closedAt", gte(start).lte(end)).collect()   // ALL CS, AGAIN
                 .filter(... cancelled ... csKeyOf(csName) === csKeyArg)         // cancelled
```

So each write reads **all orders + all recaps (twice)** in the window, then
discards everything not belonging to `csKeyArg`. With `W` writes into a window
holding `O` orders + `R` recaps, daily read volume ≈ `W × (O + 2R)` ≈ **O(window²)**,
and it **couples every CS together** (CS A's message write re-reads CS B/C/D's orders).

**Impact.** Single-tenant today (~53 orders / ~29 recaps per window) is small. A
SaaS tenant at 500 orders/day → each write reads ~500 → ~250k row-reads/day/tenant
purely for rollup bumps, multiplied across tenants. This is the primary
DB-I/O scaling risk (`ingest/core.processEvent` = 77 MB in the 2026-07-08 snapshot,
dominated by these bumps).

**Non-problem (leave as-is).** `recomputeWindowImpl` (rollups.ts:262, used by the
**daily** `trueUp` cron and one-time backfill) intentionally scans the whole window
to discover every csKey. It runs infrequently, so its whole-window scan is correct
and cheap in aggregate. Only the **per-write** path needs fixing.

## Root obstacle

`csKey` is a **derived** value (`csKeyOf(assignedCsName)` / `csKeyOf(csName)`) that
normalizes multiple raw name-forms (`"CS Aisyah"`, `"Aisyah"`, `"aisyah"`) into one
key. It is **not stored** on `orders` / `shippingRecaps`. The existing indexes
`orders.by_assignedCsName_createdAt` and `shippingRecaps.by_csName_closedAt` key on
the **raw** name, so a single index lookup would miss a CS's other name-variants →
wrong aggregation. We therefore cannot reuse the raw-name indexes; we must store and
index `csKey`.

**Precedent:** `responseSamples` already stores `csKey` and is indexed
`by_cs_createdAt (["csKey","createdAt"])` (schema.ts:165). This design applies the
same, proven pattern to `orders` and `shippingRecaps`.

## Approaches considered

**A. Store `csKey` + compound index (CHOSEN).** Add `csKey` to `orders` and
`shippingRecaps`, populate on write, backfill existing docs, add
`by_csKey_createdAt` / `by_csKey_closedAt`, and switch `computeRollupValues` to read
the csKey-bounded slice. Keeps recompute-on-write correctness; per-write cost drops
to O(one CS's slice). Mirrors `responseSamples`.

**B. Debounce / dirty-window recompute.** Mark windows dirty; recompute on an
interval instead of per write. Reduces frequency but each recompute still scans the
whole window, and it breaks the live-accuracy the Arena "live chase" depends on.
Rejected — liveness is a core product property.

**C. Pure incremental counters.** Increment counters per write instead of
recomputing. Rejected — distinct-customer leads, dedup-by-(orderIdBerdu|phone)
closings, and per-product distinct sets are not incrementally maintainable without
storing the sets; this is exactly why the retired `dailyStats` counters drifted.

## Design (Approach A)

### Schema (`convex/schema.ts`)

- `orders`: add `csKey: v.string()`; add index `by_csKey_createdAt (["csKey","createdAt"])`.
- `shippingRecaps`: add `csKey: v.string()`; add index `by_csKey_closedAt (["csKey","closedAt"])`.
- Keep existing indexes (other callers still use raw-name indexes).

### Write-path population

Set `csKey` wherever these docs are inserted/patched, derived from the same raw
name already written:
- `orders`: `upsertOrderCore` (state.ts) — `csKey = csKeyOf(args.csName)`. Verify
  every insert/patch site that sets `assignedCsName` also sets `csKey`.
- `shippingRecaps`: every writer that sets `csName` (upsertRecapFromMessage +
  the batch/import/cancel mutations in shippingRecaps.ts) — `csKey = csKeyOf(csName)`.
  The implementer greps all recap insert/patch sites and covers each.

`csKey` must always equal `csKeyOf(rawName)` for the row's stored raw name — this is
the invariant the reader relies on.

### Reader change (`computeRollupValues`)

Replace the three whole-window reads with csKey-bounded reads, and **merge** the two
recap reads into one:
```
orders  = query.withIndex("by_csKey_createdAt",
            q => q.eq("csKey", csKeyArg).gte("createdAt", start).lte("createdAt", end))
            .collect().filter(!isInternalTestPhone)
recaps  = query.withIndex("by_csKey_closedAt",
            q => q.eq("csKey", csKeyArg).gte("closedAt", start).lte("closedAt", end))
            .collect().filter(!isInternalTestPhone)
active    = recaps.filter(status not in {cancelled, cancelled_after_export})
cancelled = recaps.filter(status in    {cancelled, cancelled_after_export})
```
The orphan-recap fallback (rollups.ts:61-84, indexed `by_orderId` / `by_customerPhone`
lookups) is already bounded and unchanged. All downstream aggregation logic is
untouched — only the source reads change → output stays byte-identical.

`recomputeWindowImpl` (whole-window collect of csKeys) is unchanged; each
`computeRollupRow` it calls now benefits from the cheaper reads.

### Backfill (one-time)

Populate `csKey` on all existing `orders` and `shippingRecaps` before the reader
switches to the new index. Bounded, admin-guarded mutation over `by_createdAt` /
`by_closedAt` in windowed chunks (reuse the `BACKFILL_WINDOW_CAP` chunking pattern
from the rollup project to avoid mutation limits). Verify 100% coverage
(count docs with `csKey == undefined` → must reach 0) before M2.

## Milestones

- **M1 — Schema + write-path + backfill.** Add fields + indexes, populate on write,
  backfill existing docs. Deploy. Reader still reads the old way (csKey written but
  unused). Gate: 0 docs missing `csKey`.
- **M2 — Switch reader + merge recap reads.** Point `computeRollupValues` at the
  csKey indexes; merge the two recap scans. Deploy. Gate: parity — rollup output
  byte-identical vs pre-switch across a window range (`debugRollupParity` clean).
- **M3 (optional, minor) — Throttle health cron** `checkHealth` 5 min → 15 min
  (`getHealthSnapshot` ≈ 12 MB/day → ≈ 4 MB/day). Independent of the above.

## Testing

- **Parity is the gate:** `computeRollupValues` output must be byte-identical
  before/after M2 (same discipline as the Rollup Efficiency project). Run
  `rollups.debugRollupParity` over the live window range → 0 mismatches.
- **Backfill coverage test:** assert no `orders` / `shippingRecaps` row has an
  undefined/empty `csKey` after M1 backfill.
- **Write-path test:** inserting an order/recap with a raw name variant
  (e.g. `"CS Aisyah"`) stores `csKey === csKeyOf("CS Aisyah")`, and the bump
  recompute reads it via the csKey index.
- **Amplification proof (optional):** with N CS each holding orders in one window,
  a single order write triggers reads bounded to that CS's slice (not N×).

## Sequencing / risk

- The csKey index read (M2) only returns docs that have `csKey` set → **M1 backfill
  must be complete and verified before M2**, else pre-backfill docs are invisible to
  the reader. Enforced by the M1 coverage gate.
- No behavior change is intended — this is a read-path efficiency refactor with a
  new denormalized field. Parity guards correctness.

## Out of scope

- Reducing panel read churn (`getResponseTimes` / `getDailyReport` reactive re-runs)
  — separate optimization; those readers are already rollup/sample-served.
- n8n cutover (removes the `appendMessageFromN8n` / `upsertOrderFromN8n` dual-run
  cost) — tracked separately; orthogonal to this fix.
