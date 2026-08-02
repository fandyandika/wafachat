# Wafachat Operational Ledger Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Operational Ledger foundation and a secure role-adaptive Dashboard for owner and CS without changing business calculations or adding live Convex subscriptions.

**Architecture:** `/panel` becomes a thin role switch. Owner and CS homes share one bounded snapshot-data hook and small dashboard-specific ledger primitives, while retaining different compositions. Convex derives the effective CS scope from the authenticated user record, so browser-supplied `csName` can never broaden a CS account's data.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS 3, Convex 1.39, Vitest 2, existing shadcn/Base UI and Lucide components.

## Global Constraints

- Work only in the `feat/ui-redesign-v2` worktree.
- Prefix every shell command with `rtk`.
- Before the first UI edit, read `C:\Users\fandy\.agents\skills\impeccable\reference\craft-floor.md` completely.
- Reuse installed dependencies and existing components; add no package.
- Preserve webhook, ingest, notification, deduplication, reconciliation, 16:00 cutoff, Queen, report, tenant, and metric calculations.
- The only route-permission change is allowing CS accounts to open exact route `/panel`.
- Performance, Queen, and Settings remain admin-only.
- Owner Dashboard query budget remains unchanged: one summary snapshot, one duplicate snapshot, one performance snapshot, one CS-list read, and one response-time snapshot per load/manual refresh.
- CS Dashboard query budget is one scoped summary snapshot, one scoped performance snapshot, one scoped response-time snapshot, and one scoped follow-up-candidates snapshot per load/manual refresh. It must not read duplicate orders, team CS list, or follow-up effectiveness.
- Add no interval, polling loop, or realtime subscription.
- Use the existing font and Wafachat brand assets.
- Mobile touch targets are at least 44px, navigation is opaque and safe-area-aware, focus is visible, contrast is WCAG AA, and reduced motion is respected.
- Run the Impeccable detector exactly once, after all UI implementation and visual inspection.

## File map

**Create**

- `components/panel/dashboard/use-dashboard-data.ts` — shared bounded Dashboard snapshot orchestration.
- `components/panel/dashboard/ledger.tsx` — Dashboard-only Operational Ledger primitives.
- `components/panel/dashboard/ledger.test.tsx` — semantic rendering checks for the ledger primitives.
- `components/panel/dashboard/owner-home.tsx` — owner decision surface and duplicate-order sheet.
- `components/panel/dashboard/cs-home.tsx` — CS next-work and personal-progress surface.
- `app/api/follow-up/counts/route.ts` — one-shot CS queue counts using the existing candidates query only.
- `app/api/follow-up/counts/route.test.ts` — authorization and response-shape checks for the counts endpoint.
- `DESIGN.md` — generated at finish from the implemented visual system by the Impeccable documenter.

**Modify**

- `convex/authz.ts` — central effective-CS scope resolver.
- `convex/metrics.ts` — server-scope Dashboard summary and duplicates.
- `convex/shippingRecaps.ts` — server-scope Dashboard performance.
- `convex/followUp.ts` — server-scope the candidates query used by CS Home.
- `convex/metrics.test.ts` and `convex/followUp.test.ts` — prove browser filters cannot escape CS scope.
- `convex/auth.ts` and `convex/auth.test.ts` — add organization name to login result without a recurring query.
- `lib/auth-jwt.ts` and `lib/auth-jwt.test.ts` — carry organization context and allow exact CS Dashboard route.
- `app/api/auth/login/route.ts`, `app/api/me/route.ts`, and `components/panel/use-me.ts` — expose session organization context to the shell.
- `app/globals.css` and `tailwind.config.ts` — Operational Ledger tokens and restrained elevation.
- `app/panel/layout.tsx` and `app/panel/layout.test.tsx` — role-aware shell and navigation.
- `components/panel/window-mode-toggle.tsx` — explicit ledger-styled calendar/work-window control.
- `app/panel/page.tsx` and `app/panel/page.test.tsx` — role switch and Dashboard integration checks.
- `docs/superpowers/specs/2026-08-02-wafachat-role-adaptive-operational-ledger-design.md` — already amended to record the exact CS route exception.

---

### Task 1: Enforce server-side CS scope for every Phase 1 Dashboard read

**Files:**

- Modify: `convex/authz.ts`
- Modify: `convex/metrics.ts`
- Modify: `convex/shippingRecaps.ts`
- Modify: `convex/followUp.ts`
- Test: `convex/metrics.test.ts`
- Test: `convex/followUp.test.ts`

**Interfaces:**

- Produces: `requireScopedMemberOrg(ctx, fn, requestedCsName?) -> Promise<{ viewer, orgId, effectiveCsName? }>`.
- Rule: admin receives the requested scope; CS always receives the active user row's assigned `csName`.
- Consumed later by: `metrics.getDashboardSummary`, `metrics.getDuplicateOrders`, `shippingRecaps.getPerformance`, and `followUp.getFollowUpCandidates`.

- [ ] **Step 1: Add failing Convex tests for attempted cross-CS reads**

Add a user row whose `_id` is used as the CS identity subject, seed records for `Aisyah` and `Lila`, then assert that a CS assigned to Aisyah still receives only Aisyah data when requesting `csName: "Lila"`:

```ts
const csUserId = await t.run((ctx: any) => ctx.db.insert("users", {
  orgId,
  email: "aisyah@wafachat.test",
  name: "Aisyah",
  passwordHash: "x",
  role: "cs",
  csName: "Aisyah",
  isActive: true,
  createdAt: 1,
  updatedAt: 1,
}));
const asCs = t.withIdentity({
  subject: String(csUserId),
  role: "cs",
  name: "Aisyah",
  email: "aisyah@wafachat.test",
  csName: "Aisyah",
});

const summary = await asCs.query(api.metrics.getDashboardSummary, {
  startAt: t0 - DAY,
  endAt: t0 + DAY,
  csName: "Lila",
});
expect(summary.leads).toBe(1);

const performance = await asCs.query(api.shippingRecaps.getPerformance, {
  startAt: t0 - DAY,
  endAt: t0 + DAY,
  csName: "Lila",
});
expect(performance.cs.map((row) => row.csName)).toEqual(["Aisyah"]);
```

In `convex/followUp.test.ts`, seed one eligible conversation for each CS and assert that the same hostile `csName: "Lila"` request returns only Aisyah's order.

- [ ] **Step 2: Run the focused tests and verify the data escape is reproduced**

Run:

```powershell
rtk npm test -- convex/metrics.test.ts convex/followUp.test.ts
```

Expected: the new assertions fail because member queries currently trust `args.csName`.

- [ ] **Step 3: Add the central scope resolver**

Add this exported helper to `convex/authz.ts`:

```ts
export type ScopedViewerOrg = ViewerOrg & { effectiveCsName?: string };

export async function requireScopedMemberOrg(
  ctx: any,
  fn: string,
  requestedCsName?: string,
): Promise<ScopedViewerOrg> {
  const { viewer, orgId } = await requireMemberOrg(ctx, fn);
  if (viewer.role === "admin") {
    return { viewer, orgId, effectiveCsName: requestedCsName?.trim() || undefined };
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", viewer.email))
    .unique();
  if (!user || !user.isActive || String(user._id) !== viewer.subject || user.role !== "cs") {
    throw new Error(`unauthorized: ${fn} session is stale`);
  }
  const effectiveCsName = user.csName?.trim();
  if (!effectiveCsName) throw new Error(`unauthorized: ${fn} CS scope is missing`);
  return { viewer, orgId, effectiveCsName };
}
```

- [ ] **Step 4: Route Phase 1 reads through the resolver**

Change each public handler to overwrite, not merge before, the browser value:

```ts
const { orgId, effectiveCsName } = await requireScopedMemberOrg(
  ctx,
  "metrics.getDashboardSummary",
  args.csName,
);
return computeDashboardSummaryRaw(ctx, orgId, { ...args, csName: effectiveCsName });
```

Use these handler bodies for the other Phase 1 reads:

```ts
// metrics.getDuplicateOrders
const { orgId, effectiveCsName } = await requireScopedMemberOrg(
  ctx,
  "metrics.getDuplicateOrders",
  args.csName,
);
const scopedArgs = { ...args, csName: effectiveCsName };
assertPublicAnalyticsRange(scopedArgs.startAt, scopedArgs.endAt, "metrics.getDuplicateOrders");
```

Keep the current duplicate-order body in place and replace its remaining `args.startAt`, `args.endAt`, and `args.csName` reads with `scopedArgs.startAt`, `scopedArgs.endAt`, and `scopedArgs.csName`. Do not change its bounds, grouping, sorting, or return shape.

```ts
// shippingRecaps.getPerformance
const { orgId, effectiveCsName } = await requireScopedMemberOrg(
  ctx,
  "shippingRecaps.getPerformance",
  args.csName,
);
return performanceFromRaw(ctx, orgId, { ...args, csName: effectiveCsName });
```

```ts
// followUp.getFollowUpCandidates
const { orgId, effectiveCsName } = await requireScopedMemberOrg(
  ctx,
  "followUp.getFollowUpCandidates",
  args.csName,
);
return followUpCandidatesHandler(ctx, {
  ...args,
  orgId,
  csName: effectiveCsName,
});
```

Do not alter the internal follow-up query used by cron jobs.

- [ ] **Step 5: Run focused and authorization tests**

Run:

```powershell
rtk npm test -- convex/metrics.test.ts convex/followUp.test.ts convex/authz.test.ts
```

Expected: PASS; admin filters still work and a CS cannot escape its assigned scope.

- [ ] **Step 6: Commit the security boundary**

```powershell
rtk git add convex/authz.ts convex/metrics.ts convex/shippingRecaps.ts convex/followUp.ts convex/metrics.test.ts convex/followUp.test.ts
rtk git commit -m "fix: enforce CS scope on dashboard reads"
```

---

### Task 2: Carry organization context in the existing session

**Files:**

- Modify: `convex/auth.ts`
- Test: `convex/auth.test.ts`
- Modify: `lib/auth-jwt.ts`
- Test: `lib/auth-jwt.test.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/me/route.ts`
- Modify: `components/panel/use-me.ts`

**Interfaces:**

- Produces: optional `orgName` on `Session` and `Me`.
- Existing sessions without `orgName` remain valid; the UI uses `"Organisasi aktif"` until the next login refreshes the claim.

- [ ] **Step 1: Write failing session-context tests**

Extend the `lib/auth-jwt.test.ts` sign/verify test so this input survives a round trip:

```ts
orgName: "Pustaka Islam"
```

In `convex/auth.test.ts`, assert a successful login result includes the seeded organization name.

- [ ] **Step 2: Run tests and confirm organization context is missing**

```powershell
rtk npm test -- lib/auth-jwt.test.ts convex/auth.test.ts
```

Expected: FAIL on missing `orgName`.

- [ ] **Step 3: Add organization name to the login-time session only**

In `convex/auth.ts`, read the already-known organization document once during successful credential verification:

```ts
const org = await ctx.db.get(user.orgId);
return {
  ok: true as const,
  userId: user._id,
  role: user.role,
  name: user.name,
  email: user.email,
  csName: user.csName,
  orgId: String(user.orgId),
  orgName: org?.name,
};
```

Add `orgName?: string` to `Session`, include it in `signSession`, recover it in `verifySession`, pass it from `app/api/auth/login/route.ts`, and return it from `app/api/me/route.ts`. Add the same optional field to `Me` in `components/panel/use-me.ts`.

This deliberately avoids a recurring organization-name query in the shell.

- [ ] **Step 4: Run session and auth tests**

```powershell
rtk npm test -- lib/auth-jwt.test.ts convex/auth.test.ts app/ConvexClientProvider.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the session context**

```powershell
rtk git add convex/auth.ts convex/auth.test.ts lib/auth-jwt.ts lib/auth-jwt.test.ts app/api/auth/login/route.ts app/api/me/route.ts components/panel/use-me.ts
rtk git commit -m "feat: add organization session context"
```

---

### Task 3: Establish the Operational Ledger foundation and shared shell

**Files:**

- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`
- Modify: `app/panel/layout.tsx`
- Test: `app/panel/layout.test.tsx`

**Interfaces:**

- Produces: paper, ink, carbon-violet, rule, and semantic tokens used by all Phase 1 UI.
- Produces: `navItemsForRole(role)` for deterministic role navigation.
- Consumes: `Me.orgName`, `Me.role`, and existing Wafachat brand assets.

- [ ] **Step 1: Load the Impeccable craft floor before editing UI**

Read the file completely:

```powershell
rtk powershell -NoProfile -Command "Get-Content -Raw -LiteralPath 'C:\Users\fandy\.agents\skills\impeccable\reference\craft-floor.md'"
```

Do not run the detector at this point.

- [ ] **Step 2: Write failing shell tests for role navigation and context**

Make the mocked `useMe` result mutable, then test both roles:

```ts
expect(navItemsForRole("admin").map((item) => item.href)).toEqual([
  "/panel",
  "/panel/performance",
  "/panel/laporan",
  "/panel/follow-up",
  "/panel/settings",
]);
expect(navItemsForRole("cs").map((item) => item.href)).toEqual([
  "/panel/laporan",
  "/panel/follow-up",
]);
expect(adminHtml).toContain("Pustaka Islam");
expect(csHtml).not.toContain('href="/panel/performance"');
expect(csHtml).not.toContain('href="/panel/settings"');
```

Retain the existing skip-link, one-wordmark, no-global-filter, and no-query-string assertions.

- [ ] **Step 3: Run the shell test and verify it fails**

```powershell
rtk npm test -- app/panel/layout.test.tsx
```

Expected: FAIL because CS navigation omits Dashboard and the shell lacks organization/role context.

- [ ] **Step 4: Replace the generic visual tokens with the ledger palette**

In `app/globals.css`, keep the existing semantic variable names so downstream components remain compatible, but set them to the approved world:

```css
:root {
  --background: oklch(0.975 0.012 88);
  --foreground: oklch(0.22 0.025 258);
  --card: oklch(0.995 0.006 88);
  --card-foreground: oklch(0.22 0.025 258);
  --popover: oklch(0.995 0.006 88);
  --popover-foreground: oklch(0.22 0.025 258);
  --primary: oklch(0.50 0.20 285);
  --primary-foreground: oklch(0.985 0.004 88);
  --secondary: oklch(0.94 0.015 88);
  --secondary-foreground: oklch(0.28 0.025 258);
  --muted: oklch(0.945 0.012 88);
  --muted-foreground: oklch(0.47 0.025 258);
  --accent: oklch(0.93 0.035 285);
  --accent-foreground: oklch(0.36 0.14 282);
  --border: oklch(0.84 0.018 88);
  --input: oklch(0.84 0.018 88);
  --ring: oklch(0.50 0.20 285);
  --ledger-ink: oklch(0.18 0.035 258);
  --ledger-rule: oklch(0.78 0.025 88);
  --radius: 0.5rem;
}
```

Expose `ledger-ink` and `ledger-rule` in `tailwind.config.ts`. Replace tinted floating shadows with one restrained border-adjacent shadow; do not add gradients or decorative textures.

- [ ] **Step 5: Recompose the shell**

Export this pure helper from `app/panel/layout.tsx`:

```ts
export function navItemsForRole(role: "admin" | "cs" | undefined) {
  if (role !== "cs") return NAV;
  return NAV.filter(({ href }) =>
    href === "/panel/laporan" || href === "/panel/follow-up",
  );
}
```

Recompose the shell with:

- a quiet paper sidebar with strong ruled active navigation instead of a filled violet pill;
- Wafachat wordmark exactly once;
- organization label `me?.orgName || "Organisasi aktif"` and explicit `Owner`/`CS` role mark;
- one route title and no global period controls;
- opaque mobile navigation using `bg-card`, `pb-[env(safe-area-inset-bottom)]`, and 44px targets;
- existing skip link, logout, PWA install, and route behaviors unchanged.

- [ ] **Step 6: Run the shell test**

```powershell
rtk npm test -- app/panel/layout.test.tsx
```

Expected: PASS for admin and CS compositions.

- [ ] **Step 7: Commit the visual foundation**

```powershell
rtk git add app/globals.css tailwind.config.ts app/panel/layout.tsx app/panel/layout.test.tsx
rtk git commit -m "feat: establish operational ledger shell"
```

---

### Task 4: Create the Dashboard-scoped Operational Ledger primitives

**Files:**

- Create: `components/panel/dashboard/ledger.tsx`
- Create: `components/panel/dashboard/ledger.test.tsx`

**Interfaces:**

- Produces: `LedgerSection`, `LedgerMetricGrid`, `LedgerMetric`, `StatusStamp`, and `DashboardContextBar`.
- Does not produce a general design-system package; these primitives stay Dashboard-scoped until another phase proves reuse.

- [ ] **Step 1: Write failing semantic-rendering tests**

Render the primitives with `renderToStaticMarkup` and assert semantic structure and visible content:

```tsx
const html = renderToStaticMarkup(
  <LedgerSection title="Kinerja bisnis" description="Snapshot periode aktif">
    <LedgerMetricGrid>
      <LedgerMetric label="Leads" value="42" detail="hari ini" />
      <LedgerMetric label="Closing" value="30" detail="hari ini" tone="positive" />
    </LedgerMetricGrid>
  </LedgerSection>,
);

expect(html).toContain("<section");
expect(html).toContain("Kinerja bisnis");
expect(html).toContain("Snapshot periode aktif");
expect(html).toContain("Leads");
expect(html).toContain("42");
expect(html).not.toContain("shadow-elevate");
```

Add a context-bar case that verifies its period and update status remain visible without icon-only labels.

- [ ] **Step 2: Run the primitive test and verify it fails**

```powershell
rtk npm test -- components/panel/dashboard/ledger.test.tsx
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the low-wrapper primitives**

Use these exact public signatures:

```ts
export function LedgerSection(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element;

export function LedgerMetricGrid(props: { children: ReactNode }): JSX.Element;

export function LedgerMetric(props: {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: "default" | "positive" | "warning" | "negative";
}): JSX.Element;

export function StatusStamp(props: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "negative";
}): JSX.Element;

export function DashboardContextBar(props: {
  eyebrow: string;
  period: string;
  updatedAt: string;
  actions?: ReactNode;
}): JSX.Element;
```

Use real `<section>`, headings, borders, and shared baselines. Do not wrap every metric in a floating Card.

- [ ] **Step 4: Run primitive tests and TypeScript**

```powershell
rtk npm test -- components/panel/dashboard/ledger.test.tsx
rtk npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit the Dashboard presentation vocabulary**

```powershell
rtk git add components/panel/dashboard/ledger.tsx components/panel/dashboard/ledger.test.tsx
rtk git commit -m "feat: add dashboard ledger primitives"
```

---

### Task 5: Build the owner decision surface

**Files:**

- Create: `components/panel/dashboard/use-dashboard-data.ts`
- Create: `components/panel/dashboard/owner-home.tsx`
- Modify: `components/panel/window-mode-toggle.tsx`
- Modify: `app/panel/page.tsx`
- Test: `app/panel/page.test.tsx`

**Interfaces:**

- Produces: `useDashboardData({ mode, csName, includeDuplicates })`.
- Produces: `formatDashboardUpdatedAt(ms)` for consistent Indonesian update labels.
- Consumes: `useDashboardData({ mode, includeDuplicates: true })`.
- Produces: `OwnerHome` with current/work-period control, action register, metric matrix, Top CS, Top Product, and duplicate sheet.

- [ ] **Step 1: Add failing owner-composition assertions**

Assert the rendered owner home contains:

```ts
expect(html).toContain("Perlu perhatian");
expect(html).toContain("Kinerja bisnis");
expect(html).toContain("Top CS");
expect(html).toContain("Top Produk");
expect(html).not.toContain("Trend Harian");
expect(html).not.toContain("Pekerjaan berikutnya");
expect(snapshots).toHaveBeenCalledTimes(3);
expect(snapshots.mock.calls[0][1]).toMatchObject({ raw: true });
expect(snapshots.mock.calls[1][1]).not.toBe("skip");
```

With one duplicate result, assert `Order ganda` is visible and opens the existing detail sheet through an explicit button. With zero duplicates, assert the register says `Tidak ada perhatian mendesak` rather than rendering an empty card.

- [ ] **Step 2: Run the owner test and verify it fails**

```powershell
rtk npm test -- app/panel/page.test.tsx
```

Expected: FAIL on the new Operational Ledger sections.

- [ ] **Step 3: Extract the bounded Dashboard data hook**

Move the existing time-window, summary, performance, duplicate, response-time, refresh, and last-updated orchestration into this interface:

```ts
export type DashboardDataOptions = {
  mode: WindowMode;
  csName?: string;
  includeDuplicates: boolean;
};

export type DuplicateOrder = {
  phone: string;
  customerName: string;
  csName: string;
  count: number;
  likelyAccidental: boolean;
  orders: Array<{
    orderId: string;
    productName: string;
    total: string;
    createdAt: number;
  }>;
};

export type DashboardDataResult = {
  stats: Stats;
  revenue: number;
  totalClosing: number;
  closingRate: number;
  cancelled: number;
  responseLabel: string;
  topCs: PerformanceData["cs"];
  topProducts: PerformanceData["products"];
  duplicateOrders: DuplicateOrder[];
  loading: boolean;
  errors: {
    summary: string | null;
    duplicates: string | null;
    performance: string | null;
  };
  lastUpdatedAt: number | null;
  periodLabel: string;
  refreshAll: () => Promise<void>;
};

export function formatDashboardUpdatedAt(ms: number | null): string {
  if (!ms) return "Belum dimuat";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ms));
}

export function useDashboardData({
  mode,
  csName,
  includeDuplicates,
}: DashboardDataOptions): DashboardDataResult;
```

Preserve the current memoized start/end calculations. Use exactly these sources:

```ts
const summary = useConvexSnapshotQuery(api.metrics.getDashboardSummary, summaryArgs);
const duplicates = useConvexSnapshotQuery(
  api.metrics.getDuplicateOrders,
  includeDuplicates ? filteredRangeArgs : "skip",
);
const performance = useConvexSnapshotQuery(api.shippingRecaps.getPerformance, performanceArgs);
const responseTimes = useResponseTimes({
  startAt: endAt - 24 * 60 * 60 * 1000,
  endAt,
  csName,
  refreshKey,
});
```

`refreshAll` calls only active snapshots, then increments the response-time refresh key once. Do not add trend or previous-period reads.

- [ ] **Step 4: Implement `OwnerHome`**

Use the existing data and controls, but compose them in this order:

```tsx
<DashboardContextBar
  eyebrow="Kendali operasional"
  period={periodLabel}
  updatedAt={formatDashboardUpdatedAt(lastUpdatedAt)}
  actions={<OwnerDashboardActions mode={mode} onModeChange={setMode} onRefresh={refreshAll} loading={loading} />}
/>
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
  <div className="xl:col-start-2">
    <LedgerSection title="Perlu perhatian">
      {duplicateOrders.length > 0
        ? <DuplicateAttention count={duplicateOrders.length} onOpen={() => setDupOpen(true)} />
        : <HealthyAttentionState />}
    </LedgerSection>
  </div>
  <div className="xl:col-start-1 xl:row-start-1">
    <LedgerSection title="Kinerja bisnis" description="Snapshot periode aktif">
      <LedgerMetricGrid>
        <LedgerMetric label="Leads" value={<AnimatedNumber value={stats.orders} />} detail={periodLabel} />
        <LedgerMetric label="Closing" value={<AnimatedNumber value={totalClosing} />} detail={periodLabel} tone="positive" />
        <LedgerMetric label="Closing rate" value={`${closingRate.toFixed(1)}%`} detail={periodLabel} tone="positive" />
        <LedgerMetric label="Omzet" value={<AnimatedNumber value={revenue} format={formatRupiah} />} detail={periodLabel} />
        <LedgerMetric label="Dibatalkan" value={<AnimatedNumber value={cancelled} />} detail={periodLabel} tone="negative" />
        <LedgerMetric label="Respon CS" value={responseLabel} detail="Median balasan pertama, 24 jam" />
      </LedgerMetricGrid>
    </LedgerSection>
  </div>
</div>
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
  <OwnerCsRanking rows={topCs} avatarByKey={avatarByKey} periodLabel={periodLabel} />
  <OwnerProductRanking rows={topProducts} periodLabel={periodLabel} />
</div>
```

Keep these values unchanged: leads, closing, closing rate, revenue, cancellation, response time, Top CS, and Top Product. Reuse `AnimatedNumber`, `CsAvatar`, `crBarClass`, the existing duplicate sheet content, and existing refresh behavior.

The action register starts with one evidence-backed exception only: duplicate orders. Do not invent response-time or conversion thresholds.

Keep `OwnerDashboardActions`, `DuplicateAttention`, `HealthyAttentionState`, `OwnerCsRanking`, and `OwnerProductRanking` as private functions in `owner-home.tsx`; they are not shared primitives. `DuplicateAttention` uses `<StatusStamp tone="warning">Perlu cek</StatusStamp>`, while `HealthyAttentionState` uses `<StatusStamp tone="positive">Operasional normal</StatusStamp>`. `OwnerHome` performs the existing admin-only `api.cs.listCs` read and builds `avatarByKey` locally, so the shared hook never loads the team list for CS.

Render a shaped skeleton only when no summary/performance snapshot exists yet. If a refresh fails after valid data exists, render a compact `role="alert"` listing the affected source and retry action while leaving all valid sections visible. Restyle `WindowModeToggle` with ledger tokens and explicit `Hari kalender` / `Periode kerja 16:00` labels; preserve its two existing data modes.

- [ ] **Step 5: Make the still-admin-only `/panel` route render `OwnerHome`**

Keep route authorization unchanged until Task 6 has a complete CS surface. Replace the current page body with:

```tsx
export default function DashboardPage() {
  return <OwnerHome />;
}
```

- [ ] **Step 6: Run the owner test and TypeScript**

```powershell
rtk npm test -- app/panel/page.test.tsx
rtk npx tsc --noEmit
```

Expected: owner assertions and the existing three-snapshot budget PASS.

- [ ] **Step 7: Commit the owner home**

```powershell
rtk git add components/panel/dashboard/use-dashboard-data.ts components/panel/dashboard/owner-home.tsx components/panel/window-mode-toggle.tsx app/panel/page.tsx app/panel/page.test.tsx
rtk git commit -m "feat: build owner operational dashboard"
```

---

### Task 6: Build the bounded CS next-work surface

**Files:**

- Create: `app/api/follow-up/counts/route.ts`
- Create: `app/api/follow-up/counts/route.test.ts`
- Create: `components/panel/dashboard/cs-home.tsx`
- Modify: `lib/auth-jwt.ts`
- Test: `lib/auth-jwt.test.ts`
- Modify: `app/panel/layout.tsx`
- Test: `app/panel/layout.test.tsx`
- Modify: `app/panel/page.tsx`
- Test: `app/panel/page.test.tsx`

**Interfaces:**

- Produces: `POST /api/follow-up/counts -> { ok: true, counts: { h1, h2, h3 } }` for authenticated, assigned CS users.
- Consumes: `useDashboardData({ mode: "work", csName: me.csName, includeDuplicates: false })`.
- Produces: `CsHome({ me })` with next work, personal progress, and links to Follow-up and Laporan.
- Produces: exact `/panel` access and Dashboard navigation for CS; all other admin-only routes remain blocked.

- [ ] **Step 1: Write failing CS route and navigation tests**

Update `lib/auth-jwt.test.ts`:

```ts
expect(routeGuard("/panel", cs).redirect).toBeNull();
expect(routeGuard("/panel/performance", cs).redirect).toBe("/panel/laporan");
expect(routeGuard("/panel/queen", cs).redirect).toBe("/panel/laporan");
expect(routeGuard("/panel/settings", cs).redirect).toBe("/panel/laporan");
```

Update `app/panel/layout.test.tsx`:

```ts
expect(navItemsForRole("cs").map((item) => item.href)).toEqual([
  "/panel",
  "/panel/laporan",
  "/panel/follow-up",
]);
```

- [ ] **Step 2: Run the access tests and verify they fail**

```powershell
rtk npm test -- lib/auth-jwt.test.ts app/panel/layout.test.tsx
```

Expected: FAIL because CS still redirects away from `/panel` and its navigation omits Dashboard.

- [ ] **Step 3: Permit and expose only the exact CS Dashboard route**

Use the same allow-list in server guard and shell helper:

```ts
const allowed =
  pathname === "/panel" ||
  pathname.startsWith("/panel/laporan") ||
  pathname.startsWith("/panel/follow-up");
return { redirect: allowed ? null : "/panel/laporan" };
```

```ts
return NAV.filter(({ href }) =>
  href === "/panel" || href === "/panel/laporan" || href === "/panel/follow-up",
);
```

- [ ] **Step 4: Write failing counts-route tests**

Mock `verifySession`, `signConvexToken`, and `ConvexHttpClient.query`, then cover:

```ts
const { query, setAuth, verifySession } = vi.hoisted(() => ({
  query: vi.fn(),
  setAuth: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(() => ({ query, setAuth })),
}));
vi.mock("@/lib/auth-jwt", () => ({ verifySession }));
vi.mock("@/lib/convex-token", () => ({ signConvexToken: vi.fn(async () => "token") }));

function request() {
  return new NextRequest("http://localhost/api/follow-up/counts", { method: "POST" });
}

expect((await POST(request())).status).toBe(401); // no session
expect((await POST(request())).status).toBe(403); // admin or CS without csName

// Assigned CS; browser body cannot choose another CS because the endpoint accepts no body scope.
expect(query).toHaveBeenCalledWith(api.followUp.getFollowUpCandidates, {
  csName: "Aisyah",
});
expect(await response.json()).toEqual({
  ok: true,
  counts: { h1: 2, h2: 1, h3: 0 },
});
```

- [ ] **Step 5: Run the route test and confirm the endpoint is absent**

```powershell
rtk npm test -- app/api/follow-up/counts/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Implement the one-query counts endpoint**

Use the verified session's assignment only:

```ts
export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get("auth_token")?.value);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (session.role !== "cs" || !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: "CS scope required" }, { status: 403 });
  }

  try {
    convex.setAuth(await signConvexToken(session));
    const rows = await convex.query(api.followUp.getFollowUpCandidates, {
      csName: session.csName,
    });
    return NextResponse.json({
      ok: true,
      counts: {
        h1: rows.stage1.length,
        h2: rows.stage2.length,
        h3: rows.stage3.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message || "Gagal memuat antrean" },
      { status: 500 },
    );
  }
}
```

There is no follow-up-effectiveness call and no timer.

- [ ] **Step 7: Add failing CS-home assertions**

Mock `useMe` as an assigned CS and assert:

```ts
expect(html).toContain("Pekerjaan berikutnya");
expect(html).toContain("H+1");
expect(html).toContain("H+2");
expect(html).toContain("H+3");
expect(html).toContain("Progress saya");
expect(html).toContain('href="/panel/follow-up"');
expect(html).toContain('href="/panel/laporan"');
expect(html).not.toContain("Omzet");
expect(html).not.toContain("Top CS");
expect(html).not.toContain("Top Produk");
expect(snapshots).toHaveBeenCalledTimes(3);
expect(snapshots.mock.calls[1][1]).toBe("skip");
```

Also assert the duplicate snapshot received `"skip"`.

- [ ] **Step 8: Implement `CsHome` and add the final role switch**

Fetch queue counts once on mount and again only from the same manual refresh action used for the Dashboard snapshots. Keep the last valid counts visible during refresh.

```ts
type QueueCounts = { h1: number; h2: number; h3: number };

const [counts, setCounts] = useState<QueueCounts>();
const [countsError, setCountsError] = useState<string | null>(null);
const loadCounts = useCallback(async () => {
  setCountsError(null);
  const response = await fetch("/api/follow-up/counts", { method: "POST" });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Gagal memuat antrean");
  setCounts(body.counts as QueueCounts);
}, []);

useEffect(() => {
  void loadCounts().catch((error) => setCountsError((error as Error).message));
}, [loadCounts]);

const refreshAll = async () => {
  await Promise.all([
    refreshDashboard(),
    loadCounts().catch((error) => setCountsError((error as Error).message)),
  ]);
};
```

Alias the hook result as `refreshAll: refreshDashboard`. Render `countsError` as a compact `role="alert"` beside the queue metrics without hiding personal progress.

Compose:

```tsx
<DashboardContextBar
  eyebrow={`Shift ${me.csName || me.name}`}
  period="Periode kerja 16:00–16:00"
  updatedAt={formatDashboardUpdatedAt(lastUpdatedAt)}
  actions={<Button onClick={refreshAll} disabled={loading}>Refresh</Button>}
/>
<LedgerSection
  title="Pekerjaan berikutnya"
  action={<Link href="/panel/follow-up">Buka Follow-up</Link>}
>
  <LedgerMetricGrid>
    <LedgerMetric label="H+1" value={counts?.h1 ?? "—"} detail="Tindak lanjut pertama" />
    <LedgerMetric label="H+2" value={counts?.h2 ?? "—"} detail="Pengingat" />
    <LedgerMetric label="H+3" value={counts?.h3 ?? "—"} detail="Penawaran terakhir" />
  </LedgerMetricGrid>
</LedgerSection>
<LedgerSection title="Progress saya">
  <LedgerMetricGrid>
    <LedgerMetric label="Leads" value={stats.orders} detail="periode kerja" />
    <LedgerMetric label="Closing" value={totalClosing} detail="periode kerja" tone="positive" />
    <LedgerMetric label="Closing rate" value={`${closingRate.toFixed(1)}%`} detail="periode kerja" tone="positive" />
    <LedgerMetric label="Respon saya" value={responseLabel} detail="Median balasan pertama, 24 jam" />
  </LedgerMetricGrid>
</LedgerSection>
<Link href="/panel/laporan">Lihat status Queen di Laporan</Link>
```

Do not render revenue, team ranking, duplicate orders, Top CS, or Top Product to CS.

Replace the admin-only page body from Task 5 with the final role switch:

```tsx
if (!me) return <DashboardRoleSkeleton />;
return me.role === "cs" ? <CsHome me={me} /> : <OwnerHome />;
```

- [ ] **Step 9: Run route, page, and access tests**

```powershell
rtk npm test -- app/api/follow-up/counts/route.test.ts app/panel/page.test.tsx app/panel/layout.test.tsx lib/auth-jwt.test.ts
```

Expected: PASS; CS Home is reachable, scoped, and has no owner-only information.

- [ ] **Step 10: Commit the CS home**

```powershell
rtk git add app/api/follow-up/counts/route.ts app/api/follow-up/counts/route.test.ts components/panel/dashboard/cs-home.tsx lib/auth-jwt.ts lib/auth-jwt.test.ts app/panel/layout.tsx app/panel/layout.test.tsx app/panel/page.tsx app/panel/page.test.tsx
rtk git commit -m "feat: add bounded CS work dashboard"
```

---

### Task 7: Verify Phase 1, close Impeccable review, and document the shipped world

**Files:**

- Modify only files required by verified findings.
- Create: `DESIGN.md` through the Impeccable documenter.

**Interfaces:**

- Consumes: completed Phase 1 implementation and approved design spec.
- Produces: verified screenshots, one detector result, reviewer verdict, and the implemented design reference.

- [ ] **Step 1: Run the focused test set**

```powershell
rtk npm test -- convex/metrics.test.ts convex/followUp.test.ts convex/authz.test.ts convex/auth.test.ts lib/auth-jwt.test.ts app/panel/layout.test.tsx app/panel/page.test.tsx app/api/follow-up/counts/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full automated gate**

```powershell
rtk npm test
rtk npx tsc --noEmit
rtk npx convex codegen
rtk npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Inspect owner and CS query budgets in source and browser network logs**

Verify one load and one manual refresh for each role:

```text
Owner load: summary 1, duplicates 1, performance 1, listCs 1, response-time 1.
CS load: summary 1, performance 1, response-time 1, follow-up candidates 1.
CS load: duplicates 0, listCs 0, follow-up effectiveness 0.
Idle for 5 minutes: no repeated Dashboard or follow-up request.
```

Any excess call is a release blocker.

- [ ] **Step 4: Perform responsive and accessibility inspection before the detector**

Using existing owner and CS sessions, inspect `/panel` at 375px, 768px, 1024px, and 1440px. Save desktop and mobile screenshots under `.impeccable/artifacts/phase1/` and verify:

```text
- no horizontal page scroll;
- mobile bottom navigation is opaque and does not cover content;
- 44px touch targets;
- visible keyboard focus and logical order;
- owner/CS priorities differ immediately;
- loading preserves structure;
- empty attention and empty queue states explain what happened;
- partial errors retain unrelated valid data;
- no client or console error.
```

Apply one bounded visual-correction pass if needed, then rerun only the affected tests and build.

- [ ] **Step 5: Run the Impeccable detector exactly once**

```powershell
rtk node C:\Users\fandy\.agents\skills\impeccable\scripts\detect.mjs --json app/globals.css app/panel/layout.tsx app/panel/page.tsx components/panel/dashboard
```

Resolve actionable mechanical findings in one batch. Record false positives with evidence. Do not run the detector a second time.

- [ ] **Step 6: Run the required Impeccable finish review**

Invoke a fresh `impeccable-finish-reviewer` with no forked conversation history. Provide:

```text
- original redesign request;
- approved spec path;
- PRODUCT.md;
- Operational Ledger direction contract;
- owner desktop/mobile screenshot paths;
- CS desktop/mobile screenshot paths;
- detector output and any justified false positives;
- craft-floor reference path.
```

Apply material fixes in one batch, rebuild, recapture the same viewports, and send the recaptures back to the same reviewer for the verdict pass. Do not start a new independent defect hunt.

- [ ] **Step 7: Generate the implemented design reference**

Invoke the Impeccable documenter with the project root, approved spec, `PRODUCT.md`, implemented artifact paths, final screenshots, and `C:\Users\fandy\.agents\skills\impeccable\reference\document.md`. It must write `DESIGN.md` from the built result, not copy the pre-build intention.

- [ ] **Step 8: Run the final non-detector gate**

```powershell
rtk npm test
rtk npx tsc --noEmit
rtk npx convex codegen
rtk npm run build
rtk git diff --check
rtk git status --short
```

Expected: all automated gates pass; only intentional `.impeccable` artifacts may remain untracked.

- [ ] **Step 9: Commit verified Phase 1**

```powershell
rtk git add app components convex lib tailwind.config.ts DESIGN.md
rtk git commit -m "feat: deliver operational ledger dashboard"
```

Do not merge or deploy in this task. Use `superpowers:finishing-a-development-branch` after the implementation is reviewed and the user authorizes release.

## Phase 1 completion boundary

This plan ends when Foundation + Dashboard passes the gate. It intentionally does not redesign Performance, Laporan, Queen, the Follow-up workspace, Settings, Login, Offline, or PWA surfaces. Those routes keep their current behavior and receive separate implementation plans after the user accepts Phase 1's visual result.
