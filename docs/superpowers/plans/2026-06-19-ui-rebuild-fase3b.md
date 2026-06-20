# Fase 3B — Dashboard + Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dashboard's live metrics feel satisfying — animated count-up numbers + a brief soft highlight when leads/closings increase — and restyle the Dashboard cards/sections to the airy light design system (StatCard).

**Architecture:** Pure-logic helpers (`lib/animated-number.ts`, unit-tested) feed a dependency-free `AnimatedNumber` React component (rAF count-up, respects reduced motion). A `useHighlightOnChange` hook flips a boolean when a tracked value increases. The Dashboard wires both into the `StatCard` primitive (built in 3A) via a small `DashboardStatCard` wrapper. Presentation-only — all data still comes from the existing Convex `useQuery` calls.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind 3.4, vitest (edge-runtime), `lucide-react`. No new dependencies.

## Global Constraints

- **Light-mode ONLY**, indigo/violet accent, airy density — the design system established in Plan 3A (tokens, `StatCard`, soft `Badge` variants) is already on `main`. (Spec §2)
- **"Satisfying live" is subtle:** animated count-up + a brief soft highlight when a value **increases**. No confetti/pulse. (Spec §2, §3.2)
- **`AnimatedNumber` rules:** dependency-free rAF count-up; guard NaN/undefined (render `–`); on first render **snap** to the value (no count-up from 0 on mount); count-up only on subsequent **increases** (snap on decrease/equal). (Spec §3.2, §5)
- **`prefers-reduced-motion`:** disable count-up AND highlight — instant updates. (Spec §3.2, §5)
- **Presentation-only:** no data/Convex/query changes. Components keep consuming the existing `useQuery(api.metrics.getDashboardSummary, …)` and `useQuery(api.metrics.getDuplicateOrders, …)`. (Spec §1, §4)
- **Testing:** `npm run build` (typecheck) + visual review; the **one** Fase-3 unit test is here — for `AnimatedNumber`'s value/format logic and that reduced-motion short-circuits. The Convex suite stays green (13/13, untouched). (Spec §6)
- **Repo:** git root is `F:/Projects/whatsapp_cs_automotion/wafachat`. Branch off `main`. All paths are repo-relative.

## Testing approach (read before starting)

This project's test runner is **vitest in `edge-runtime`** (`vitest.config.ts`), used for pure logic — there is **no** `@testing-library/react`/jsdom, so React components, rAF, and DOM/`matchMedia` cannot be unit-tested. Therefore:
- **Task 1 is TDD** — the pure helpers in `lib/animated-number.ts` (the spec's "value/format logic") get a real red→green unit test. `Intl`, `Math` are available in edge-runtime.
- **Tasks 2–5 are presentation/DOM** — verified by `npm run build` + a visual-review checklist. Do NOT invent placeholder render tests for the component/hook/page edits.

**Commands (run from repo root `wafachat/`):**
- Unit tests: `npm test` (currently 13 passing; Task 1 adds more)
- Build/typecheck: `npm run build`
- Dev server for visual review: `npm run dev` → http://localhost:3000/panel (login password = the `.env.local` `PANEL_PASSWORD` value, truncated at any `#` by dotenv)

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/animated-number.ts` | **New** — pure helpers: `sanitizeTarget`, `shouldAnimate`, `easeOutCubic`, `interpolate`, `formatInt` | 1 |
| `lib/animated-number.test.ts` | **New** — unit tests for the pure helpers (incl. reduced-motion short-circuit) | 1 |
| `components/ui/use-prefers-reduced-motion.ts` | **New** — `usePrefersReducedMotion()` client hook (matchMedia, SSR-safe) | 2 |
| `components/ui/animated-number.tsx` | **New** — `AnimatedNumber` component (rAF count-up, snap-on-mount, reduced-motion) | 2 |
| `components/ui/use-highlight-on-change.ts` | **New** — `useHighlightOnChange(value)` hook (flash-on-increase, reduced-motion-aware) | 3 |
| `app/panel/page.tsx` | Reshape `cards` array + add `DashboardStatCard` wrapper; render metric cards via `StatCard`+`AnimatedNumber`+highlight; restyle `MetricSkeleton`; remove now-unused `MetricCard` | 4 |
| `app/panel/page.tsx` | Restyle the Order Dobel section + the formula/readiness aside cards (airy, token Badges) | 5 |

**Decomposition note:** the pure logic (Task 1), the animation shell (Task 2), the highlight hook (Task 3), and the two page-restyle slices (Tasks 4–5) are independently reviewable. Tasks 2 and 3 produce components that are unused until Task 4 — that is expected and does not fail the build.

---

### Task 1: AnimatedNumber pure logic + unit test (TDD)

**Files:**
- Create: `lib/animated-number.ts`
- Test: `lib/animated-number.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sanitizeTarget(value: unknown): number | null` — finite number → itself; NaN/Infinity/undefined/null/non-number → `null`.
  - `shouldAnimate(reducedMotion: boolean, from: number, to: number): boolean` — `true` iff `!reducedMotion && to > from` (animate only increases).
  - `easeOutCubic(t: number): number` — eased progress for `t` in [0,1].
  - `interpolate(from: number, to: number, progress: number): number` — eased value; clamps `progress` to [0,1]; returns exactly `to` at `progress >= 1`, exactly `from` at `progress <= 0`.
  - `formatInt(n: number): string` — `id-ID` thousand-separated integer (rounds).
  These are consumed by `AnimatedNumber` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `lib/animated-number.test.ts`:
```ts
import { expect, test } from "vitest";
import {
  sanitizeTarget,
  shouldAnimate,
  easeOutCubic,
  interpolate,
  formatInt,
} from "./animated-number";

test("sanitizeTarget: finite numbers pass, junk becomes null", () => {
  expect(sanitizeTarget(0)).toBe(0);
  expect(sanitizeTarget(42)).toBe(42);
  expect(sanitizeTarget(-3.5)).toBe(-3.5);
  expect(sanitizeTarget(NaN)).toBeNull();
  expect(sanitizeTarget(Infinity)).toBeNull();
  expect(sanitizeTarget(undefined)).toBeNull();
  expect(sanitizeTarget(null)).toBeNull();
  expect(sanitizeTarget("5")).toBeNull();
});

test("shouldAnimate: only animate increases, never under reduced motion", () => {
  expect(shouldAnimate(false, 5, 10)).toBe(true);
  expect(shouldAnimate(false, 10, 5)).toBe(false); // decrease snaps
  expect(shouldAnimate(false, 5, 5)).toBe(false); // no change
  expect(shouldAnimate(true, 5, 10)).toBe(false); // reduced motion short-circuits
});

test("easeOutCubic: clamped endpoints", () => {
  expect(easeOutCubic(0)).toBe(0);
  expect(easeOutCubic(1)).toBe(1);
  expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // decelerating curve
});

test("interpolate: endpoints exact and monotonic", () => {
  expect(interpolate(0, 100, 0)).toBe(0);
  expect(interpolate(0, 100, 1)).toBe(100);
  expect(interpolate(10, 10, 0.5)).toBe(10);
  expect(interpolate(0, 100, -0.2)).toBe(0); // clamp low
  expect(interpolate(0, 100, 1.5)).toBe(100); // clamp high
  const a = interpolate(0, 100, 0.25);
  const b = interpolate(0, 100, 0.75);
  expect(b).toBeGreaterThan(a);
});

test("formatInt: id-ID thousands, rounds", () => {
  expect(formatInt(0)).toBe("0");
  expect(formatInt(42)).toBe("42");
  expect(formatInt(1234567)).toBe("1.234.567");
  expect(formatInt(1234.6)).toBe("1.235");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- animated-number`
Expected: FAIL — `lib/animated-number.ts` does not exist / functions not defined.

- [ ] **Step 3: Implement the pure helpers**

Create `lib/animated-number.ts`:
```ts
export function sanitizeTarget(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function shouldAnimate(reducedMotion: boolean, from: number, to: number): boolean {
  return !reducedMotion && to > from;
}

export function easeOutCubic(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, 3);
}

export function interpolate(from: number, to: number, progress: number): number {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return from + (to - from) * easeOutCubic(progress);
}

const intFormatter = new Intl.NumberFormat("id-ID");

export function formatInt(n: number): string {
  return intFormatter.format(Math.round(n));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- animated-number`
Expected: PASS (5 tests). Then run the full suite `npm test` → all green (13 prior + new file).

- [ ] **Step 5: Commit**

```bash
git add lib/animated-number.ts lib/animated-number.test.ts
git commit -m "feat(ui): AnimatedNumber pure logic (sanitize/interpolate/format) + tests"
```

---

### Task 2: usePrefersReducedMotion + AnimatedNumber component

**Files:**
- Create: `components/ui/use-prefers-reduced-motion.ts`
- Create: `components/ui/animated-number.tsx`

**Interfaces:**
- Consumes: `sanitizeTarget`, `shouldAnimate`, `interpolate`, `formatInt` from `@/lib/animated-number` (Task 1).
- Produces:
  - `usePrefersReducedMotion(): boolean` — `true` when the user prefers reduced motion (SSR-safe: `false` until mounted). Reused by Task 3.
  - `AnimatedNumber` component:
    ```ts
    function AnimatedNumber(props: {
      value: number | null | undefined;
      format?: (n: number) => string;   // default formatInt
      durationMs?: number;               // default 600
      className?: string;
    }): JSX.Element
    ```
    Renders a `<span>`; counts up to `value` on increase, snaps otherwise; renders `–` when `value` is not a finite number. Consumed by Task 4.

- [ ] **Step 1: Create the reduced-motion hook**

Create `components/ui/use-prefers-reduced-motion.ts`:
```ts
"use client";

import * as React from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
```

- [ ] **Step 2: Create the AnimatedNumber component**

Create `components/ui/animated-number.tsx`:
```tsx
"use client";

import * as React from "react";

import {
  sanitizeTarget,
  shouldAnimate,
  interpolate,
  formatInt,
} from "@/lib/animated-number";
import { usePrefersReducedMotion } from "@/components/ui/use-prefers-reduced-motion";

export function AnimatedNumber({
  value,
  format = formatInt,
  durationMs = 600,
  className,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const target = sanitizeTarget(value);
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = React.useState<number>(target ?? 0);
  const fromRef = React.useRef<number>(target ?? 0);
  const mountedRef = React.useRef(false);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (target === null) return;

    // First render: snap to value, no count-up on mount.
    if (!mountedRef.current) {
      mountedRef.current = true;
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    if (!shouldAnimate(reducedMotion, from, target)) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplay(interpolate(from, target, progress));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reducedMotion, durationMs]);

  if (target === null) return <span className={className}>–</span>;
  return <span className={className}>{format(display)}</span>;
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build completes, no TS errors. `AnimatedNumber`/`usePrefersReducedMotion` are currently unused (consumed in Task 4) — unused exports do not fail the build.

- [ ] **Step 4: Commit**

```bash
git add components/ui/use-prefers-reduced-motion.ts components/ui/animated-number.tsx
git commit -m "feat(ui): AnimatedNumber component + usePrefersReducedMotion hook"
```

---

### Task 3: useHighlightOnChange hook

**Files:**
- Create: `components/ui/use-highlight-on-change.ts`

**Interfaces:**
- Consumes: `usePrefersReducedMotion` from `@/components/ui/use-prefers-reduced-motion` (Task 2).
- Produces:
  - `useHighlightOnChange(value: number | null | undefined, durationMs?: number): boolean` — returns `true` briefly (default 1200ms) after `value` **increases** vs its previous value; never highlights on the first value, on decrease/equal, on non-finite values, or under reduced motion. Consumed by Task 4.

- [ ] **Step 1: Create the hook**

Create `components/ui/use-highlight-on-change.ts`:
```ts
"use client";

import * as React from "react";

import { usePrefersReducedMotion } from "@/components/ui/use-prefers-reduced-motion";

export function useHighlightOnChange(
  value: number | null | undefined,
  durationMs = 1200,
): boolean {
  const [highlight, setHighlight] = React.useState(false);
  const prevRef = React.useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    const v =
      typeof value === "number" && Number.isFinite(value) ? value : null;
    const prev = prevRef.current;
    prevRef.current = v;

    if (prev === null || v === null || reducedMotion) return;
    if (v > prev) {
      setHighlight(true);
      const t = setTimeout(() => setHighlight(false), durationMs);
      return () => clearTimeout(t);
    }
  }, [value, reducedMotion, durationMs]);

  return highlight;
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: build completes, no TS errors (hook currently unused — consumed in Task 4).

- [ ] **Step 3: Commit**

```bash
git add components/ui/use-highlight-on-change.ts
git commit -m "feat(ui): useHighlightOnChange hook (flash on increase, reduced-motion aware)"
```

---

### Task 4: Dashboard metric cards → StatCard + AnimatedNumber + highlight

**Files:**
- Modify: `app/panel/page.tsx` — imports; `cards` useMemo (≈ lines 545–612); the metric-grid render (≈ lines 776–780); add `DashboardStatCard`; restyle `MetricSkeleton` (≈ lines 1040–1052); remove `MetricCard` (≈ lines 1011–1038); add module-level `pct` helper.

**Interfaces:**
- Consumes: `StatCard` + `StatTone` from `@/components/ui/stat-card` (Plan 3A); `AnimatedNumber` (Task 2); `useHighlightOnChange` (Task 3). Existing values `stats.orders`, `totalClosing`, `manualClosings`, `aiClosings`, `crPerf`, `handoverTodayCount`, `handoverRate`, `handover.length`, `active.length`, `closed.length`, `performance`, `stats.cancelled` are unchanged numbers already in scope.
- Produces: a Dashboard metric grid whose numbers count up and whose lead/closing cards softly flash on increase.

- [ ] **Step 1: Add imports**

In `app/panel/page.tsx`, alongside the existing `@/components/ui/*` imports (the block around lines 29–80), add:
```tsx
import { StatCard, type StatTone } from '@/components/ui/stat-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { useHighlightOnChange } from '@/components/ui/use-highlight-on-change';
```

- [ ] **Step 2: Add the `pct` module-level helper**

Near the bottom of the file, right above `function formatRupiah(` (≈ line 2620), add:
```tsx
function pct(n: number): string {
  return `${n}%`;
}
```

- [ ] **Step 3: Reshape the `cards` useMemo**

Replace the entire `const cards = useMemo( … );` block (≈ lines 545–612) with this. Each card now carries a numeric `value`, a `StatTone`, an optional `format`, and a `highlightable` flag:
```tsx
  const cards = useMemo(
    (): Array<{
      label: string;
      value: number;
      detail: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: StatTone;
      format?: (n: number) => string;
      highlightable?: boolean;
    }> => [
      {
        label: 'Orders',
        value: stats.orders,
        detail: 'Leads · HP unik',
        icon: Activity,
        tone: 'lead',
        highlightable: true,
      },
      {
        label: 'Total Closing',
        value: totalClosing,
        detail: `AI: ${aiClosings} · Manual: ${manualClosings}`,
        icon: CheckCircle2,
        tone: 'positive',
        highlightable: true,
      },
      {
        label: 'Manual closing',
        value: manualClosings,
        detail: 'Marked by CS',
        icon: CheckCircle2,
        tone: 'lead',
      },
      {
        label: 'Cancelled',
        value: performance?.cancelled ?? stats.cancelled ?? 0,
        detail: 'Customer cancelled',
        icon: CircleAlert,
        tone: 'negative',
      },
      {
        label: 'Closing rate',
        value: crPerf,
        detail: 'Closing / orders',
        icon: BarChart3,
        tone: crPerf > 100 ? 'negative' : 'positive',
        format: pct,
      },
      {
        label: 'Handovers',
        value: handoverTodayCount,
        detail: `Today · Queue: ${handover.length}`,
        icon: CircleAlert,
        tone: 'default',
      },
      {
        label: 'Handover rate',
        value: handoverRate,
        detail: 'Today handover / orders',
        icon: ShieldCheck,
        tone: 'default',
        format: pct,
      },
      {
        label: 'Active chats',
        value: active.length,
        detail: `Today · Updated: ${activeTodayCount}`,
        icon: MessageCircle,
        tone: 'lead',
      },
      {
        label: 'Archived',
        value: closed.length,
        detail: 'Chat archived',
        icon: Clock3,
        tone: 'default',
      },
    ],
    [active.length, activeTodayCount, aiClosings, closed.length, crPerf, handover.length, handoverTodayCount, handoverRate, manualClosings, performance, stats, totalClosing],
  );
```

- [ ] **Step 4: Update the metric-grid render**

Replace the metric `<section>` (≈ lines 776–780) with an airier grid that renders `DashboardStatCard`:
```tsx
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {loading
                    ? Array.from({ length: 9 }).map((_, index) => <MetricSkeleton key={index} />)
                    : cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
                </section>
```

- [ ] **Step 5: Add the `DashboardStatCard` wrapper and restyle `MetricSkeleton`; remove `MetricCard`**

Replace the entire `function MetricCard({ … }) { … }` block (≈ lines 1011–1038) with the `DashboardStatCard` component below, and replace the `function MetricSkeleton()` block (≈ lines 1040–1052) with the restyled version. (Net: `MetricCard` is removed — it has no remaining callers after Step 4 — and `DashboardStatCard` takes its place.)
```tsx
function DashboardStatCard({
  label,
  value,
  detail,
  icon,
  tone,
  format,
  highlightable,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatTone;
  format?: (n: number) => string;
  highlightable?: boolean;
}) {
  const highlight = useHighlightOnChange(highlightable ? value : undefined);
  return (
    <StatCard
      label={label}
      value={<AnimatedNumber value={value} format={format} />}
      detail={detail}
      icon={icon}
      tone={tone}
      highlight={highlight}
    />
  );
}

function MetricSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}
```

- [ ] **Step 6: Confirm `MetricCard` has no remaining references**

Run: `grep -rn "MetricCard\b" app`
Expected: no matches (it was only used in the grid render replaced in Step 4).

- [ ] **Step 7: Build to verify**

Run: `npm run build`
Expected: build completes, no TS errors (no unused-import or missing-symbol errors; `StatTone`/`StatCard`/`AnimatedNumber`/`useHighlightOnChange` all resolve).

- [ ] **Step 8: Visual review checklist**

`npm run dev` → http://localhost:3000/panel (Dashboard):
- Nine metric cards render as airy light `StatCard`s (rounded-2xl, soft border + shadow, label muted, big `tabular-nums` value, icon tinted by tone: lead=sky/indigo, positive=emerald, negative=red, default=indigo).
- Percentages ("Closing rate", "Handover rate") show e.g. `50%`.
- Switch the period filter (e.g. Hari ini → 7 hari) and watch numbers **count up** to new values; "Orders" and "Total Closing" briefly **flash** a soft indigo background when they increase.
- Loading state shows the restyled light skeletons.
- (If your OS has "reduce motion" on, numbers update instantly with no flash — that's correct.)

- [ ] **Step 9: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(ui): live Dashboard StatCards with count-up + highlight on increase"
```

---

### Task 5: Restyle Order Dobel + formula/readiness sections

**Files:**
- Modify: `app/panel/page.tsx` — the Order Dobel `Card` (≈ lines 782–820) and minor token polish in the "System readiness" / "Today formula" aside cards (≈ lines 847–879).

**Interfaces:**
- Consumes: `Badge` soft variants `warning`/`secondary` (Plan 3A). Existing `duplicateOrders`, `fmtTime`, `displayGlobalEnabled` references unchanged.
- Produces: an airier, token-based Order Dobel list (no hardcoded amber).

- [ ] **Step 1: Restyle the Order Dobel section**

Replace the Order Dobel `<Card className="mt-3"> … </Card>` block (≈ lines 782–820) with:
```tsx
                <Card className="mt-3">
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
                        <div key={d.phone} className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{d.customerName || 'Tanpa Nama'}</span>
                            <span className="text-muted-foreground">{d.phone}</span>
                            <span className="text-muted-foreground">· {d.csName || '—'}</span>
                            <Badge variant="secondary">{d.count}× order</Badge>
                            {d.likelyAccidental ? (
                              <Badge variant="warning">⚠ kemungkinan accidental</Badge>
                            ) : (
                              <Badge variant="secondary">repeat customer</Badge>
                            )}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {d.orders.map((o) => (
                              <li key={o.orderId} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                <code className="text-foreground">{o.orderId}</code>
                                <span>{o.productName || '—'}</span>
                                <span>{o.total || '—'}</span>
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

- [ ] **Step 2: Polish the readiness note token**

In the "System readiness" card, replace the inner note `<div>` (≈ line 858):
```tsx
                        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
```
with (use the explicit border token + soft accent tint for consistency):
```tsx
                        <div className="rounded-lg border border-border bg-accent/40 p-3 text-xs text-muted-foreground">
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build completes, no errors.

- [ ] **Step 4: Visual review checklist**

`npm run dev` → http://localhost:3000/panel (Dashboard):
- Order Dobel rows are airy light cards (rounded-xl, soft border+shadow). The "N× order" and "repeat customer" chips are neutral `secondary` Badges; "⚠ kemungkinan accidental" is a soft amber `warning` Badge (no harsh hardcoded amber).
- The "System readiness" note reads as a soft indigo-tinted panel; "Today formula" rows unchanged and legible.

- [ ] **Step 5: Run the Convex regression suite (unchanged data layer)**

Run: `npm test`
Expected: all pass (13 prior Convex tests + the AnimatedNumber tests from Task 1; no UI change touched Convex).

- [ ] **Step 6: Commit**

```bash
git add app/panel/page.tsx
git commit -m "feat(ui): airy light Order Dobel + readiness restyle"
```

---

## Self-Review

**1. Spec coverage:**
- §3.2 "AnimatedNumber — rAF count-up, dependency-free, respects reduced-motion" → Tasks 1 (logic) + 2 (component). ✓
- §3.2 "useHighlightOnChange / highlight class — soft accent flash on increase, applied to leads/closings" → Task 3 + Task 4 (`highlightable: true` on Orders + Total Closing; StatCard `highlight` → `bg-accent`). ✓
- §3.3 "Dashboard — metric StatCards (with AnimatedNumber + highlight), Order Dobel section, formula helper" → Task 4 (StatCards + live) + Task 5 (Order Dobel + formula/readiness). ✓
- §5 "guard NaN/undefined (show 0 or –); snap on first render; count-up only on subsequent increases; reduced-motion disables count-up + highlight" → Task 1 `sanitizeTarget`/`shouldAnimate`, Task 2 `mountedRef` snap + reduced-motion, Task 3 reduced-motion guard. ✓
- §4 "data flow unchanged" → no Convex/query edits; cards read the same in-scope values. ✓
- §6 "build + visual review; one unit test for AnimatedNumber value/format logic + reduced-motion short-circuit; Convex suite stays green" → Task 1 TDD (incl. `shouldAnimate` reduced-motion case), Tasks 2–5 build+visual, Task 5 Step 5 reruns Convex suite. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step is complete. Reduced-motion + NaN guards are concrete code, not prose. ✓

**3. Type/name consistency:** Pure-fn names (`sanitizeTarget`, `shouldAnimate`, `easeOutCubic`, `interpolate`, `formatInt`) defined in Task 1 are imported with the same names in Task 2. `AnimatedNumber` prop `value: number | null | undefined` + `format` is consumed consistently in Task 4. `useHighlightOnChange(value)` signature (Task 3) matches its call in `DashboardStatCard` (Task 4). `StatCard`/`StatTone` names match the Plan 3A contract (`label`, `value`, `detail`, `icon`, `tone`, `highlight`). `DashboardStatCard`'s `icon: React.ComponentType<{ className?: string }>` matches both the lucide icons passed in `cards` and `StatCard`'s `icon` prop type. ✓

**Note:** `MetricCard` is removed because Task 4 leaves it with no callers (orphan cleanup of code this change made unused — per surgical-change discipline). `MetricSkeleton` is kept (still used by the loading branch) and restyled to match `StatCard`.
