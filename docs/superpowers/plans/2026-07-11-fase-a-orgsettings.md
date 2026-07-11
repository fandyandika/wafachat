# Fase A orgSettings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the last three pustakaislam hardcodes (internal-phone exclusion list, Berdu staff→CS map, org identity) from code into DB config (`orgSettings` table + `csConfigs.berduStaffIds`), with in-code fallback so an unseeded deploy behaves byte-identically.

**Architecture:** Mirror the proven `getActiveClosingPhrases` pattern (read table, fall back to in-code default when empty). Org-level config lives in a new single-doc `orgSettings` table (key `"default"`); per-CS attributes live on the existing `csConfigs` registry. `isInternalTestPhone` gains a REQUIRED `ReadonlySet<string>` param so the TypeScript compiler forces every one of the ~41 call sites to be updated in one atomic commit — no reader/writer can silently keep a different phone set (rollup-parity safety).

**Tech Stack:** Convex 1.39, Next.js 14 App Router, vitest + convex-test (edge-runtime), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-11-fase-a-orgsettings-design.md`

## Global Constraints

- Working dir: shell cwd resets between commands — ALWAYS prefix `cd /f/Projects/whatsapp_cs_automotion/wafachat`.
- `git add` SPECIFIC files only, NEVER `-A`. New commits only, never `--amend`.
- `convex/_generated/` IS tracked — commit it whenever schema/api changes regenerate it (run `npx convex codegen` if api.d.ts is stale after adding modules; note the deploy key targets prod, codegen is safe/read-only for types).
- vitest does NOT typecheck — run `npx tsc --noEmit -p convex` before claiming a Convex task done.
- Baseline tests: 246 total, 245 pass + **1 PRE-EXISTING failure** (`convex/followUp.test.ts` › "getArchivedFollowUps: lists recent manual archives, scoped by CS"). This failure is NOT yours to fix and does NOT block any task. "Suite green" in this plan means: no NEW failures beyond that one.
- Auth is ENFORCED in prod. Public queries/mutations use `requireAdmin`/`requireMember` from `convex/authz.ts`. Tests call guarded functions via `t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" })` (see `convex/closingRules.test.ts:8`).
- Deploy/seed is CONTROLLER work (Task 5), never a subagent's: `npm run build` + `npx tsc --noEmit -p convex` + `npx vitest run` + `npx convex deploy -y`, then seed via `node _admin.mjs` (gitignored admin helper — mints an RS256 admin token; syntax `node _admin.mjs query|mutation <module>:<fn> '<json>'`).
- Behavior invariant: with the `orgSettings` table EMPTY, every metric/attribution result must be byte-identical to before (fallback = the exact current hardcoded values). `debugRollupParity` must report 0 mismatches after deploy+seed.
- Fase A scope guard: NO `orgId` on data tables, NO timezone/cutoff config, NO editable PRODUCT_ALIASES (spec §6 deferrals). Do not "improve" adjacent code.

---

## File Structure

| File | Role |
|---|---|
| `convex/schema.ts` | +`orgSettings` table; +`csConfigs.berduStaffIds` field |
| `convex/orgSettings.ts` (NEW) | defaults, `loadOrgSettings`, `getInternalPhoneSet`, `get`/`update`/`seedDefault` |
| `convex/orgSettings.test.ts` (NEW) | fallback / seed / update / normalization tests |
| `convex/lib.ts` | `isInternalTestPhone` new signature; hardcoded Set removed |
| `convex/lib.test.ts` | signature updates (explicit set) |
| `convex/{analytics,metrics,rollups,rollupReaders,shippingRecaps,followUp,responseTime}.ts` | sweep: load set once per function, pass down |
| `convex/ingest/berduAdapter.ts` | `parseBerduOrderDetail(order, staffMap)`; `DEFAULT_BERDU_STAFF_MAP` export |
| `convex/ingest/berduAdapter.test.ts` | pass map explicitly; custom-map test |
| `convex/ingest/core.ts` | `resolveBerduStaffMap(ctx)` + wire into `lead.created` |
| `convex/ingest/core.test.ts` | registry-vs-fallback attribution test |
| `convex/csConfigs.ts` | +`setBerduStaffIds` mutation |
| `convex/csConfigs.test.ts` (NEW) | mutation test |
| `convex/cs.ts` | `listCs` returns `berduStaffIds` |
| `components/panel/settings-dashboard.tsx` | +Organisasi section; +Berdu Staff IDs field per CS card |
| `docs/SAAS-BLUEPRINT.md` | §14 ledger update (Task 5) |

---

### Task 1: `orgSettings` table + module + tests

**Files:**
- Modify: `convex/schema.ts` (add table — place after the `settings` table, around line 299)
- Create: `convex/orgSettings.ts`
- Create: `convex/orgSettings.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` from `./lib`, `requireAdmin` from `./authz`.
- Produces (later tasks rely on these EXACT names):
  - `DEFAULT_INTERNAL_PHONES: string[]` (exported const)
  - `loadOrgSettings(ctx: { db: any }): Promise<{ orgName: string; internalPhones: string[] }>`
  - `getInternalPhoneSet(ctx: { db: any }): Promise<ReadonlySet<string>>`
  - public `orgSettings.get` (query, admin), `orgSettings.update` (mutation, admin, partial, upserts), `orgSettings.seedDefault` (mutation, admin, idempotent)

- [ ] **Step 1: Add the table to `convex/schema.ts`**

Insert after the `settings` table definition (currently lines 295-299), keeping its style:

```ts
  // Single-doc org config (key "default") — Fase A anchor for multi-tenant.
  // Values here override the in-code DEFAULT_ORG_SETTINGS fallback (empty table
  // = fallback = pre-Fase-A behavior). Phones stored normalized (62…).
  orgSettings: defineTable({
    key: v.string(), // "default" — becomes a per-org lookup in Fase B
    orgName: v.string(),
    internalPhones: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
```

- [ ] **Step 2: Write the failing tests — `convex/orgSettings.test.ts`**

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { DEFAULT_INTERNAL_PHONES, getInternalPhoneSet, loadOrgSettings } from "./orgSettings";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("loadOrgSettings: empty table falls back to in-code defaults", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Pustaka Islam");
    expect(s.internalPhones).toEqual(DEFAULT_INTERNAL_PHONES);
    const set = await getInternalPhoneSet(ctx);
    expect(set.has("6281385708799")).toBe(true); // CS Aisyah line, from defaults
  });
});

test("seedDefault: inserts once, second call is a no-op", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const first = await asAdmin.mutation(api.orgSettings.seedDefault, {});
  expect(first.seeded).toBe(true);
  const second = await asAdmin.mutation(api.orgSettings.seedDefault, {});
  expect(second.seeded).toBe(false);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("orgSettings").collect();
    expect(rows.length).toBe(1);
    expect(rows[0].internalPhones).toEqual(DEFAULT_INTERNAL_PHONES);
  });
});

test("update: normalizes phones (0/8 prefixes), dedupes, upserts when table empty", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgSettings.update, {
    orgName: "Toko Test",
    internalPhones: ["081234567890", "81234567890", "6281234567890", "6289999999999"],
  });
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Toko Test");
    // three spellings of the same number collapse to one normalized entry
    expect(s.internalPhones).toEqual(["6281234567890", "6289999999999"]);
    const set = await getInternalPhoneSet(ctx);
    expect(set.has("6281385708799")).toBe(false); // table now overrides defaults entirely
  });
});

test("update: partial patch keeps the other field", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgSettings.seedDefault, {});
  await asAdmin.mutation(api.orgSettings.update, { orgName: "Renamed Org" });
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Renamed Org");
    expect(s.internalPhones).toEqual(DEFAULT_INTERNAL_PHONES); // untouched
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgSettings.test.ts`
Expected: FAIL — `Cannot find module './orgSettings'` (or api.orgSettings missing).

- [ ] **Step 4: Implement `convex/orgSettings.ts`**

```ts
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./authz";
import { normalizePhone } from "./lib";

// In-code fallback = tenant #1's values, verbatim from the old convex/lib.ts
// INTERNAL_TEST_PHONES hardcode. Used whenever the orgSettings table is empty
// (fresh dev env, convex-test without seeding) so behavior never regresses.
// Prod is seeded via seedDefault; after that the table is the source of truth.
export const DEFAULT_INTERNAL_PHONES: string[] = [
  "6285715682110", // owner Pustaka Islam
  "6285774076061", // admin input
  "628211900201", // admin input
  "6282280000661", // owner Pustaka Islam
  "6281385708799", // CS Aisyah line
  "6282321381742", // CS Risma line
  "6285210047441", // CS Lila line
  "6282113515152", // CS Azelia line
  "6281220823210", // CS Nabila line
];

export const DEFAULT_ORG_SETTINGS = {
  orgName: "Pustaka Islam",
  internalPhones: DEFAULT_INTERNAL_PHONES,
};

// Structural { db } ctx (same convention as getActiveClosingPhrases) so this
// works from queries, mutations, and convex-test t.run alike.
export async function loadOrgSettings(ctx: { db: any }): Promise<{ orgName: string; internalPhones: string[] }> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_key", (q: any) => q.eq("key", "default"))
    .unique();
  return row ?? DEFAULT_ORG_SETTINGS;
}

/** One indexed point-read per handler; pass the returned set down into filters. */
export async function getInternalPhoneSet(ctx: { db: any }): Promise<ReadonlySet<string>> {
  const s = await loadOrgSettings(ctx);
  return new Set(s.internalPhones);
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgSettings.get");
    return loadOrgSettings(ctx);
  },
});

export const update = mutation({
  args: {
    orgName: v.optional(v.string()),
    internalPhones: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgSettings.update");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.orgName !== undefined) {
      const name = args.orgName.trim();
      if (!name) throw new Error("orgName kosong");
      patch.orgName = name;
    }
    if (args.internalPhones !== undefined) {
      // Normalize at write (62… form) + dedupe, so readers never re-normalize the set.
      patch.internalPhones = Array.from(
        new Set(args.internalPhones.map((p) => normalizePhone(p)).filter((p) => p.length > 0)),
      );
    }
    const existing = await ctx.db
      .query("orgSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true, action: "updated" as const };
    }
    await ctx.db.insert("orgSettings", {
      key: "default",
      orgName: DEFAULT_ORG_SETTINGS.orgName,
      internalPhones: DEFAULT_INTERNAL_PHONES,
      updatedAt: Date.now(),
      ...patch,
    });
    return { ok: true, action: "inserted" as const };
  },
});

// Idempotent prod seeding: copies the in-code defaults into the table once.
export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "orgSettings.seedDefault");
    const existing = await ctx.db
      .query("orgSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (existing) return { seeded: false as const };
    await ctx.db.insert("orgSettings", {
      key: "default",
      orgName: DEFAULT_ORG_SETTINGS.orgName,
      internalPhones: DEFAULT_INTERNAL_PHONES,
      updatedAt: Date.now(),
    });
    return { seeded: true as const };
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgSettings.test.ts && npx tsc --noEmit -p convex`
Expected: 4/4 PASS, tsc clean. (If `api.orgSettings` type is missing, run `npx convex codegen` first.)

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/orgSettings.ts convex/orgSettings.test.ts convex/_generated
git commit -m "feat(orgSettings): single-doc org config table with in-code fallback"
```

---

### Task 2: `isInternalTestPhone` → config-driven (ATOMIC sweep, one commit)

⚠️ The signature change breaks compilation of ALL 7 consumer files at once. This entire task is ONE compile unit — do every step before expecting green. Use `npx tsc --noEmit -p convex` output as your completeness checklist: when tsc is clean, the sweep is complete by construction.

**Files:**
- Modify: `convex/lib.ts:28-50` (remove Set, new signature)
- Modify: `convex/lib.test.ts:1-34`
- Modify (sweep): `convex/analytics.ts` (sites at lines 18, 21, 93, 96, 189, 234, 239, 325, 328), `convex/metrics.ts` (21, 26, 31, 34, 41, 90, 94, 130, 206, 207), `convex/rollups.ts` (44, 51, 271, 283, 330, 509, 517), `convex/shippingRecaps.ts` (710, 746, 1301, 1308, 1311, 1423), `convex/followUp.ts` (59, 336, 421, 469), `convex/rollupReaders.ts` (450, 454, 672, 673), `convex/responseTime.ts` (17)

**Interfaces:**
- Consumes: `getInternalPhoneSet(ctx)` and `DEFAULT_INTERNAL_PHONES` from Task 1.
- Produces: `isInternalTestPhone(value: string | undefined, internalPhones: ReadonlySet<string>): boolean` — the signature every later caller (Task 3's core.ts does NOT call it; no other new callers) must use.

- [ ] **Step 1: Change `convex/lib.ts`**

Replace lines 28-50 (the comment, `INTERNAL_TEST_PHONES` Set, and old function) with:

```ts
// Phones excluded from all closing/leads/revenue metrics: owner + admin input
// numbers, every CS WhatsApp line (CS may forward closing cases to each other).
// The per-tenant list lives in orgSettings.internalPhones (convex/orgSettings.ts,
// which also holds the in-code DEFAULT fallback). Callers load the set ONCE per
// handler via getInternalPhoneSet(ctx) and pass it down — the required param is
// deliberate: the compiler guarantees every metric path uses the same set (no
// silent parity drift between rollup writers and readers).
export function isInternalTestPhone(value: string | undefined, internalPhones: ReadonlySet<string>): boolean {
  const normalized = normalizePhone(value);
  if (internalPhones.has(normalized)) return true;
  // WhatsApp group JIDs / non-MSISDN ids are far longer than any Indonesian
  // number (62 + <=12 digits = <=14 chars). Universal product rule — stays in code.
  if (normalized.length > 15) return true;
  return false;
}
```

- [ ] **Step 2: Update `convex/lib.test.ts`**

Replace the four `isInternalTestPhone` tests (lines 1-34) with:

```ts
import { expect, test } from "vitest";
import { isInternalTestPhone, csKey } from "./lib";
import { DEFAULT_INTERNAL_PHONES } from "./orgSettings";

const PHONES: ReadonlySet<string> = new Set(DEFAULT_INTERNAL_PHONES);

test("isInternalTestPhone: owner/admin/CS numbers are excluded (default set)", () => {
  for (const phone of DEFAULT_INTERNAL_PHONES) {
    expect(isInternalTestPhone(phone, PHONES)).toBe(true);
  }
});

test("isInternalTestPhone: normalizes 0/8 prefixes before matching", () => {
  expect(isInternalTestPhone("081385708799", PHONES)).toBe(true); // CS Aisyah with leading 0
  expect(isInternalTestPhone("81385708799", PHONES)).toBe(true); // CS Aisyah with leading 8
});

test("isInternalTestPhone: group / non-MSISDN ids are excluded even with an empty set", () => {
  expect(isInternalTestPhone("120363042837849988", new Set())).toBe(true); // WhatsApp group JID
});

test("isInternalTestPhone: a normal customer number is NOT excluded", () => {
  expect(isInternalTestPhone("6281234567890", PHONES)).toBe(false);
  expect(isInternalTestPhone("6289653903889", PHONES)).toBe(false);
  expect(isInternalTestPhone("081234567890", PHONES)).toBe(false);
});
```

(The `csKey` and report-window tests below stay untouched.)

- [ ] **Step 3: Sweep the 7 consumer files — mechanical transformation**

For EVERY file in the sweep list, apply exactly two mechanical edits:

**(a)** Add the import (extend the existing `./lib` import line's neighborhood):
```ts
import { getInternalPhoneSet } from "./orgSettings";
```
(for `convex/rollupReaders.ts` and other root-level files the path is `./orgSettings`; no sweep files live in subdirectories.)

**(b)** In each function containing a call site (all of them are `async` and receive `ctx` — verified for every site in this list), add ONE loader line at the top of the function body, then thread the variable into every call in that function:

```ts
const internalPhones = await getInternalPhoneSet(ctx);
// …
.filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones))
```

Worked example — `convex/metrics.ts` `computeDashboardSummaryRaw` (contains sites 21, 26, 31, 34, 41):

```ts
export async function computeDashboardSummaryRaw(ctx: QueryCtx, args: { startAt: number; endAt: number; csName?: string; includeActiveChats?: boolean }) {
    const internalPhones = await getInternalPhoneSet(ctx);   // ← added, once per function
    const orders = await ctx.db.query("orders")
      // …unchanged…
    const leadPhones = new Set(
      orders.filter((o) => !isInternalTestPhone(o.customerPhone, internalPhones) && csOk(o.assignedCsName))
        .map((o) => normalizePhone(o.customerPhone)),
    );
    // …every other isInternalTestPhone(x) in this function → isInternalTestPhone(x, internalPhones)
```

Rules:
- ONE loader line per enclosing function, even if the function has 5 call sites.
- Do NOT restructure, rename, or "improve" anything else — the diff per site is exactly `, internalPhones)` plus one loader line per function.
- Do NOT thread the set through pure helpers that lack ctx — there are none in this sweep (all enclosing functions have ctx).
- After editing all listed lines, run tsc; fix any site it still reports (tsc is the checklist — line numbers above may drift a few lines once edits land).

- [ ] **Step 4: Typecheck + full suite**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run`
Expected: tsc clean; suite green apart from the 1 pre-existing followUp failure. Behavior is identical because every test runs with an empty `orgSettings` table → fallback set == old hardcode.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/lib.ts convex/lib.test.ts convex/analytics.ts convex/metrics.ts convex/rollups.ts convex/shippingRecaps.ts convex/followUp.ts convex/rollupReaders.ts convex/responseTime.ts
git commit -m "feat(orgSettings): isInternalTestPhone reads the org's internalPhones set (compiler-enforced sweep)"
```

---

### Task 3: `BERDU_STAFF_MAP` → `csConfigs.berduStaffIds`

**Files:**
- Modify: `convex/schema.ts` (csConfigs table, after `providerNumberIds` at ~line 67)
- Modify: `convex/ingest/berduAdapter.ts:16-23,34,48`
- Modify: `convex/ingest/core.ts:9-18,51-53`
- Modify: `convex/csConfigs.ts` (new mutation after `setProviderNumberIds`, ~line 173)
- Modify: `convex/cs.ts:7-11,22-25,31-45,51-59` (`listCs` passthrough)
- Modify: `convex/ingest/berduAdapter.test.ts` (all ~8 `parseBerduOrderDetail(` call sites)
- Modify: `convex/ingest/core.test.ts` (new attribution test)
- Create: `convex/csConfigs.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (independent of the phones work).
- Produces:
  - `parseBerduOrderDetail(orderInput: unknown, staffMap: Record<string, string>): BerduParseResult` (REQUIRED second param)
  - `DEFAULT_BERDU_STAFF_MAP: Record<string, string>` (exported from berduAdapter.ts)
  - `resolveBerduStaffMap(ctx: any): Promise<Record<string, string>>` (exported from core.ts)
  - public `csConfigs.setBerduStaffIds` mutation `{ csName: string, berduStaffIds: string[] }`
  - `cs.listCs` rows gain optional `berduStaffIds?: string[]`

- [ ] **Step 1: Schema — add the field**

In `convex/schema.ts` csConfigs table, directly under the `providerNumberIds` line:

```ts
    berduStaffIds: v.optional(v.array(v.string())), // Berdu staff id(s) owned by this CS (order attribution)
```

- [ ] **Step 2: Write the failing tests**

**`convex/ingest/berduAdapter.test.ts`** — update the import and every existing call to pass `DEFAULT_BERDU_STAFF_MAP`; add one custom-map test:

```ts
import { parseBerduOrderDetail, DEFAULT_BERDU_STAFF_MAP } from "./berduAdapter";
// every existing call:  parseBerduOrderDetail(X)  →  parseBerduOrderDetail(X, DEFAULT_BERDU_STAFF_MAP)

test("staff map is injected: a custom map wins over the default", () => {
  const r = parseBerduOrderDetail(ORDER, { [ORDER.assigned_to_staff]: "Tenant2CS" });
  expect(r.kind).toBe("lead");
  if (r.kind === "lead") expect(r.event.csName).toBe("Tenant2CS");
});
```

(Existing expectations — e.g. the `B-XXX` unknown-staff test yielding `Staff B-XXX` — stay valid because `DEFAULT_BERDU_STAFF_MAP` is the same map. Reference `ORDER` fixture already defined at the top of that file.)

**`convex/ingest/core.test.ts`** — add (reuse the file's existing captureEvent/processEvent helpers and raw-body style; copy the exact orderId expectation shape from the existing lead test at ~line 154):

```ts
test("lead.created attribution: csConfigs.berduStaffIds overrides the baked default map", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "sari", csName: "Sari",
      berduStaffIds: ["B-1apQSy"], // id that the DEFAULT map assigns to Aisyah
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607110001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234500999", firstName: "Budi", address: "Jl. X", district: "Y", city: "Z" },
    } }),
    signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607110001"));
    expect(order?.assignedCsName).toBe("Sari"); // registry won, not baked "Aisyah"
  });
});
```

**`convex/csConfigs.test.ts`** (new file):

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("setBerduStaffIds: patches a stored config; errors when no stored row", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "aisyah", csName: "Aisyah",
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const r = await asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "Aisyah", berduStaffIds: ["B-1apQSy"] });
  expect(r.success).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique();
    expect(row?.berduStaffIds).toEqual(["B-1apQSy"]);
  });
  await expect(
    asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "GhostCS", berduStaffIds: ["B-1"] }),
  ).rejects.toThrow(/csConfig not found/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/berduAdapter.test.ts convex/ingest/core.test.ts convex/csConfigs.test.ts`
Expected: FAIL (missing param / missing exports / missing mutation).

- [ ] **Step 4: Implement**

**`convex/ingest/berduAdapter.ts`** — replace lines 16-23 (comment + `BERDU_STAFF_MAP`) with:

```ts
// Tenant #1's inherited glue, now the FALLBACK only: the live map is built from
// csConfigs.berduStaffIds (see resolveBerduStaffMap in core.ts). Used verbatim when
// no csConfig row carries staff ids yet (fresh env / pre-seed transition).
export const DEFAULT_BERDU_STAFF_MAP: Record<string, string> = {
  "B-1apQSy": "Aisyah",
  "B-1CxSmL": "Risma",
  "B-Z28TdYc": "Azelia",
  "B-NCIXt": "Lila",
  "B-ZDfQE9": "Nabila",
};
```

Line 34 signature:

```ts
export function parseBerduOrderDetail(orderInput: unknown, staffMap: Record<string, string>): BerduParseResult {
```

Line 48 usage:

```ts
      csName: staffMap[staff] || `Staff ${staff || "?"}`,
```

**`convex/ingest/core.ts`** — update the import (line 6) and add the resolver below `resolveCsByPhoneNumberId` (line 18):

```ts
import { parseBerduOrderDetail, DEFAULT_BERDU_STAFF_MAP } from "./berduAdapter";
```

```ts
// Build the Berdu staffId -> CS-name map from the csConfigs registry; fall back to
// the baked tenant-#1 map while no config row carries berduStaffIds (pre-seed).
export async function resolveBerduStaffMap(ctx: any): Promise<Record<string, string>> {
  const configs = await ctx.db.query("csConfigs").collect(); // small table (~5 rows)
  const map: Record<string, string> = {};
  for (const c of configs) for (const id of c.berduStaffIds ?? []) map[id] = c.csName;
  return Object.keys(map).length > 0 ? map : DEFAULT_BERDU_STAFF_MAP;
}
```

`lead.created` branch (lines 51-52):

```ts
  if (event.kind === "lead.created") {
    const staffMap = await resolveBerduStaffMap(ctx);
    const parsed = parseBerduOrderDetail((body as any).order ?? body, staffMap);
```

**`convex/csConfigs.ts`** — add after `setProviderNumberIds` (ends line 173), same shape:

```ts
// Map a CS to their Berdu staff id(s) so order attribution reads the registry
// instead of the baked DEFAULT_BERDU_STAFF_MAP. Patches only berduStaffIds.
export const setBerduStaffIds = mutation({
  args: { csName: v.string(), berduStaffIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "csConfigs.setBerduStaffIds");
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName))
      .unique();
    if (!existing) throw new Error(`csConfig not found: ${args.csName}`);
    await ctx.db.patch(existing._id, { berduStaffIds: args.berduStaffIds, updatedAt: Date.now() });
    return { success: true, csName: args.csName, berduStaffIds: args.berduStaffIds };
  },
});
```

**`convex/cs.ts`** — thread `berduStaffIds` through `listCs` (stored rows only; built-in defaults have none):
- `CsRow` type (lines 7-11): add `berduStaffIds?: string[];`
- `Entry` type (lines 22-25): add `berduStaffIds?: string[];`
- stored-configs loop (lines 41-45): add `berduStaffIds: c.berduStaffIds,`
- final `rows.push` (lines 51-59): add `berduStaffIds: e.berduStaffIds,`

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run`
Expected: tsc clean (it will have forced any missed `parseBerduOrderDetail` caller); suite green except the pre-existing failure.

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/ingest/berduAdapter.ts convex/ingest/berduAdapter.test.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/csConfigs.ts convex/csConfigs.test.ts convex/cs.ts convex/_generated
git commit -m "feat(orgSettings): Berdu staff map reads csConfigs.berduStaffIds with baked fallback"
```

---

### Task 4: Settings UI — Organisasi section + Berdu Staff IDs per CS

**Files:**
- Modify: `components/panel/settings-dashboard.tsx` (add `OrgSection` + `BerduStaffIdsField` components before `TeamSection` at line 26; render `<OrgSection />` above `<TeamSection />` at line 223; add the staff-ids field in the CS card after the Phone block ending ~line 307)

**Interfaces:**
- Consumes: `api.orgSettings.get` / `api.orgSettings.update` (Task 1), `api.csConfigs.setBerduStaffIds` + `listCs.berduStaffIds` (Task 3).
- Produces: UI only — nothing downstream.

- [ ] **Step 1: Add the two components** (insert above `function TeamSection()` at line 26):

```tsx
function OrgSection() {
  const org = useQuery(api.orgSettings.get, {});
  const update = useMutation(api.orgSettings.update);
  const [name, setName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (org) setName(org.orgName); }, [org]);

  async function save(patch: { orgName?: string; internalPhones?: string[] }) {
    setBusy(true); setErr(null);
    try { await update(patch); } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menyimpan'); }
    setBusy(false);
  }

  if (!org) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Organisasi</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {err && <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{err}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <input className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nama organisasi" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={busy || !name.trim() || name.trim() === org.orgName} onClick={() => save({ orgName: name.trim() })}>Simpan nama</Button>
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <div className="text-sm font-medium text-foreground">Nomor internal (dikecualikan dari metrik)</div>
          <p className="text-xs text-muted-foreground">Nomor owner/admin/line CS — order & closing dari nomor ini tidak dihitung leads/omzet.</p>
          <div className="flex flex-wrap gap-1.5">
            {org.internalPhones.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-xs">
                {p}
                <button className="text-muted-foreground hover:text-destructive" disabled={busy} aria-label={`Hapus ${p}`}
                  onClick={() => { if (confirm(`Hapus ${p} dari daftar internal? Nomor ini akan mulai DIHITUNG di metrik.`)) save({ internalPhones: org.internalPhones.filter((x) => x !== p) }); }}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" placeholder="08xxx / 62xxx" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || !newPhone.trim()} onClick={async () => { await save({ internalPhones: [...org.internalPhones, newPhone.trim()] }); setNewPhone(''); }}>Tambah</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BerduStaffIdsField({ csName, initial, disabled }: { csName: string; initial: string[]; disabled: boolean }) {
  const setIds = useMutation(api.csConfigs.setBerduStaffIds);
  const [value, setValue] = useState(initial.join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(initial.join(', ')); }, [initial]);
  const parsed = value.split(',').map((s) => s.trim()).filter(Boolean);
  const dirty = parsed.join(',') !== initial.join(',');
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">Berdu Staff ID</div>
      <div className="mt-1 flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs" placeholder="B-xxxxx, B-yyyyy" value={value} disabled={disabled || busy} onChange={(e) => setValue(e.target.value)} />
        {dirty && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={disabled || busy}
            onClick={async () => { setBusy(true); try { await setIds({ csName, berduStaffIds: parsed }); } catch (e) { alert(e instanceof Error ? e.message : 'Gagal'); setValue(initial.join(', ')); } setBusy(false); }}>
            Simpan
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render both**

In the admin branch (lines 221-223), render `<OrgSection />` directly above `<TeamSection />`:

```tsx
      {me?.role !== 'admin' ? null : (
        <>
          <OrgSection />
          <TeamSection />
```

In the CS card, insert directly after the Phone read-only block's closing `)}` (~line 307):

```tsx
              <BerduStaffIdsField csName={c.csName} initial={c.berduStaffIds ?? []} disabled={busy === c.csName} />
```

(`c` comes from `api.cs.listCs`, which returns `berduStaffIds` after Task 3. Note: saving for a CS that exists only as a built-in default (no stored csConfigs row) alerts "csConfig not found" — expected behavior, mirrors `setProviderNumberIds`; all 5 real CS have stored rows.)

- [ ] **Step 3: Build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0, no type errors.

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add components/panel/settings-dashboard.tsx
git commit -m "feat(orgSettings): Settings UI — Organisasi section + Berdu staff-id per CS"
```

---

### Task 5: CONTROLLER GATE — deploy, seed, verify, ledger (not a subagent task)

- [ ] **Step 1: Full gates**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
npm run build && npx tsc --noEmit -p convex && npx vitest run
```
Expected: build EXIT 0, tsc clean, suite green except the 1 pre-existing followUp failure.

- [ ] **Step 2: Deploy**

```bash
npx convex deploy -y
```
Behavior is unchanged at this instant (orgSettings table empty → fallbacks active).

- [ ] **Step 3: Seed prod**

```bash
node _admin.mjs mutation orgSettings:seedDefault '{}'
node _admin.mjs mutation csConfigs:setBerduStaffIds '{"csName":"Aisyah","berduStaffIds":["B-1apQSy"]}'
node _admin.mjs mutation csConfigs:setBerduStaffIds '{"csName":"Risma","berduStaffIds":["B-1CxSmL"]}'
node _admin.mjs mutation csConfigs:setBerduStaffIds '{"csName":"Azelia","berduStaffIds":["B-Z28TdYc"]}'
node _admin.mjs mutation csConfigs:setBerduStaffIds '{"csName":"Lila","berduStaffIds":["B-NCIXt"]}'
node _admin.mjs mutation csConfigs:setBerduStaffIds '{"csName":"Nabila","berduStaffIds":["B-ZDfQE9"]}'
node _admin.mjs query orgSettings:get '{}'   # confirm row exists with 9 phones + "Pustaka Islam"
```

- [ ] **Step 4: Verify (all three, in order)**

1. Parity: run `node _admin.mjs query rollups:debugRollupParity '{"windowKey":"YYYY-MM-DD"}'` for today's windowKey and the two prior days → expect `mismatches: []` on all three (seeded set == old hardcode → zero metric shift).
2. Attribution: wait for the next live Berdu `lead.created` (or replay one via `ingest.core.replayEvent`); confirm the stored order's `assignedCsName` is a real CS name (registry path, not `Staff B-…`). Inspect via `node _admin.mjs query ingest/events:listRecent '{"limit":5}'`.
3. Settings UI spot-check (Fandy): Organisasi section shows "Pustaka Islam" + 9 phones; optionally add then remove a dummy phone and confirm both writes stick.

- [ ] **Step 5: Update `docs/SAAS-BLUEPRINT.md` §14**

Mark as PAID (with date + mechanism):
- "Nomor internal/test `EXCLUDED_PHONES` hardcoded" → LUNAS 2026-07-11: `orgSettings.internalPhones` (fallback in-code untuk dev/test).
- "`BERDU_STAFF_MAP` (staff Berdu → nama CS) hardcoded" → LUNAS 2026-07-11: `csConfigs.berduStaffIds` + `resolveBerduStaffMap` (fallback baked map).
- Add a note that org identity is now anchored: `orgSettings.key="default"` + `orgName` (Fase B turns this into per-org rows).
- Annotate the three deferrals per spec §6 (cutoff/timezone → Fase B with rollup re-key; source keys → Fase B; PRODUCT_ALIASES → deliberate, byProduct drift risk).

- [ ] **Step 6: Commit + push (push needs Fandy's explicit OK)**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add docs/SAAS-BLUEPRINT.md
git commit -m "docs: SAAS-BLUEPRINT §14 — internal phones + Berdu staff map + org identity paid (Fase A)"
# git push origin main   ← ONLY after explicit user approval, per repo discipline
```
