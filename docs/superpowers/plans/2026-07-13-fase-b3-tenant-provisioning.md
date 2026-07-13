# Fase B3 — Tenant Provisioning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org #2 bisa di-provision dan beroperasi terisolasi penuh (config per-org, webhook source-key sendiri, login+JWT per-org) tanpa satu pun perubahan perilaku tenant #1.

**Architecture:** Empat komponen di atas fondasi jalur B yang sudah LIVE: (1) tiga tabel config pindah dari lookup global-by-key ke `by_org_*` dengan fallback in-code; (2) route webhook menerima `?source=<sourceKey>` (route lama tanpa key = alias tenant-1); (3) JWT session+Convex-token dapat claim `orgId` tervalidasi server-side; (4) mutation `provisionOrg` atomic. Pola migrasi B2b dipakai ulang: index additive → switch → hapus index lama, parity 0 sebagai gate.

**Tech Stack:** Convex 1.39 (prod `helpful-spoonbill-863`), Next.js 14, jose (JWT), vitest + convex-test (edge-runtime).

## Global Constraints

- Branch: `fase-b3-tenant-provisioning` off main @`1300083`. Spec: `docs/superpowers/specs/2026-07-13-fase-b3-tenant-provisioning-design.md`.
- Baseline test: **278 total = 277 pass + 1 PRE-EXISTING fail** (`followUp.test.ts` "getArchivedFollowUps") — JANGAN disentuh; harus tetap satu-satunya failure.
- vitest TIDAK typecheck → tiap task WAJIB `npx tsc --noEmit -p convex` DAN `npx vitest run` DAN (di gate) `npm run build`.
- cwd shell suka reset → prefix SEMUA perintah shell: `cd /f/Projects/whatsapp_cs_automotion/wafachat`.
- `git add` file spesifik SAJA (JANGAN `-A`); commit BARU (JANGAN `--amend`). Subagent JANGAN deploy/push — controller yang pegang gate.
- Convex runtime: `crypto.getRandomValues` OK; JANGAN Node `crypto`/`Buffer` di file convex/.
- Unknown/disabled source di route webhook WAJIB tetap **200 ack** (regresi = KirimDev auto-disable subscription — insiden 7 Jul).
- Fallback in-code config: org default (slug `pustakaislam`) → default tenant-1 verbatim; org lain → kosong/netral. Tenant #1 byte-identik.
- ⚠️ **provisionOrg JANGAN dijalankan di PROD sebelum GATE B** (sebelum switch config ter-deploy, row `orgSettings key="default"` kedua bikin `.unique()` reader global lama THROW). Test lokal convex-test aman (dunia terisolasi).
- Deploy yang MENGHAPUS index butuh workaround (deploy key kurang `data:view`): `env -u CONVEX_DEPLOY_KEY npx convex deploy -y --env-file <file berisi CONVEX_DEPLOYMENT=prod:helpful-spoonbill-863>` — terbukti GATE B B2b.
- Parity gate: `node _admin.mjs query rollups:debugRollupParity '{"windowKey":"YYYY-MM-DD"}'` ×3 window → `mismatches: []`.
- SDD ledger: `.superpowers/sdd/progress.md` (controller reset utk B3).

---

## File Map

| File | Peran di B3 |
|---|---|
| `convex/schema.ts` | +3 index org-scoped (T1); −3 index global lama (T6) |
| `convex/orgs.ts` | +`provisionOrg` (T1) |
| `convex/orgSettings.ts` | `loadOrgSettings`/`getInternalPhoneSet` +param `orgId` wajib; public fns → `requireAdminOrg` (T2) |
| `convex/settings.ts` | `getGlobalAiEnabled`/`setGlobalAiEnabled` +arg `orgId` wajib (T2) |
| `convex/closingRules.ts` | `getActiveClosingPhrases` +param `orgId` wajib; `by_org_active` (T2) |
| ~25 call site helper (analytics/metrics/followUp/responseTime/rollups/rollupReaders/shippingRecaps/messages) | thread `orgId` — compiler yang menemukan semuanya (T2) |
| `convex/http.ts` | `?source=` + alias tenant-1 di `/webhooks/kirimdev` & `/webhooks/berdu` (T3) |
| `convex/ingest/reconciler.ts` | guard org-default utk creds ENV (T3) |
| `lib/auth-jwt.ts`, `lib/convex-token.ts`, `convex/auth.ts`, `convex/authz.ts` + Next login/user routes | claim `orgId` (T4) |
| sisa `requireDefaultOrgId` | audit PINDAH/TETAP + tabel tercatat (T5) |
| `convex/orgProvisioning.test.ts` | e2e org #2 sintetis (T1 dasar, T6 penuh) |

---

### Task 1: Schema index additive + `provisionOrg` + test provisioning

**Files:**
- Modify: `convex/schema.ts` (3 index), `convex/orgs.ts` (mutation baru)
- Test: `convex/orgProvisioning.test.ts` (BARU)

**Interfaces:**
- Consumes: `requireAdmin` (convex/authz.ts), `hashPassword` (convex/passwordHash.ts), index `organizations.by_slug`, `users.by_email`, `ingestSources.by_sourceKey`.
- Produces: `orgs.provisionOrg({slug, orgName, adminEmail, adminPassword, adminName?, sources:[{kind,name}]}) → {orgId, sourceKeys:[{sourceKey, secret}]}`; index `settings.by_org_key`, `orgSettings.by_org_key`, `closingRules.by_org_active` (dipakai T2).

- [ ] **Step 1: Tambah 3 index additive di `convex/schema.ts`** — di tabel masing-masing, SETELAH index existing (jangan hapus apa pun):

```ts
// settings (sekarang berakhir: .index("by_key", ["key"]))
    .index("by_key", ["key"])
    .index("by_org_key", ["orgId", "key"]),
// orgSettings (sama):
    .index("by_key", ["key"])
    .index("by_org_key", ["orgId", "key"]),
// closingRules (sekarang: .index("by_active", ["active"])):
    .index("by_active", ["active"])
    .index("by_org_active", ["orgId", "active"]),
```

- [ ] **Step 2: Tulis failing test `convex/orgProvisioning.test.ts`:**

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ADMIN = { subject: "op", role: "admin" as const, name: "Op", email: "op@wafachat.test" };

async function seedDefaultOrg(t: any) {
  return t.run((ctx: any) =>
    ctx.db.insert("organizations", { slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1 }),
  );
}

test("provisionOrg: creates org + orgSettings + admin user + sources atomically", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t); // _admin.mjs-style admin resolves via default-org fallback
  const res = await t.withIdentity(ADMIN).mutation(api.orgs.provisionOrg, {
    slug: "toko-buku", orgName: "Toko Buku", adminEmail: "owner@tokobuku.test",
    adminPassword: "rahasia-123", sources: [{ kind: "kirimdev", name: "KirimDev Toko Buku" }],
  });
  expect(res.orgId).toBeDefined();
  expect(res.sourceKeys).toHaveLength(1);
  expect(res.sourceKeys[0].sourceKey).toBe("kirimdev-toko-buku");
  expect(res.sourceKeys[0].secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  await t.run(async (ctx: any) => {
    const org = (await ctx.db.query("organizations").collect()).find((o: any) => o.slug === "toko-buku");
    expect(org).toBeDefined();
    const os = (await ctx.db.query("orgSettings").collect()).filter((r: any) => String(r.orgId) === String(org._id));
    expect(os).toHaveLength(1);
    expect(os[0].internalPhones).toEqual([]);
    const user = (await ctx.db.query("users").collect()).find((u: any) => u.email === "owner@tokobuku.test");
    expect(user.role).toBe("admin");
    expect(String(user.orgId)).toBe(String(org._id));
    expect(user.passwordHash).not.toBe("rahasia-123"); // hashed
    const src = (await ctx.db.query("ingestSources").collect()).find((s: any) => s.sourceKey === "kirimdev-toko-buku");
    expect(String(src.orgId)).toBe(String(org._id));
    expect(src.enforceSignature).toBe(false);
    expect(src.enabled).toBe(true);
  });
});

test("provisionOrg: duplicate slug / duplicate email / invalid slug all THROW (no partial state)", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  const base = { orgName: "X", adminPassword: "pw-123456", sources: [] as { kind: "kirimdev"; name: string }[] };
  await asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-x", adminEmail: "x@x.test" });
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-x", adminEmail: "y@y.test" })).rejects.toThrow(/slug/);
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-y", adminEmail: "x@x.test" })).rejects.toThrow(/email/);
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "Bad Slug!", adminEmail: "z@z.test" })).rejects.toThrow(/slug/);
  await t.run(async (ctx: any) => {
    const orgs = await ctx.db.query("organizations").collect();
    expect(orgs.filter((o: any) => o.slug === "org-y" || o.slug === "bad slug!").length).toBe(0); // THROW = transaksi batal, nol partial
  });
});
```

- [ ] **Step 3: Run test — verify FAIL** (`provisionOrg` belum ada):
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgProvisioning.test.ts`
Expected: FAIL "provisionOrg is not a function"/property not found.

- [ ] **Step 4: Implement `provisionOrg` di `convex/orgs.ts`** (tambah import `hashPassword` dari `./passwordHash`):

```ts
// B3: admin-provisioned tenant #2 (spec §2.4). One mutation = one Convex
// transaction: any THROW rolls back everything (no partial org).
// ⚠️ PROD GUARD: do not run in prod before the T2 config switch is deployed —
// a second orgSettings key="default" row breaks the OLD global .unique() readers.
export const provisionOrg = mutation({
  args: {
    slug: v.string(),
    orgName: v.string(),
    adminEmail: v.string(),
    adminPassword: v.string(),
    adminName: v.optional(v.string()),
    sources: v.array(v.object({
      kind: v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom")),
      name: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "orgs.provisionOrg");
    const slug = args.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error(`slug invalid (a-z 0-9 dash, 3-40): ${args.slug}`);
    const orgName = args.orgName.trim();
    if (!orgName) throw new Error("orgName kosong");
    if (args.adminPassword.length < 8) throw new Error("adminPassword minimal 8 karakter");
    const dupSlug = await ctx.db.query("organizations")
      .withIndex("by_slug", (q: any) => q.eq("slug", slug)).unique();
    if (dupSlug) throw new Error(`slug sudah dipakai: ${slug}`);
    const email = args.adminEmail.trim().toLowerCase();
    const dupEmail = await ctx.db.query("users")
      .withIndex("by_email", (q: any) => q.eq("email", email)).unique();
    if (dupEmail) throw new Error(`email sudah dipakai: ${email}`);

    const now = Date.now();
    const orgId = await ctx.db.insert("organizations", { slug, name: orgName, createdAt: now, updatedAt: now });
    await ctx.db.insert("orgSettings", { orgId, key: "default", orgName, internalPhones: [], updatedAt: now });
    await ctx.db.insert("users", {
      orgId, email, name: args.adminName?.trim() || `${orgName} Admin`,
      passwordHash: await hashPassword(args.adminPassword),
      role: "admin", isActive: true, createdAt: now, updatedAt: now,
    });
    const sourceKeys: { sourceKey: string; secret: string }[] = [];
    for (const s of args.sources) {
      const sourceKey = `${s.kind}-${slug}`;
      const dup = await ctx.db.query("ingestSources")
        .withIndex("by_sourceKey", (q: any) => q.eq("sourceKey", sourceKey)).unique();
      if (dup) throw new Error(`sourceKey sudah ada: ${sourceKey}`);
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const secret = "whsec_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      // enforceSignature:false = log-only first (auto-disable lesson, 7 Jul);
      // flip via ingest.sources.setEnforceSignature after live verification.
      await ctx.db.insert("ingestSources", {
        orgId, sourceKey, name: s.name, kind: s.kind, secret,
        enabled: true, enforceSignature: false, createdAt: now,
      });
      sourceKeys.push({ sourceKey, secret });
    }
    return { orgId, sourceKeys };
  },
});
```

- [ ] **Step 5: Run test — verify PASS**, lalu full gates:
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgProvisioning.test.ts && npx tsc --noEmit -p convex && npx vitest run`
Expected: file PASS (2 test); tsc 0 error; suite 279 pass + 1 known fail.

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/orgs.ts convex/orgProvisioning.test.ts convex/_generated
git commit -m "feat(b3): additive org-scoped config indexes + provisionOrg (atomic tenant provisioning)"
```

---

### Task 2: Config per-org switch — settings / orgSettings / closingRules

**Files:**
- Modify: `convex/orgSettings.ts`, `convex/settings.ts`, `convex/closingRules.ts`, `convex/http.ts:190-200` (set_global/get_global), + semua call site yang error tsc (analytics.ts, metrics.ts, followUp.ts, responseTime.ts, rollups.ts, rollupReaders.ts, shippingRecaps.ts, messages.ts, orgs.ts:34)
- Test: extend `convex/orgSettings.test.ts`, `convex/closingRules.test.ts` (existing)

**Interfaces:**
- Consumes: index T1 (`by_org_key`, `by_org_active`); `requireMemberOrg`/`requireAdminOrg` (authz.ts, return `{viewer, orgId}`); `DEFAULT_ORG_SLUG` (orgs.ts).
- Produces (dipakai T3/T5/T6): `loadOrgSettings(ctx, orgId)`, `getInternalPhoneSet(ctx, orgId)`, `getActiveClosingPhrases(ctx, orgId)` — param `orgId: Id<"organizations">` WAJIB; `internal.settings.getGlobalAiEnabled({orgId})`, `internal.settings.setGlobalAiEnabled({enabled, orgId})`.

**Metode: ubah signature helper jadi WAJIB → `npx tsc --noEmit -p convex` mencetak SEMUA call site → perbaiki satu-satu. Sumber orgId per call site: public fn → `requireMemberOrg`/`requireAdminOrg` (mayoritas SUDAH punya sejak B2b — pakai `orgId` yang sudah ada di scope); engine/internal fn → param `orgId` yang sudah di-thread B1/B2b (mis. `args.orgId`, var `orgId` lokal). JANGAN pernah isi dengan `requireDefaultOrgId` baru.**

- [ ] **Step 1: `convex/orgSettings.ts` — helper per-org + fallback slug-aware:**

```ts
import type { Id } from "./_generated/dataModel";
import { DEFAULT_ORG_SLUG } from "./orgs";

// Non-default org with no row yet: neutral empty settings (spec §2.1) — NOT
// tenant #1's phone list, which would leak pustakaislam filters into org #2.
export const EMPTY_ORG_SETTINGS = { orgName: "", internalPhones: [] as string[] };

export async function loadOrgSettings(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<{ orgName: string; internalPhones: string[] }> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_org_key", (q: any) => q.eq("orgId", orgId).eq("key", "default"))
    .unique();
  if (row) return row;
  const org = await ctx.db.get(orgId);
  return org?.slug === DEFAULT_ORG_SLUG ? DEFAULT_ORG_SETTINGS : EMPTY_ORG_SETTINGS;
}

export async function getInternalPhoneSet(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<ReadonlySet<string>> {
  const s = await loadOrgSettings(ctx, orgId);
  return new Set(s.internalPhones);
}
```

Public fns di file yang sama: `get` → `const { orgId } = await requireAdminOrg(ctx, "orgSettings.get"); return loadOrgSettings(ctx, orgId);`. `update` dan `seedDefault` → `requireAdminOrg` (hapus `requireDefaultOrgId`), lookup existing via `by_org_key(orgId, "default")`, insert bawa `orgId` viewer. (Import `requireAdminOrg` dari `./authz`; hapus import `requireDefaultOrgId` bila tak terpakai lagi.)

- [ ] **Step 2: `convex/closingRules.ts`:**

```ts
export async function getActiveClosingPhrases(
  ctx: { db: any }, orgId: Id<"organizations">,
): Promise<string[]> {
  const rows = await ctx.db
    .query("closingRules")
    .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("active", true))
    .collect();
  const phrases = rows
    .map((r: any) => String(r.phrase || "").trim().toUpperCase())
    .filter((p: string) => p.length > 0);
  return phrases.length > 0 ? phrases : [...DEFAULT_PHRASES]; // fallback universal semua org
}
```

`getActivePhrases` → `const { orgId } = await requireMemberOrg(ctx, "closingRules.getActivePhrases");`. `seedDefault` → `requireAdminOrg` (ganti `requireAdmin`+`requireDefaultOrgId`), cek existing via `by_org_active(orgId, ...)` per org.

- [ ] **Step 3: `convex/settings.ts` — arg orgId wajib:**

```ts
export const getGlobalAiEnabled = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const setting = await ctx.db.query("settings")
      .withIndex("by_org_key", (q) => q.eq("orgId", args.orgId).eq("key", GLOBAL_AI_KEY))
      .unique();
    return setting?.value !== false;
  },
});
export const setGlobalAiEnabled = internalMutation({
  args: { enabled: v.boolean(), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("settings")
      .withIndex("by_org_key", (q) => q.eq("orgId", args.orgId).eq("key", GLOBAL_AI_KEY))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value: args.enabled, updatedAt: now });
    else await ctx.db.insert("settings", { key: GLOBAL_AI_KEY, value: args.enabled, updatedAt: now, orgId: args.orgId });
    await ctx.db.insert("events", { type: "global_ai_changed", actor: "cs", metadata: { enabled: args.enabled }, createdAt: now, orgId: args.orgId });
    return { success: true, globalEnabled: args.enabled };
  },
});
```

Caller di `convex/http.ts` `/n8n/state` action `set_global`/`get_global` (≈:190-200): resolve `const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {}); if (!orgId) return jsonResponse({ success:false, error:"no default org" }, 500);` lalu pass `{ orgId }` — route n8n TETAP default-org by design. Grep caller lain `internal.settings.` dan thread orgId dari scope-nya (doc-driven/args yang sudah ada).

- [ ] **Step 4: Compiler-driven sweep:** `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex` → perbaiki SETIAP error call site (≈28 situs `getInternalPhoneSet`, 2 situs `getActiveClosingPhrases`, 1 `loadOrgSettings` di orgs.ts:34 `seedDefaultOrg` — di situ JANGAN pakai loadOrgSettings ber-orgId (org default belum tentu ada saat seeding): import dan pakai `DEFAULT_ORG_SETTINGS` langsung, seedDefaultOrg selalu = tenant-1). Aturan sumber orgId di header task. Ulangi sampai tsc 0.

- [ ] **Step 5: Test fallback per-org** — tambah di `convex/orgSettings.test.ts` (pola test existing di file itu):

```ts
test("loadOrgSettings: default org falls back to tenant-1 defaults; other org falls back to EMPTY", async () => {
  const t = convexTest(schema);
  const defId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "PI", createdAt: 1, updatedAt: 1 }));
  const otherId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "B", createdAt: 1, updatedAt: 1 }));
  const def = await t.run((ctx: any) => loadOrgSettings(ctx, defId));
  expect(def.internalPhones.length).toBeGreaterThan(0); // tenant-1 baked defaults
  const other = await t.run((ctx: any) => loadOrgSettings(ctx, otherId));
  expect(other.internalPhones).toEqual([]); // neutral for new org
});
```

(import `loadOrgSettings` dari `./orgSettings`.) Test existing yang memanggil public config fns: JANGAN ubah expected value — hanya seed (org default sudah di-seed di mayoritas test post-B1).

- [ ] **Step 6: Gates + commit:**
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run`
Expected: tsc 0; suite hijau (+1 test baru) kecuali 1 known fail.

```bash
git add convex/orgSettings.ts convex/settings.ts convex/closingRules.ts convex/http.ts convex/orgs.ts convex/analytics.ts convex/metrics.ts convex/followUp.ts convex/responseTime.ts convex/rollups.ts convex/rollupReaders.ts convex/shippingRecaps.ts convex/messages.ts convex/orgSettings.test.ts convex/_generated
git commit -m "feat(b3): config lookups org-scoped (settings/orgSettings/closingRules) with slug-aware fallback"
```
(Tambahkan file test/callsite lain yang ikut berubah secara eksplisit.)

---

### Task 3: Ingest — sourceKey dari URL + alias tenant-1 + guard reconciler

**Files:**
- Modify: `convex/http.ts` route `/webhooks/kirimdev` (≈:206-254) dan `/webhooks/berdu` (≈:256-...); `convex/ingest/reconciler.ts:46-77`
- Test: `convex/ingest/reconciler.test.ts` (existing) — perilaku tak berubah, pastikan tetap hijau

**Interfaces:**
- Consumes: `internal.ingest.sources.getBySourceKey({sourceKey})` (existing), `source.orgId` (sudah di-thread ke captureEvent — JANGAN diubah).
- Produces: kontrak URL `POST /webhooks/kirimdev?source=<sourceKey>` dan `POST /webhooks/berdu?source=<sourceKey>`; tanpa `?source` = alias tenant-1 (`kirimdev-pustakaislam` / `berdu-pustakaislam`).

- [ ] **Step 1: `/webhooks/kirimdev` — ganti hardcode (http.ts:214-216):**

```ts
    // B3: sourceKey from URL (?source=...). Old bare URL (tenant #1's registered
    // webhook) keeps working via the legacy alias — do NOT break that contract.
    const sourceKeyParam = new URL(request.url).searchParams.get("source");
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, {
      sourceKey: sourceKeyParam || "kirimdev-pustakaislam",
    });
```

Sisa handler TIDAK berubah (unknown/disabled → 200 ack; `source.orgId` sudah dipakai captureEvent).

- [ ] **Step 2: `/webhooks/berdu` — sama (http.ts:262):**

```ts
    const sourceKeyParam = new URL(request.url).searchParams.get("source");
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, { sourceKey: sourceKeyParam || "berdu-pustakaislam" });
```

⚠️ Enrich `fetchBerduOrderDetail` pakai creds ENV tenant-1: tambahkan guard — enrich HANYA bila source adalah org default:

```ts
    // Berdu ENV creds are tenant #1's (spec §1.3): never enrich another org's
    // thin payload with tenant #1's Berdu account.
    const defaultOrgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
    let effectiveBody = rawBody;
    if (String(source.orgId) === String(defaultOrgId) &&
        !parsedBody.shipping_address && !parsedBody.order?.shipping_address && parsedBody.order_id) {
      const detail = await fetchBerduOrderDetail(String(parsedBody.order_id));
      if (detail) effectiveBody = JSON.stringify({ order: detail });
    }
```

- [ ] **Step 3: Reconciler guard (`convex/ingest/reconciler.ts:53`):** biarkan `defaultOrgIdInternal` TAPI dokumentasikan sebagai keputusan sadar — ganti komentar di atasnya:

```ts
    // B3 decision (spec §1.3): BERDU_* env creds belong to tenant #1 only, so the
    // reconciler is default-org-only BY DESIGN until tenantIntegrations exists.
    // Provisioning a second kind="berdu" source does NOT enroll it here.
    const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
```

- [ ] **Step 4: Gates:**
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run`
Expected: tsc 0; suite hijau kecuali 1 known.

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/ingest/reconciler.ts convex/_generated
git commit -m "feat(b3): webhook routes accept ?source= (tenant-1 alias preserved); Berdu enrich/reconcile guarded default-org"
```

---

### Task 4: Auth — orgId di session + Convex token + resolveViewerOrg claim-first

**Files:**
- Modify: `lib/auth-jwt.ts`, `lib/convex-token.ts`, `convex/auth.ts`, `convex/authz.ts`, + Next route yang memanggil `signSession(...)` / `verifyCredentials` / `createUser` (grep dulu: `grep -rn "signSession(\|verifyCredentials\|createUser" app lib --include="*.ts" --include="*.tsx"`)
- Test: `lib/auth-jwt.test.ts`, `convex/authz.test.ts` (extend)

**Interfaces:**
- Consumes: `users.by_email`, `Viewer` (authz.ts), `Session` (lib/auth-jwt.ts).
- Produces: `Session.orgId?: string` (claim baru, optional = backward-compatible); Convex token claim `orgId`; `Viewer.orgIdClaim?: string`; `resolveViewerOrg` prioritas claim-tervalidasi; `auth.verifyCredentials` return `+ orgId: string`; `auth.createUser` arg `+ orgId?: v.id("organizations")`.

- [ ] **Step 1: Failing tests dulu.** `lib/auth-jwt.test.ts` tambah:

```ts
test("signSession round-trips orgId; old token without orgId stays valid", async () => {
  const withOrg = await signSession({ userId: "u1", role: "admin", name: "A", email: "a@t.co", orgId: "org123" });
  const s1 = await verifySession(withOrg);
  expect(s1?.orgId).toBe("org123");
  const withoutOrg = await signSession({ userId: "u2", role: "cs", name: "B", email: "b@t.co", csName: "B" });
  const s2 = await verifySession(withoutOrg);
  expect(s2).not.toBeNull();      // backward compat: absence is NOT invalid
  expect(s2?.orgId).toBeUndefined();
});
```

`convex/authz.test.ts` tambah (pola test existing di file — seed org+user, `withIdentity`):

```ts
test("resolveViewerOrg: orgId claim must match users row; mismatch THROWs; matching claim resolves", async () => {
  const t = convexTest(schema);
  const orgA = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "PI", createdAt: 1, updatedAt: 1 }));
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "B", createdAt: 1, updatedAt: 1 }));
  await t.run((ctx: any) => ctx.db.insert("users", { orgId: orgA, email: "a@t.co", name: "A", passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 }));
  const ok = await t.withIdentity({ subject: "u", role: "admin", name: "A", email: "a@t.co", orgId: String(orgA) } as any)
    .query(api.authz.probeOrg, {});
  expect(String(ok.orgId)).toBe(String(orgA));
  await expect(
    t.withIdentity({ subject: "u", role: "admin", name: "A", email: "a@t.co", orgId: String(orgB) } as any)
      .query(api.authz.probeOrg, {}),
  ).rejects.toThrow(/org/);
});
```

Run: `npx vitest run lib/auth-jwt.test.ts convex/authz.test.ts` → Expected: FAIL (orgId belum ada di Session / claim belum dibaca).

- [ ] **Step 2: `lib/auth-jwt.ts`:**

```ts
export type Session = { userId: string; role: "admin" | "cs"; name: string; email: string; csName?: string; orgId?: string };
export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ userId: s.userId, role: s.role, name: s.name, email: s.email, csName: s.csName, orgId: s.orgId })
    // ... sisa chain TIDAK berubah
}
// verifySession: destructure + orgId; validasi TIDAK menolak absennya orgId:
//   return { ..., orgId: typeof orgId === "string" ? orgId : undefined };
```

- [ ] **Step 3: `lib/convex-token.ts` `signConvexToken`:** payload jadi `new SignJWT({ role: s.role, name: s.name, email: s.email, csName: s.csName, orgId: s.orgId })` — sisa chain identik.

- [ ] **Step 4: `convex/authz.ts`:**

```ts
export type Viewer = { subject: string; role: "admin" | "cs"; name: string; email: string; csName?: string; orgIdClaim?: string };
// getViewer: tambah — orgIdClaim: typeof id.orgId === "string" ? id.orgId : undefined,

async function resolveViewerOrg(ctx: any, viewer: Viewer, fn: string): Promise<Id<"organizations">> {
  const userRow = await ctx.db.query("users")
    .withIndex("by_email", (q: any) => q.eq("email", viewer.email)).unique();
  // B3: a token orgId claim is a HINT, never an authority — it must match the
  // users row (defense vs stale/forged claims after an org move).
  if (viewer.orgIdClaim) {
    if (!userRow) throw new Error(`unauthorized: ${fn} — org claim but no user record for ${viewer.email}`);
    if (String(userRow.orgId) !== viewer.orgIdClaim) throw new Error(`unauthorized: ${fn} — org claim mismatch`);
    return userRow.orgId;
  }
  if (userRow) return userRow.orgId;
  if (viewer.role === "admin") {
    // _admin.mjs platform-operator token (no users row, no claim): default org.
    // PERMANENT single-operator semantics (spec §2.3), not a temporary shim.
    const fallback = await getDefaultOrgId(ctx);
    if (fallback) return fallback;
    throw new Error(`unauthorized: ${fn} — org not seeded`);
  }
  throw new Error(`unauthorized: ${fn} — no user record for ${viewer.email}`);
}
```

- [ ] **Step 5: `convex/auth.ts`:** `verifyCredentials` return `+ orgId: String(user.orgId)` (baris 25). `createUser`: arg `+ orgId: v.optional(v.id("organizations"))`; handler `const orgId = args.orgId ?? await requireDefaultOrgId(ctx);` (fallback = kompatibel panel existing; Next route user-management di-update Step 6 untuk pass orgId session). `seedFirstAdmin` TETAP `requireDefaultOrgId` (bootstrap tenant-1, dicatat T5).

- [ ] **Step 6: Next side:** grep `signSession(` → route login: thread `orgId` dari hasil `verifyCredentials` ke `signSession({...,orgId})`. Grep pemanggil `createUser` (users management route): pass `orgId` dari `session.orgId` bila ada. JANGAN ubah kontrak respons route.

- [ ] **Step 7: Gates:**
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run && npm run build`
Expected: tsc 0; suite hijau (+2 test baru) kecuali 1 known; build EXIT 0 (lib/ berubah → build wajib di task ini).

- [ ] **Step 8: Commit**

```bash
git add lib/auth-jwt.ts lib/convex-token.ts convex/auth.ts convex/authz.ts lib/auth-jwt.test.ts convex/authz.test.ts convex/_generated
git commit -m "feat(b3): orgId claim in session+convex tokens, claim-validated viewer-org resolution, per-org login"
```
(Tambah file route Next yang berubah secara eksplisit.)

---

### Task 5: Sweep sisa `requireDefaultOrgId` — klasifikasi PINDAH / TETAP-tercatat

**Files:**
- Modify: hasil audit (daftar di bawah). Dokumen: tabel TETAP ditulis ke laporan task (controller menyalin ke ledger §14 di GATE B).

**Interfaces:**
- Consumes: `requireMemberOrg`/`requireAdminOrg`; aturan spec §3.
- Produces: `grep -rn "requireDefaultOrgId\|defaultOrgIdInternal" convex --include="*.ts" | grep -v test | grep -v "convex/orgs.ts"` → SETIAP hit sisa ada di tabel TETAP.

**Daftar situs (grep 2026-07-13) + klasifikasi AWAL — implementer WAJIB verifikasi konteks tiap situs (public panel fn = PINDAH; jalur n8n `/n8n/state` / authSecret channel / backfill one-time / infra = TETAP + alasan):**

| Situs | Klasifikasi awal |
|---|---|
| auth.ts:34,114 | SELESAI di T4 (createUser arg, seedFirstAdmin TETAP-bootstrap) |
| closingRules.ts:27, orgSettings.ts:59,97, settings.ts:23 | SELESAI di T2 |
| ingest/reconciler.ts:53 | TETAP (T3, creds ENV tenant-1) |
| ingest/monitor.ts:51 | TETAP — infra health global |
| ingest/sources.ts:37,65 | TETAP — register/maintenance CLI tenant-1 (org baru pakai provisionOrg) |
| http.ts:67,161,174 | TETAP — route `/n8n/state` relay n8n tenant-1 by design |
| events.ts:29 | AUDIT: public panel fn → PINDAH `requireMemberOrg`; dipanggil n8n → TETAP |
| followUp.ts:203,375 | AUDIT: authSecret channel (kirim/arsip follow-up tenant-1) → kemungkinan TETAP; viewer-facing → PINDAH |
| messages.ts:48,349 | AUDIT: appendMessageFromN8n/backfill → kemungkinan TETAP |
| shippingRecaps.ts ×11 (356,456,607,839,871,903,952,1010,1042,1137) | AUDIT satu-satu: admin panel mutations → PINDAH `requireAdminOrg`; n8n actions/import/backfill → TETAP |
| state.ts ×11 (117,396,439,528,599,659,716,769,865,1072) | AUDIT satu-satu: n8n write cores → TETAP; viewer-facing → PINDAH |

- [ ] **Step 1:** Jalankan grep master, lalu audit tiap situs sesuai aturan. Setiap PINDAH: transform standar `const { orgId } = await requireMemberOrg/requireAdminOrg(ctx, "<fn>");` menggantikan `await requireDefaultOrgId(ctx)` — SISA logika identik. Setiap TETAP: tambah 1 baris komentar `// B3: default-org BY DESIGN — <alasan singkat>` di atas call bila belum ada.
- [ ] **Step 2:** Test existing yang memanggil fn yang PINDAH: pastikan seed org + (bila perlu identity users-row) — JANGAN ubah expected value.
- [ ] **Step 3: Gates:** `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run` → tsc 0; hijau kecuali 1 known.
- [ ] **Step 4:** Tulis tabel final TETAP (file:baris + alasan) di laporan.
- [ ] **Step 5: Commit**

```bash
git add <setiap file yang berubah, eksplisit> convex/_generated
git commit -m "refactor(b3): classify remaining default-org sites — move viewer-facing to org resolution, annotate deliberate defaults"
```

---

### Task 6: Test e2e org #2 sintetis + hapus 3 index config global lama

**Files:**
- Modify: `convex/orgProvisioning.test.ts` (extend e2e), `convex/schema.ts` (hapus 3 index)

**Interfaces:**
- Consumes: semua produk T1-T5.
- Produces: definition-of-done Fase B3; schema tanpa `settings.by_key`, `orgSettings.by_key`, `closingRules.by_active` (JANGAN sentuh index lain).

- [ ] **Step 1: Extend `convex/orgProvisioning.test.ts` dengan e2e:**

```ts
test("E2E: provisioned org #2 ingests via its own sourceKey and its admin sees ONLY its data", async () => {
  const t = convexTest(schema);
  const defaultOrgId = await seedDefaultOrg(t);
  // tenant #1 baseline data
  await t.run(async (ctx: any) => {
    const NOW = Date.now();
    await ctx.db.insert("users", { orgId: defaultOrgId, email: "admin@pi.test", name: "PI", passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("orders", {
      orgId: defaultOrgId, orderId: "O-PI-1", customerPhone: "62800000001", customerName: "cust-pi",
      assignedCsName: "Aisyah", csKey: "aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
      shippingCost: "Rp1", total: "Rp2", shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z",
      source: "berdu", aiEligible: false, createdAt: NOW, updatedAt: NOW,
    });
  });
  // provision org #2
  const prov = await t.withIdentity(ADMIN).mutation(api.orgs.provisionOrg, {
    slug: "org-two", orgName: "Org Two", adminEmail: "admin@two.test", adminPassword: "pw-123456",
    sources: [{ kind: "kirimdev", name: "KD Two" }],
  });
  // ingest an event through org #2's source (same path the webhook route uses)
  const source = await t.run(async (ctx: any) =>
    (await ctx.db.query("ingestSources").collect()).find((s: any) => s.sourceKey === "kirimdev-org-two"));
  expect(String(source.orgId)).toBe(String(prov.orgId));
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: source.sourceKey, kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { /* SALIN bentuk payload minimal valid dari test ingest existing — baca convex/ingest/berduAdapter.test.ts / reconciler.test.ts; assertion intent yang mengikat, bukan bentuk persisnya */ } }),
    signatureOk: true, orgId: source.orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx: any) => {
    const orders = await ctx.db.query("orders").collect();
    expect(orders.filter((o: any) => String(o.orgId) === String(prov.orgId)).length).toBeGreaterThan(0); // masuk org #2
    expect(orders.filter((o: any) => String(o.orgId) === String(defaultOrgId)).length).toBe(1);          // tenant #1 untouched
  });
  // org #2 admin (claim + users row dari provisionOrg) sees ONLY org #2
  const now = Date.now();
  const range = { startAt: now - 86_400_000, endAt: now + 86_400_000 };
  const sumTwo = await t.withIdentity({ subject: "u2", role: "admin", name: "T", email: "admin@two.test", orgId: String(prov.orgId) } as any)
    .query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumTwo.leads).toBe(1);   // hanya order org #2 — bukan 2
  const sumPi = await t.withIdentity({ subject: "u1", role: "admin", name: "PI", email: "admin@pi.test" } as any)
    .query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumPi.leads).toBe(1);    // tenant #1 tetap 1 — nol kebocoran dua arah
});
```

(Import `internal` dari `./_generated/api`. Payload `captureEvent` WAJIB disalin dari bentuk yang dipakai test ingest existing.)

- [ ] **Step 2: Run e2e — MUST PASS.** Gagal = leak/regresi NYATA di T1-T5 → perbaiki KODE-nya, bukan assertion.
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/orgProvisioning.test.ts`

- [ ] **Step 3: Hapus 3 index lama dari `convex/schema.ts`** — SETELAH grep per index:

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
grep -rn 'withIndex("by_key"' convex --include='*.ts'      # sisa hits HARUS milik tabel yang index by_key-nya DIPERTAHANKAN (bukan settings/orgSettings)
grep -rn 'withIndex("by_active"' convex --include='*.ts'   # HARUS 0 (closingRules.by_active pemakai terakhir, sudah pindah T2)
grep -n '.index("by_key"\|.index("by_active"' convex/schema.ts   # identifikasi baris per tabel sebelum hapus
```

Hapus HANYA: baris `.index("by_key", ["key"])` milik tabel `settings` dan `orgSettings`, dan `.index("by_active", ["active"])` milik `closingRules`. Tabel lain yang punya index bernama sama TIDAK disentuh. Bila grep menemukan pemakai live tersisa pada index yang mau dihapus → STOP dan laporkan (gap sweep), jangan hapus.

- [ ] **Step 4: Gates penuh:**
Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit -p convex && npx vitest run && npm run build`
Expected: tsc 0 (referensi index terhapus = compile error → ketahuan); hijau kecuali 1 known; build EXIT 0.

- [ ] **Step 5: Commit (dua commit)**

```bash
git add convex/orgProvisioning.test.ts
git commit -m "test(b3): E2E synthetic org #2 — provision -> ingest own source -> scoped dashboards, zero cross-leak"
git add convex/schema.ts convex/_generated
git commit -m "chore(b3): drop superseded global config indexes (settings/orgSettings by_key, closingRules by_active)"
```

---

### GATE B (CONTROLLER — final): deploy + verifikasi + tutup fase

- [ ] `npm run build && npx tsc --noEmit -p convex && npx vitest run` → hijau kecuali 1 known (controller re-run INDEPENDEN — jangan percaya klaim subagent).
- [ ] Deploy (menghapus index → pakai workaround): `env -u CONVEX_DEPLOY_KEY npx convex deploy -y --env-file <file CONVEX_DEPLOYMENT=prod:helpful-spoonbill-863>` → konfirmasi summary `[-]` = 3 index config.
- [ ] Parity ×3 window → 0. Webhook live tenant #1 tetap masuk (route alias tanpa `?source=` — cek event terbaru diproses). Panel spot-check Fandy.
- [ ] `docs/SAAS-BLUEPRINT.md` §14: baris LUNAS B3 (config per-org + source-key URL + JWT org-claim + provisionOrg) + salin tabel TETAP dari T5 + deferral (tenantIntegrations/wizard/switcher/B4/billing/enkripsi secret).
- [ ] Commit ledger; merge ff → main; **push origin main HANYA setelah izin eksplisit Fandy.**
- [ ] Pasca-GATE B: provisionOrg AMAN dijalankan di prod (guard di Global Constraints gugur).

---

## Self-Review (dijalankan saat menulis plan)

- **Spec coverage:** §2.1→T2+T6 · §2.2→T3 · §2.3→T4 · §2.4→T1 · §3→T5 · §4→T1/T2/T4/T6 · §7→GATE B. GATE A opsional (spec §7) di-skip sadar: semua perubahan T1-T5 backward-compatible (index additive, alias route, claim optional, fallback slug-aware) dan T6 e2e = bukti sebelum satu-satunya deploy; satu gate cukup.
- **Placeholder scan:** payload `captureEvent` di T6 menyuruh implementer menyalin bentuk dari test ingest existing — fakta kode yang bisa dibaca, bukan TBD desain; selain itu nol placeholder.
- **Type consistency:** `loadOrgSettings(ctx, orgId)` / `getInternalPhoneSet(ctx, orgId)` / `getActiveClosingPhrases(ctx, orgId)` konsisten T2→T6; `Viewer.orgIdClaim`/`Session.orgId` konsisten T4→T6; `provisionOrg` return `{orgId, sourceKeys}` konsisten T1→T6.
