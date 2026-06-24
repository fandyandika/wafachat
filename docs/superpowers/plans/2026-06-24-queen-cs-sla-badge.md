# Queen CS crown + SLA mini-badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crown one overall "Queen CS" per period (weighted closings/CR/speed) and turn the SLA-breach metric into a lean header mini-badge.

**Architecture:** A pure `lib/queen.ts` computes the winner from data already in the Laporan view; the dashboard renders a Queen hero + passes `isQueen` to the winner's card; the card shows a Queen crown + gold ring and an SLA mini-badge. Front-end only — no Convex/schema/query change.

**Tech Stack:** Next.js 14, TypeScript, vitest.

## Global Constraints

- Next.js 14, single light theme; lucide icons (`Crown`, `Clock`), no emoji-as-text in components.
- Front-end / derived only — no schema, index, query, or Convex change.
- Queen: weighted `0.40·closings + 0.40·CR + 0.20·speed`, each normalized relative to the best qualified CS; qualify = `leads >= 3`; needs `>= 2` qualified else no Queen; `speedScore = minMedian/median` needs `respCount >= 3` else 0; tie-break `closings` then `cr`.
- Reuse existing tokens/patterns (`bg-positive-soft`, amber, reward-chip gradient, `ring-*`).
- Keep the existing per-category reward chips and the "Balas chat baru" median line.
- Deploy: `npm run build` (EXIT 0) + `npx vitest run` green, then `git push` (Vercel). **No Convex deploy** (no backend change).
- cwd resets → prefix every shell command with `cd /f/Projects/whatsapp_cs_automotion/wafachat &&`.
- Repo Fact-Forcing Gate: before each Write/Edit/Bash, state importers (Grep), affected public functions, data fields, and quote the user instruction verbatim.

## File Structure

- `lib/queen.ts` (create) — pure `computeQueenCs` + `QUEEN_WEIGHTS`.
- `lib/queen.test.ts` (create) — unit tests (the 6 spec cases).
- `components/panel/report-card.tsx` (modify) — SLA row → header mini-badge; `isQueen` prop → crown chip + gold ring.
- `components/panel/daily-report-dashboard.tsx` (modify) — compute Queen + hero banner + pass `isQueen` to `ReportCard`.

---

### Task 1: lib/queen.ts — weighted Queen scorer

**Files:**
- Create: `lib/queen.ts`, `lib/queen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type QueenInput = { csName: string; closings: number; cr: number; leads: number; respMedianMs: number | null; respCount: number }`
  - `QUEEN_WEIGHTS = { closing: 0.4, cr: 0.4, speed: 0.2 }`
  - `computeQueenCs(rows: QueenInput[], minLeads = 3, minRespCount = 3): { csName: string; score: number } | null`

- [ ] **Step 1: Write the failing tests**

Create `lib/queen.test.ts`:

```ts
import { expect, test } from "vitest";
import { computeQueenCs } from "./queen";

const row = (csName: string, closings: number, cr: number, leads: number, respMedianMs: number | null, respCount: number) =>
  ({ csName, closings, cr, leads, respMedianMs, respCount });

test("crowns the CS dominating closings + CR", () => {
  const q = computeQueenCs([row("Risma", 10, 50, 20, 60000, 10), row("Aisyah", 3, 20, 15, 30000, 10)]);
  expect(q?.csName).toBe("Risma");
});

test("a much faster CS with weak closings/CR does not overtake (speed only 20%)", () => {
  const q = computeQueenCs([
    row("Risma", 10, 50, 20, 120000, 10), // dominates closings+CR, slow
    row("Aisyah", 2, 10, 15, 10000, 10),  // fastest by far, weak results
  ]);
  expect(q?.csName).toBe("Risma");
});

test("returns null when fewer than 2 CS qualify", () => {
  expect(computeQueenCs([row("Risma", 5, 40, 10, 60000, 5)])).toBeNull();
  expect(computeQueenCs([row("Risma", 5, 40, 10, 60000, 5), row("Aisyah", 1, 50, 2, 30000, 5)])).toBeNull();
});

test("excludes CS with leads < 3 from qualification", () => {
  const q = computeQueenCs([
    row("Risma", 5, 40, 10, 60000, 5),
    row("Aisyah", 8, 90, 12, 30000, 5),
    row("Lila", 99, 99, 2, 1000, 5), // leads<3 -> excluded despite huge numbers
  ]);
  expect(q?.csName).toBe("Aisyah");
});

test("deterministic on a tie (identical stats) -> a valid winner, not null", () => {
  const q = computeQueenCs([row("A", 5, 50, 10, 60000, 5), row("B", 5, 50, 10, 60000, 5)]);
  expect(q).not.toBeNull();
  expect(["A", "B"]).toContain(q!.csName);
});

test("no speed data (all respCount<3) -> still crowns by closings + CR", () => {
  const q = computeQueenCs([row("Risma", 10, 50, 20, null, 0), row("Aisyah", 3, 20, 15, null, 0)]);
  expect(q?.csName).toBe("Risma");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/queen.test.ts`
Expected: FAIL (cannot find module `./queen`).

- [ ] **Step 3: Implement `lib/queen.ts`**

Create `lib/queen.ts`:

```ts
// Pure "Queen CS" scorer — the overall best CS for a period, combining closings,
// closing-rate, and response speed. Weighted, normalized relative to the best
// qualified CS. No framework imports so it runs plain in vitest.

export type QueenInput = {
  csName: string;
  closings: number;
  cr: number;
  leads: number;
  respMedianMs: number | null;
  respCount: number;
};

export const QUEEN_WEIGHTS = { closing: 0.4, cr: 0.4, speed: 0.2 };

export function computeQueenCs(
  rows: QueenInput[],
  minLeads = 3,
  minRespCount = 3,
): { csName: string; score: number } | null {
  const qualified = rows.filter((r) => r.leads >= minLeads);
  if (qualified.length < 2) return null;

  const maxClosings = Math.max(...qualified.map((r) => r.closings));
  const maxCr = Math.max(...qualified.map((r) => r.cr));
  const speedEligible = qualified.filter((r) => r.respCount >= minRespCount && r.respMedianMs != null);
  const minMedian = speedEligible.length ? Math.min(...speedEligible.map((r) => r.respMedianMs as number)) : null;

  const scored = qualified.map((r) => {
    const closeScore = maxClosings > 0 ? r.closings / maxClosings : 0;
    const crScore = maxCr > 0 ? r.cr / maxCr : 0;
    const speedScore =
      minMedian != null && r.respCount >= minRespCount && r.respMedianMs != null ? minMedian / r.respMedianMs : 0;
    const score =
      QUEEN_WEIGHTS.closing * closeScore + QUEEN_WEIGHTS.cr * crScore + QUEEN_WEIGHTS.speed * speedScore;
    return { csName: r.csName, closings: r.closings, cr: r.cr, score };
  });

  scored.sort((a, b) => b.score - a.score || b.closings - a.closings || b.cr - a.cr);
  return { csName: scored[0].csName, score: scored[0].score };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run lib/queen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add lib/queen.ts lib/queen.test.ts && git commit -m "feat(laporan): pure Queen CS scorer (weighted 40/40/20)"
```

---

### Task 2: report-card — SLA mini-badge + Queen crown

**Files:**
- Modify: `components/panel/report-card.tsx`

**Interfaces:**
- Consumes: `resp.slaBreaches` (already on `RespStat`); a new `isQueen?: boolean` prop (passed by Task 3).
- Produces: `ReportCard` accepts `isQueen?: boolean`; SLA shown as a header mini-badge; Queen shown as a crown chip + gold ring.

**Note:** `Crown` and `Clock` are already imported in this file (line 4). `cn` is imported.

- [ ] **Step 1: Add the `isQueen` prop**

In `components/panel/report-card.tsx`, add `isQueen` to the destructure (line 30) and the props type (after line 40):

- Destructure line 30 → `card, label, isCurrent, resp, rank, avgCr, delta, rewards, avatarByKey, isQueen,`
- Props type, after `avatarByKey?: Map<string, string | null>;` (line 40) → add:
```ts
  isQueen?: boolean;
```

- [ ] **Step 2: Add the gold ring when Queen**

Replace the `<Card className={cn(...)}>` block (lines 55-58) with:

```tsx
    <Card className={cn(
      'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevate hover:border-primary/30',
      rank === 1 && 'ring-1 ring-primary/20',
      isQueen && 'ring-2 ring-amber-400/70',
    )}>
```

- [ ] **Step 3: Add the SLA mini-badge to the header**

Immediately after the Live/Selesai badge block (after line 77, i.e. after the closing `)}` of the `{isCurrent ? (...) : (...)}` and before the `</div>` at line 78), add:

```tsx
          {resp && resp.slaBreaches > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
              title={`${resp.slaBreaches} chat lewat SLA (>15m)`}
            >
              <Clock className="size-3.5" /> {resp.slaBreaches}
            </span>
          )}
```

- [ ] **Step 4: Add the Queen chip at the top of CardContent**

Immediately after `<CardContent className="space-y-4">` (line 83), as its first child (before the rewards block at line 84), add:

```tsx
        {isQueen && (
          <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-100 to-yellow-100 px-2.5 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-300/60">
            <Crown className="size-4 text-amber-500" /> Queen CS · juara umum
          </div>
        )}
```

- [ ] **Step 5: Collapse the SLA row back to a single response-time line**

Replace the two-row resp block (lines 156-168) with the single median line (the SLA row moved to the header badge in Step 3):

```tsx
        {resp && resp.firstReplyCount > 0 && (
          <div className={cn('flex items-center justify-between gap-2 border-t pt-3 text-sm', resp.firstReplyCount < 3 && 'opacity-50')}>
            <span className="flex items-center gap-1.5 text-muted-foreground"><Zap className="size-3.5 text-primary" /> Balas chat baru</span>
            <span className="font-medium tabular-nums text-foreground">
              {formatDuration(resp.firstReplyMedianMs)} <span className="font-normal text-muted-foreground">· {resp.firstReplyCount} chat</span>
            </span>
          </div>
        )}
```

- [ ] **Step 6: Build to verify it compiles**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/report-card.tsx && git commit -m "feat(laporan): SLA header mini-badge + Queen crown on report card"
```

---

### Task 3: dashboard — compute Queen + hero + pass isQueen

**Files:**
- Modify: `components/panel/daily-report-dashboard.tsx`

**Interfaces:**
- Consumes: `computeQueenCs`/`QueenInput` (Task 1); `isQueen` prop on `ReportCard` (Task 2); existing `allCs`, `respByCs`, `csName`, `avatarByKey`.
- Produces: a Queen hero banner + the winner's card flagged `isQueen`.

- [ ] **Step 1: Import `computeQueenCs` + `Crown`**

In `components/panel/daily-report-dashboard.tsx`:
- Add to the lucide import (line 6): `Crown` →
```ts
import { ChevronLeft, ChevronRight, ClipboardList, Copy, CheckCircle2, Info, Clock, Crown } from 'lucide-react';
```
- Add an import for the scorer (after the `report-window` import block, around line 20):
```ts
import { computeQueenCs } from '@/lib/queen';
```

- [ ] **Step 2: Compute the Queen (team view only)**

After the `fastestResp` loop + `showHighlights` line (after line 118), add:

```ts
  const queen = !csName
    ? computeQueenCs(
        allCs.map((c) => {
          const r = respByCs.get(c.csName);
          return {
            csName: c.csName,
            closings: c.closings,
            cr: c.cr,
            leads: c.leads,
            respMedianMs: r?.firstReplyMedianMs ?? null,
            respCount: r?.firstReplyCount ?? 0,
          };
        }),
      )
    : null;
  const queenName = queen?.csName;
  const queenCard = queenName ? allCs.find((c) => c.csName === queenName) : undefined;
```

- [ ] **Step 3: Render the Queen hero banner above Sorotan**

Immediately after `<GrandStrip ... />` (line 178) and before the `{showHighlights && (` block (line 179), add:

```tsx
          {queen && queenCard && (
            <QueenHero name={queenCard.csName} closings={queenCard.closings} cr={queenCard.cr} avatarByKey={avatarByKey} />
          )}
```

- [ ] **Step 4: Pass `isQueen` to the winner's card**

In the `cards.map((c) => (<ReportCard ... />))` (lines 200-213), add the prop after `avatarByKey={avatarByKey}`:

```tsx
                    isQueen={c.csName === queenName}
```

- [ ] **Step 5: Add the `QueenHero` component**

At the bottom of the file (next to `HighlightCard`), add:

```tsx
function QueenHero({ name, closings, cr, avatarByKey }: { name: string; closings: number; cr: number; avatarByKey: Map<string, string | null> }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-300/70 bg-gradient-to-r from-amber-50 to-yellow-50 p-4 shadow-sm ring-1 ring-amber-300/40">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
        <Crown className="size-6" />
      </span>
      <CsAvatar name={name} size="md" src={avatarByKey.get(csKey(name)) ?? undefined} />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Queen CS · juara umum</div>
        <div className="truncate text-base font-bold tracking-tight text-amber-900">{name}</div>
        <div className="text-xs tabular-nums text-amber-700">{closings} closing · CR {Math.round(cr * 10) / 10}%</div>
      </div>
    </div>
  );
}
```

(`CsAvatar`, `csKey`, `Crown` are imported in this file after Step 1.)

- [ ] **Step 6: Build + full test suite**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build && npx vitest run`
Expected: build EXIT 0, all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add components/panel/daily-report-dashboard.tsx && git commit -m "feat(laporan): Queen CS hero banner + crown on winning card"
```

---

### Task 4: Deploy

**Files:** none (ops). Front-end only — no Convex deploy.

- [ ] **Step 1: Final green check** — `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build` (all PASS, EXIT 0).
- [ ] **Step 2: Push** — `git push origin main` (Vercel deploys the UI; no Convex change so no `convex deploy` needed).
- [ ] **Step 3: Finish** — use superpowers:finishing-a-development-branch.
