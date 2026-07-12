# Fase B2a Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CS identity becomes a registry (`csConfigs.key` canonical + `nameAliases`) with ONE resolver used at every write entry point, making any rename safe (key immutable) and killing the phantom-CS fragmentation class — with byte-identical behavior for the current 5 CS.

**Architecture:** No re-key of data: rows keep carrying the canonical `csKey` string; the fix is WRITE-TIME. A single `resolveAgent` (id→agent) + `canonicalizeCs` (rawName→{csName,key}) helper pair in `convex/agents.ts` is called at every site that stamps `csName`/`csKey` on a row. Resolver miss → exact legacy behavior (store raw + `csKey(raw)`) which doubles as new-CS discovery. `csConfigs` IS the agents table (not renamed).

**Tech Stack:** Convex 1.39, Next.js 14, vitest + convex-test, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-12-fase-b2a-agents-design.md`

**Design refinement vs spec §2.3 (same goal, less churn):** instead of threading a `csKeyResolved` param through the cores, every stamp site calls `canonicalizeCs(ctx, name)` directly. Rationale discovered while pinning code: the closing-recap path never receives a csName (it resolves from order/conversation internally), so param-threading would miss it; a uniform stamp-site helper covers every path including post-rename (`resolveAgent` matches the CURRENT `csName` → returns the old immutable key). Cost: ~1k extra small collects/day ≈ $0.02/month. `berduAdapter.ts` and `DEFAULT_BERDU_STAFF_MAP` stay untouched.

## Global Constraints

- Branch: `fase-b2a-agents` off main. Working dir: ALWAYS prefix `cd /f/Projects/whatsapp_cs_automotion/wafachat` (shell cwd resets).
- `git add` SPECIFIC files only, NEVER `-A`. New commits only. `convex/_generated/` IS tracked (commit when regenerated; `npx convex codegen` if api types stale).
- vitest does NOT typecheck — `npx tsc --noEmit -p convex` before claiming any task done.
- Baseline: 259 tests, 258 pass + **1 PRE-EXISTING failure** (`convex/followUp.test.ts` › "getArchivedFollowUps: lists recent manual archives, scoped by CS") — never touch it. "Suite green" = no NEW failures.
- Post-B1 test convention: every test file has a local `seedOrg(t)` helper and every raw insert carries `orgId` (schema-required). New tests MUST follow it.
- Auth ENFORCED: public fns `requireAdmin`/`requireMember`; test identity `t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" })`.
- Deploy/seed = CONTROLLER at the final gate: `npm run build` + `npx tsc --noEmit -p convex` + `npx vitest run` + `npx convex deploy -y`; admin calls via `node _admin.mjs`.
- Behavior invariant: for the current 5 CS the resolver returns exactly what legacy normalization produced (key == csKey(csName); ingest paths already emit canonical names) → all outputs byte-identical; `debugRollupParity` 0.
- Line numbers cited are from 2026-07-12 greps — they drift; re-grep the symbol when implementing.

---

## File Structure

| File | Role |
|---|---|
| `convex/schema.ts` | csConfigs +`key`, +`nameAliases`, +index `by_org_key` |
| `convex/agents.ts` (NEW) | `resolveAgent`, `canonicalizeCs`, `seedKeys`, `setNameAliases` |
| `convex/agents.test.ts` (NEW) | resolver unit tests + rename-safety |
| `convex/ingest/core.ts` | message branch uses `resolveAgent({phoneNumberId})`; `resolveCsByPhoneNumberId` becomes deprecated thin wrapper |
| `convex/state.ts` | `upsertOrderCore` + `createTestConversation` stamp via `canonicalizeCs` |
| `convex/messages.ts` | response-sample site stamps via `canonicalizeCs` |
| `convex/shippingRecaps.ts` | both recap payload sites + `importBerduVerifiedRows` + `backfillCsNameByOrderIds` via `canonicalizeCs` |
| `convex/csConfigs.ts` | `renameCs` key-immutable + alias push |
| `convex/cs.ts` + `components/panel/settings-dashboard.tsx` | listCs threads registryKey/aliases; Settings badge + aliases field |
| `docs/SAAS-BLUEPRINT.md` | §14 update (GATE) |

---

### Task 1: schema + `convex/agents.ts` (resolver core) + tests

**Files:**
- Modify: `convex/schema.ts` (csConfigs table)
- Create: `convex/agents.ts`
- Create: `convex/agents.test.ts`

**Interfaces:**
- Consumes: `csKey`, `normalizeCsName` (./lib), `requireAdmin` (./authz).
- Produces (later tasks rely on EXACT names):
  - `resolveAgent(ctx: { db: any }, q: { name?: string; berduStaffId?: string; phoneNumberId?: string }): Promise<{ key: string; csName: string; agentId: Id<"csConfigs"> } | null>`
  - `canonicalizeCs(ctx: { db: any }, rawName: string | undefined): Promise<{ csName: string; key: string }>` (never null — falls back to `{ csName: raw, key: csKey(raw) }`)
  - public `agents.seedKeys` (mutation, admin, idempotent) → `{ seeded: number }`
  - public `agents.setNameAliases` (mutation, admin) `{ csName, nameAliases: string[] }`

- [ ] **Step 1: Schema** — in the `csConfigs` table (convex/schema.ts, after `berduStaffIds`):

```ts
    key: v.optional(v.string()),          // canonical per-org identity key (= csKey(csName) at creation; IMMUTABLE across renames)
    nameAliases: v.optional(v.array(v.string())), // raw name forms that resolve to this agent (e.g. "CS Aisyah", pre-rename names)
```

and add to its index list:

```ts
    .index("by_org_key", ["orgId", "key"])
```

- [ ] **Step 2: Failing tests — `convex/agents.test.ts`**

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { resolveAgent, canonicalizeCs } from "./agents";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

async function seedAgent(t: any, orgId: any, over: Record<string, unknown> = {}) {
  return t.run((ctx: any) => ctx.db.insert("csConfigs", {
    orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah",
    nameAliases: ["CS Aisyah"], berduStaffIds: ["B-1apQSy"],
    providerNumberIds: ["1197250776802755"],
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
    isActive: true, createdAt: 1, updatedAt: 1, ...over,
  }));
}

test("resolveAgent: matches by phoneNumberId, berduStaffId, current csName, alias, csKey — with priority", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const agentId = await seedAgent(t, orgId);
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, { phoneNumberId: "1197250776802755" }))?.key).toBe("aisyah");
    expect((await resolveAgent(ctx, { berduStaffId: "B-1apQSy" }))?.csName).toBe("Aisyah");
    expect((await resolveAgent(ctx, { name: "Aisyah" }))?.key).toBe("aisyah");        // current csName
    expect((await resolveAgent(ctx, { name: "  cs aisyah " }))?.key).toBe("aisyah");  // alias, case/trim-insensitive
    expect((await resolveAgent(ctx, { name: "CS AISYAH" }))?.key).toBe("aisyah");     // csKey(name)==key
    expect((await resolveAgent(ctx, { name: "Aisyah" }))?.agentId).toEqual(agentId);
    expect(await resolveAgent(ctx, { name: "Bambang" })).toBeNull();                  // miss = discovery
    expect(await resolveAgent(ctx, {})).toBeNull();
  });
});

test("resolveAgent: post-rename, the CURRENT csName returns the OLD immutable key", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  // renamed agent: display "Ayesha", key stays "aisyah", old name kept as alias
  await seedAgent(t, orgId, { csName: "Ayesha", nameAliases: ["Aisyah"], normalizedName: "ayesha" });
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, { name: "Ayesha" }))?.key).toBe("aisyah");  // csName-match (csKey("Ayesha") != "aisyah"!)
    expect((await resolveAgent(ctx, { name: "Aisyah" }))?.key).toBe("aisyah");  // old name via alias
  });
});

test("resolveAgent: row without key falls back to csKey(csName) matching", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { key: undefined, nameAliases: undefined });
  await t.run(async (ctx: any) => {
    const hit = await resolveAgent(ctx, { name: "CS Aisyah" }); // csKey("CS Aisyah")=="aisyah"==csKey(csName)
    expect(hit?.key).toBe("aisyah");
    expect(hit?.csName).toBe("Aisyah");
  });
});

test("canonicalizeCs: hit returns registry canonical form; miss falls back to raw+csKey(raw); empty tolerated", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId);
  await t.run(async (ctx: any) => {
    expect(await canonicalizeCs(ctx, "cs aisyah")).toEqual({ csName: "Aisyah", key: "aisyah" });
    expect(await canonicalizeCs(ctx, "Bambang")).toEqual({ csName: "Bambang", key: "bambang" });
    expect(await canonicalizeCs(ctx, "")).toEqual({ csName: "", key: "" });
    expect(await canonicalizeCs(ctx, undefined)).toEqual({ csName: "", key: "" });
  });
});

test("seedKeys: idempotent — stamps key=csKey(csName) + nameAliases=[] only where missing", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { key: undefined, nameAliases: undefined });
  await seedAgent(t, orgId, { csName: "Risma", normalizedName: "risma", key: "risma", nameAliases: [], berduStaffIds: ["B-1CxSmL"], providerNumberIds: ["433364286526515"] });
  const asAdmin = t.withIdentity(ADMIN);
  const r1 = await asAdmin.mutation(api.agents.seedKeys, {});
  expect(r1.seeded).toBe(1);
  const r2 = await asAdmin.mutation(api.agents.seedKeys, {});
  expect(r2.seeded).toBe(0);
  await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("csConfigs").collect();
    for (const row of rows) { expect(row.key).toBeDefined(); expect(row.nameAliases).toBeDefined(); }
  });
});

test("setNameAliases: patches a stored config; errors when no stored row", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId);
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.agents.setNameAliases, { csName: "Aisyah", nameAliases: ["CS Aisyah", "Kak Aisyah"] });
  expect(r.success).toBe(true);
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", "aisyah")).unique();
    expect(row?.nameAliases).toEqual(["CS Aisyah", "Kak Aisyah"]);
  });
  await expect(asAdmin.mutation(api.agents.setNameAliases, { csName: "Ghost", nameAliases: [] })).rejects.toThrow(/csConfig not found/);
});
```

- [ ] **Step 3: Verify fail** — `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/agents.test.ts` → FAIL (`Cannot find module './agents'`).

- [ ] **Step 4: Implement `convex/agents.ts`**

```ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import { csKey, normalizeCsName } from "./lib";

// ─── Fase B2a: agents = the csConfigs registry, addressed through ONE resolver. ───
// Identity = the canonical per-org `key` (immutable across renames). Data rows keep
// carrying csKey strings; this module guarantees every WRITE stamps the canonical
// form, which kills phantom-CS fragmentation at the source. A resolver MISS returns
// null and callers fall back to legacy raw+csKey(raw) behavior — that is deliberate:
// unknown staff surface on the panel as-is (discovery), never silently swallowed.

export type ResolvedAgent = { key: string; csName: string; agentId: Id<"csConfigs"> };

const normName = (s: string) => s.trim().toLowerCase();

export async function resolveAgent(
  ctx: { db: any },
  q: { name?: string; berduStaffId?: string; phoneNumberId?: string },
): Promise<ResolvedAgent | null> {
  if (!q.name && !q.berduStaffId && !q.phoneNumberId) return null;
  const rows = await ctx.db.query("csConfigs").collect(); // small registry (~6 rows)
  const keyOf = (r: any): string => r.key ?? csKey(r.csName); // pre-seed fallback
  // 1) provider phone_number_id (KirimDev message attribution)
  if (q.phoneNumberId) {
    const hit = rows.find((r: any) => r.providerNumberId === q.phoneNumberId || (r.providerNumberIds ?? []).includes(q.phoneNumberId));
    if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
  }
  // 2) Berdu staff id (order attribution)
  if (q.berduStaffId) {
    const hit = rows.find((r: any) => (r.berduStaffIds ?? []).includes(q.berduStaffId));
    if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
  }
  // 3) raw name form: current csName (REQUIRED for post-rename: csKey(newName) != key,
  //    only this match returns the old immutable key) > explicit alias > csKey match.
  if (q.name) {
    const n = normName(q.name);
    if (n.length > 0) {
      const hit =
        rows.find((r: any) => normName(r.csName) === n) ??
        rows.find((r: any) => (r.nameAliases ?? []).some((a: string) => normName(a) === n)) ??
        rows.find((r: any) => csKey(q.name!) === keyOf(r));
      if (hit) return { key: keyOf(hit), csName: hit.csName, agentId: hit._id };
    }
  }
  return null;
}

/** Stamp-site helper: canonical {csName,key} for a raw name; never null. */
export async function canonicalizeCs(
  ctx: { db: any },
  rawName: string | undefined,
): Promise<{ csName: string; key: string }> {
  const raw = rawName ?? "";
  const hit = raw.trim() ? await resolveAgent(ctx, { name: raw }) : null;
  return hit ? { csName: hit.csName, key: hit.key } : { csName: raw, key: csKey(raw) };
}

// Idempotent seeding: every registry row gets its immutable key (+empty aliases).
export const seedKeys = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "agents.seedKeys");
    const rows = await ctx.db.query("csConfigs").collect();
    let seeded = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (r.key === undefined) patch.key = csKey(r.csName);
      if (r.nameAliases === undefined) patch.nameAliases = [];
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(r._id, { ...patch, updatedAt: Date.now() });
        seeded++;
      }
    }
    return { seeded };
  },
});

// Admin: manage the raw name forms that resolve to this agent (Settings UI).
export const setNameAliases = mutation({
  args: { csName: v.string(), nameAliases: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "agents.setNameAliases");
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizeCsName(args.csName)))
      .unique();
    if (!existing) throw new Error(`csConfig not found: ${args.csName}`);
    const nameAliases = Array.from(new Set(args.nameAliases.map((a) => a.trim()).filter(Boolean)));
    await ctx.db.patch(existing._id, { nameAliases, updatedAt: Date.now() });
    return { success: true, csName: args.csName, nameAliases };
  },
});
```

- [ ] **Step 5: Verify pass** — `npx vitest run convex/agents.test.ts && npx tsc --noEmit -p convex` → all pass + clean (`npx convex codegen` if `api.agents` missing). Then `npx vitest run` full → green except known.

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/agents.ts convex/agents.test.ts convex/_generated
git commit -m "feat(agents): registry key/nameAliases on csConfigs + resolveAgent/canonicalizeCs resolver core"
```

---

### Task 2: stamp sites — cores + sample pairing + ingest message-path

**Files:**
- Modify: `convex/state.ts` (`upsertOrderCore` — orders stamp; re-grep `assignedCsName` + `csKey(` inside it)
- Modify: `convex/messages.ts` (sample site ~line 219-220)
- Modify: `convex/shippingRecaps.ts` (auto payload site ~366-380 AND manual payload site ~466-475)
- Modify: `convex/ingest/core.ts` (message branch + deprecate `resolveCsByPhoneNumberId`)
- Test: `convex/ingest/core.test.ts` (+1 rename-safety end-to-end), `convex/state.test.ts` (+1 canonical stamp)

**Interfaces:**
- Consumes: `resolveAgent`, `canonicalizeCs` (Task 1; import from `./agents` or `../agents`).
- Produces: no new exports — stamp behavior only.

- [ ] **Step 1: Failing tests**

In `convex/ingest/core.test.ts` (reuse the file's helpers/imports; seeds must carry orgId):

```ts
test("rename-safety: after display rename, new orders keep the OLD immutable key", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "ayesha", csName: "Ayesha", key: "aisyah", // renamed: display new, key old
      nameAliases: ["Aisyah"], berduStaffIds: ["B-1apQSy"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607129001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234501111", firstName: "T", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx: any) => {
    const order = (await ctx.db.query("orders").collect()).find((o: any) => o.orderId.includes("2607129001"));
    expect(order?.assignedCsName).toBe("Ayesha"); // display = current name (via registry staff map)
    expect(order?.csKey).toBe("aisyah");          // identity = OLD key (canonicalizeCs csName-match)
  });
});
```

In `convex/state.test.ts` (alongside an existing upsertOrderCore-path test): seed a registry row for Aisyah (key "aisyah", alias "CS Aisyah"), create an order through the core path with csName `"CS Aisyah"`, assert the stored order has `assignedCsName === "Aisyah"` and `csKey === "aisyah"`.

- [ ] **Step 2: Verify fail** — `npx vitest run convex/ingest/core.test.ts convex/state.test.ts` → the new tests FAIL (csKey derived from new name / raw name stored).

- [ ] **Step 3: Implement the stamp sites**

**`convex/state.ts` `upsertOrderCore`** — at the top of the function add:

```ts
  const canon = await canonicalizeCs(ctx, args.csName);
```

then wherever it stamps CS identity on inserts/patches inside this function (re-grep: `assignedCsName:` and `csKey:` sites for orders + the conversation's `assignedCsName`): use `canon.csName` instead of `args.csName` and `canon.key` instead of `csKey(args.csName)`. (Import `canonicalizeCs` from `./agents`.)

**`convex/messages.ts`** sample site (~219): replace

```ts
    const csName = conversation.assignedCsName ?? args.csName ?? "Unknown";
    const csKeyValue = csKey(csName);
```

with

```ts
    const rawCsName = conversation.assignedCsName ?? args.csName ?? "Unknown";
    const canon = await canonicalizeCs(ctx, rawCsName);
    const csName = canon.csName;
    const csKeyValue = canon.key;
```

**`convex/shippingRecaps.ts`** BOTH payload sites (auto ~366-380, manual ~466-475): replace the pair

```ts
    const resolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    ...
      csName: resolvedCsName,
      csKey: csKey(resolvedCsName),
```

with

```ts
    const rawResolvedCsName = args.csName || order?.assignedCsName || conversation?.assignedCsName || "";
    const canonCs = await canonicalizeCs(ctx, rawResolvedCsName);
    const resolvedCsName = canonCs.csName;
    ...
      csName: resolvedCsName,
      csKey: canonCs.key,
```

(Every OTHER use of `resolvedCsName` in those functions — flags/NO_CS_DATA checks — keeps reading the same variable, now canonical.)

**`convex/ingest/core.ts`** message branch: replace `const csName = await resolveCsByPhoneNumberId(ctx, parsed.event.phoneNumberId);` with

```ts
    const agent = await resolveAgent(ctx, { phoneNumberId: parsed.event.phoneNumberId });
    const csName = agent?.csName;
```

and turn `resolveCsByPhoneNumberId` into a deprecated thin wrapper (grep its other callers first; keep behavior for any):

```ts
/** @deprecated B2a — use resolveAgent({ phoneNumberId }) from ../agents. */
export async function resolveCsByPhoneNumberId(ctx: any, phoneNumberId: string | undefined) {
  if (!phoneNumberId) return undefined;
  return (await resolveAgent(ctx, { phoneNumberId }))?.csName;
}
```

(`resolveBerduStaffMap` stays AS-IS — its map already carries the registry's current csName, and `upsertOrderCore`'s `canonicalizeCs` turns that name into the immutable key.)

- [ ] **Step 4: Gates** — `npx tsc --noEmit -p convex && npx vitest run` → clean + green except known (existing tests prove byte-identity: canonical forms == legacy forms for the 5 CS).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/state.ts convex/messages.ts convex/shippingRecaps.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/state.test.ts
git commit -m "feat(agents): all core stamp sites canonicalize csName/csKey via the registry resolver"
```

---

### Task 3: raw-name entries + rename-safe `renameCs`

**Files:**
- Modify: `convex/shippingRecaps.ts` (`importBerduVerifiedRows` payload ~1148-1154; `backfillCsNameByOrderIds` ~1475+)
- Modify: `convex/state.ts` (`createTestConversation` csName site ~368)
- Modify: `convex/csConfigs.ts` (`renameCs` ~197)
- Test: `convex/csConfigs.test.ts` (+2 rename tests), `convex/shippingRecaps.test.ts` (+1 import canonicalization)

**Interfaces:** Consumes `canonicalizeCs`, `csKey`. Produces: rename semantics (key immutable).

- [ ] **Step 1: Failing tests**

`convex/csConfigs.test.ts` (follow the file's existing seed pattern incl. orgId; add a `seedOrg` helper if the file lacks one):

```ts
test("renameCs: key is IMMUTABLE; old csName becomes an alias; display fields update", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.csConfigs.renameCs, { fromCsName: "Aisyah", toCsName: "Ayesha" });
  expect(r.ok).toBe(true);
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", "ayesha")).unique();
    expect(row?.csName).toBe("Ayesha");
    expect(row?.key).toBe("aisyah");                 // immutable
    expect(row?.nameAliases).toContain("Aisyah");    // old name preserved as alias
  });
});

test("renameCs backstop: row without key gets key=csKey(oldName) before renaming", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "risma", csName: "Risma", // NO key (pre-seed row)
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.csConfigs.renameCs, { fromCsName: "Risma", toCsName: "Rismawati" });
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q: any) => q.eq("normalizedName", "rismawati")).unique();
    expect(row?.key).toBe("risma"); // from the OLD name, not csKey("Rismawati")
  });
});
```

`convex/shippingRecaps.test.ts`: an `importBerduVerifiedRows` case where `row.csName = "cs aisyah"` (alias/case form) with a seeded registry row (key "aisyah", csName "Aisyah") → the stored recap has `csName === "Aisyah"` and `csKey === "aisyah"`.

- [ ] **Step 2: Verify fail** — `npx vitest run convex/csConfigs.test.ts convex/shippingRecaps.test.ts` → new tests FAIL.

- [ ] **Step 3: Implement**

**`csConfigs.ts` `renameCs`** — in the success path (after the clash check), replace the existing single patch with:

```ts
    const stableKey = stored.key ?? csKey(args.fromCsName); // backstop for pre-seed rows
    const aliases = Array.from(new Set([...(stored.nameAliases ?? []), stored.csName]
      .map((a: string) => a.trim()).filter((a: string) => a && a.toLowerCase() !== to.toLowerCase())));
    await ctx.db.patch(stored._id, {
      csName: to, normalizedName: toNorm, key: stableKey, nameAliases: aliases, updatedAt: Date.now(),
    });
```

(Import `csKey` from `./lib` if not already imported.)

**`shippingRecaps.ts` `importBerduVerifiedRows`** — inside the row loop, before building `payload`:

```ts
      const rawImportCsName = row.csName || order?.assignedCsName || conversation?.assignedCsName || "";
      const canonImport = await canonicalizeCs(ctx, rawImportCsName);
```

then in the payload: `csName: canonImport.csName,` and `csKey: canonImport.key,` (replacing the two lines at ~1153-1154).

**`shippingRecaps.ts` `backfillCsNameByOrderIds`** — resolve once before the loop:

```ts
    const canonBf = await canonicalizeCs(ctx, args.csName);
```

and the patch becomes `{ csName: canonBf.csName, csKey: canonBf.key, updatedAt: now }`.

**`state.ts` `createTestConversation`** — canonicalize `args.csName` once at the top (`const canonTest = await canonicalizeCs(ctx, args.csName);`) and use `canonTest.csName` at its csName sites (+ `canonTest.key` if a csKey is stamped there — re-grep).

- [ ] **Step 4: Gates** — `npx tsc --noEmit -p convex && npx vitest run` → clean + green except known.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/csConfigs.ts convex/csConfigs.test.ts convex/shippingRecaps.ts convex/shippingRecaps.test.ts convex/state.ts
git commit -m "feat(agents): raw-name entry points canonicalize via registry; renameCs keeps key immutable + aliases old name"
```

---

### Task 4: UI — key badge + name-aliases field; `listCs` threading

**Files:**
- Modify: `convex/cs.ts` (`listCs`)
- Modify: `components/panel/settings-dashboard.tsx`

**NOTE (naming collision):** `listCs` rows ALREADY have a `key` field (derived `csKey(csName)`, used as React key + avatar map). Do NOT overwrite it. Thread the registry values as **`registryKey?: string`** + `nameAliases?: string[]` (stored rows only). For seeded rows registryKey === key; after a rename they may differ — the badge shows `registryKey ?? key`.

**Interfaces:** Consumes `api.agents.setNameAliases` (Task 1). Produces UI only.

- [ ] **Step 1: `convex/cs.ts`** — add `registryKey?: string; nameAliases?: string[];` to the `CsRow` type + `Entry` type; in the stored-configs loop carry `registryKey: c.key, nameAliases: c.nameAliases,`; pass both through in the final `rows.push`.

- [ ] **Step 2: `components/panel/settings-dashboard.tsx`** — add below `BerduStaffIdsField` (mirroring it exactly):

```tsx
function NameAliasesField({ csName, initial, disabled }: { csName: string; initial: string[]; disabled: boolean }) {
  const setAliases = useMutation(api.agents.setNameAliases);
  const [value, setValue] = useState(initial.join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(initial.join(', ')); }, [initial]);
  const parsed = value.split(',').map((s) => s.trim()).filter(Boolean);
  const dirty = parsed.join(',') !== initial.join(',');
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">Alias nama (bentuk lain yang dikenali)</div>
      <div className="mt-1 flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs" placeholder="CS Aisyah, Kak Aisyah" value={value} disabled={disabled || busy} onChange={(e) => setValue(e.target.value)} />
        {dirty && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={disabled || busy}
            onClick={async () => { setBusy(true); try { await setAliases({ csName, nameAliases: parsed }); } catch (e) { alert(e instanceof Error ? e.message : 'Gagal'); setValue(initial.join(', ')); } setBusy(false); }}>
            Simpan
          </Button>
        )}
      </div>
    </div>
  );
}
```

Render inside the CS card directly under `BerduStaffIdsField`:

```tsx
              <NameAliasesField csName={c.csName} initial={c.nameAliases ?? []} disabled={busy === c.csName} />
```

And the key badge — in the card header under the `CardTitle` name:

```tsx
                  <span className="font-mono text-[10px] text-muted-foreground" title="Kunci identitas — tetap walau nama diganti">#{c.registryKey ?? c.key}</span>
```

- [ ] **Step 3: Gate** — `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build` → EXIT 0.

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/cs.ts components/panel/settings-dashboard.tsx
git commit -m "feat(agents): Settings shows immutable key badge + name-aliases editor per CS"
```

---

### GATE (CONTROLLER ONLY): deploy + seed + verify + ledger + merge + push

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → green except known.
- [ ] `npx convex deploy -y`.
- [ ] `node _admin.mjs mutation agents:seedKeys '{}'` → `{ seeded: 5 }` (or 6 with any extra row); re-run → `{ seeded: 0 }`.
- [ ] Verify live: next order + message attribute canonically (`ingest/events:listRecent` + `metrics:debugFindOrders` — same names as yesterday); `rollups:debugRollupParity` → 0 mismatches ×3 windows.
- [ ] Settings UI spot-check (Fandy): key badge `#aisyah` etc. visible; aliases editable.
- [ ] `docs/SAAS-BLUEPRINT.md` §14: row "CS = string nama + csKey" → ✅ LUNAS-B2a (registry key immutable + alias resolver at every write entry; conscious decisions recorded: rows carry canonical key not agentId — no re-key of 218k rows; csConfigs not renamed — cosmetic deferral). Note B2b remains (org-isolation: dedup-key scoping + reader org-filter + isolation tests).
- [ ] Commit ledger; merge ff → main; **push origin main ONLY after Fandy's explicit approval.**
