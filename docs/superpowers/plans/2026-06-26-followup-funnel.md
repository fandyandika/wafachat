# Follow-up Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, filtered **Follow-up** tool to WaFaChat that sends approved WhatsApp templates (H+1 then H+2) to ghosted, not-yet-closed, still-fresh leads via the KirimDev API — a 2-stage funnel.

**Architecture:** A pure eligibility module decides which funnel stage a conversation qualifies for. A derive-on-read Convex query lists candidates per stage. A secret-gated Convex action sends the template via the KirimDev REST API (`POST /v1/{phone_id}/messages`, native `Idempotency-Key`) and stamps the conversation. A new `/panel/follow-up` page (2 tabs) drives it; sends route through a JWT-verified Next.js API route.

**Tech Stack:** Convex 1.39, Next.js 14 (app router), TypeScript, vitest (edge-runtime) + convex-test, Tailwind v3 + shadcn, `jose` JWT sessions.

## Global Constraints

- cwd resets between shells → prefix every command with `cd /f/Projects/whatsapp_cs_automotion/wafachat`.
- **Fact-Forcing Gate**: before every Write/Edit/Bash, present (1) importers, (2) public functions affected, (3) data fields, (4) verbatim user-instruction quote.
- Pure helpers have **no Convex imports** (run plain in vitest), mirroring `convex/responseTimeMath.ts`.
- `orders` has **no status field** — "closed" = a `shippingRecaps` row exists for the customer OR `conversation.status === "closed"`.
- KirimDev send: `POST https://api.kirimdev.com/v1/{phone_number_id}/messages`, header `Authorization: Bearer ${KIRIMDEV_API_KEY}`, `Idempotency-Key: fu-{conversationId}-{stage}`, body is Meta-Cloud-API template shape.
- Secrets via Convex **dashboard** (deploy key lacks `env:write`): `KIRIMDEV_API_KEY`, `KIRIMDEV_BASE_URL` (default `https://api.kirimdev.com/v1`). Reuse `PANEL_AUTH_SECRET` to gate the send action.
- Deploy discipline: `npm run build` (check EXIT 0) → `npx vitest run` → merge to main → `npx convex deploy -y` (schema + query + action) → `git push`.
- **Build-time inputs still needed from user before live use** (tests use mocks/placeholders): real H+1/H+2 template `name` + `language` + parameter mapping; `KIRIMDEV_API_KEY`. Until then `FOLLOWUP_STAGES` uses placeholder template names.

## File Structure

- `convex/followUpMath.ts` (new) — `FOLLOWUP_STAGES` config + pure `eligibleStage()` + types. No Convex imports.
- `convex/followUpMath.test.ts` (new) — vitest unit tests.
- `convex/schema.ts` (modify) — add `followUpStage`, `followUpStageAt` to `conversations`.
- `convex/followUp.ts` (new) — `getFollowUpCandidates` query + `candidacyFor` internalQuery + `sendFollowUp` action + `stampFollowUp` internalMutation.
- `convex/followUp.test.ts` (new) — convex-test for the query + the action (fetch mocked).
- `app/api/follow-up/send/route.ts` (new) — JWT-verified POST → secret-gated action.
- `app/panel/follow-up/page.tsx` (new) — the page (2 tabs).
- `components/panel/follow-up-dashboard.tsx` (new) — tabs + table + send wiring + states.
- `app/panel/layout.tsx` (modify) — add the "Follow-up" nav entry.

---

### Task 1: Pure eligibility module (`followUpMath.ts`)

**Files:**
- Create: `convex/followUpMath.ts`
- Test: `convex/followUpMath.test.ts`

**Interfaces:**
- Produces: `FOLLOWUP_STAGES: FollowUpStageConfig[]`; `eligibleStage(input: CandidacyInput, stages?): number | null`; types `FollowUpStageConfig`, `CandidacyInput`.

- [ ] **Step 1: Write the failing test**

```ts
// convex/followUpMath.test.ts
import { expect, test } from "vitest";
import { eligibleStage, FOLLOWUP_STAGES, type CandidacyInput } from "./followUpMath";

const HOUR = 3_600_000;
const base = (over: Partial<CandidacyInput>): CandidacyInput => ({
  lastInboundAt: 0, lastMessageOutbound: true, isClosed: false,
  followUpStage: null, followUpStageAt: null, now: 30 * HOUR, ...over,
});

test("ghosted, 30h since inbound, no prior follow-up -> stage 1 (H+1)", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 30 * HOUR }))).toBe(1);
});

test("customer spoke last (not ghosted) -> null", () => {
  expect(eligibleStage(base({ lastMessageOutbound: false }))).toBeNull();
});

test("closed (recap/conversation) -> null", () => {
  expect(eligibleStage(base({ isClosed: true }))).toBeNull();
});

test("within 24h of last inbound -> null (window not yet closed)", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 10 * HOUR }))).toBeNull();
});

test("older than 5-day ceiling -> null", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 130 * HOUR }))).toBeNull();
});

test("got H+1, 26h later, still silent -> stage 2 (H+2)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 1, followUpStageAt: 26 * HOUR, now: 52 * HOUR,
  }))).toBe(2);
});

test("got H+1 but replied after it -> null (left the funnel)", () => {
  // lastInboundAt (30h) is AFTER followUpStageAt (26h) -> customer responded; also not ghosted now
  expect(eligibleStage(base({
    lastInboundAt: 30 * HOUR, lastMessageOutbound: false, followUpStage: 1,
    followUpStageAt: 26 * HOUR, now: 52 * HOUR,
  }))).toBeNull();
});

test("got H+1 but only 10h passed -> null (too soon for H+2)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 1, followUpStageAt: 40 * HOUR, now: 50 * HOUR,
  }))).toBeNull();
});

test("already at H+2 -> null (funnel done)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 2, followUpStageAt: 50 * HOUR, now: 80 * HOUR,
  }))).toBeNull();
});

test("config: two stages, H+1 then H+2", () => {
  expect(FOLLOWUP_STAGES.map((s) => s.label)).toEqual(["H+1", "H+2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUpMath.test.ts`
Expected: FAIL ("Failed to resolve import './followUpMath'").

- [ ] **Step 3: Write minimal implementation**

```ts
// convex/followUpMath.ts
// Pure funnel-eligibility helpers — no Convex imports so they run plain in vitest.
// A conversation is scored against fixed stage configs; eligibleStage returns the stage
// it qualifies for (1 = H+1, 2 = H+2) or null. Mirrors the responseTimeMath.ts pattern.

export type FollowUpStageConfig = {
  stage: number;
  label: string;
  templateName: string;
  language: string;
  minHoursSinceLastInbound?: number;
  maxHoursSinceLastInbound?: number;
  requiresPrevStage?: number; // stage number that must already be sent (H+2 needs H+1)
  minHoursSincePrevStage?: number;
};

// NOTE: templateName values are PLACEHOLDERS until the user supplies the approved names.
export const FOLLOWUP_STAGES: FollowUpStageConfig[] = [
  { stage: 1, label: "H+1", templateName: "followup_h1", language: "id",
    minHoursSinceLastInbound: 24, maxHoursSinceLastInbound: 120 }, // 24h .. 5-day ceiling
  { stage: 2, label: "H+2", templateName: "followup_h2", language: "id",
    requiresPrevStage: 1, minHoursSincePrevStage: 20, maxHoursSinceLastInbound: 120 },
];

const HOUR = 3_600_000;

export type CandidacyInput = {
  lastInboundAt: number | null;   // customer's most recent inbound message
  lastMessageOutbound: boolean;   // most recent message in the thread is outbound (ghosted)
  isClosed: boolean;              // shippingRecap exists OR conversation.status === "closed"
  followUpStage: number | null;   // highest stage already sent (null/0 = none)
  followUpStageAt: number | null; // when that stage was sent
  now: number;
};

/** The funnel stage this conversation qualifies for, or null. First matching stage wins. */
export function eligibleStage(input: CandidacyInput, stages: FollowUpStageConfig[] = FOLLOWUP_STAGES): number | null {
  if (input.isClosed) return null;
  if (!input.lastMessageOutbound) return null;   // customer spoke last -> not ghosted
  if (input.lastInboundAt == null) return null;  // never chatted us
  const sinceInbound = input.now - input.lastInboundAt;
  const curStage = input.followUpStage ?? 0;
  for (const s of stages) {
    if (curStage !== (s.requiresPrevStage ?? 0)) continue; // must be exactly at the prior stage
    if (s.minHoursSinceLastInbound != null && sinceInbound < s.minHoursSinceLastInbound * HOUR) continue;
    if (s.maxHoursSinceLastInbound != null && sinceInbound > s.maxHoursSinceLastInbound * HOUR) continue;
    if (s.requiresPrevStage != null) {
      if (input.followUpStageAt == null) continue;
      if (s.minHoursSincePrevStage != null && input.now - input.followUpStageAt < s.minHoursSincePrevStage * HOUR) continue;
      if (input.lastInboundAt >= input.followUpStageAt) continue; // replied after the prior follow-up
    }
    return s.stage;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUpMath.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/followUpMath.ts convex/followUpMath.test.ts
git commit -m "feat(followup): pure funnel-eligibility helpers (H+1/H+2 stages)"
```

---

### Task 2: Schema fields

**Files:**
- Modify: `convex/schema.ts` (the `conversations` table, around lines 37-52)

**Interfaces:**
- Produces: `conversations.followUpStage?: number`, `conversations.followUpStageAt?: number` (read by Task 3, written by Task 4).

- [ ] **Step 1: Add the two optional fields**

In `convex/schema.ts`, inside `conversations: defineTable({ ... })`, after `lastMessageAt: v.optional(v.number()),` add:

```ts
    followUpStage: v.optional(v.number()),   // 1 = H+1 sent, 2 = H+2 sent
    followUpStageAt: v.optional(v.number()),
```

- [ ] **Step 2: Regenerate types + typecheck**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex codegen && npx tsc --noEmit`
Expected: no errors (optional fields are backward-compatible).

- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/schema.ts convex/_generated
git commit -m "feat(followup): add followUpStage/followUpStageAt to conversations"
```

---

### Task 3: `getFollowUpCandidates` query

**Files:**
- Create: `convex/followUp.ts`
- Test: `convex/followUp.test.ts`

**Interfaces:**
- Consumes: `eligibleStage` (Task 1); `csKey`, `isInternalTestPhone` from `./lib`.
- Produces: query `getFollowUpCandidates({ csName?: string, nowOverride?: number }) => { stage1: Candidate[]; stage2: Candidate[] }` where `Candidate = { conversationId, customerName, customerPhone, productName, orderId, csName, lastInboundAt }`.

- [ ] **Step 1: Write the failing convex-test**

```ts
// convex/followUp.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 5, 26, 5, 0, 0); // fixed reference
const convBase = {
  customerName: "Budi", assignedCsName: "Nabila", status: "active" as const,
  aiEnabled: false, note: "", createdAt: now - 50 * HOUR, updatedAt: now,
};
const orderBase = {
  customerName: "Budi", assignedCsName: "Nabila", productName: "Quran Mapping",
  products: "Quran Mapping", productsSubtotal: "0", shippingCost: "0", total: "0",
  shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const,
  aiEligible: false, createdAt: now - 50 * HOUR, updatedAt: now,
};
const msg = (conversationId: any, orderId: string, phone: string, direction: "inbound" | "outbound", createdAt: number) =>
  ({ conversationId, orderId, customerPhone: phone, role: direction === "inbound" ? "customer" as const : "cs" as const,
     direction, content: "x", messageType: "text" as const, source: "n8n" as const, createdAt });

test("getFollowUpCandidates: ghosted >24h, not closed -> stage1", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-1", customerPhone: "62811" });
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-1", "62811", "outbound", now - 29 * HOUR));
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toContain("O-1");
  expect(r.stage2.length).toBe(0);
});

test("getFollowUpCandidates: closed (shippingRecap) excluded", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", { ...convBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-2", customerPhone: "62812" });
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(conv, "O-2", "62812", "outbound", now - 29 * HOUR));
    await ctx.db.insert("shippingRecaps", {
      customerPhone: "62812", customerName: "Budi", csName: "Nabila", closedAt: now - 20 * HOUR,
      recipientName: "Budi", recipientPhone: "62812", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "Quran Mapping", paymentMethod: "cod" as const,
      status: "ready" as const, flags: [], sourceMessageText: "", version: 1,
      createdAt: now - 20 * HOUR, updatedAt: now - 20 * HOUR,
    });
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { nowOverride: now });
  expect(r.stage1.length).toBe(0);
});

test("getFollowUpCandidates: csName scope filters to that CS", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const c1 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    const c2 = await ctx.db.insert("conversations", { ...convBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-3", customerPhone: "62813", assignedCsName: "Nabila" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-4", customerPhone: "62814", assignedCsName: "Lila" });
    for (const [c, o, p] of [[c1, "O-3", "62813"], [c2, "O-4", "62814"]] as const) {
      await ctx.db.insert("messages", msg(c, o, p, "inbound", now - 30 * HOUR));
      await ctx.db.insert("messages", msg(c, o, p, "outbound", now - 29 * HOUR));
    }
  });
  const r = await t.query(api.followUp.getFollowUpCandidates, { csName: "Nabila", nowOverride: now });
  expect(r.stage1.map((c) => c.orderId)).toEqual(["O-3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUp.test.ts`
Expected: FAIL ("api.followUp.getFollowUpCandidates is not a function").

- [ ] **Step 3: Write the query**

```ts
// convex/followUp.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { csKey, isInternalTestPhone } from "./lib";
import { eligibleStage } from "./followUpMath";

// nowOverride is test-only (Date.now() is unavailable in some runtimes); prod passes nothing.
export const getFollowUpCandidates = query({
  args: { csName: v.optional(v.string()), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.nowOverride ?? Date.now();
    const wantKey = args.csName ? csKey(args.csName) : null;

    // Open conversations only (active + handover), never closed.
    const open = (await ctx.db.query("conversations").collect())
      .filter((c) => c.status !== "closed")
      .filter((c) => !isInternalTestPhone(c.customerPhone))
      .filter((c) => (wantKey ? csKey(c.assignedCsName) === wantKey : true));

    // Closed-by-recap set (one phone lookup per conversation, parallel).
    const recaps = await Promise.all(
      open.map((c) => ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", c.customerPhone)).first()),
    );
    // Last messages per conversation tell us last-inbound + last-direction.
    const lastMsgs = await Promise.all(
      open.map((c) => ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").take(30)),
    );
    const orders = await Promise.all(
      open.map((c) => ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", c.orderId)).first()),
    );

    type Candidate = { conversationId: typeof open[number]["_id"]; customerName: string; customerPhone: string;
      productName: string; orderId: string; csName: string; lastInboundAt: number };
    const stage1: Candidate[] = [];
    const stage2: Candidate[] = [];
    open.forEach((c, i) => {
      const msgs = lastMsgs[i]; // desc
      const lastInbound = msgs.find((m) => m.direction === "inbound");
      const stage = eligibleStage({
        lastInboundAt: lastInbound?.createdAt ?? null,
        lastMessageOutbound: msgs.length > 0 && msgs[0].direction === "outbound",
        isClosed: c.status === "closed" || recaps[i] != null,
        followUpStage: c.followUpStage ?? null,
        followUpStageAt: c.followUpStageAt ?? null,
        now,
      });
      if (stage == null) return;
      const card: Candidate = {
        conversationId: c._id, customerName: c.customerName, customerPhone: c.customerPhone,
        productName: orders[i]?.productName ?? "—", orderId: c.orderId,
        csName: c.assignedCsName, lastInboundAt: lastInbound!.createdAt,
      };
      (stage === 1 ? stage1 : stage2).push(card);
    });
    stage1.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    stage2.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    return { stage1, stage2 };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/followUp.ts convex/followUp.test.ts
git commit -m "feat(followup): getFollowUpCandidates query (derive-on-read, per stage)"
```

---

### Task 4: `sendFollowUp` action (KirimDev send + stamp)

**Files:**
- Modify: `convex/followUp.ts` (append `candidacyFor` internalQuery, `stampFollowUp` internalMutation, `sendFollowUp` action)
- Test: `convex/followUp.test.ts` (append)

**Interfaces:**
- Consumes: `FOLLOWUP_STAGES`, `eligibleStage` (Task 1); `csConfigs.providerNumberId`; `normalizeCsName` from `./shippingRecaps`; env `KIRIMDEV_API_KEY`, `KIRIMDEV_BASE_URL`, `PANEL_AUTH_SECRET`.
- Produces: action `sendFollowUp({ conversationId, stage, authSecret, nowOverride? }) => { ok: boolean, error?: string }`.

- [ ] **Step 1: Write the failing tests (fetch mocked)**

```ts
// append to convex/followUp.test.ts
import { vi } from "vitest";

const csCfg = (csName: string) => ({
  normalizedName: csName.toLowerCase().replace(/[^a-z]/g, ""), csName, providerNumberId: "PHONE123",
  orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
  isActive: true, createdAt: now, updatedAt: now,
});

test("sendFollowUp: success stamps stage + inserts template message", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-9", customerPhone: "62899" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-9", customerPhone: "62899" });
    await ctx.db.insert("messages", msg(convId, "O-9", "62899", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-9", "62899", "outbound", now - 29 * HOUR));
    await ctx.db.insert("csConfigs", csCfg("Nabila"));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret"; process.env.KIRIMDEV_API_KEY = "k_test";
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "wamid.1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "s3cret", nowOverride: now });
  expect(res.ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  await t.run(async (ctx) => {
    const c = await ctx.db.get(convId);
    expect(c!.followUpStage).toBe(1);
    const msgs = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", convId)).collect();
    expect(msgs.some((m) => m.messageType === "template" && m.direction === "outbound")).toBe(true);
  });
  vi.unstubAllGlobals();
});

test("sendFollowUp: wrong secret -> not ok, no send", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => { convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-10", customerPhone: "62810" }); });
  process.env.PANEL_AUTH_SECRET = "s3cret";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "WRONG", nowOverride: now });
  expect(res.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("sendFollowUp: KirimDev error code -> not ok, not stamped", async () => {
  const t = convexTest(schema);
  let convId: any;
  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { ...convBase, orderId: "O-11", customerPhone: "62811b" });
    await ctx.db.insert("orders", { ...orderBase, orderId: "O-11", customerPhone: "62811b" });
    await ctx.db.insert("messages", msg(convId, "O-11", "62811b", "inbound", now - 30 * HOUR));
    await ctx.db.insert("messages", msg(convId, "O-11", "62811b", "outbound", now - 29 * HOUR));
    await ctx.db.insert("csConfigs", csCfg("Nabila"));
  });
  process.env.PANEL_AUTH_SECRET = "s3cret"; process.env.KIRIMDEV_API_KEY = "k_test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "template_paused" } }), { status: 400 })));
  const res = await t.action(api.followUp.sendFollowUp, { conversationId: convId, stage: 1, authSecret: "s3cret", nowOverride: now });
  expect(res.ok).toBe(false);
  await t.run(async (ctx) => { expect((await ctx.db.get(convId))!.followUpStage).toBeUndefined(); });
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUp.test.ts`
Expected: FAIL ("api.followUp.sendFollowUp is not a function").

- [ ] **Step 3: Implement `candidacyFor`, `stampFollowUp`, `sendFollowUp`**

Append to `convex/followUp.ts`:

```ts
// NOTE: merge into the file's existing imports — `query`, `v`, and `eligibleStage` are already
// imported from Task 3; only add the NEW bindings below (do not re-import `eligibleStage`).
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeCsName } from "./shippingRecaps";
import { FOLLOWUP_STAGES } from "./followUpMath";

const KIRIM_ERR: Record<string, string> = {
  template_paused: "Template lagi dijeda Meta — cek di KirimDev.",
  template_not_found: "Template belum approved.",
  template_policy_violation: "Template melanggar kebijakan Meta.",
  account_rate_limited: "Nomor lagi dibatasi, coba lagi nanti.",
  app_rate_limited: "Lagi terlalu banyak kirim, coba lagi sebentar.",
  outside_24h_window: "Window 24 jam — harusnya pakai template (cek konfigurasi).",
  marketing_blocked_by_user: "Customer memblokir pesan marketing.",
};

// Re-derive eligibility + resolve the CS WABA number for one conversation (defends the send).
export const candidacyFor = internalQuery({
  args: { conversationId: v.id("conversations"), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    if (!c) return null;
    const now = args.nowOverride ?? Date.now();
    const recap = await ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", c.customerPhone)).first();
    const msgs = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").take(30);
    const lastInbound = msgs.find((m) => m.direction === "inbound");
    const order = await ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", c.orderId)).first();
    const normName = normalizeCsName(c.assignedCsName).toLowerCase().replace(/[^a-z]/g, "");
    const cfg = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", normName)).first();
    const eligible = eligibleStage({
      lastInboundAt: lastInbound?.createdAt ?? null,
      lastMessageOutbound: msgs.length > 0 && msgs[0].direction === "outbound",
      isClosed: c.status === "closed" || recap != null,
      followUpStage: c.followUpStage ?? null, followUpStageAt: c.followUpStageAt ?? null, now,
    });
    return { eligible, phoneNumberId: cfg?.providerNumberId ?? null, customerName: c.customerName,
             customerPhone: c.customerPhone, orderId: c.orderId, productName: order?.productName ?? "—" };
  },
});

export const stampFollowUp = internalMutation({
  args: { conversationId: v.id("conversations"), stage: v.number(), at: v.number(),
          orderId: v.string(), customerPhone: v.string(), content: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.conversationId, { followUpStage: a.stage, followUpStageAt: a.at, updatedAt: a.at });
    await ctx.db.insert("messages", {
      conversationId: a.conversationId, orderId: a.orderId, customerPhone: a.customerPhone,
      role: "cs", direction: "outbound", content: a.content, messageType: "template",
      source: "panel", createdAt: a.at,
    });
  },
});

export const sendFollowUp = action({
  args: { conversationId: v.id("conversations"), stage: v.number(), authSecret: v.string(),
          nowOverride: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    const now = args.nowOverride ?? Date.now();
    const d = await ctx.runQuery(internal.followUp.candidacyFor, { conversationId: args.conversationId, nowOverride: now });
    if (!d) return { ok: false, error: "Percakapan tidak ditemukan." };
    if (d.eligible !== args.stage) {
      return { ok: false, error: "Sudah tidak eligible (mungkin sudah dibalas / closing / sudah di-follow-up)." };
    }
    if (!d.phoneNumberId) return { ok: false, error: "Nomor WABA CS belum dikonfigurasi." };
    const cfg = FOLLOWUP_STAGES.find((s) => s.stage === args.stage)!;
    const base = process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1";
    // Positional params — FINALISE order once the real template is known: {{1}}=name, {{2}}=product, {{3}}=orderId.
    const params = [d.customerName, d.productName, d.orderId];
    let resp: Response;
    try {
      resp = await fetch(`${base}/${d.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.KIRIMDEV_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `fu-${args.conversationId}-${args.stage}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: d.customerPhone, type: "template",
          template: { name: cfg.templateName, language: cfg.language,
            components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
        }),
      });
    } catch {
      return { ok: false, error: "Gagal menghubungi KirimDev." };
    }
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
      const code = body?.error?.code;
      return { ok: false, error: (code && KIRIM_ERR[code]) || `Gagal kirim${code ? ` (${code})` : ""}.` };
    }
    await ctx.runMutation(internal.followUp.stampFollowUp, {
      conversationId: args.conversationId, stage: args.stage, at: now,
      orderId: d.orderId, customerPhone: d.customerPhone,
      content: `[follow-up ${cfg.label}] ${cfg.templateName}`,
    });
    return { ok: true };
  },
});
```

> **Implementer check:** confirm `csConfigs.by_normalizedName` key derivation matches stored rows (inspect one `csConfigs` row). If `normalizedName` is already the bare key (no "cs" prefix), align the lookup with `csKey(c.assignedCsName)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/followUp.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add convex/followUp.ts convex/followUp.test.ts
git commit -m "feat(followup): sendFollowUp action (KirimDev template + idempotency-key + stamp)"
```

---

### Task 5: JWT-verified send route

**Files:**
- Create: `app/api/follow-up/send/route.ts`

**Interfaces:**
- Consumes: `verifySession` from `@/lib/auth-jwt`; `sendFollowUp` action; `ConvexHttpClient`. **Open `app/api/admin/users/route.ts` first** and copy its exact session-read + Convex-client pattern (cookie name, env var, `verifySession` signature).
- Produces: `POST /api/follow-up/send` body `{ conversationId, stage }` → `{ ok, error? }`.

- [ ] **Step 1: Implement the route (mirror admin/users)**

```ts
// app/api/follow-up/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { verifySession } from "@/lib/auth-jwt";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("auth_token")?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { conversationId, stage } = await req.json();
  if (!conversationId || (stage !== 1 && stage !== 2)) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const result = await client.action(api.followUp.sendFollowUp, {
    conversationId, stage, authSecret: process.env.PANEL_AUTH_SECRET!,
  });
  return NextResponse.json(result);
}
```

> **Implementer check:** match `verifySession`, the cookie name (`auth_token`), and the Convex URL env var to whatever `app/api/admin/users/route.ts` actually uses.

- [ ] **Step 2: Typecheck**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add app/api/follow-up/send/route.ts
git commit -m "feat(followup): JWT-verified send route -> secret-gated action"
```

---

### Task 6: Follow-up page (2 tabs) + nav entry

**Files:**
- Create: `app/panel/follow-up/page.tsx`
- Create: `components/panel/follow-up-dashboard.tsx`
- Modify: `app/panel/layout.tsx` (the `NAV` array, line 13-18; lucide import line 6)

**Interfaces:**
- Consumes: `api.followUp.getFollowUpCandidates` (Task 3); `POST /api/follow-up/send` (Task 5); `/api/me` for `{name, role}`; UI primitives in `components/ui/*`; the `useQuery` + `/api/me` conventions in `app/panel/layout.tsx` and `components/panel/daily-report-dashboard.tsx`.

- [ ] **Step 1: Add the nav entry**

In `app/panel/layout.tsx`: add `Send` to the lucide import (line 6), then add to `NAV` after the Laporan entry:

```ts
  { href: '/panel/follow-up', label: 'Follow-up', icon: Send },
```

(Desktop sidebar, mobile bottom nav, and the title bar all read `NAV`, so they update automatically. Visible to all roles.)

- [ ] **Step 2: Create the page shell**

```tsx
// app/panel/follow-up/page.tsx
import { FollowUpDashboard } from '@/components/panel/follow-up-dashboard';
export default function FollowUpPage() {
  return <FollowUpDashboard />;
}
```

- [ ] **Step 3: Build the dashboard component**

Create `components/panel/follow-up-dashboard.tsx` (`'use client'`). Follow `daily-report-dashboard.tsx` for `useQuery` + `/api/me` + Tailwind/shadcn conventions. It must:

1. Read `me` via `fetch('/api/me')` → `{ name, role }` (copy the effect from `app/panel/layout.tsx` lines 36-39).
2. `const csName = me?.role === 'cs' ? me.name : undefined;`
3. `const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');`
4. A 2-button tab toggle (local `useState<'stage1'|'stage2'>`), styled like the range buttons in `layout.tsx`, each showing its count: `H+1 ({data?.stage1.length ?? 0})`, `H+2 ({data?.stage2.length ?? 0})`.
5. A table for the active tab — columns: **Customer · Produk · Order · "chat terakhir {rel}"** · (a **CS** column only when `me?.role==='admin'`) · action. `rel` = a relative-time string from `lastInboundAt` (e.g. `Math.round((Date.now()-t)/3.6e6)` → "Xj lalu" / "Xh lalu").
6. Per-row **"Kirim"** button calling:
```ts
const [sending, setSending] = useState<Record<string, boolean>>({});
const [result, setResult] = useState<Record<string, 'ok' | string>>({});
async function send(conversationId: string, stage: 1 | 2) {
  setSending((s) => ({ ...s, [conversationId]: true }));
  const r = await fetch('/api/follow-up/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, stage }),
  }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Gagal' }));
  setSending((s) => ({ ...s, [conversationId]: false }));
  setResult((m) => ({ ...m, [conversationId]: r.ok ? 'ok' : (r.error || 'Gagal') }));
}
```
A row whose `result` is `'ok'` renders **"✓ Terkirim"** (the next `useQuery` refetch drops it anyway); a string result renders as inline red error text.
7. **Batch:** a header checkbox + per-row checkboxes (local `Set<string>`); a **"Kirim terpilih (N)"** button that, when `N > 20`, calls `window.confirm('Kirim follow-up ke N customer sekaligus?')` before `for…of` looping `send` over the selected ids (sequential; collect per-row results).
8. **States:** skeleton while `data === undefined`; per-tab empty state ("Tidak ada yang perlu di-follow-up 🎉"); the `stage` passed to `send` is `1` on the H+1 tab, `2` on the H+2 tab.

- [ ] **Step 4: Typecheck + build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat
git add app/panel/follow-up app/panel/layout.tsx components/panel/follow-up-dashboard.tsx
git commit -m "feat(followup): Follow-up page (H+1/H+2 tabs, send + batch) + nav entry"
```

---

## Final integration (after all tasks)

- [ ] Full suite + build: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build` (EXIT 0).
- [ ] Merge to main.
- [ ] **Set Convex env via dashboard** (deploy key can't `env:write`): `KIRIMDEV_API_KEY`, optional `KIRIMDEV_BASE_URL`; reuse existing `PANEL_AUTH_SECRET`.
- [ ] **Fill real template config** in `FOLLOWUP_STAGES` (`templateName`, `language`) + confirm `params` order matches the approved H+1/H+2 templates (user-supplied).
- [ ] `npx convex deploy -y` (schema + query + action).
- [ ] `git push`.
- [ ] **Live smoke** to ONE test number per stage before rollout: candidate appears in H+1 → send → stamped + leaves list; next day it surfaces in H+2.

## Tasks NOT to do (out of scope)
- No chat inbox/CRM. No automated/scheduled sends. No H+3 / H+2A-H+2B variants (config is ready; don't build). No changes to the order-notif n8n flow.
