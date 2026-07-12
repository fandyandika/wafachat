# Fase B2b Org-Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant #2 becomes safe: every unique-key dedup lookup and every reader is org-scoped, proven by a 2-org isolation suite — with byte-identical behavior for the single live org (parity 0 at both gates).

**Architecture:** Write-path first (dedup collisions are a CORRECTNESS bug — a tenant-B order with a colliding `O-`id would PATCH tenant-A's row), then readers. One mechanical transform everywhere: `withIndex("by_X", q => q.…)` → `withIndex("by_org_X", q => q.eq("orgId", orgId).…)` — orgId prefixed, rest of the range IDENTICAL. orgId comes from exactly three sources: viewer (`requireMemberOrg`/`requireAdminOrg`, new), the doc in hand (`doc.orgId`, data-driven), or the already-threaded B1 param (`args.orgId` in write cores). Indexes are added additively, all code switches, then old unscoped indexes are REMOVED. `*Legacy` readers (zero refs, verified) die before the index removal.

**Tech Stack:** Convex 1.39, Next.js 14, vitest + convex-test, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-13-fase-b2b-org-isolation-design.md`

## Global Constraints

- Branch: `fase-b2b-org-isolation` off main (@`3e3dec5`). ALWAYS prefix `cd /f/Projects/whatsapp_cs_automotion/wafachat` (cwd resets).
- `git add` SPECIFIC files, never `-A`. `convex/_generated` tracked (commit when regenerated). vitest does NOT typecheck → `npx tsc --noEmit -p convex` every task.
- Baseline: 270 tests, 269 pass + **1 PRE-EXISTING fail** (`followUp.test.ts` "getArchivedFollowUps…") — never touch it.
- **Byte-identity invariant:** single org → org-scoped index over constant orgId ≡ old index. NO existing test may need a VALUE-assertion change; a value break = regression you introduced (fix code, not test). Seed-only test adjustments allowed.
- Test identity convention: `t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" })` — these have NO users row → `requireMemberOrg`/`requireAdminOrg` falls back to the DEFAULT org, which the test must have seeded (post-B1 `seedOrg(t)` helpers already exist in data-touching test files; slug MUST be "pustakaislam").
- Do NOT org-scope (by design): `users.by_email`, `ingestSources.by_sourceKey`, `organizations.by_slug`, `ingestEvents.*`, `alertState.by_alertKey`, `settings`/`orgSettings` `by_key`, `closingRules.by_active` (B3 deferral), `dailyStats.*` (retired; its `by_date` sites in state.ts deprecated fns — SKIP). `auth.ts` needs NO conversion (by_email global; createUser already stamps orgId via B1).
- Index sites keyed by a Convex `_id` (`by_conversation_createdAt`, `by_alertKey`) are inherently org-safe — DO NOT change them.
- Deploy/seed/verify = CONTROLLER at the two gates. Parity: `node _admin.mjs query rollups:debugRollupParity '{"windowKey":"YYYY-MM-DD"}'` ×3 recent windows → `mismatches: []`.
- Line numbers/counts cited are from 2026-07-13 greps — re-grep when implementing; counts are the checklist.

---

## File Structure

| File | Role |
|---|---|
| `convex/authz.ts` + `convex/authz.test.ts` (EXISTS — extend) | `ViewerOrg`, `requireMemberOrg`, `requireAdminOrg`, `probeOrg` |
| `convex/orgs.ts` | +`listOrgsInternal` (internalQuery, for cron loops) |
| `convex/schema.ts` | +22 org-scoped indexes (T2); −~29 old indexes (T7) |
| `convex/state.ts`, `messages.ts`, `shippingRecaps.ts` (write half), `csConfigs.ts`, `agents.ts`, `cs.ts`, `autoFollowUp.ts`, `conversationLifecycle.ts` | T3 write/dedup group |
| `convex/rollups.ts`, `rollupReaders.ts`, `analytics.ts`, `metrics.ts`, `responseTime.ts` | T4 reader wave 1 |
| `convex/state.ts`, `shippingRecaps.ts` (read half), `followUp.ts`, `events.ts`, `messages.ts` readers + crons | T5 reader wave 2 |
| `convex/orgIsolation.test.ts` (NEW) | T6 the 2-org proof |
| `docs/SAAS-BLUEPRINT.md` | §14 (GATE B) |

---

### Task 1: authz org resolution + `listOrgsInternal`

**Files:**
- Modify: `convex/authz.ts` (append below `requireAdmin`)
- Modify: `convex/orgs.ts` (append internalQuery)
- Modify: `convex/authz.test.ts` (append tests; add a local `seedOrg(t)` helper if the file lacks one — insert organizations row slug "pustakaislam")

**Interfaces:**
- Consumes: `getDefaultOrgId` (./orgs), `Viewer`/`requireMember`/`requireAdmin`/`getViewer` (existing authz.ts).
- Produces (every later task depends on these EXACT names):
  - `type ViewerOrg = { viewer: Viewer; orgId: Id<"organizations"> }`
  - `requireMemberOrg(ctx: any, fn: string): Promise<ViewerOrg>` / `requireAdminOrg(ctx: any, fn: string): Promise<ViewerOrg>`
  - public `authz.probeOrg` (query — test/diagnostic probe)
  - `orgs.listOrgsInternal` (internalQuery, no args) → all organization docs.

- [ ] **Step 1: Failing tests (append to `convex/authz.test.ts`)**

```ts
test("requireMemberOrg: user WITH a users row resolves that row's org (not default)", async () => {
  const t = convexTest(schema);
  const defaultOrg = await seedOrg(t); // slug "pustakaislam"
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "Org B", createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx: any) => {
    await ctx.db.insert("users", {
      orgId: orgB, email: "csb@test", name: "CS B", passwordHash: "x", role: "cs",
      csName: "Bela", isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asCsB = t.withIdentity({ subject: "u-b", role: "cs", name: "CS B", email: "csb@test" });
  const probe = await asCsB.query(api.authz.probeOrg, {});
  expect(probe.orgId).toEqual(orgB);
  expect(probe.orgId).not.toEqual(defaultOrg);
});

test("requireMemberOrg: ADMIN without users row falls back to the default org", async () => {
  const t = convexTest(schema);
  const defaultOrg = await seedOrg(t);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const probe = await asAdmin.query(api.authz.probeOrg, {});
  expect(probe.orgId).toEqual(defaultOrg);
});

test("requireMemberOrg: CS without users row THROWS (no silent default fallback)", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const asGhostCs = t.withIdentity({ subject: "u-x", role: "cs", name: "Ghost", email: "ghost@test" });
  await expect(asGhostCs.query(api.authz.probeOrg, {})).rejects.toThrow(/no user record/);
});

test("requireMemberOrg: admin fallback with NO org seeded throws clearly", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  await expect(asAdmin.query(api.authz.probeOrg, {})).rejects.toThrow(/org not seeded/);
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run convex/authz.test.ts` → FAIL (`api.authz.probeOrg` missing).

- [ ] **Step 3: Implement**

Append to `convex/authz.ts`:

```ts
import type { Id } from "./_generated/dataModel";
import { getDefaultOrgId } from "./orgs";

// ─── Fase B2b: org resolution from the VIEWER (server-side; JWT untouched). ───
// users.orgId is REQUIRED (B1), so a users-row hit always yields an org.
// Admin WITHOUT a users row (_admin.mjs platform-operator token) falls back to the
// default org — single-tenant semantics, revisit with multi-org login (B3).
// CS without a users row is a misconfiguration: THROW (never silently default).

export type ViewerOrg = { viewer: Viewer; orgId: Id<"organizations"> };

async function resolveViewerOrg(ctx: any, viewer: Viewer, fn: string): Promise<Id<"organizations">> {
  const userRow = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", viewer.email))
    .unique();
  if (userRow) return userRow.orgId;
  if (viewer.role === "admin") {
    const fallback = await getDefaultOrgId(ctx);
    if (fallback) return fallback;
    throw new Error(`unauthorized: ${fn} — org not seeded`);
  }
  throw new Error(`unauthorized: ${fn} — no user record for ${viewer.email}`);
}

export async function requireMemberOrg(ctx: any, fn: string): Promise<ViewerOrg> {
  const viewer = await requireMember(ctx, fn);
  if (!viewer) throw new Error(`unauthorized: ${fn} requires a logged-in user`);
  return { viewer, orgId: await resolveViewerOrg(ctx, viewer, fn) };
}

export async function requireAdminOrg(ctx: any, fn: string): Promise<ViewerOrg> {
  const viewer = await requireAdmin(ctx, fn);
  if (!viewer || viewer.role !== "admin") throw new Error(`unauthorized: ${fn} requires admin`);
  return { viewer, orgId: await resolveViewerOrg(ctx, viewer, fn) };
}

/** Test/diagnostic probe for viewer-org resolution (B2b). */
export const probeOrg = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, orgId } = await requireMemberOrg(ctx, "authz.probeOrg");
    return { email: viewer.email, role: viewer.role, orgId };
  },
});
```

Append to `convex/orgs.ts` (extend its `_generated/server` import with `internalQuery` if absent — B2a already added it):

```ts
// Cron helpers iterate every org (single org today = identical behavior).
export const listOrgsInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("organizations").collect(),
});
```

- [ ] **Step 4: Verify pass** — `npx vitest run convex/authz.test.ts && npx tsc --noEmit -p convex` (codegen if `api.authz.probeOrg` types missing) → PASS + clean. Full suite → green except known.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/authz.ts convex/authz.test.ts convex/orgs.ts convex/_generated
git commit -m "feat(org-isolation): viewer-org resolution (requireMemberOrg/requireAdminOrg) + listOrgsInternal"
```

---

### Task 2: schema — 22 org-scoped indexes (additive, inert)

**Files:** Modify `convex/schema.ts` only.

**Interfaces:** Produces the index names every sweep task uses — EXACT inventory (usage-driven; do not invent extras):

```ts
// orders
.index("by_org_orderId", ["orgId", "orderId"])
.index("by_org_customerPhone", ["orgId", "customerPhone"])
.index("by_org_createdAt", ["orgId", "createdAt"])
.index("by_org_csKey_createdAt", ["orgId", "csKey", "createdAt"])
// conversations
.index("by_org_orderId", ["orgId", "orderId"])
.index("by_org_status_updatedAt", ["orgId", "status", "updatedAt"])
.index("by_org_customerPhone_updatedAt", ["orgId", "customerPhone", "updatedAt"])
.index("by_org_assignedCsName_status", ["orgId", "assignedCsName", "status"])
// customers
.index("by_org_phone", ["orgId", "phone"])
// messages
.index("by_org_createdAt", ["orgId", "createdAt"])
.index("by_org_customerPhone_createdAt", ["orgId", "customerPhone", "createdAt"])
.index("by_org_externalMessageId", ["orgId", "externalMessageId"])
// events
.index("by_org_createdAt", ["orgId", "createdAt"])
.index("by_org_type_createdAt", ["orgId", "type", "createdAt"])
// shippingRecaps
.index("by_org_orderIdBerdu", ["orgId", "orderIdBerdu"])
.index("by_org_customerPhone", ["orgId", "customerPhone"])
.index("by_org_closedAt", ["orgId", "closedAt"])
.index("by_org_status_closedAt", ["orgId", "status", "closedAt"])
.index("by_org_csKey_closedAt", ["orgId", "csKey", "closedAt"])
// dailyRollups
.index("by_org_window_cs", ["orgId", "windowKey", "csKey"])
.index("by_org_windowKey", ["orgId", "windowKey"])
// responseSamples
.index("by_org_createdAt", ["orgId", "createdAt"])
.index("by_org_cs_createdAt", ["orgId", "csKey", "createdAt"])
// csConfigs
.index("by_org_normalizedName", ["orgId", "normalizedName"])
.index("by_org_active", ["orgId", "isActive"])
```

- [ ] **Step 1:** Add each index to its table (existing indexes untouched). NO other change.
- [ ] **Step 2:** `npx tsc --noEmit -p convex && npx vitest run` → clean + green except known (purely additive).
- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/_generated
git commit -m "feat(org-isolation): 22 org-scoped indexes (additive; usage-driven inventory)"
```

---

### Task 3: WRITE-path dedup scoping (the correctness core)

**Files (write/dedup group — convert every data-table `withIndex` in these files' write/lookup functions; a function is converted WHOLE, never half):**
- `convex/state.ts` — `upsertOrderCore` (orders `by_orderId`, customers `by_phone`, conversations `by_customerPhone_updatedAt`/`by_orderId`) + other conversation-state mutations' lookups
- `convex/messages.ts` — `by_externalMessageId` dedup + `getConversationForMessage` (conversations `by_orderId`, `by_customerPhone_updatedAt`)
- `convex/shippingRecaps.ts` WRITE half — `upsertRecapFromMessage`, manual upsert, `importBerduVerifiedRows`, `backfillCsNameByOrderIds`, markX mutations' recap/order lookups (`by_orderIdBerdu`, `by_orderId`, `by_customerPhone`)
- `convex/csConfigs.ts`, `convex/agents.ts`, `convex/cs.ts`, `convex/autoFollowUp.ts` — `by_normalizedName` → `by_org_normalizedName`
- `convex/conversationLifecycle.ts` — child lookups (recap `by_orderIdBerdu`, order `by_customerPhone`) — data-driven via the conversation doc's `c.orgId`
- Tests: collision tests in `convex/state.test.ts` + `convex/messages.test.ts`

**Interfaces:** Consumes `requireAdminOrg` (T1), `args.orgId` (B1 threading in cores), T2 indexes. Produces org-scoped write paths.

**orgId source per site (spec §2.2):**
1. Write cores (`upsertOrderCore`, `appendMessageCore`, `upsertRecapFromMessage`): the **already-threaded required `args.orgId`** (B1).
2. Child lookups following a doc (lifecycle; recap→order heals): **that doc's `.orgId`**.
3. Public admin mutations (csConfigs upsert/rename/setProviderNumberIds/setBerduStaffIds, agents setNameAliases, cs avatar mutations, manual closing/import wrappers): replace `await requireAdmin(ctx, fn)` → `const { orgId } = await requireAdminOrg(ctx, fn)` (if the old viewer value was used, take it from `.viewer`). `autoFollowUp`'s csConfig lookup: data-driven via the conversation being processed (`conversation.orgId`).

**Transform (identical everywhere):**

```ts
// BEFORE
.withIndex("by_orderId", (q) => q.eq("orderId", orderId))
// AFTER
.withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", orderId))
```

- [ ] **Step 1: Failing collision tests**

In `convex/state.test.ts`:

```ts
test("org isolation: same orderId in two orgs = TWO rows; org-B upsert never patches org-A", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "B", createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx: any) => {
    const { upsertOrderCore } = await import("./state");
    const base = {
      phone: "6281234500001", csName: "Aisyah", customerName: "A-Cust", productName: "P",
      products: "P (1x)", productsSubtotal: "Rp1", shippingCost: "Rp1", total: "Rp2",
      shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z", order_id: "O-COLLIDE",
    };
    await upsertOrderCore(ctx, { ...base, orgId: orgA });
    await upsertOrderCore(ctx, { ...base, customerName: "B-Cust", orgId: orgB });
    const rows = (await ctx.db.query("orders").collect()).filter((o: any) => o.orderId === "O-COLLIDE");
    expect(rows.length).toBe(2); // NOT an overwrite
    const a = rows.find((r: any) => String(r.orgId) === String(orgA));
    const b = rows.find((r: any) => String(r.orgId) === String(orgB));
    expect(a?.customerName).toBe("A-Cust"); // org-B upsert did not clobber org-A
    expect(b?.customerName).toBe("B-Cust");
  });
});
```

In `convex/messages.test.ts` (same shape): append a message with the SAME `externalMessageId` in two orgs (per-org conversations, `appendMessageCore` with each orgId) → 2 message rows (no cross-org dedup hit).

- [ ] **Step 2: Verify fail** — the orders collision test FAILS today (second upsert PATCHES org-A's row → 1 row). That failure IS the bug demonstration.
- [ ] **Step 3: Sweep the file group** per transform + orgId-source rules.
- [ ] **Step 4: Gates** — `npx tsc --noEmit -p convex && npx vitest run` → clean; collision tests pass; existing green except known (no value changes).
- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/state.ts convex/messages.ts convex/shippingRecaps.ts convex/csConfigs.ts convex/agents.ts convex/cs.ts convex/autoFollowUp.ts convex/conversationLifecycle.ts convex/state.test.ts convex/messages.test.ts
git commit -m "feat(org-isolation): org-scoped dedup/unique-key lookups on all write paths (collision-proof)"
```

---

### Task 4: reader sweep wave 1 — rollup engine + heavy readers

**Files:** `convex/rollups.ts`, `convex/rollupReaders.ts`, `convex/analytics.ts`, `convex/metrics.ts`, `convex/responseTime.ts`.

**Rules:**
- **Engine internals** (`computeRollupValues`, `computeRollupRow`, `recomputeWindowImpl`, `rebuildSamplesForWindowImpl`, backfill): gain an explicit `orgId` param threaded from their callers; bumps (`bumpForOrderDoc`/`bumpForRecapDoc`) use the **doc's `.orgId`**. All slice reads move to `by_org_csKey_createdAt` / `by_org_csKey_closedAt` / `by_org_window_cs` / `by_org_windowKey` / `by_org_createdAt`.
- **`trueUp` (internalAction):** `const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {}); for (const org of orgs) { …existing per-window recompute with org._id… }`.
- **Public queries** in all five files: `await requireMember(ctx, fn)` → `const { orgId } = await requireMemberOrg(ctx, fn)` (keep viewer via `.viewer` where used) and thread orgId into every index read; the `compute*Raw(ctx, …)` helpers gain `orgId` as their first data param.
- **Admin tools** (`debugRollupParity`, `csKeyCoverage`, `backfillRange`, `debugFindOrders`, `debugOrderReconcile`): `requireAdminOrg` → scope to the resolved org.

- [ ] **Step 1:** Sweep per rules (re-grep `withIndex(` per file — every data-table site converts; Id-keyed sites stay).
- [ ] **Step 2:** `npx tsc --noEmit -p convex && npx vitest run` → clean/green except known — rollup + reader tests passing UNCHANGED is the parity proof.
- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/rollups.ts convex/rollupReaders.ts convex/analytics.ts convex/metrics.ts convex/responseTime.ts
git commit -m "feat(org-isolation): rollup engine + wave-1 readers org-scoped (viewer-driven public, doc-driven bumps)"
```

---

### Task 5: reader sweep wave 2 — remaining readers + per-org crons

**Files:** `convex/state.ts` (listConversations + remaining readers), `convex/shippingRecaps.ts` (read half: list/getCounts/getPerformance/detail), `convex/followUp.ts` (getFollowUpCandidates/effectiveness/archived + send/archive flows), `convex/events.ts`, `convex/messages.ts` (reader queries), `convex/conversationLifecycle.ts` (sweep body), `convex/autoFollowUp.ts` (sweep body), `convex/cs.ts` (`listCs`: keep `collect()`, add in-memory `.filter((c) => String(c.orgId) === String(orgId))` — tiny table).

**Cron pattern (internalActions `cronArchiveSweep`, `autoFollowUpSweep`):**

```ts
const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {});
for (const org of orgs) {
  // existing body, threading org._id into the internal queries/mutations it calls
}
```

(The internal helpers they call gain an `orgId` arg and use the org-scoped indexes.)

- [ ] **Step 1:** Sweep per the same rules (public → requireMemberOrg / requireAdminOrg; internal → orgId param; child lookups → doc.orgId).
- [ ] **Step 2:** Gates: `npx tsc --noEmit -p convex && npx vitest run` → clean/green except known.
- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/state.ts convex/shippingRecaps.ts convex/followUp.ts convex/events.ts convex/messages.ts convex/conversationLifecycle.ts convex/autoFollowUp.ts convex/cs.ts
git commit -m "feat(org-isolation): wave-2 readers org-scoped + per-org cron loops"
```

---

### GATE A (CONTROLLER): deploy the scoped world + parity

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → green except known.
- [ ] `npx convex deploy -y` (new indexes build; all code now on org-scoped paths).
- [ ] Parity ×3 windows → `mismatches: []` each. Live: next order + message process normally (`ingest/events:listRecent`); panel loads normally (Fandy spot-check).
- [ ] Ledger append.

---

### Task 6: `convex/orgIsolation.test.ts` (the proof) + delete `*Legacy`

**Files:**
- Create: `convex/orgIsolation.test.ts`
- Modify (delete blocks): `convex/analytics.ts` (`getCsLeaderboardLegacy` ~:76, `getProductDifficultyLegacy` ~:116, `getPeriodReportLegacy` ~:171, `getDailyReportLegacy` ~:458), `convex/followUp.ts` (`getFollowUpEffectivenessLegacy` ~:416), `convex/metrics.ts` (`getDashboardSummaryLegacy` ~:57, `getTrendLegacy` ~:84), `convex/responseTime.ts` (`getResponseTimesLegacy` ~:10), `convex/shippingRecaps.ts` (`getPerformanceLegacy` ~:1309). ZERO non-test refs (verified 2026-07-13). Grep test files for `Legacy` first — delete any test that exists solely to exercise a Legacy wrapper; keep tests of the still-live `compute*Raw` helpers.

- [ ] **Step 1: Write `convex/orgIsolation.test.ts`:**

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

async function seedFullOrg(t: any, slug: string, email: string, csName: string, phone: string) {
  const orgId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug, name: slug, createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx: any) => {
    await ctx.db.insert("users", { orgId, email, name: email, passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: csName.toLowerCase(), csName, key: csName.toLowerCase(), nameAliases: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    const NOW = Date.now();
    await ctx.db.insert("orders", {
      orgId, orderId: "O-SAME", customerPhone: phone, customerName: `cust-${slug}`, assignedCsName: csName,
      csKey: csName.toLowerCase(), productName: "P", products: "P (1x)", productsSubtotal: "Rp1", shippingCost: "Rp1",
      total: "Rp2", shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z", source: "berdu",
      aiEligible: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId, orderIdBerdu: "O-SAME", customerPhone: phone, customerName: `cust-${slug}`, csName, csKey: csName.toLowerCase(),
      closedAt: NOW, recipientName: `cust-${slug}`, recipientPhone: phone, recipientAddress: "X",
      recipientDistrict: "Y", recipientCity: "Z", packageContent: "P", paymentMethod: "cod", codValue: 100000,
      status: "ready", flags: [], version: 1, createdAt: NOW, updatedAt: NOW,
    });
  });
  return orgId;
}

const ID_A = { subject: "ua", role: "admin" as const, name: "A", email: "a@test" };
const ID_B = { subject: "ub", role: "admin" as const, name: "B", email: "b@test" };

test("ISOLATION #1: same orderId+phone in two orgs stay two separate worlds (dedup + summary + leaderboard)", async () => {
  const t = convexTest(schema);
  await seedFullOrg(t, "org-a", "a@test", "Alfa", "62811111");
  await seedFullOrg(t, "org-b", "b@test", "Beta", "62811111");
  await t.run(async (ctx: any) => {
    const orders = (await ctx.db.query("orders").collect()).filter((o: any) => o.orderId === "O-SAME");
    expect(orders.length).toBe(2);
    expect(new Set(orders.map((o: any) => String(o.orgId))).size).toBe(2);
  });
  const now = Date.now();
  const range = { startAt: now - 86_400_000, endAt: now + 86_400_000 };
  const sumA = await t.withIdentity(ID_A).query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumA.leads).toBe(1);    // ONLY org-A's order
  expect(sumA.closings).toBe(1); // ONLY org-A's recap
  const lbA = await t.withIdentity(ID_A).query(api.analytics.getCsLeaderboard, { ...range, raw: true });
  expect(lbA.map((r: any) => r.csName)).toEqual(["Alfa"]); // no "Beta" leak
  const lbB = await t.withIdentity(ID_B).query(api.analytics.getCsLeaderboard, { ...range, raw: true });
  expect(lbB.map((r: any) => r.csName)).toEqual(["Beta"]);
});

test("ISOLATION #2: conversations list is org-scoped", async () => {
  const t = convexTest(schema);
  const orgA = await seedFullOrg(t, "org-a", "a@test", "Alfa", "62822222");
  const orgB = await seedFullOrg(t, "org-b", "b@test", "Beta", "62822222");
  await t.run(async (ctx: any) => {
    const NOW = Date.now();
    for (const [orgId, name] of [[orgA, "A-conv"], [orgB, "B-conv"]] as const) {
      await ctx.db.insert("conversations", {
        orgId, orderId: "O-SAME", customerPhone: "62822222", customerName: name, assignedCsName: "X",
        status: "active", aiEnabled: false, note: "", createdAt: NOW, updatedAt: NOW,
      });
    }
  });
  const listA = await t.withIdentity(ID_A).query(api.state.listConversations, {});
  const dump = JSON.stringify(listA);
  expect(dump).toContain("A-conv");
  expect(dump).not.toContain("B-conv");
});
```

(Adapt exact query arg shapes/return field names to the live signatures by reading the functions — the ASSERTION intent is binding: an org-A viewer must never see org-B values. Extra recap fields in the seed may need trimming to match the schema — tsc/convex-test will point at any mismatch.)

- [ ] **Step 2:** Run — the isolation tests must PASS against the swept code (they are the proof; a failure = a real leak → fix the CODE).
- [ ] **Step 3:** Delete the 9 `*Legacy` exports + Legacy-only tests. `grep -rn "Legacy" convex --include="*.ts"` → only comments (or nothing).
- [ ] **Step 4:** Gates: `npx tsc --noEmit -p convex && npx vitest run && npm run build` → clean / green except known / EXIT 0.
- [ ] **Step 5: Commit (two commits)**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/orgIsolation.test.ts
git commit -m "test(org-isolation): 2-org isolation suite — dedup separation + reader scoping (jalur B definition-of-done)"
git add convex/analytics.ts convex/followUp.ts convex/metrics.ts convex/responseTime.ts convex/shippingRecaps.ts convex/_generated
git commit -m "chore(org-isolation): delete 9 unused *Legacy internalQueries (rollup-project backlog; parity tool independent)"
```

(If Legacy-only tests were deleted, add those test files explicitly to the second commit.)

---

### Task 7: remove old unscoped indexes

**Files:** `convex/schema.ts`.

**Removal list** (each REPLACED by an org variant, or verified UNUSED 2026-07-13):
- orders: `by_orderId`, `by_customerPhone`, `by_createdAt`, `by_csKey_createdAt`, `by_assignedCsName_createdAt` (unused), `by_aiEligible_createdAt` (unused)
- conversations: `by_orderId`, `by_status_updatedAt`, `by_customerPhone_updatedAt`, `by_assignedCsName_status`
- customers: `by_phone`
- messages: `by_createdAt`, `by_customerPhone_createdAt`, `by_externalMessageId`, `by_orderId_createdAt` (unused)
- events: `by_createdAt`, `by_type_createdAt`
- shippingRecaps: `by_orderIdBerdu`, `by_customerPhone`, `by_closedAt`, `by_status_closedAt`, `by_csKey_closedAt`, `by_csName_closedAt` (unused), `by_paymentMethod_closedAt` (unused)
- dailyRollups: `by_window_cs`, `by_windowKey`
- responseSamples: `by_createdAt`, `by_cs_createdAt`
- csConfigs: `by_normalizedName`, `by_active`

**KEEP (never remove):** `users.by_email`, `ingestSources.by_sourceKey`, `organizations.by_slug`, all `ingestEvents.*`, `alertState.by_alertKey`, `settings.by_key`, `orgSettings.by_key`, `closingRules.by_active`, `dailyStats.by_date`, `csConfigs.by_org_key`, every `by_org_*`, every `by_conversation_createdAt`.

- [ ] **Step 1:** For EACH index in the removal list: `grep -rn 'withIndex("<name>"' convex --include='*.ts'` and confirm the remaining hits belong to OTHER tables' same-named indexes that are staying (disambiguate by the queried table) or are zero — including test files (update tests still using an old index name to the org variant or plain collect+filter). Only then delete its `.index(...)` line.
- [ ] **Step 2:** Gates: `npx tsc --noEmit -p convex && npx vitest run && npm run build` → clean / green except known / EXIT 0. (A missed reference fails tsc — Convex validates index names at the type level.)
- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/_generated
git commit -m "chore(org-isolation): remove superseded/unused unscoped indexes (write-amp neutral)"
```

---

### GATE B (CONTROLLER): deploy removal + close jalur B

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → green except known.
- [ ] `npx convex deploy -y` — this DELETES the removed indexes (confirm the deploy summary lists them).
- [ ] Parity ×3 windows → 0. Live order + message normal. Panel normal (Fandy spot-check).
- [ ] `docs/SAAS-BLUEPRINT.md` §14: update the orgId/isolation row → LUNAS-B2b (dedup org-scoped + reader org-filter + 2-org isolation suite + 9 Legacy deleted + indexes swapped); note deferrals (B3: per-org settings/source-keys/tenantIntegrations/members/JWT-org; B4: window per-org).
- [ ] Commit ledger; merge ff → main; **push origin main ONLY after Fandy's explicit approval.**
