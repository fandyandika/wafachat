# WaFaChat Dashboard Fase 1B — Auto-Closing Message Pipeline (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a closing record when a CS's outbound WhatsApp message matches a user-configurable phrase (e.g. `PEMESANAN BERHASIL`), fed by a real KirimDev message webhook, deduped per order — so closings are captured without manual marking.

**Architecture:** Convex, derive-on-read (closings already counted by Plan 1A's `getDashboardSummary`/`getPerformance` from `shippingRecaps`). This plan adds: a `closingRules` table for configurable phrases; idempotent message ingestion (dedup by `externalMessageId`); a reusable `upsertRecapFromMessage` helper extracted from the existing `backfillFromMessages` (DRY); real-time auto-closing inside `appendMessageFromN8n`; and a new n8n workflow subscribing to KirimDev `message.sent`/`message.received` webhooks.

**Tech Stack:** Convex 1.39, TypeScript, Vitest + convex-test (from Plan 1A), n8n, KirimDev webhooks.

**Scope split:** Plan 1B of Fase 1. Plan 1A (metrics accuracy + leads feed) is done. Spec: `wafachat/docs/superpowers/specs/2026-06-18-wafachat-dashboard-fase1-data-foundation-design.md` (components 2 message pipeline, 3 auto-closing detector, 5 configurable closing rules).

## Global Constraints

- **Auto-closing matches OUTBOUND messages only** (role `cs`/`ai`, `direction: "outbound"`) — never inbound, to avoid false positives from customers quoting text.
- **Dedup per order/conversation:** one closing per order regardless of how many times the phrase appears or across days; closing date = first detection. Reuse the existing `findExistingRecap` + `sourceMessageId` dedup in `backfillFromMessages`.
- **Manual override wins:** `createFromPanelClosing` (status flags `MANUAL_CLOSING`) and exported/delivered recaps are never overwritten by auto-detection (mirror the existing guard: skip when `existing.status` is `exported`/`delivered`).
- **Phrases are case-insensitive, multiple allowed.** Default seed: `PEMESANAN BERHASIL`. Stored in a `closingRules` table (the `settings` table holds only booleans, so it cannot store phrase strings).
- **Idempotent ingestion:** the same `externalMessageId` ingested twice → exactly one `messages` row.
- **Stay Convex; reuse existing parsers** (`parseClosingMessage`, `compareWithOrder`, `applyOrderFallbacks`, `findOrder`, `findConversation`, `findExistingRecap` in `convex/shippingRecaps.ts`). Don't duplicate parsing.
- **Closing recap shape is the existing `shippingRecaps` schema** — auto recaps set `flags` from `compareWithOrder` and `status` = `needs_review` when flagged else `parsed.status`.
- Tests use the Plan 1A harness: `npm test` (vitest + convex-test), files `convex/*.test.ts`.

---

### Task 1: `closingRules` table + active-phrases query + seed

**Files:**
- Modify: `wafachat/convex/schema.ts` (add `closingRules` table)
- Create: `wafachat/convex/closingRules.ts`
- Test: `wafachat/convex/closingRules.test.ts`

**Interfaces:**
- Produces: `api.closingRules.getActivePhrases() => string[]` (uppercased, trimmed; falls back to `["PEMESANAN BERHASIL"]` when the table is empty). `api.closingRules.seedDefault()` mutation (idempotent). Internal helper `getActiveClosingPhrases(ctx): Promise<string[]>` exported from `closingRules.ts` for reuse by the detector.

- [ ] **Step 1: Add the table to `convex/schema.ts`.** Inside `defineSchema({ ... })`, after the `settings` table, add:
```ts
  closingRules: defineTable({
    phrase: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_active", ["active"]),
```

- [ ] **Step 2: Write the failing test** `wafachat/convex/closingRules.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

test("getActivePhrases: empty table falls back to default", async () => {
  const t = convexTest(schema);
  const phrases = await t.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["PEMESANAN BERHASIL"]);
});

test("getActivePhrases: returns active rows uppercased, ignores inactive", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("closingRules", { phrase: "deal ya kak", active: true, createdAt: 1 });
    await ctx.db.insert("closingRules", { phrase: "draft", active: false, createdAt: 1 });
  });
  const phrases = await t.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["DEAL YA KAK"]);
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL ("Could not find module for: closingRules").

- [ ] **Step 4: Implement `convex/closingRules.ts`:**
```ts
import { mutation, query } from "./_generated/server";

const DEFAULT_PHRASES = ["PEMESANAN BERHASIL"];

export async function getActiveClosingPhrases(ctx: { db: any }): Promise<string[]> {
  const rows = await ctx.db
    .query("closingRules")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();
  const phrases = rows
    .map((r: any) => String(r.phrase || "").trim().toUpperCase())
    .filter((p: string) => p.length > 0);
  return phrases.length > 0 ? phrases : [...DEFAULT_PHRASES];
}

export const getActivePhrases = query({
  args: {},
  handler: async (ctx) => getActiveClosingPhrases(ctx),
});

export const seedDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("closingRules").collect();
    if (existing.length > 0) return { seeded: false, count: existing.length };
    for (const phrase of DEFAULT_PHRASES) {
      await ctx.db.insert("closingRules", { phrase, active: true, createdAt: Date.now() });
    }
    return { seeded: true, count: DEFAULT_PHRASES.length };
  },
});
```

- [ ] **Step 5: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (both new tests + Plan 1A's 3 tests).

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/schema.ts wafachat/convex/closingRules.ts wafachat/convex/closingRules.test.ts
git commit -m "feat(closing): configurable closingRules table + getActivePhrases (default PEMESANAN BERHASIL)"
```

---

### Task 2: Idempotent message ingestion (dedup by `externalMessageId`)

**Files:**
- Modify: `wafachat/convex/schema.ts` (add `messages` index `by_externalMessageId`)
- Modify: `wafachat/convex/messages.ts` (`appendMessageFromN8n`)
- Test: `wafachat/convex/messages.test.ts`

**Interfaces:**
- Consumes: `messages` table.
- Produces: `appendMessageFromN8n` returns `{ success, messageId, conversationId, order_id, phone, _action, deduped?: boolean }`; when `externalMessageId` already exists, it returns the existing message id with `deduped: true` and inserts no new row/event.

- [ ] **Step 1: Add the index in `convex/schema.ts`.** In the `messages` table definition, add to its index chain:
```ts
    .index("by_externalMessageId", ["externalMessageId"]),
```
(append after the existing `.index("by_orderId_createdAt", ...)`).

- [ ] **Step 2: Write the failing test** `wafachat/convex/messages.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

test("appendMessageFromN8n: same externalMessageId twice -> one row", async () => {
  const t = convexTest(schema);
  const args = {
    phone: "62811", order_id: "O-1", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const, content: "halo",
    messageType: "text" as const, externalMessageId: "msg_ABC", createdAt: 1000,
  };
  const first = await t.mutation(api.messages.appendMessageFromN8n, args);
  const second = await t.mutation(api.messages.appendMessageFromN8n, args);
  expect(second.deduped).toBe(true);
  expect(second.messageId).toBe(first.messageId);
  const rows = await t.run(async (ctx) =>
    ctx.db.query("messages").withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", "msg_ABC")).collect());
  expect(rows.length).toBe(1);
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (`second.deduped` is undefined / two rows).

- [ ] **Step 4: Add the dedup guard in `convex/messages.ts`.** In `appendMessageFromN8n`'s handler, immediately after `const phone = normalizePhone(args.phone);`, insert:
```ts
    if (args.externalMessageId) {
      const dup = await ctx.db
        .query("messages")
        .withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", args.externalMessageId))
        .first();
      if (dup) {
        return {
          success: true, messageId: dup._id, conversationId: dup.conversationId,
          order_id: dup.orderId, phone: dup.customerPhone, _action: "append_message", deduped: true,
        };
      }
    }
```

- [ ] **Step 5: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/schema.ts wafachat/convex/messages.ts wafachat/convex/messages.test.ts
git commit -m "feat(messages): idempotent ingestion (dedup by externalMessageId)"
```

---

### Task 3: Extract reusable `upsertRecapFromMessage` helper (DRY) + configurable phrases

**Files:**
- Modify: `wafachat/convex/shippingRecaps.ts` (extract helper from `backfillFromMessages`; export it; use `getActiveClosingPhrases`)
- Test: `wafachat/convex/shippingRecaps.test.ts`

**Interfaces:**
- Consumes: existing private `parseClosingMessage`, `applyOrderFallbacks`, `compareWithOrder`, `findOrder`, `findConversation`, `findExistingRecap`; `getActiveClosingPhrases` from `./closingRules`.
- Produces (exported from `shippingRecaps.ts`):
  - `messageMatchesPhrase(content: string, phrases: string[]): boolean` — case-insensitive substring match.
  - `upsertRecapFromMessage(ctx, message: { orderId?: string; customerPhone: string; content: string; externalMessageId?: string; _id: any; createdAt: number }, opts?: { force?: boolean }): Promise<{ recapId: Id<"shippingRecaps">; action: "created" | "updated" | "skipped" }>` — parses the message, upserts the recap with the existing dedup, never overwrites `exported`/`delivered` recaps.

- [ ] **Step 1: Write the failing characterization test** `wafachat/convex/shippingRecaps.test.ts`:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const t0 = 1_750_000_000_000;

test("backfillFromMessages still upserts one recap for an outbound PEMESANAN BERHASIL", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", {
      orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
      status: "active", aiEnabled: true, note: "", createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("messages", {
      conversationId: convId, orderId: "O-1", customerPhone: "62811", role: "cs",
      direction: "outbound", content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
      messageType: "text", source: "n8n", externalMessageId: "msg_1", createdAt: t0,
    });
  });
  const res = await t.mutation(api.shippingRecaps.backfillFromMessages, {});
  expect(res.upserted).toBe(1);
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  expect(recaps[0].orderIdBerdu).toBe("O-1");
});
```
(`backfillFromMessages` returns `{ scanned, upserted, skipped, recapIds }`.)

- [ ] **Step 2: Run to verify it passes (characterization).** Run: `cd wafachat && npm test`. Expected: PASS (locks current backfill behavior before refactor). If FAIL, STOP and reconcile.

- [ ] **Step 3: Extract the helper in `convex/shippingRecaps.ts`.** Add `import { getActiveClosingPhrases } from "./closingRules";` to the top imports. Add these functions above `backfillFromMessages`:
```ts
export function messageMatchesPhrase(content: string, phrases: string[]): boolean {
  const haystack = String(content || "").toUpperCase();
  return phrases.some((p) => haystack.includes(p));
}

export async function upsertRecapFromMessage(
  ctx: any,
  message: { orderId?: string; customerPhone: string; content: string; externalMessageId?: string; _id: any; createdAt: number },
  opts?: { force?: boolean },
): Promise<{ recapId: Id<"shippingRecaps">; action: "created" | "updated" | "skipped" }> {
  const order = await findOrder(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone });
  const conversation = await findConversation(ctx, { orderIdBerdu: message.orderId, customerPhone: message.customerPhone });
  const parsed = applyOrderFallbacks(parseClosingMessage(message.content), order);
  const comparison = compareWithOrder(parsed, order);
  const existing = await findExistingRecap(ctx, {
    orderIdBerdu: message.orderId || order?.orderId,
    customerPhone: message.customerPhone,
    conversationId: conversation?._id,
  });
  if (existing && (existing.status === "exported" || existing.status === "delivered")) {
    return { recapId: existing._id, action: "skipped" };
  }
  const flags = comparison.flags;
  const status: RecapStatus = flags.length > 0 ? "needs_review" : parsed.status;
  const sourceMessageId = message.externalMessageId ?? message._id;
  const payload = {
    orderIdBerdu: message.orderId || order?.orderId,
    conversationId: conversation?._id,
    customerPhone: message.customerPhone,
    customerName: order?.customerName ?? conversation?.customerName ?? "",
    csName: order?.assignedCsName ?? conversation?.assignedCsName ?? "",
    csPhone: order?.assignedCsNumber,
    orderedAt: order?.createdAt,
    closedAt: message.createdAt,
    recipientName: parsed.recipientName,
    recipientPhone: parsed.recipientPhone,
    recipientAddress: parsed.recipientAddress,
    recipientDistrict: parsed.recipientDistrict,
    recipientCity: parsed.recipientCity,
    packageContent: parsed.packageContent,
    paymentMethod: parsed.paymentMethod,
    nonCodItemPrice: parsed.nonCodItemPrice,
    codValue: parsed.codValue,
    shippingCost: parsed.shippingCost,
    total: parsed.total,
    discount: parsed.discount,
    inferredDiscount: comparison.inferredDiscount,
    status,
    flags,
    sourceMessageId,
    sourceMessageText: message.content,
    updatedAt: Date.now(),
  };
  if (existing && existing.sourceMessageId === sourceMessageId && !opts?.force) {
    return { recapId: existing._id, action: "skipped" };
  }
  if (existing) {
    await ctx.db.patch(existing._id, { ...payload, version: existing.version + 1 });
    return { recapId: existing._id, action: "updated" };
  }
  const recapId = await ctx.db.insert("shippingRecaps", { ...payload, version: 1, createdAt: Date.now() });
  return { recapId, action: "created" };
}
```

- [ ] **Step 4: Refactor `backfillFromMessages` to use the helper + configurable phrases.** Replace the per-message body (the block from `if (!String(message.content || "").includes("PEMESANAN BERHASIL")) continue;` through the recap insert/patch and any event/counter lines) with:
```ts
    const phrases = await getActiveClosingPhrases(ctx);
    for (const message of messages) {
      if (args.startAt && message.createdAt < args.startAt) continue;
      if (args.endAt && message.createdAt > args.endAt) continue;
      if (message.direction !== "outbound") continue;
      if (!messageMatchesPhrase(message.content, phrases)) continue;
      scanned += 1;
      const result = await upsertRecapFromMessage(ctx, message, { force: args.force });
      if (result.action === "skipped") { skipped += 1; continue; }
      upserted += 1;
      recapIds.push(result.recapId);
    }
```
(Keep the existing `return { scanned, upserted, skipped, recapIds }` at the end. Remove any now-unused locals the old loop declared.)

- [ ] **Step 5: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (characterization test still green → behavior preserved).

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/shippingRecaps.ts wafachat/convex/shippingRecaps.test.ts
git commit -m "refactor(closing): extract upsertRecapFromMessage helper + configurable phrases (DRY)"
```

---

### Task 4: Real-time auto-closing inside `appendMessageFromN8n`

**Files:**
- Modify: `wafachat/convex/messages.ts` (`appendMessageFromN8n`)
- Test: `wafachat/convex/messages.test.ts` (extend)

**Interfaces:**
- Consumes: `messageMatchesPhrase`, `upsertRecapFromMessage` (from `./shippingRecaps`), `getActiveClosingPhrases` (from `./closingRules`).
- Produces: when an OUTBOUND ingested message matches an active phrase, `appendMessageFromN8n` upserts the closing recap and logs a `closing_detected` event, returning `{ ..., closingRecapId?: Id<"shippingRecaps"> }`.

- [ ] **Step 1: Write the failing test** (append to `messages.test.ts`):
```ts
test("appendMessageFromN8n: outbound closing phrase -> exactly one recap + closing_detected event", async () => {
  const t = convexTest(schema);
  const base = {
    phone: "62811", order_id: "O-9", customerName: "A", csName: "CS Aisyah",
    role: "cs" as const, direction: "outbound" as const,
    content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
    messageType: "text" as const,
  };
  const r1 = await t.mutation(api.messages.appendMessageFromN8n, { ...base, externalMessageId: "m1", createdAt: 2000 });
  expect(r1.closingRecapId).toBeDefined();
  // Same order, phrase again (different message id) -> still ONE recap (dedup per order)
  await t.mutation(api.messages.appendMessageFromN8n, { ...base, externalMessageId: "m2", createdAt: 3000 });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  const events = await t.run(async (ctx) =>
    ctx.db.query("events").withIndex("by_type_createdAt", (q) => q.eq("type", "closing_detected")).collect());
  expect(events.length).toBeGreaterThanOrEqual(1);
});

test("appendMessageFromN8n: inbound with phrase -> NO recap", async () => {
  const t = convexTest(schema);
  await t.mutation(api.messages.appendMessageFromN8n, {
    phone: "62822", order_id: "O-10", role: "customer", direction: "inbound",
    content: "PEMESANAN BERHASIL?", messageType: "text", externalMessageId: "in1", createdAt: 2000,
  });
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd wafachat && npm test`. Expected: FAIL (`closingRecapId` undefined; recap not created).

- [ ] **Step 3: Wire detection into `convex/messages.ts`.** Add imports at top:
```ts
import { messageMatchesPhrase, upsertRecapFromMessage } from "./shippingRecaps";
import { getActiveClosingPhrases } from "./closingRules";
import type { Id } from "./_generated/dataModel";
```
In `appendMessageFromN8n`, after the existing message insert + conversation patch + `message_inbound`/`ai_reply_sent` event (just before the final `return { success: true, messageId, ... }`), insert:
```ts
    let closingRecapId: Id<"shippingRecaps"> | undefined;
    if (args.direction === "outbound") {
      const phrases = await getActiveClosingPhrases(ctx);
      if (messageMatchesPhrase(args.content, phrases)) {
        const result = await upsertRecapFromMessage(ctx, {
          orderId: conversation.orderId,
          customerPhone: conversation.customerPhone,
          content: args.content,
          externalMessageId: args.externalMessageId,
          _id: messageId,
          createdAt,
        });
        if (result.action !== "skipped") {
          closingRecapId = result.recapId;
          await ctx.db.insert("events", {
            conversationId: conversation._id,
            orderId: conversation.orderId,
            customerPhone: conversation.customerPhone,
            type: "closing_detected",
            actor: "n8n",
            metadata: { recapId: result.recapId, source: "auto_message", externalMessageId: args.externalMessageId },
            createdAt,
          });
        }
      }
    }
```
Then change the final return to include it: `return { success: true, messageId, conversationId: conversation._id, order_id: conversation.orderId, phone: conversation.customerPhone, closingRecapId, _action: "append_message" };`

- [ ] **Step 4: Run to verify it passes.** Run: `cd wafachat && npm test`. Expected: PASS (all tests).

- [ ] **Step 5: Verify the full build.** Run: `cd wafachat && npx convex codegen && npm run build`. Expected: clean build (new `api.closingRules` + `messages`/`shippingRecaps` exports typecheck).

- [ ] **Step 6: Commit.**
```bash
git add wafachat/convex/messages.ts wafachat/convex/messages.test.ts wafachat/convex/_generated/api.d.ts
git commit -m "feat(closing): real-time auto-closing on outbound phrase match in appendMessageFromN8n"
```

---

### Task 5: n8n message-ingestion workflow (KirimDev message webhooks → Convex)

**Files:**
- Create (live, via n8n-mcp): new workflow `WaFaChat - Message Ingest (KirimDev)`
- Create: `wafachat/automations/n8n/workflows/message-ingest-kirimdev.json` (canonical export, secrets as placeholders)
- Modify: `wafachat/automations/n8n/README.md` (add the workflow row)

**Interfaces:**
- Consumes: KirimDev webhooks `message.sent` (incl. coexistence WA-Business-App echoes, `source: "app"`) and `message.received`; Convex `appendMessageFromN8n` reached via the State Manager `conversation-state` webhook (`https://n8n.miqra.dev/webhook/conversation-state`) using `action: "append_message"`, OR a direct call — confirm during Step 1 which the State Manager already routes.
- Produces: each KirimDev message → one Convex `messages` row (idempotent via Task 2), auto-closing fired by Task 4.

- [ ] **Step 1: Confirm the State Manager routing.** Use `n8n_get_workflow` on the State Manager (`oTNay1fDleMibZ3J`) and check whether the `conversation-state` webhook already routes `action: "append_message"` to `appendMessageFromN8n`. If it does, reuse it. If not, add a route (Switch case) that maps `append_message` → `appendMessageFromN8n` mutation call. Record the decision in the workflow `_notes`.

- [ ] **Step 2: Build the ingest workflow** (via `n8n_create_workflow` then `n8n_update_partial_workflow`): `Webhook (POST /kirimdev-message)` → `Code: verify HMAC + map payload` → `IF: skip non message.sent/received` → `HTTP Request POST conversation-state {action:"append_message", ...}`. The mapper Code node extracts from the KirimDev webhook body: `externalMessageId` (message id), `phone` (the customer/counterparty number, not the CS), `direction` (`outbound` when from the business/CS incl. `source:"app"`; `inbound` when from the customer), `role` (`cs` for outbound app/business, `customer` for inbound), `content` (text body), `messageType`. Verify `X-Kirim-Signature: t=…,v1=…` HMAC over the raw body using the KirimDev signing secret (n8n credential); on mismatch return 401 without forwarding.

- [ ] **Step 3: Activate + export.** Activate the workflow (`activateWorkflow`). Export via `n8n_get_workflow` and save sanitized JSON (replace the signing secret + ids with placeholders) to `wafachat/automations/n8n/workflows/message-ingest-kirimdev.json`. Validate it parses: `node -e "JSON.parse(require('fs').readFileSync('<abs path>','utf8'))"`.

- [ ] **Step 4: Verification is deferred (no test spam).** Do NOT trigger synthetic sends. The next real CS reply that contains a configured phrase will exercise the path; confirm afterward by checking the workflow execution + that a `shippingRecaps` row with `flags`/`sourceMessageId` and a `closing_detected` event appeared for that order. Note this in the README row.

- [ ] **Step 5: Commit the repo artifacts.**
```bash
git add wafachat/automations/n8n/workflows/message-ingest-kirimdev.json wafachat/automations/n8n/README.md
git commit -m "feat(n8n): KirimDev message-ingest workflow -> Convex appendMessageFromN8n"
```

---

## Self-Review

**Spec coverage (Fase 1B scope):**
- Component 2 (message pipeline: KirimDev webhooks → n8n → Convex `messages`, HMAC, idempotent by `externalMessageId`) → Task 2 (idempotency) + Task 5 (n8n workflow). ✅
- Component 3 (auto-closing detector: outbound phrase match → upsert closing recap, dedup per order, log `closing_detected`, reuse recap/parse logic, manual override) → Tasks 3 + 4. ✅
- Component 5 (configurable closing rules: multiple phrases, case-insensitive, seedable, panel-editable later) → Task 1. ✅
- Testing (auto-closing exactly-one-per-order incl. repeat; inbound ignored; idempotent ingestion) → Tasks 2, 3, 4 tests. ✅

**Placeholder scan:** no TBDs; every code step shows code; commands exact. Task 5 Steps 1–2 require live-system confirmation of the State Manager route and the exact KirimDev payload field names — these are explicit verification steps, not placeholders. ✅

**Type consistency:** `getActiveClosingPhrases(ctx) => Promise<string[]>` used identically in Tasks 1, 3, 4. `upsertRecapFromMessage(ctx, message, opts) => { recapId, action }` defined in Task 3, consumed in Task 4. `messageMatchesPhrase(content, phrases) => boolean` defined Task 3, used Tasks 3–4. `appendMessageFromN8n` return extended with `deduped?` (Task 2) and `closingRecapId?` (Task 4) — both additive. `closing_detected` event `type` already exists in the schema/events union. ✅

**Note on deploy ordering (same as Plan 1A):** schema changes (`closingRules`, `messages` index) + new functions must be deployed to **Convex prod first** (`npx convex deploy`), then the n8n workflow can forward to them. Do not activate Task 5's workflow before the Convex deploy.
