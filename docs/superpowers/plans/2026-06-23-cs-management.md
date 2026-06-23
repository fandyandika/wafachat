# CS Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A data-derived CS registry that powers a working CS filter everywhere and a Settings page where each CS gets a profile photo + feature toggles.

**Architecture:** A canonical CS key (strips the `CS ` prefix so `CS Aisyah` == `Aisyah`) underpins a new `cs.listCs` query (data ∪ config, with resolved avatar URLs). The header filter and Settings page consume it; every `csName`-aware query matches via the canonical key. Photos use Convex file storage referenced from `csConfigs.avatarStorageId`.

**Tech Stack:** Convex 1.39, Next.js 14 (App Router), vitest (edge-runtime) + convex-test, Tailwind v3 + shadcn (base-nova).

## Global Constraints

- Repo root: `f:\Projects\whatsapp_cs_automotion\wafachat`. cwd resets between shell calls → prefix every command with `cd /f/Projects/whatsapp_cs_automotion/wafachat &&`.
- Fact-Forcing Gate: before any Write/Edit/Bash, present facts + a verbatim quote of the user's current instruction.
- No emoji in UI — lucide icons only.
- Single light theme; reuse existing design system (cards, `MetricCard`, `CsAvatar`, CR colors).
- Convex deploy only from `main` after `npm run build` (EXIT 0) and `npx vitest run` are green.
- `normalizeCsName` (convex/lib.ts) is `s.toLowerCase().replace(/[^a-z]/g,"")` — do NOT change it (it keys `csConfigs`). Introduce a separate `csKey` instead.
- Internal-test phones excluded via `isInternalTestPhone` (convex/lib.ts).

---

### Task 1: Canonical CS key (`csKey`)

**Files:**
- Modify: `convex/lib.ts` (add `csKey` next to `normalizeCsName`, ~line 7)
- Test: `convex/lib.test.ts`

**Interfaces:**
- Produces: `export function csKey(name: string | undefined): string` — `normalizeCsName` then strip a leading `cs`. `csKey("CS Aisyah") === csKey("Aisyah") === "aisyah"`. Empty/undefined → `""`.

- [ ] **Step 1: Write the failing test** — append to `convex/lib.test.ts`:
```ts
import { csKey } from "./lib";

test("csKey collapses the 'CS ' prefix so config and data names match", () => {
  expect(csKey("CS Aisyah")).toBe("aisyah");
  expect(csKey("Aisyah")).toBe("aisyah");
  expect(csKey("CS Risma")).toBe("risma");
  expect(csKey("Risma")).toBe("risma");
  expect(csKey("Azelia")).toBe("azelia");
  expect(csKey(undefined)).toBe("");
  expect(csKey("")).toBe("");
  // does not over-strip a name that legitimately starts with "cs"
  expect(csKey("Cynthia Sari")).toBe("cynthiasari");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/lib.test.ts`
Expected: FAIL — `csKey is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `convex/lib.ts`, immediately after `normalizeCsName`:
```ts
// Canonical CS identity: collapses the "CS " prefix so config ("CS Aisyah")
// and data ("Aisyah") resolve to the same key. Only strips a leading "cs"
// when the remainder is non-empty (so "Cs"-only inputs keep a key).
export function csKey(name: string | undefined): string {
  const n = normalizeCsName(name ?? "");
  return n.startsWith("cs") && n.length > 2 ? n.slice(2) : n;
}
```
Note: `csKey("Cynthia Sari")` → `normalizeCsName` = `"cynthiasari"` → starts with `"cy"`, not `"cs"` → unchanged. ✓

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/lib.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/lib.ts convex/lib.test.ts && git commit -m "feat(cs): csKey canonical normalizer (strips CS prefix)"
```

---

### Task 2: Filter correctness — match by `csKey` everywhere + add `csName` to the two queries that ignore it

**Files:**
- Modify: `convex/metrics.ts` (`getDashboardSummary` csOk ~line 18; `getTrend`; `getDuplicateOrders`)
- Modify: `convex/responseTime.ts` (`getResponseTimes` filter)
- Modify: `convex/shippingRecaps.ts` (`getPerformance` csName filter)
- Modify: `convex/analytics.ts` (`computeCsAgg`, `getCsLeaderboard` add `csName`; `computeProductAgg`, `getProductDifficulty` add `csName`)
- Test: `convex/analytics.test.ts`

**Interfaces:**
- Consumes: `csKey` (Task 1).
- Produces: `getCsLeaderboard({ startAt, endAt, csName?: string })` and `getProductDifficulty({ startAt, endAt, minLeads?, csName?: string })`. All `csName`-aware queries match a record's CS via `csKey(record) === csKey(args.csName)`.

- [ ] **Step 1: Write the failing test** — append to `convex/analytics.test.ts` (mirror the `orders` insert shape already used in that file; include all schema-required fields):
```ts
test("getCsLeaderboard honors csName via csKey (CS Aisyah == Aisyah)", async () => {
  const t = convexTest(schema);
  const t0 = Date.parse("2026-06-22T10:00:00+07:00");
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O1", customerPhone: "62811", customerName: "A", productName: "Quran Mapping", assignedCsName: "Aisyah", createdAt: t0 });
    await ctx.db.insert("orders", { orderId: "O2", customerPhone: "62822", customerName: "B", productName: "Quran Mapping", assignedCsName: "Risma", createdAt: t0 });
  });
  const start = Date.parse("2026-06-22T00:00:00+07:00");
  const end = Date.parse("2026-06-23T00:00:00+07:00");
  const all = await t.query(api.analytics.getCsLeaderboard, { startAt: start, endAt: end });
  expect(all.length).toBe(2);
  const filtered = await t.query(api.analytics.getCsLeaderboard, { startAt: start, endAt: end, csName: "CS Aisyah" });
  expect(filtered.length).toBe(1);
  expect(filtered[0].csName).toBe("Aisyah");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/analytics.test.ts`
Expected: FAIL — `filtered.length` is 2 (csName ignored) or the arg is rejected.

- [ ] **Step 3: Implement** —

In `convex/analytics.ts` import `csKey`:
```ts
import { normalizePhone, isInternalTestPhone, csKey } from "./lib";
```
Change `computeCsAgg` to accept + apply a CS filter:
```ts
async function computeCsAgg(ctx: any, startAt: number, endAt: number, csName?: string): Promise<Map<string, CsAgg>> {
  const key = csName ? csKey(csName) : null;
  const orders = (
    await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone) && (!key || csKey(o.assignedCsName) === key));
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect()
  ).filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone) && (!key || csKey(r.csName) === key));
  // ... rest of computeCsAgg unchanged
}
```
Update `getCsLeaderboard`:
```ts
export const getCsLeaderboard = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const len = args.endAt - args.startAt;
    const cur = await computeCsAgg(ctx, args.startAt, args.endAt, args.csName);
    const prev = await computeCsAgg(ctx, args.startAt - len, args.startAt - 1, args.csName);
    // ... rest unchanged
  },
});
```
Update `computeProductAgg` + `getProductDifficulty` the same way:
```ts
async function computeProductAgg(ctx: any, startAt: number, endAt: number, csName?: string) {
  const key = csName ? csKey(csName) : null;
  const orders = (await ctx.db.query("orders").withIndex("by_createdAt", (q: any) => q.gte("createdAt", startAt).lte("createdAt", endAt)).collect())
    .filter((o: any) => !isInternalTestPhone(o.customerPhone) && (!key || csKey(o.assignedCsName) === key));
  const recaps = (await ctx.db.query("shippingRecaps").withIndex("by_closedAt", (q: any) => q.gte("closedAt", startAt).lte("closedAt", endAt)).collect())
    .filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export" && !isInternalTestPhone(r.customerPhone) && (!key || csKey(r.csName) === key));
  // ... rest of computeProductAgg unchanged
}
export const getProductDifficulty = query({
  args: { startAt: v.number(), endAt: v.number(), minLeads: v.optional(v.number()), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const minLeads = args.minLeads ?? 3;
    const len = args.endAt - args.startAt;
    const cr = (c: number, l: number) => (l > 0 ? Math.round((c / l) * 1000) / 10 : 0);
    const cur = await computeProductAgg(ctx, args.startAt, args.endAt, args.csName);
    const prev = await computeProductAgg(ctx, args.startAt - len, args.startAt - 1, args.csName);
    // ... rest unchanged
  },
});
```

In `convex/metrics.ts` — replace the raw equality with `csKey`. Import `csKey`, then change `getDashboardSummary`'s predicate:
```ts
const key = args.csName ? csKey(args.csName) : null;
const csOk = (cs: string | undefined) => !key || csKey(cs) === key;
```
Apply the same `csKey` predicate inside `getTrend` and `getDuplicateOrders` wherever they compare `assignedCsName`/`csName` to `args.csName`.

In `convex/responseTime.ts` and `convex/shippingRecaps.ts` (`getPerformance`): import `csKey` and change any `=== args.csName` / `=== csName` CS comparison to `csKey(record) === csKey(args.csName)` (guarded by `!args.csName`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/analytics.test.ts convex/metrics.test.ts`
Expected: PASS (new test + existing regression tests).

- [ ] **Step 5: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ && git commit -m "fix(cs): filter every query by csKey; add csName to leaderboard + product difficulty"
```

---

### Task 3: CS registry — `cs.listCs`

**Files:**
- Create: `convex/cs.ts`
- Test: `convex/cs.test.ts`

**Interfaces:**
- Consumes: `csKey` (Task 1), `csConfigs` table, `orders` (`by_createdAt`).
- Produces: `query api.cs.listCs({}) → Array<{ csName: string; normalizedName: string; key: string; avatarUrl: string | null; isActive: boolean; orderAutomationEnabled: boolean; aiAssistantEnabled: boolean; reportingEnabled: boolean; csPhone?: string }>`. Sorted by `csName`. Excludes internal-test phones and blank/Unknown CS.

> **Sequencing:** land Task 4's `avatarStorageId` schema field BEFORE this references `cfg.avatarStorageId`, OR temporarily read `(cfg as any)?.avatarStorageId` here and drop the cast in Task 4.

- [ ] **Step 1: Write the failing test** — `convex/cs.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const t0 = Date.now() - 86_400_000;

test("listCs unions data CS + config CS and dedupes via csKey", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orderId: "O1", customerPhone: "62811", customerName: "A", productName: "X", assignedCsName: "Aisyah", createdAt: t0 });
    await ctx.db.insert("orders", { orderId: "O2", customerPhone: "62822", customerName: "B", productName: "X", assignedCsName: "Risma", createdAt: t0 });
    await ctx.db.insert("csConfigs", {
      normalizedName: "csaisyah", csName: "CS Aisyah",
      orderAutomationEnabled: true, aiAssistantEnabled: true, reportingEnabled: true, isActive: true,
      createdAt: t0, updatedAt: t0,
    });
  });
  const rows = await t.query(api.cs.listCs, {});
  expect(rows.map((r) => r.key).sort()).toEqual(["aisyah", "risma"]);
  const aisyah = rows.find((r) => r.key === "aisyah")!;
  expect(aisyah.orderAutomationEnabled).toBe(true);
  expect(aisyah.avatarUrl).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/cs.test.ts`
Expected: FAIL — `api.cs` undefined / module missing.

- [ ] **Step 3: Implement** — `convex/cs.ts`:
```ts
import { query } from "./_generated/server";
import { csKey, normalizeCsName, isInternalTestPhone } from "./lib";

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

type CsRow = {
  csName: string; normalizedName: string; key: string; avatarUrl: string | null;
  isActive: boolean; orderAutomationEnabled: boolean; aiAssistantEnabled: boolean;
  reportingEnabled: boolean; csPhone?: string;
};

export const listCs = query({
  args: {},
  handler: async (ctx): Promise<CsRow[]> => {
    const since = Date.now() - NINETY_DAYS;
    const orders = await ctx.db.query("orders")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since)).collect();

    const dataName = new Map<string, string>(); // key -> first-seen display name
    for (const o of orders) {
      if (isInternalTestPhone(o.customerPhone)) continue;
      const raw = (o.assignedCsName ?? "").trim();
      const k = csKey(raw);
      if (!k || k === "unknown") continue;
      if (!dataName.has(k)) dataName.set(k, raw);
    }

    const configs = await ctx.db.query("csConfigs").collect();
    const configByKey = new Map(configs.map((c) => [csKey(c.csName), c]));
    const keys = new Set<string>([...dataName.keys(), ...configByKey.keys()].filter(Boolean));

    const rows: CsRow[] = [];
    for (const k of keys) {
      if (!k || k === "unknown") continue;
      const cfg = configByKey.get(k);
      const display = cfg?.csName ?? dataName.get(k) ?? k;
      const avatarUrl = cfg?.avatarStorageId ? await ctx.storage.getUrl(cfg.avatarStorageId) : null;
      rows.push({
        csName: display, normalizedName: normalizeCsName(display), key: k, avatarUrl,
        isActive: cfg?.isActive ?? true,
        orderAutomationEnabled: cfg?.orderAutomationEnabled ?? false,
        aiAssistantEnabled: cfg?.aiAssistantEnabled ?? false,
        reportingEnabled: cfg?.reportingEnabled ?? true,
        csPhone: cfg?.csPhone,
      });
    }
    rows.sort((a, b) => a.csName.localeCompare(b.csName));
    return rows;
  },
});
```
Run `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex codegen` so `api.cs` is registered.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/cs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/cs.ts convex/cs.test.ts convex/_generated && git commit -m "feat(cs): listCs registry (data union config, resolved avatars)"
```

---

### Task 4: Schema `avatarStorageId` + upload/setter mutations

**Files:**
- Modify: `convex/schema.ts` (`csConfigs` table, add `avatarStorageId`)
- Modify: `convex/cs.ts` (add `generateUploadUrl`, `setCsAvatar`)
- Test: `convex/cs.test.ts`

**Interfaces:**
- Produces:
  - `mutation api.cs.generateUploadUrl({}) → string`.
  - `mutation api.cs.setCsAvatar({ csName: string, storageId: Id<"_storage"> }) → { success: true }`. Upserts `csConfigs` by `normalizeCsName(csName)`, sets `avatarStorageId`, deletes any previous storage object.

- [ ] **Step 1: Write the failing test** — append to `convex/cs.test.ts`:
```ts
import { Id } from "./_generated/dataModel";

test("setCsAvatar stores avatarStorageId and replacing removes the old file", async () => {
  const t = convexTest(schema);
  const id1 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await t.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id1 as Id<"_storage"> });
  let cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id1);

  const id2 = await t.run(async (ctx) => await ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await t.mutation(api.cs.setCsAvatar, { csName: "Aisyah", storageId: id2 as Id<"_storage"> });
  cfg = await t.run(async (ctx) =>
    ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique());
  expect(cfg?.avatarStorageId).toBe(id2);
  expect(await t.run(async (ctx) => await ctx.storage.getUrl(id1 as Id<"_storage">))).toBeNull();
});
```
(`normalizeCsName("Aisyah")` = `"aisyah"`, so the config row key is `"aisyah"`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/cs.test.ts`
Expected: FAIL — `api.cs.setCsAvatar` undefined / `avatarStorageId` not in schema.

- [ ] **Step 3: Implement** —

`convex/schema.ts`, inside `csConfigs: defineTable({ ... })` add before `createdAt`:
```ts
    avatarStorageId: v.optional(v.id("_storage")),
```

`convex/cs.ts` — add imports `import { mutation } from "./_generated/server";`, `import { v } from "convex/values";` (and `normalizeCsName` is already imported). Append:
```ts
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setCsAvatar = mutation({
  args: { csName: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const normalizedName = normalizeCsName(args.csName);
    const now = Date.now();
    const existing = await ctx.db.query("csConfigs")
      .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).unique();
    if (existing) {
      if (existing.avatarStorageId && existing.avatarStorageId !== args.storageId) {
        await ctx.storage.delete(existing.avatarStorageId);
      }
      await ctx.db.patch(existing._id, { avatarStorageId: args.storageId, updatedAt: now });
    } else {
      await ctx.db.insert("csConfigs", {
        normalizedName, csName: args.csName, avatarStorageId: args.storageId,
        orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
        createdAt: now, updatedAt: now,
      });
    }
    return { success: true } as const;
  },
});
```
Drop any `(cfg as any)` cast added in Task 3. Run `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex codegen`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/cs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ && git commit -m "feat(cs): avatarStorageId + generateUploadUrl + setCsAvatar"
```

---

### Task 5: Header filter uses the registry

**Files:**
- Modify: `app/panel/layout.tsx` (CS `<Select>` source ~line 33 + options ~line 108)

**Interfaces:**
- Consumes: `api.cs.listCs` (Task 3).

- [ ] **Step 1: Implement** — in `app/panel/layout.tsx`, replace the config source:
```tsx
const csList = useQuery(api.cs.listCs, {}) ?? [];
```
(remove `const csConfigs = useQuery(api.csConfigs.list, {}) ?? [];`) and the options map:
```tsx
{csList.map((c) => (
  <SelectItem key={c.key} value={c.csName}>{c.csName.replace(/^CS\s+/i, '')}</SelectItem>
))}
```

- [ ] **Step 2: Verify build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build`
Expected: EXIT 0. Manual: the dropdown lists every CS in the data.

- [ ] **Step 3: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/panel/layout.tsx && git commit -m "feat(cs): header CS filter lists all CS from registry"
```

---

### Task 6: Settings page + photo upload + avatar wiring

**Files:**
- Create: `lib/cs-key.ts` (client `csKey` mirror), `lib/resize-image.ts`, `components/panel/settings-dashboard.tsx`, `app/panel/settings/page.tsx`
- Modify: `app/panel/layout.tsx` (`NAV` + import `Settings` icon)
- Modify: `app/panel/page.tsx`, `components/panel/daily-report-dashboard.tsx`, `app/panel/performance/page.tsx`, `components/panel/performance-panel.tsx` (+ `report-card.tsx` if it renders avatars) — thread `src` into `CsAvatar` from a `key→avatarUrl` map
- Reuse: `components/ui/switch.tsx` (exists), `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/cs-avatar.tsx`

**Interfaces:**
- Consumes: `api.cs.listCs`, `api.cs.generateUploadUrl`, `api.cs.setCsAvatar`, `api.csConfigs.upsert`, `CsAvatar` (`src` prop exists), `csKey`.

- [ ] **Step 1: Client `csKey` mirror** — `lib/cs-key.ts` (keep in sync with `convex/lib.ts` `csKey`):
```ts
// MUST mirror convex/lib.ts csKey(). Used client-side to map a CS display
// name to the registry key for avatar lookups.
export function csKey(name: string | undefined): string {
  const n = (name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return n.startsWith("cs") && n.length > 2 ? n.slice(2) : n;
}
```

- [ ] **Step 2: Image resize helper** — `lib/resize-image.ts`:
```ts
// Downscale an image File to <= maxPx on the long edge → JPEG Blob.
export async function resizeImage(file: File, maxPx = 256, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", quality),
  );
}
```

- [ ] **Step 3: Add Settings to NAV** — in `app/panel/layout.tsx`:
```tsx
import { Bot, LayoutDashboard, BarChart3, ClipboardList, PanelLeft, PanelLeftClose, Settings } from 'lucide-react';
const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
  { href: '/panel/laporan', label: 'Laporan', icon: ClipboardList },
  { href: '/panel/settings', label: 'Settings', icon: Settings },
] as const;
```

- [ ] **Step 4: Settings dashboard** — `components/panel/settings-dashboard.tsx` (`'use client'`). Query `api.cs.listCs`; one `Card` per CS with `CsAvatar` (`src={c.avatarUrl ?? undefined}`), name, an "Upload foto" `Button` wrapping a hidden `<input type="file" accept="image/*">`, and four `Switch` toggles. Handlers:
```tsx
const genUrl = useMutation(api.cs.generateUploadUrl);
const setAvatar = useMutation(api.cs.setCsAvatar);
const upsert = useMutation(api.csConfigs.upsert);
const [busy, setBusy] = useState<string | null>(null);
const [err, setErr] = useState<string | null>(null);

async function onPick(file: File, csName: string) {
  setBusy(csName); setErr(null);
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Maksimal 8 MB');
    const blob = await resizeImage(file);
    const url = await genUrl({});
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!res.ok) throw new Error('Upload gagal');
    const { storageId } = await res.json();
    await setAvatar({ csName, storageId });
  } catch (e) { setErr(`${csName}: ${(e as Error).message}`); }
  finally { setBusy(null); }
}

function onToggle(c, field, value: boolean) {
  upsert({
    csName: c.csName, csPhone: c.csPhone,
    orderAutomationEnabled: c.orderAutomationEnabled, aiAssistantEnabled: c.aiAssistantEnabled,
    reportingEnabled: c.reportingEnabled, isActive: c.isActive,
    [field]: value,
  });
}
```
Render inline `err` text (no `window.alert`). Style consistent with the panel.

- [ ] **Step 5: Settings route** — `app/panel/settings/page.tsx`:
```tsx
import { SettingsDashboard } from '@/components/panel/settings-dashboard';
export default function SettingsPage() { return <SettingsDashboard />; }
```

- [ ] **Step 6: Thread avatars** — in `app/panel/page.tsx`, `components/panel/daily-report-dashboard.tsx`, and `app/panel/performance/page.tsx`: add `const csList = useQuery(api.cs.listCs, {}) ?? [];` build `const avatarByKey = new Map(csList.map((c) => [c.key, c.avatarUrl]));` and pass `src={avatarByKey.get(csKey(name)) ?? undefined}` to each `CsAvatar` (importing `csKey` from `@/lib/cs-key`). For `performance-panel.tsx` and `report-card.tsx`, accept an optional `avatarByKey` (or `avatarUrl`) prop from their parent pages and forward it to `CsAvatar`.

- [ ] **Step 7: Verify build + full tests**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build && npx vitest run`
Expected: build EXIT 0; all tests green.

- [ ] **Step 8: Commit**
```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add app/ components/ lib/ && git commit -m "feat(cs): settings page with photo upload + per-CS toggles; wire avatars panel-wide"
```

---

## Finish

After all tasks: `npm run build` (EXIT 0) + `npx vitest run` (green), then use **superpowers:finishing-a-development-branch** — merge `cs-management` → `main`, `npx convex deploy -y` (schema + new `cs.*` queries/mutations + filter changes), then `git push origin main`. Prod sanity: open Settings, upload one photo, confirm it shows on Laporan/Performance avatars; select a CS in the filter and confirm every view narrows correctly.
