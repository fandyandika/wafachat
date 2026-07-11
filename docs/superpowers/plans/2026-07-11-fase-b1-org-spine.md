# Fase B1 Org Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every WaFaChat data row carries a schema-enforced `orgId` (single default org "pustakaislam"), with zero behavior change — readers untouched, all query results byte-identical.

**Architecture:** Proven recipe at full scale (rollup project, Fase A): additive optional field → stamp all write paths (resolve-once-per-handler, null-tolerant pre-seed) → bounded backfill + coverage query → flip to required. The flip is the enforcement: Convex schema validation rejects deploys with unlabeled rows, convex-test loud-fails every unlabeled test seed, TypeScript rejects unlabeled prod inserts.

**Tech Stack:** Convex 1.39, Next.js 14, vitest + convex-test (edge-runtime), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-11-fase-b1-org-spine-design.md`

## Global Constraints

- Branch: `fase-b1-org-spine` off main (main @ `c161968`). Working dir: ALWAYS prefix `cd /f/Projects/whatsapp_cs_automotion/wafachat` (shell cwd resets).
- `git add` SPECIFIC files only, NEVER `-A`. New commits, never `--amend`. `convex/_generated/` IS tracked — commit when regenerated (`npx convex codegen` if api types stale).
- vitest does NOT typecheck — `npx tsc --noEmit -p convex` before claiming any task done. NOTE: `convex deploy` typechecks test files too.
- Baseline: 253 tests, 252 pass + **1 PRE-EXISTING failure** (`convex/followUp.test.ts` › "getArchivedFollowUps: lists recent manual archives, scoped by CS") — NOT yours, never touch it. "Suite green" = no NEW failures.
- Auth ENFORCED: public fns `requireAdmin`/`requireMember` (convex/authz.ts); tests use `t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" })`.
- Deploy/seed/backfill = CONTROLLER work at the two gates (never a subagent): `npm run build` + `npx tsc --noEmit -p convex` + `npx vitest run` + `npx convex deploy -y`; admin calls via `node _admin.mjs query|mutation <module>:<fn> '<json>'`.
- Behavior invariant: readers untouched; with organizations table EMPTY, all writes proceed unstamped (optional field) — deploy is inert until seeding.
- `dailyStats` table is RETIRED — excluded from orgId entirely (state.ts:63 insert site untouched).
- Insert-site line numbers below are from 2026-07-11 greps — they may drift a few lines; re-grep `db.insert(` per file when implementing. The COUNT and target tables are the checklist.

---

## File Structure

| File | Role |
|---|---|
| `convex/schema.ts` | +`organizations` table; +`orgId` optional (→required in T5) on 16 tables |
| `convex/orgs.ts` (NEW) | `DEFAULT_ORG_SLUG`, `getDefaultOrgId`, `requireDefaultOrgId`, `seedDefaultOrg`, `backfillOrgId`, `orgIdCoverage`, `defaultOrgIdInternal` |
| `convex/orgs.test.ts` (NEW) | seed/resolve/backfill/coverage unit tests |
| `convex/ingest/{events,sources,core,reconciler}.ts` | orgId threading through the ingest chain |
| `convex/http.ts` | routes pass `source.orgId` into captureEvent |
| `convex/state.ts`, `convex/messages.ts`, `convex/shippingRecaps.ts`, `convex/settings.ts`, `convex/rollups.ts`, `convex/followUp.ts`, `convex/auth.ts`, `convex/events.ts`, `convex/csConfigs.ts`, `convex/cs.ts`, `convex/closingRules.ts`, `convex/orgSettings.ts`, `convex/ingest/monitor.ts` | stamping sweep (resolve-once + `orgId: orgId ?? undefined`) |
| all `convex/**/*.test.ts` (16 files) | T5 sweep: seed org + orgId on ~291 test inserts |
| `docs/SAAS-BLUEPRINT.md` | §14 update (GATE B) |

---

### Task 1: `organizations` table + `convex/orgs.ts` + optional `orgId` fields on 16 tables

**Files:**
- Modify: `convex/schema.ts` (new table after `orgSettings` ~line 310; +1 field line in each of 16 tables)
- Create: `convex/orgs.ts`
- Create: `convex/orgs.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (./authz), `loadOrgSettings` (./orgSettings), `Id` from `./_generated/dataModel`.
- Produces (later tasks rely on EXACT names):
  - `DEFAULT_ORG_SLUG = "pustakaislam"`
  - `getDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations"> | null>`
  - `requireDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations">>` (throws if unseeded)
  - public `orgs.seedDefaultOrg` (mutation, admin, idempotent, returns `{ seeded, orgId }`)
  - (backfill/coverage land in Task 4, same module)

- [ ] **Step 1: Schema — organizations table + 16 field additions**

Insert after the `orgSettings` table:

```ts
  // Tenant identity — Fase B1. Single row (slug "pustakaislam") until multi-org.
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
```

Add this exact line as the FIRST field of each of these 16 tables (`orders`, `shippingRecaps`, `messages`, `conversations`, `customers`, `events`, `csConfigs`, `ingestEvents`, `ingestSources`, `dailyRollups`, `responseSamples`, `alertState`, `settings`, `closingRules`, `orgSettings`, `users`):

```ts
    orgId: v.optional(v.id("organizations")), // B1: required after backfill (spec §3.4)
```

Do NOT touch `dailyStats` (retired) or add any index.

- [ ] **Step 2: Write failing tests — `convex/orgs.test.ts`**

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { getDefaultOrgId, requireDefaultOrgId } from "./orgs";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("getDefaultOrgId: null before seed; resolves after; requireDefaultOrgId throws before", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    expect(await getDefaultOrgId(ctx)).toBeNull();
    await expect(requireDefaultOrgId(ctx)).rejects.toThrow(/org not seeded/);
  });
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(r.seeded).toBe(true);
  await t.run(async (ctx) => {
    const id = await getDefaultOrgId(ctx);
    expect(id).not.toBeNull();
    expect(await requireDefaultOrgId(ctx)).toEqual(id);
  });
});

test("seedDefaultOrg: idempotent, single row, name follows orgSettings fallback", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const first = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const second = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(first.seeded).toBe(true);
  expect(second.seeded).toBe(false);
  expect(second.orgId).toEqual(first.orgId);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("organizations").collect();
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe("pustakaislam");
    expect(rows[0].name).toBe("Pustaka Islam"); // from DEFAULT_ORG_SETTINGS fallback
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgs.test.ts`
Expected: FAIL — `Cannot find module './orgs'`.

- [ ] **Step 4: Implement `convex/orgs.ts`**

```ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import { loadOrgSettings } from "./orgSettings";

export const DEFAULT_ORG_SLUG = "pustakaislam";

// Null-tolerant resolver: before seedDefaultOrg runs, returns null and callers
// SKIP stamping (orgId still optional) — a deploy with an empty organizations
// table is fully inert. After seeding it always resolves. (Structural { db }
// ctx: works from queries, mutations, and convex-test t.run alike.)
export async function getDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations"> | null> {
  const row = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q: any) => q.eq("slug", DEFAULT_ORG_SLUG))
    .unique();
  return row?._id ?? null;
}

// Post-flip strictness (spec §3.4): write paths that MUST stamp use this.
export async function requireDefaultOrgId(ctx: { db: any }): Promise<Id<"organizations">> {
  const id = await getDefaultOrgId(ctx);
  if (!id) throw new Error("org not seeded: run orgs.seedDefaultOrg first");
  return id;
}

export const seedDefaultOrg = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgs.seedDefaultOrg");
    const existing = await getDefaultOrgId(ctx);
    if (existing) return { seeded: false as const, orgId: existing };
    const settings = await loadOrgSettings(ctx);
    const orgId = await ctx.db.insert("organizations", {
      slug: DEFAULT_ORG_SLUG,
      name: settings.orgName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { seeded: true as const, orgId };
  },
});
```

- [ ] **Step 5: Verify pass + typecheck**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgs.test.ts && npx tsc --noEmit -p convex`
Expected: 2/2 PASS, tsc clean. (`npx convex codegen` first if `api.orgs` types missing.)

- [ ] **Step 6: Full suite (fields are optional → zero impact)**

Run: `npx vitest run`
Expected: green except the 1 pre-existing followUp failure.

- [ ] **Step 7: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/orgs.ts convex/orgs.test.ts convex/_generated
git commit -m "feat(orgs): organizations table + default-org resolvers + optional orgId on 16 data tables"
```

---

### Task 2: orgId threading through the ingest chain

**Files:**
- Modify: `convex/ingest/events.ts:9-21` (captureEvent arg)
- Modify: `convex/ingest/sources.ts` (new `setSourceOrg` mutation; existing exports at lines 7 getBySourceKey / 17 upsertSource / 40 setEnforceSignature / 53 listSources)
- Modify: `convex/http.ts` — `/webhooks/kirimdev` captureEvent call ~line 226, `/webhooks/berdu` ~line 270, `genericIngestRoute` capture call (~line 300+)
- Modify: `convex/ingest/core.ts` (processCapturedEvent threads event.orgId; replay inserts ~135/~161 copy `orgId: event.orgId`)
- Modify: `convex/state.ts` `upsertOrderCore` (~line 226: new `orgId` arg; its inserts to customers/orders/conversations get stamped; legacy `upsertOrderFromN8n` resolves default)
- Modify: `convex/messages.ts` `appendMessageCore` (~line 129: `AppendMessageCoreArgs` gains orgId; inserts in its call-tree stamped; legacy `appendMessageFromN8n` resolves default)
- Modify: `convex/shippingRecaps.ts` `upsertRecapFromMessage` (gains orgId param; its recap+event inserts ~413/422 stamped)
- Modify: `convex/ingest/reconciler.ts` (~line 61: captureEvent call gains orgId via internal query)
- Modify: `convex/orgs.ts` (add `defaultOrgIdInternal` internalQuery — actions lack ctx.db)
- Test: `convex/ingest/core.test.ts`

**Interfaces:**
- Consumes: `getDefaultOrgId` (Task 1).
- Produces:
  - `captureEvent` args + `orgId: v.optional(v.id("organizations"))` (its insert is `{ ...args, status, receivedAt }` — the arg lands on the row via the spread automatically)
  - `upsertOrderCore(ctx, args)` — args gains `orgId?: Id<"organizations"> | null`
  - `AppendMessageCoreArgs` gains `orgId?: Id<"organizations"> | null`
  - `sources.setSourceOrg` (mutation, admin): `{ sourceKey }` → patches the source's orgId to the default org
  - `orgs.defaultOrgIdInternal` (internalQuery, no args) → `Id | null`

- [ ] **Step 1: Write the failing tests in `convex/ingest/core.test.ts`**

(Reuse the file's existing imports/`internal` handle; mirror the existing lead test's body shape.)

```ts
test("orgId threads: source.orgId -> captured event -> stored order", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607119001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234509999", firstName: "Test", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true,
    orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const ev = await ctx.db.get(eventId);
    expect(ev?.orgId).toEqual(orgId);
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607119001"));
    expect(order?.orgId).toEqual(orgId);
  });
});

test("orgId absent (pre-seed source): event still processes, rows unstamped", async () => {
  const t = convexTest(schema);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607119002", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234508888", firstName: "Test", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true,
  });
  const out = await t.mutation(internal.ingest.core.processEvent, { eventId });
  expect(out.status).toBe("processed");
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607119002"));
    expect(order?.orgId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run convex/ingest/core.test.ts` → FAIL (unknown arg `orgId`).

- [ ] **Step 3: Implement the chain**

**`convex/ingest/events.ts`** — captureEvent args add one line (insert body unchanged, the spread carries it):

```ts
    orgId: v.optional(v.id("organizations")), // copied from the source row by http routes / reconciler
```

**`convex/orgs.ts`** — append (extend the `_generated/server` import to include `internalQuery`):

```ts
export const defaultOrgIdInternal = internalQuery({
  args: {},
  handler: async (ctx) => getDefaultOrgId(ctx),
});
```

**`convex/ingest/sources.ts`** — add after `setEnforceSignature` (mirror its lookup; use a top-level `import { requireDefaultOrgId } from "../orgs";` — no cycle: orgs.ts does not import sources):

```ts
// Attach the source to the default org (B1 single-tenant; per-org keys arrive in B3).
export const setSourceOrg = mutation({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.setSourceOrg");
    const src = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (!src) throw new Error(`source not found: ${args.sourceKey}`);
    const orgId = await requireDefaultOrgId(ctx);
    await ctx.db.patch(src._id, { orgId });
    return { ok: true, sourceKey: args.sourceKey, orgId };
  },
});
```

(Check the actual index name used by `getBySourceKey` at sources.ts:7 and reuse it.)

**`convex/http.ts`** — in the captureEvent calls of `/webhooks/kirimdev` (~226), `/webhooks/berdu` (~270), and the generic route, add one field:

```ts
      orgId: (source as any).orgId ?? undefined,
```

**`convex/ingest/core.ts`**:
- `processCapturedEvent` event param type adds `orgId?: any`.
- `message.event` + `generic.message` branches: add `orgId: (event as any).orgId ?? null,` to the `appendMessageCore` args object.
- `lead.created` + `generic.lead` branches: add `orgId: (event as any).orgId ?? null,` to the `upsertOrderCore` args object.
- Replay inserts (`ctx.db.insert("ingestEvents", {...})` at ~135 and ~161): add `orgId: (event as any).orgId ?? undefined,` (COPY from the original event — do not re-resolve).

**`convex/ingest/reconciler.ts`** — in `runReconcile` before the gap loop:

```ts
    const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
```

and add `orgId: orgId ?? undefined,` to its captureEvent args.

**`convex/state.ts`**:
- `upsertOrderCore` args type adds `orgId?: Id<"organizations"> | null;` (add `import type { Id } from "./_generated/dataModel";` if absent). Each `ctx.db.insert("customers"|"orders"|"conversations", {...})` inside it gains `orgId: args.orgId ?? undefined,`.
- Legacy `upsertOrderFromN8n` (and `createTestConversation` if it calls upsertOrderCore): resolve once — `const orgId = await getDefaultOrgId(ctx);` — and pass `orgId` in the core call args.

**`convex/messages.ts`**:
- `AppendMessageCoreArgs` adds `orgId?: Id<"organizations"> | null;`.
- Every insert in appendMessageCore's call-tree (messages/events/conversations/responseSamples sites) gains `orgId: args.orgId ?? undefined,`; nested helpers receive the value as a parameter (Fase A threading discipline).
- Legacy `appendMessageFromN8n`: resolve `getDefaultOrgId(ctx)` once, pass into core args.

**`convex/shippingRecaps.ts`**:
- `upsertRecapFromMessage(ctx, args)` gains `orgId?: Id<"organizations"> | null` in its args; its recap (~413) + event (~422) inserts gain `orgId: args.orgId ?? undefined,`. `appendMessageCore` passes its own `args.orgId` through when invoking it.

- [ ] **Step 4: Verify** — `npx vitest run convex/ingest/core.test.ts convex/messages.test.ts convex/state.test.ts && npx tsc --noEmit -p convex`
Expected: new tests pass; existing pass (unstamped path unchanged); tsc clean.

- [ ] **Step 5: Full suite** — `npx vitest run` → green except known failure.

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/ingest/events.ts convex/ingest/sources.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/ingest/reconciler.ts convex/http.ts convex/state.ts convex/messages.ts convex/shippingRecaps.ts convex/orgs.ts convex/_generated
git commit -m "feat(orgs): orgId threads source -> event -> order/message/recap through the ingest chain"
```

---

### Task 3: stamping sweep — every remaining insert site

**Files (site map, 2026-07-11 lines — re-grep per file; COUNTS are the checklist):**
- `convex/state.ts`: events ×8 (~351/481/552/611/666/719/810/864 — setConversationStatus/handover/undo flows); any customers/orders/conversations sites NOT inside upsertOrderCore (e.g. `createTestConversation` ~264/306/331)
- `convex/shippingRecaps.ts`: shippingRecaps ×3 remaining (~497/580/1182), events ×8 (~502/839/869/909/951/1039/1091/1197)
- `convex/messages.ts`: any site NOT inside appendMessageCore's tree (re-grep; expected none left)
- `convex/settings.ts`: settings ~30, events ~33
- `convex/rollups.ts`: dailyRollups ~239 (computeRollupRow insert), responseSamples ~366 (rebuild path)
- `convex/followUp.ts`: messages ~203 (sendFollowUp), csConfigs ~382
- `convex/auth.ts`: users ~36/112
- `convex/events.ts`: events ~28
- `convex/csConfigs.ts`: csConfigs ~152 (upsert insert branch)
- `convex/cs.ts`: csConfigs ~87 (avatar upsert branch)
- `convex/closingRules.ts`: closingRules ~29 (seedDefault)
- `convex/orgSettings.ts`: orgSettings ~78/99 (update-upsert + seedDefault)
- `convex/ingest/monitor.ts`: alertState ~56
- SKIP: `state.ts:63` (dailyStats — retired, excluded)
- Test: extend one existing test in `convex/state.test.ts`

**Interfaces:** Consumes `getDefaultOrgId` (Task 1). Produces nothing new — pure stamping.

- [ ] **Step 1: The mechanical rule (apply per file)**

In each function containing a listed insert: resolve ONCE at the top of the handler/helper —

```ts
import { getDefaultOrgId } from "./orgs"; // "../orgs" from convex/ingest/*

const orgId = await getDefaultOrgId(ctx);
```

— then every listed insert object gains:

```ts
      orgId: orgId ?? undefined,
```

Rules: one resolve per enclosing function (even with 5 sites); functions already holding a threaded `orgId` param (Task 2) use that instead of re-resolving; NEVER put the resolve inside a `.map`/`for` over data rows; do not restructure anything else.

Worked example — `convex/settings.ts` (both sites live in one handler):

```ts
  handler: async (ctx, args) => {
    const orgId = await getDefaultOrgId(ctx);
    // ...existing lookup logic unchanged...
    await ctx.db.insert("settings", { /* existing fields unchanged */ orgId: orgId ?? undefined });
    await ctx.db.insert("events", { /* existing fields unchanged */ orgId: orgId ?? undefined });
```

- [ ] **Step 2: Sweep all files in the map**, then run the completeness check:

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && grep -rn "db.insert(" convex --include="*.ts" | grep -v ".test.ts"` and manually confirm every listed site now sits in a function that stamps (the insert lines themselves may not contain the literal "orgId" when the object spans lines — verify per site, not per grep line). Expected exceptions: exactly one — state.ts dailyStats site.

- [ ] **Step 3: Spot test** — in `convex/state.test.ts`, extend one existing test that exercises a public mutation insert path: seed org first (`await t.withIdentity(ADMIN).mutation(api.orgs.seedDefaultOrg, {})`), then assert the created row's `orgId` is non-null. 1-2 assertions; systemic proof = Task 4 coverage + GATE A live check.

- [ ] **Step 4: Gates** — `npx tsc --noEmit -p convex && npx vitest run` → clean + green (except known).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/state.ts convex/shippingRecaps.ts convex/messages.ts convex/settings.ts convex/rollups.ts convex/followUp.ts convex/auth.ts convex/events.ts convex/csConfigs.ts convex/cs.ts convex/closingRules.ts convex/orgSettings.ts convex/ingest/monitor.ts convex/state.test.ts
git commit -m "feat(orgs): stamp orgId on all remaining insert sites (resolve-once per handler)"
```

---

### Task 4: `backfillOrgId` + `orgIdCoverage`

**Files:**
- Modify: `convex/orgs.ts` (append both fns)
- Modify: `convex/orgs.test.ts` (append test)

**Interfaces:**
- Produces: public `orgs.backfillOrgId` (mutation, admin) `{ table, limit? }` → `{ patched, done }`; public `orgs.orgIdCoverage` (query, admin) `{}` → `Record<table, missingCount>` (counts capped at 1001).

- [ ] **Step 1: Failing test (append to orgs.test.ts)**

```ts
test("backfillOrgId: stamps unlabeled rows bounded per call; coverage reports missing", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("orders", {
        orderId: `O-B1-${i}`, customerPhone: `62811111000${i}`, customerName: "X",
        assignedCsName: "Aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
        shippingCost: "Rp1", total: "Rp2", shippingAddress: "A", shippingDistrict: "D",
        shippingCity: "C", source: "berdu", aiEligible: false, createdAt: 1, updatedAt: 1,
      }); // no orgId — simulates pre-B1 rows
    }
  });
  const cov1 = await asAdmin.query(api.orgs.orgIdCoverage, {});
  expect(cov1.orders).toBe(3);
  const r1 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r1.patched).toBe(2);
  expect(r1.done).toBe(false);
  const r2 = await asAdmin.mutation(api.orgs.backfillOrgId, { table: "orders", limit: 2 });
  expect(r2.patched).toBe(1);
  expect(r2.done).toBe(true);
  const cov2 = await asAdmin.query(api.orgs.orgIdCoverage, {});
  expect(cov2.orders).toBe(0);
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run convex/orgs.test.ts` → FAIL (missing fns).

- [ ] **Step 3: Implement (append to convex/orgs.ts; extend imports with `query`)**

```ts
const B1_TABLES = [
  "orders", "shippingRecaps", "messages", "conversations", "customers", "events",
  "csConfigs", "ingestEvents", "ingestSources", "dailyRollups", "responseSamples",
  "alertState", "settings", "closingRules", "orgSettings", "users",
] as const;
const tableValidator = v.union(...B1_TABLES.map((t) => v.literal(t)));

// One-time B1 backfill (pattern: rollups.backfillCsKey). Idempotent; controller
// loops per table until { done: true }. Bounded read via take(limit).
export const backfillOrgId = mutation({
  args: { table: tableValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgs.backfillOrgId");
    const orgId = await requireDefaultOrgId(ctx);
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query(args.table as any)
      .filter((q: any) => q.eq(q.field("orgId"), undefined))
      .take(limit);
    for (const r of rows) await ctx.db.patch(r._id, { orgId });
    return { patched: rows.length, done: rows.length < limit };
  },
});

export const orgIdCoverage = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgs.orgIdCoverage");
    const out: Record<string, number> = {};
    for (const table of B1_TABLES) {
      // take(1001): bounded read — exact up to 1000, "1001" = more remain. Enough
      // to steer the backfill loop without scanning huge tables in one query.
      const missing = await ctx.db
        .query(table as any)
        .filter((q: any) => q.eq(q.field("orgId"), undefined))
        .take(1001);
      out[table] = missing.length;
    }
    return out;
  },
});
```

(TS note: `v.union(...arr.map(...))` may need a spread of at least two literals — if the validator complains, write the 16 `v.literal("…")` entries out explicitly.)

- [ ] **Step 4: Verify pass** — `npx vitest run convex/orgs.test.ts && npx tsc --noEmit -p convex` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/orgs.ts convex/orgs.test.ts convex/_generated
git commit -m "feat(orgs): bounded backfillOrgId + orgIdCoverage across the 16 B1 tables"
```

---

### GATE A (CONTROLLER ONLY): deploy M1-M3 + seed + backfill to coverage 0

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → green (except known).
- [ ] `npx convex deploy -y` (inert: organizations empty → stamping skipped).
- [ ] `node _admin.mjs mutation orgs:seedDefaultOrg '{}'` → `{ seeded: true }`.
- [ ] `node _admin.mjs mutation ingest/sources:setSourceOrg '{"sourceKey":"kirimdev-pustakaislam"}'` + same for `"berdu-pustakaislam"`.
- [ ] Verify NEW rows stamp: after the next live order+message, `node _admin.mjs query ingest/events:listRecent '{"limit":3}'` → events carry orgId; the new order row carries orgId.
- [ ] Backfill loop per table (chunk 500, repeat until `done: true`) for all 16 tables — messages/ingestEvents are the big ones (hundreds of calls; script the loop).
- [ ] `node _admin.mjs query orgs:orgIdCoverage '{}'` → ALL zeros (values ≤1000 exact; re-run after loops).
- [ ] Ledger append. One-time Usage spike expected (documented; precedent: 183MB rollup backfill).

---

### Task 5: flip `orgId` to required + test sweep + strict resolvers

**Files:**
- Modify: `convex/schema.ts` (16 lines: drop `v.optional(...)`)
- Modify: prod files from Tasks 2-3 (tsc-driven tightening)
- Modify: 16 test files (~291 seed inserts gain orgId: followUp×82, analytics×49, conversationLifecycle×30, rollupReaders×26, autoFollowUp×25, rollups×20, metrics×15, state×10, responseTime×10, shippingRecaps×8, messages×6, ingest/core×4, cs×2, closingRules×2, responseSamples×1, csConfigs×1)

**Interfaces:** Consumes `requireDefaultOrgId` (Task 1). Produces the permanent invariant.

- [ ] **Step 1: Flip schema** — each of the 16 tables:

```ts
    orgId: v.id("organizations"), // B1 REQUIRED: every row belongs to an org (spec §3.4)
```

- [ ] **Step 2: tsc-driven prod tightening**

Run `npx tsc --noEmit -p convex` repeatedly; every error is a site to tighten:
- Write-path resolvers: `getDefaultOrgId(ctx)` → `requireDefaultOrgId(ctx)`.
- Threaded params: `orgId?: Id<"organizations"> | null` → `orgId: Id<"organizations">` on `upsertOrderCore` / `AppendMessageCoreArgs` / `upsertRecapFromMessage`; `captureEvent`'s arg becomes `v.id("organizations")` (required). http routes: if a source row somehow lacks orgId, return the existing always-200 "ignored" ack (never 500 a vendor); otherwise pass `source.orgId`.
- Insert objects: `orgId: orgId ?? undefined` → `orgId,`.
Repeat until tsc is clean.

- [ ] **Step 3: Test sweep (convex-test loud-fails are the checklist)**

Per test file, add a local helper at the top (INLINE per file — deliberately NOT a shared convex/ module: non-test .ts files in convex/ are bundled at deploy, an avoidable risk surface):

```ts
async function seedOrg(t: any) {
  return t.run((ctx: any) =>
    ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }),
  );
}
```

Then in each seed block: `const orgId = await seedOrg(t);` and add `orgId,` to every raw insert object. Files with a shared `seed()` helper need only a handful of edits. Run `npx vitest run <file>` per file — every remaining unlabeled insert throws a schema validation error naming itself. Do NOT touch the pre-existing followUp failure's assertions — only its seeds.

- [ ] **Step 4: Full gates** — `npx tsc --noEmit -p convex && npx vitest run && npm run build`
Expected: clean / green except the 1 known / EXIT 0.

- [ ] **Step 5: Commit (two commits: prod flip, then test sweep)**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/orgs.ts convex/state.ts convex/messages.ts convex/shippingRecaps.ts convex/settings.ts convex/rollups.ts convex/followUp.ts convex/auth.ts convex/events.ts convex/csConfigs.ts convex/cs.ts convex/closingRules.ts convex/orgSettings.ts convex/http.ts convex/ingest/events.ts convex/ingest/sources.ts convex/ingest/core.ts convex/ingest/reconciler.ts convex/ingest/monitor.ts convex/_generated
git commit -m "feat(orgs): orgId REQUIRED on all 16 data tables (schema-enforced org spine)"
# enumerate the actually-touched test files with git status --short, then add them EXPLICITLY:
git add <the touched convex/**/*.test.ts files>
git commit -m "test(orgs): seed org + orgId in all test fixtures (required-flip sweep)"
```

---

### GATE B (CONTROLLER ONLY): deploy the flip + verify + ledger + push

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → green (except known).
- [ ] `npx convex deploy -y` — **server-side validation of every row in all 16 tables IS the gate.** If rejected: `orgIdCoverage` → backfill stragglers (rows written between backfill and flip are already stamped by live write paths; stragglers should be zero) → retry.
- [ ] `node _admin.mjs query rollups:debugRollupParity '{"windowKey":"<today>"}'` + two prior windows → `mismatches: []` ×3 (readers untouched → must be identical).
- [ ] Live flow: next order + message arrive stamped (`listRecent`).
- [ ] Update `docs/SAAS-BLUEPRINT.md` §14: row "Belum ada `orgId` di tabel data" → ✅ LUNAS (date; orgId required on 16 tables + organizations + org-attached sources). Record spec §7 deferrals (org-scoped indexes → B2; read-isolation → B2; members/JWT-org → org #2; per-org settings lookup → B3; drop dailyStats → housekeeping).
- [ ] Commit ledger; merge branch → main via superpowers:finishing-a-development-branch; **push origin main ONLY after Fandy's explicit approval.**
