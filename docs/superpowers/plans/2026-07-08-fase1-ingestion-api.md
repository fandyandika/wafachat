# Fase 1 — WaFaChat Ingestion API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire n8n from the WaFaChat data-ingestion path by receiving KirimDev/Berdu webhooks directly in Convex with capture-first durability, self-monitoring, and BSP-agnostic generic endpoints.

**Architecture:** Convex `httpAction` routes verify vendor signatures, persist every raw payload to `ingestEvents` BEFORE processing (capture-first), then translate via pure adapter functions into two universal events (`message.event`, `lead.created`) handled by the existing battle-tested core mutations. Convex crons provide an order reconciler (pull safety-net), a silence/failure detector that alerts via Telegram directly from Convex, and event-retention cleanup.

**Tech Stack:** Convex 1.39 (httpAction, internalMutation, cronJobs, Web Crypto `crypto.subtle`), Next.js 14 (untouched), vitest `environment: "edge-runtime"`, convex-test.

**Spec:** `docs/superpowers/specs/2026-07-08-fase1-ingestion-api-design.md` (committed `9b3648f`). Read it once before starting.

## Global Constraints

- Repo root for all commands: `cd /f/Projects/whatsapp_cs_automotion/wafachat` — **cwd resets between Bash calls; prefix every command.**
- Fact-Forcing Gate: before any Write/Edit/Bash, quote the user's instruction verbatim: `"Plan Fase 1 now"` + `"Tentukan aja yang terbaik untuk SaaS ini... jangka panjang... Make it perfect yang sesuai dengan standar expert developer"`.
- Convex auth enforcement is LIVE: every new **public** function MUST call `requireAdmin(ctx, "<name>")` (all ingestion admin ops are admin-only). Capture/process/mark functions are `internalMutation`/`internalQuery` (not publicly callable).
- Existing route `/n8n/state` in `convex/http.ts` and functions `appendMessageFromN8n` / `upsertOrderFromN8n` MUST keep working unchanged in behavior (n8n path stays alive during transition).
- Always-200 contract: after an event is captured, the HTTP response is 200 even if processing fails. Only invalid signature (with `enforceSignature: true`) → 401, oversize/non-JSON → 400, unknown/disabled source → 404.
- Timestamps are epoch-ms everywhere (matches `messages.createdAt`).
- Signature scheme (KirimDev inbound AND our generic endpoints): header value `t=<unixSeconds>,v1=<hexHmacSha256>`, signed message `` `${t}.${rawBody}` ``, tolerance ±300s.
- **NEVER write production secrets into repo files.** Secrets live in Convex env vars (set manually by Fandy in the Convex dashboard — the deploy key cannot `env:write`) or in the `ingestSources` table.
- Deploy discipline per milestone: `npm run build` (exit 0) → `npx vitest run` (all green) → `npx convex deploy -y` → `git push origin main`.
- Existing test count is 144; never reduce it. New files follow existing patterns (`convex/*.test.ts` for convex-test, pure tests may live next to the module).
- Milestones ship in order M1 → M2 → M3 → M4; each milestone ends deployed and verified.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `convex/schema.ts` | modify | +`ingestEvents`, +`ingestSources`, +`alertState`, +`csConfigs.providerNumberIds` |
| `convex/ingest/signature.ts` | create | pure HMAC parse/verify/sign (Web Crypto) |
| `convex/ingest/kirimdevAdapter.ts` | create | pure KirimDev payload → universal MessageEvent |
| `convex/ingest/berduAdapter.ts` | create | pure Berdu order JSON → universal LeadEvent |
| `convex/ingest/events.ts` | create | capture/mark/replay/cleanup for `ingestEvents` |
| `convex/ingest/sources.ts` | create | `ingestSources` CRUD (admin) + internal lookup |
| `convex/ingest/core.ts` | create | processCapturedEvent dispatcher + CS lookup + ingest wrappers |
| `convex/ingest/reconciler.ts` | create | cron action: Berdu gap-heal (port of n8n reconciler) |
| `convex/ingest/monitor.ts` | create | cron action: silence + failure-spike detector → Telegram |
| `convex/crons.ts` | modify | register 3 new crons |
| `convex/http.ts` | modify | +`/webhooks/kirimdev`, +`/webhooks/berdu`, +`/ingest/message`, +`/ingest/lead` |
| `convex/messages.ts` | modify | extract `appendMessageCore(ctx, args)` shared handler |
| `convex/state.ts` | modify (commit pending diff) | createdAt preservation in `upsertOrderFromN8n` (already edited, uncommitted) |

---

# Milestone M1 — KirimDev message path (URGENT)

### Task 1: Schema additions

**Files:**
- Modify: `convex/schema.ts` (append tables after `csConfigs`; add one field inside `csConfigs`)

**Interfaces:**
- Produces: tables `ingestEvents`, `ingestSources`, `alertState`; field `csConfigs.providerNumberIds?: string[]` — consumed by every later task.

- [ ] **Step 1: Add `providerNumberIds` to csConfigs**

In `convex/schema.ts`, after the line `providerNumberId: v.optional(v.string()),` (~line 63) add:

```ts
    providerNumberIds: v.optional(v.array(v.string())), // one CS can own >1 WABA number (e.g. Nabila has 2)
```

- [ ] **Step 2: Add the three new tables**

In the same `defineSchema({...})` object, after the `csConfigs` table definition closes, add:

```ts
  // ── Ingestion API (Fase 1) ────────────────────────────────────────────────
  // Capture-first: every inbound webhook is stored raw BEFORE processing, so a
  // processing bug never loses data and failed events replay from OUR table,
  // not the vendor's dead-letter UI. (Incident 2026-07-07.)
  ingestEvents: defineTable({
    sourceKey: v.string(),
    kind: v.string(), // "message.event" | "lead.created" | "generic.message" | "generic.lead" | "unknown"
    rawHeaders: v.string(), // JSON string of the relevant header subset
    rawBody: v.string(),
    signatureOk: v.boolean(),
    status: v.union(
      v.literal("received"),
      v.literal("processed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    error: v.optional(v.string()),
    skipReason: v.optional(v.string()),
    resultRef: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    replayOf: v.optional(v.id("ingestEvents")),
  })
    .index("by_status_receivedAt", ["status", "receivedAt"])
    .index("by_receivedAt", ["receivedAt"]),

  ingestSources: defineTable({
    sourceKey: v.string(),
    name: v.string(),
    kind: v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom")),
    secret: v.string(),
    orgId: v.optional(v.string()),
    enabled: v.boolean(),
    // false = log-only: record signatureOk but accept the request. Prevents a
    // wrong HMAC construction from 401-ing every delivery and getting the NEW
    // subscription auto-disabled. Flip true after live verification.
    enforceSignature: v.boolean(),
    createdAt: v.number(),
  }).index("by_sourceKey", ["sourceKey"]),

  alertState: defineTable({
    alertKey: v.string(), // "silence" | "failure-spike"
    lastSentAt: v.number(),
  }).index("by_alertKey", ["alertKey"]),
```

- [ ] **Step 3: Build + full test suite (schema is exercised by convex-test schema load)**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build && npx vitest run`
Expected: build exit 0; 144 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/schema.ts && git commit -m "feat(ingest): schema for ingestEvents/ingestSources/alertState + csConfigs.providerNumberIds"
```

---

### Task 2: `signature.ts` — pure HMAC helpers

**Files:**
- Create: `convex/ingest/signature.ts`
- Test: `convex/ingest/signature.test.ts`

**Interfaces:**
- Produces:
  - `parseSignatureHeader(header: string | null): { t: number; v1: string } | null`
  - `hmacHex(secret: string, message: string): Promise<string>`
  - `hmacBase64(secret: string, message: string): Promise<string>` (Berdu uses base64, Task 11)
  - `verifySignature(opts: { header: string | null; rawBody: string; secret: string; nowMs: number; toleranceSec?: number }): Promise<{ ok: boolean; reason?: string }>`
  - `signPayload(secret: string, rawBody: string, nowMs: number): Promise<string>` → `"t=<sec>,v1=<hex>"`

- [ ] **Step 1: Write the failing tests**

Create `convex/ingest/signature.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { hmacHex, parseSignatureHeader, signPayload, verifySignature } from "./signature";

describe("parseSignatureHeader", () => {
  test("parses t and v1", () => {
    expect(parseSignatureHeader("t=1783442989,v1=abc123")).toEqual({ t: 1783442989, v1: "abc123" });
  });
  test("rejects null, garbage, missing parts", () => {
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader("nonsense")).toBeNull();
    expect(parseSignatureHeader("t=notanumber,v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=123")).toBeNull();
  });
});

describe("verify/sign roundtrip", () => {
  const secret = "whsec_testsecret";
  const body = JSON.stringify({ hello: "world" });

  test("hmacHex is deterministic hex", async () => {
    const h = await hmacHex(secret, "msg");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex(secret, "msg")).toBe(h);
  });

  test("signPayload output verifies", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    expect(header).toMatch(/^t=1783442989,v1=[0-9a-f]{64}$/);
    const res = await verifySignature({ header, rawBody: body, secret, nowMs: now });
    expect(res).toEqual({ ok: true });
  });

  test("wrong secret fails", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    const res = await verifySignature({ header, rawBody: body, secret: "other", nowMs: now });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("mismatch");
  });

  test("tampered body fails", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    const res = await verifySignature({ header, rawBody: body + "x", secret, nowMs: now });
    expect(res.ok).toBe(false);
  });

  test("stale timestamp outside tolerance fails; inside passes", async () => {
    const signedAt = 1783442989000;
    const header = await signPayload(secret, body, signedAt);
    const late = await verifySignature({ header, rawBody: body, secret, nowMs: signedAt + 301_000 });
    expect(late).toEqual({ ok: false, reason: "timestamp out of tolerance" });
    const okLate = await verifySignature({ header, rawBody: body, secret, nowMs: signedAt + 299_000 });
    expect(okLate.ok).toBe(true);
  });

  test("missing header fails with reason", async () => {
    const res = await verifySignature({ header: null, rawBody: body, secret, nowMs: 0 });
    expect(res).toEqual({ ok: false, reason: "missing or malformed header" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/signature.test.ts`
Expected: FAIL — cannot resolve `./signature`.

- [ ] **Step 3: Implement**

Create `convex/ingest/signature.ts`:

```ts
// Pure HMAC helpers for the Ingestion API. One scheme, dogfooded:
// we VERIFY it on inbound vendor webhooks (KirimDev) and ISSUE it on our
// generic /ingest/* endpoints. Stripe convention: sign `${t}.${rawBody}`.
// Runs on Web Crypto (available in Convex httpAction runtime and edge-runtime tests).

export type ParsedSignature = { t: number; v1: string };

export function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null;
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || t <= 0 || !v1) return null;
  return { t, v1 };
}

async function hmacRaw(secret: string, message: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const buf = await hmacRaw(secret, message);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacBase64(secret: string, message: string): Promise<string> {
  const buf = await hmacRaw(secret, message);
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

const DEFAULT_TOLERANCE_SEC = 300;

export async function verifySignature(opts: {
  header: string | null;
  rawBody: string;
  secret: string;
  nowMs: number;
  toleranceSec?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { ok: false, reason: "missing or malformed header" };
  const tolerance = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(opts.nowMs / 1000 - parsed.t) > tolerance) {
    return { ok: false, reason: "timestamp out of tolerance" };
  }
  const expected = await hmacHex(opts.secret, `${parsed.t}.${opts.rawBody}`);
  if (expected !== parsed.v1.toLowerCase()) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

export async function signPayload(secret: string, rawBody: string, nowMs: number): Promise<string> {
  const t = Math.floor(nowMs / 1000);
  const v1 = await hmacHex(secret, `${t}.${rawBody}`);
  return `t=${t},v1=${v1}`;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/signature.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ingest/signature.ts convex/ingest/signature.test.ts && git commit -m "feat(ingest): pure HMAC signature helpers (Stripe-convention t/v1, hex+base64)"
```

---

### Task 3: `kirimdevAdapter.ts` — pure payload translation

**Files:**
- Create: `convex/ingest/kirimdevAdapter.ts`
- Test: `convex/ingest/kirimdevAdapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UniversalMessageEvent = {
    phone: string; content: string;
    direction: "inbound" | "outbound"; role: "customer" | "cs" | "ai";
    messageType: "text"; externalMessageId: string; createdAt: number;
    phoneNumberId?: string; // CS attribution resolved later in core via csConfigs
  };
  export type KirimdevParseResult =
    | { kind: "message"; event: UniversalMessageEvent }
    | { kind: "skip"; reason: string };
  export function parseKirimdevWebhook(
    headers: Record<string, string>, body: unknown, nowMs: number,
  ): KirimdevParseResult;
  ```
- Behavior contract: port 1:1 of n8n node "Map to append_message" (spec §5) — the only deviation: the adapter returns `phoneNumberId` instead of resolving csName inline (core resolves via DB).

- [ ] **Step 1: Write the failing tests** (fixture = real captured payload from n8n execution 223992)

Create `convex/ingest/kirimdevAdapter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseKirimdevWebhook } from "./kirimdevAdapter";

const NOW = 1783443000000;

// Real message.received payload captured from production (n8n execution 223992),
// phone/name/text kept verbatim — this is the shape KirimDev actually sends.
const RECEIVED_BODY = {
  object: "whatsapp_business_account",
  entry: [{
    id: "563030666884136",
    changes: [{
      field: "messages",
      value: {
        contacts: [{ wa_id: "6285799533626", profile: { name: "Kurn" } }],
        messages: [{
          id: "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
          from: "6285799533626",
          text: { body: "Belom dulu min" },
          type: "text",
          timestamp: "1783427359",
        }],
        metadata: { phone_number_id: "485071188032281", display_phone_number: "+62 821-1351-5152" },
        messaging_product: "whatsapp",
      },
    }],
  }],
  kirim: {
    contact: { name: "Kurn", phone_number: "+6285799533626" },
    message_id: "msg_86HD2ZRSEVJK3NWQT1XTCZMSW6",
    conversation_id: "cnv_WNYBPWH82YHPH8828JVJ8JMK7E",
    phone_number_id: "485071188032281",
  },
};

const RECEIVED_HEADERS = {
  "x-kirim-event": "message.received",
  "x-kirim-event-id": "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
};

// message.sent shape per the proven n8n mapper contract (spec §5, risk table
// notes the raw shape gets re-verified from dual-run captures).
const SENT_BODY = {
  type: "message.sent",
  data: {
    contact: { phone_number: "+6285799533626" },
    message: {
      id: "msg_ABC", provider_id: "wamid.SENT123", to: "+6285799533626",
      body: "PEMESANAN BERHASIL\nTerima kasih kak", type: "text", source: "dashboard",
    },
    timestamp: "2026-07-07T12:29:19.000Z",
    meta: { phone_number_id: "485071188032281" },
  },
};

describe("message.received", () => {
  test("maps to inbound customer event with original timestamp", () => {
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, RECEIVED_BODY, NOW);
    expect(r).toEqual({
      kind: "message",
      event: {
        phone: "6285799533626",
        content: "Belom dulu min",
        direction: "inbound",
        role: "customer",
        messageType: "text",
        externalMessageId: "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
        createdAt: 1783427359000,
        phoneNumberId: "485071188032281",
      },
    });
  });

  test("button message uses button.text", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages[0] = {
      id: "wamid.BTN", from: "6285799533626", type: "button",
      button: { text: "Ya, lanjutkan" }, timestamp: "1783427360",
    };
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW);
    expect(r.kind).toBe("message");
    if (r.kind === "message") expect(r.event.content).toBe("Ya, lanjutkan");
  });

  test("media inbound skips with type reason", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages[0].type = "image";
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW);
    expect(r).toEqual({ kind: "skip", reason: "inbound type image" });
  });

  test("no message in payload skips", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages = [];
    expect(parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW)).toEqual({
      kind: "skip", reason: "inbound no message",
    });
  });
});

describe("message.sent", () => {
  test("dashboard source maps to role cs, outbound, provider_id, parsed timestamp", () => {
    const r = parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, SENT_BODY, NOW);
    expect(r).toEqual({
      kind: "message",
      event: {
        phone: "6285799533626",
        content: "PEMESANAN BERHASIL\nTerima kasih kak",
        direction: "outbound",
        role: "cs",
        messageType: "text",
        externalMessageId: "wamid.SENT123",
        createdAt: Date.parse("2026-07-07T12:29:19.000Z"),
        phoneNumberId: "485071188032281",
      },
    });
  });

  test("non-dashboard source maps to role ai", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.source = "api";
    const r = parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW);
    expect(r.kind).toBe("message");
    if (r.kind === "message") expect(r.event.role).toBe("ai");
  });

  test("non-text outbound skips", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.type = "image";
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW)).toEqual({
      kind: "skip", reason: "outbound not text",
    });
  });

  test("event type from body.type when header missing", () => {
    const r = parseKirimdevWebhook({}, SENT_BODY, NOW);
    expect(r.kind).toBe("message");
  });
});

describe("edge cases", () => {
  test("unknown event skips", () => {
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.status" }, {}, NOW)).toEqual({
      kind: "skip", reason: "event message.status",
    });
  });
  test("missing phone/content skips", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.body = "";
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW)).toEqual({
      kind: "skip", reason: "missing phone/content",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/kirimdevAdapter.test.ts`
Expected: FAIL — cannot resolve `./kirimdevAdapter`.

- [ ] **Step 3: Implement**

Create `convex/ingest/kirimdevAdapter.ts`:

```ts
// Pure translation: KirimDev webhook payload -> universal message.event.
// 1:1 port of the proven n8n "Map to append_message" node (workflow STIyKl6dDgdZgKeh),
// with ONE deviation: CS attribution returns phoneNumberId; core resolves the CS
// name from csConfigs (n8n used a hardcoded map).

export type UniversalMessageEvent = {
  phone: string;
  content: string;
  direction: "inbound" | "outbound";
  role: "customer" | "cs" | "ai";
  messageType: "text";
  externalMessageId: string;
  createdAt: number;
  phoneNumberId?: string;
};

export type KirimdevParseResult =
  | { kind: "message"; event: UniversalMessageEvent }
  | { kind: "skip"; reason: string };

function skip(reason: string): KirimdevParseResult {
  return { kind: "skip", reason };
}

export function parseKirimdevWebhook(
  headers: Record<string, string>,
  body: unknown,
  nowMs: number,
): KirimdevParseResult {
  const b = (body ?? {}) as Record<string, any>;
  const event = headers["x-kirim-event"] || b.type || "";

  if (event === "message.sent") {
    const d = b.data ?? {};
    const m = d.message ?? {};
    if ((m.type || "text") !== "text") return skip("outbound not text");
    const phone = String(d.contact?.phone_number || m.to || "").replace(/^\+/, "");
    const content = m.body || "";
    if (!phone || !content) return skip("missing phone/content");
    const createdAt = d.timestamp ? Date.parse(d.timestamp) : nowMs;
    return {
      kind: "message",
      event: {
        phone,
        content,
        direction: "outbound",
        role: m.source === "dashboard" ? "cs" : "ai",
        messageType: "text",
        externalMessageId: String(m.provider_id || m.id || ""),
        createdAt: Number.isFinite(createdAt) ? createdAt : nowMs,
        phoneNumberId: (d.meta?.phone_number_id || d.session || undefined) as string | undefined,
      },
    };
  }

  if (event === "message.received") {
    const value = b.entry?.[0]?.changes?.[0]?.value ?? {};
    const msg = value.messages?.[0];
    if (!msg) return skip("inbound no message");
    let content = "";
    if (msg.type === "text") content = msg.text?.body || "";
    else if (msg.type === "button") content = msg.button?.text || "";
    else return skip(`inbound type ${msg.type}`);
    const kirim = b.kirim ?? {};
    const phone = String(
      value.contacts?.[0]?.wa_id || msg.from || kirim.contact?.phone_number || "",
    ).replace(/^\+/, "");
    if (!phone || !content) return skip("missing phone/content");
    return {
      kind: "message",
      event: {
        phone,
        content,
        direction: "inbound",
        role: "customer",
        messageType: "text",
        externalMessageId: String(msg.id || headers["x-kirim-event-id"] || ""),
        createdAt: msg.timestamp ? Number(msg.timestamp) * 1000 : nowMs,
        phoneNumberId: (value.metadata?.phone_number_id || undefined) as string | undefined,
      },
    };
  }

  return skip(`event ${event}`);
}
```

- [ ] **Step 4: Run tests**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/kirimdevAdapter.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ingest/kirimdevAdapter.ts convex/ingest/kirimdevAdapter.test.ts && git commit -m "feat(ingest): KirimDev adapter — 1:1 port of proven n8n mapper, real payload fixtures"
```

---

### Task 4: `events.ts` + `sources.ts` — capture, mark, sources CRUD

**Files:**
- Create: `convex/ingest/events.ts`
- Create: `convex/ingest/sources.ts`
- Test: `convex/ingest/events.test.ts`

**Interfaces:**
- Produces (events.ts):
  - `captureEvent` internalMutation `{sourceKey, kind, rawHeaders, rawBody, signatureOk, replayOf?}` → `Id<"ingestEvents">`
  - `markProcessed` internalMutation `{eventId, resultRef?}`
  - `markFailed` internalMutation `{eventId, error}`
  - `markSkipped` internalMutation `{eventId, skipReason}`
  - `cleanupOld` internalMutation `{olderThanMs: number}` → `{deleted: number}` (batch ≤ 500 per run)
  - `listRecent` public query (requireAdmin) `{limit?, status?}` — panel/debug view
- Produces (sources.ts):
  - `getBySourceKey` internalQuery `{sourceKey}` → source doc or null
  - `upsertSource` public mutation (requireAdmin) `{sourceKey, name, kind, secret, enabled, enforceSignature}`
  - `setEnforceSignature` public mutation (requireAdmin) `{sourceKey, enforce: boolean}`
  - `listSources` public query (requireAdmin) `{}` → sources with secret REDACTED to last 4 chars

- [ ] **Step 1: Write the failing tests**

Create `convex/ingest/events.test.ts`:

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";

const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });

test("capture -> mark lifecycle", async () => {
  const t = convexTest(schema);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markProcessed, { eventId, resultRef: "msg123" });
  const rows = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "processed", resultRef: "msg123" });
  expect(rows[0].processedAt).toBeGreaterThan(0);
});

test("markFailed and markSkipped record reasons", async () => {
  const t = convexTest(schema);
  const a = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "unknown", rawHeaders: "{}", rawBody: "x", signatureOk: false,
  });
  const b = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "unknown", rawHeaders: "{}", rawBody: "y", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markFailed, { eventId: a, error: "boom" });
  await t.mutation(internal.ingest.events.markSkipped, { eventId: b, skipReason: "event x" });
  const failed = await asAdmin(t).query(api.ingest.events.listRecent, { status: "failed" });
  expect(failed).toHaveLength(1);
  expect(failed[0].error).toBe("boom");
  const skipped = await asAdmin(t).query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("event x");
});

test("cleanupOld deletes only rows older than cutoff", async () => {
  const t = convexTest(schema);
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "k", rawHeaders: "{}", rawBody: "old", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "k", rawHeaders: "{}", rawBody: "new", signatureOk: true,
  });
  const res = await t.mutation(internal.ingest.events.cleanupOld, { olderThanMs: 0 });
  expect(res.deleted).toBe(0); // nothing older than epoch 0
  const res2 = await t.mutation(internal.ingest.events.cleanupOld, { olderThanMs: Date.now() + 60_000 });
  expect(res2.deleted).toBe(2); // everything older than future cutoff
});

test("listRecent requires admin", async () => {
  const t = convexTest(schema);
  await expect(t.query(api.ingest.events.listRecent, {})).rejects.toThrow(/unauthorized/);
});

test("sources: upsert, lookup, redact, enforce flip", async () => {
  const t = convexTest(schema);
  await asAdmin(t).mutation(api.ingest.sources.upsertSource, {
    sourceKey: "kirimdev-pustakaislam", name: "KirimDev Pustaka Islam",
    kind: "kirimdev", secret: "whsec_supersecret1234", enabled: true, enforceSignature: false,
  });
  const src = await t.query(internal.ingest.sources.getBySourceKey, { sourceKey: "kirimdev-pustakaislam" });
  expect(src?.secret).toBe("whsec_supersecret1234");
  expect(src?.enforceSignature).toBe(false);

  const listed = await asAdmin(t).query(api.ingest.sources.listSources, {});
  expect(listed[0].secret).toBe("…1234"); // redacted

  await asAdmin(t).mutation(api.ingest.sources.setEnforceSignature, {
    sourceKey: "kirimdev-pustakaislam", enforce: true,
  });
  const after = await t.query(internal.ingest.sources.getBySourceKey, { sourceKey: "kirimdev-pustakaislam" });
  expect(after?.enforceSignature).toBe(true);

  // upsert same key updates, not duplicates
  await asAdmin(t).mutation(api.ingest.sources.upsertSource, {
    sourceKey: "kirimdev-pustakaislam", name: "Renamed",
    kind: "kirimdev", secret: "whsec_other", enabled: true, enforceSignature: true,
  });
  expect((await asAdmin(t).query(api.ingest.sources.listSources, {})).length).toBe(1);
});

test("sources mutations require admin", async () => {
  const t = convexTest(schema);
  const asCs = t.withIdentity({ subject: "c1", role: "cs", name: "Lina", email: "c@w", csName: "Lina" });
  await expect(asCs.mutation(api.ingest.sources.upsertSource, {
    sourceKey: "x", name: "x", kind: "custom", secret: "s", enabled: true, enforceSignature: false,
  })).rejects.toThrow(/admin/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/events.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `events.ts`**

Create `convex/ingest/events.ts`:

```ts
import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { requireAdmin } from "../authz";

const statusValidator = v.union(
  v.literal("received"), v.literal("processed"), v.literal("failed"), v.literal("skipped"),
);

export const captureEvent = internalMutation({
  args: {
    sourceKey: v.string(),
    kind: v.string(),
    rawHeaders: v.string(),
    rawBody: v.string(),
    signatureOk: v.boolean(),
    replayOf: v.optional(v.id("ingestEvents")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("ingestEvents", { ...args, status: "received", receivedAt: Date.now() });
  },
});

export const markProcessed = internalMutation({
  args: { eventId: v.id("ingestEvents"), resultRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "processed", resultRef: args.resultRef, processedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: { eventId: v.id("ingestEvents"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "failed", error: args.error.slice(0, 2000), processedAt: Date.now(),
    });
  },
});

export const markSkipped = internalMutation({
  args: { eventId: v.id("ingestEvents"), skipReason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "skipped", skipReason: args.skipReason, processedAt: Date.now(),
    });
  },
});

// Retention: bounded delete batch, driven by cron (Task 8 adds cleanupOldDaily wrapper).
export const cleanupOld = internalMutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("ingestEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", args.olderThanMs))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return { deleted: old.length };
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()), status: v.optional(statusValidator) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.events.listRecent");
    const limit = Math.min(args.limit ?? 50, 200);
    if (args.status) {
      return ctx.db
        .query("ingestEvents")
        .withIndex("by_status_receivedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    return ctx.db.query("ingestEvents").withIndex("by_receivedAt").order("desc").take(limit);
  },
});
```

- [ ] **Step 4: Implement `sources.ts`**

Create `convex/ingest/sources.ts`:

```ts
import { v } from "convex/values";
import { internalQuery, mutation, query } from "../_generated/server";
import { requireAdmin } from "../authz";

const kindValidator = v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom"));

export const getBySourceKey = internalQuery({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
  },
});

export const upsertSource = mutation({
  args: {
    sourceKey: v.string(),
    name: v.string(),
    kind: kindValidator,
    secret: v.string(),
    enabled: v.boolean(),
    enforceSignature: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.upsertSource");
    const existing = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("ingestSources", { ...args, createdAt: Date.now() });
  },
});

export const setEnforceSignature = mutation({
  args: { sourceKey: v.string(), enforce: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.sources.setEnforceSignature");
    const existing = await ctx.db
      .query("ingestSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (!existing) throw new Error(`unknown source: ${args.sourceKey}`);
    await ctx.db.patch(existing._id, { enforceSignature: args.enforce });
  },
});

export const listSources = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "ingest.sources.listSources");
    const rows = await ctx.db.query("ingestSources").collect();
    return rows.map((r) => ({ ...r, secret: `…${r.secret.slice(-4)}` }));
  },
});
```

- [ ] **Step 5: Run tests**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/events.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ingest/events.ts convex/ingest/sources.ts convex/ingest/events.test.ts && git commit -m "feat(ingest): capture-first event store + sources registry (admin CRUD, redacted listing)"
```

---

### Task 5: `core.ts` + messages refactor + `/webhooks/kirimdev` route

**Files:**
- Modify: `convex/messages.ts` (extract shared handler from `appendMessageFromN8n`, ~line 111)
- Create: `convex/ingest/core.ts`
- Modify: `convex/http.ts` (add route; do NOT touch `/n8n/state`)
- Test: `convex/ingest/core.test.ts`

**Interfaces:**
- Consumes: `parseKirimdevWebhook` (Task 3), `captureEvent`/`mark*` (Task 4), `getBySourceKey` (Task 4), `verifySignature` (Task 2).
- Produces:
  - `messages.ts`: `export async function appendMessageCore(ctx, args)` — exact same behavior as today's handler plus optional `source` arg (`"n8n"` default); `appendMessageFromN8n` becomes a thin wrapper.
  - `core.ts`: `processCapturedEvent(ctx, event)` plain fn; `processEvent` internalMutation `{eventId}` (throws on processing error — HTTP caller catches and marks failed); `replayEvent` public mutation (requireAdmin) `{eventId}`; `replayAllFailed` public mutation (requireAdmin) `{}` → `{replayed: number}`; `resolveCsByPhoneNumberId(ctx, phoneNumberId)`.
  - `http.ts`: `POST /webhooks/kirimdev`.

- [ ] **Step 1: Refactor `messages.ts` — extract `appendMessageCore`**

In `convex/messages.ts`, the current `appendMessageFromN8n` internalMutation (line ~111) has its whole body inline. Change to:

```ts
// Shared ingestion core: called by the n8n adapter route (legacy, during transition)
// and by the Ingestion API (convex/ingest/core.ts). Behavior is identical to the
// pre-refactor appendMessageFromN8n handler, plus an optional `source` tag.
export type AppendMessageCoreArgs = {
  phone: string;
  order_id?: string;
  customerName?: string;
  csName?: string;
  role: "customer" | "ai" | "cs" | "system";
  direction: "inbound" | "outbound";
  content: string;
  messageType?: "text" | "image" | "template" | "button";
  externalMessageId?: string;
  createdAt?: number;
  source?: string; // "n8n" (default) | "ingest"
};

export async function appendMessageCore(ctx: any, args: AppendMessageCoreArgs) {
  // <— move the ENTIRE existing handler body here unchanged, with ONE edit:
  // the `ctx.db.insert("messages", { ... source: "n8n", ... })` line becomes
  //   source: args.source ?? "n8n",
}

export const appendMessageFromN8n = internalMutation({
  args: {
    phone: v.string(),
    order_id: v.optional(v.string()),
    customerName: v.optional(v.string()),
    csName: v.optional(v.string()),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button"))),
    externalMessageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => appendMessageCore(ctx, args),
});
```

Check the actual insert — today `source: "n8n"` is set literally inside the handler; parameterize exactly that one spot. If `messages.source` in `convex/schema.ts` is a literal union, widen it with `v.literal("ingest")`; if it is `v.string()`/`v.optional(v.string())` no schema change is needed.

- [ ] **Step 2: Run existing tests to prove the refactor is behavior-neutral**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/messages.test.ts convex/state.test.ts`
Expected: PASS, same counts as before.

- [ ] **Step 3: Write the failing core tests**

Create `convex/ingest/core.test.ts`:

```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";

const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });

const RECEIVED_RAW = JSON.stringify({
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "6285799533626" }],
    messages: [{ id: "wamid.X1", from: "6285799533626", text: { body: "halo kak" }, type: "text", timestamp: "1783427359" }],
    metadata: { phone_number_id: "485071188032281" },
  } }] }],
});
const RECEIVED_HEADERS = JSON.stringify({ "x-kirim-event": "message.received" });

async function captureKirimdev(t: ReturnType<typeof convexTest>, rawBody: string, rawHeaders = RECEIVED_HEADERS) {
  return t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders, rawBody, signatureOk: true,
  });
}

test("processEvent ingests message with original timestamp + CS from providerNumberIds", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberIds: ["485071188032281"],
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
    });
  });
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId });

  const events = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(events[0].status).toBe("processed");
  await t.run(async (ctx) => {
    const msgs = await ctx.db.query("messages").collect();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      content: "halo kak", direction: "inbound", createdAt: 1783427359000, source: "ingest",
    });
    const convs = await ctx.db.query("conversations").collect();
    expect(convs[0].assignedCsName).toBe("CS Azelia");
  });
});

test("legacy single providerNumberId still matches", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberId: "485071188032281",
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
    });
  });
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const convs = await ctx.db.query("conversations").collect();
    expect(convs[0].assignedCsName).toBe("CS Azelia");
  });
});

test("idempotent: same externalMessageId twice -> one message, both events processed", async () => {
  const t = convexTest(schema);
  const e1 = await captureKirimdev(t, RECEIVED_RAW);
  const e2 = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId: e1 });
  await t.mutation(internal.ingest.core.processEvent, { eventId: e2 });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(1);
  });
  const events = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(events.every((e) => e.status === "processed")).toBe(true);
});

test("skip payload marks skipped with reason", async () => {
  const t = convexTest(schema);
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
  const eventId = await captureKirimdev(t, raw);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  const skipped = await asAdmin(t).query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("inbound no message");
});

test("closing detection fires through the ingest path", async () => {
  const t = convexTest(schema);
  const sentRaw = JSON.stringify({
    type: "message.sent",
    data: {
      contact: { phone_number: "+6285799533626" },
      message: { id: "m1", provider_id: "wamid.CLOSE1", to: "+6285799533626",
        body: "PEMESANAN BERHASIL\nditerima ya kak", type: "text", source: "dashboard" },
      timestamp: "2026-07-07T12:29:19.000Z",
      meta: { phone_number_id: "485071188032281" },
    },
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders: JSON.stringify({ "x-kirim-event": "message.sent" }), rawBody: sentRaw, signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const recaps = await ctx.db.query("shippingRecaps").collect();
    expect(recaps).toHaveLength(1);
  });
});

test("replayEvent re-processes an event (admin only), bookkeeping via replayOf", async () => {
  const t = convexTest(schema);
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.events.markFailed, { eventId, error: "simulated" });
  await expect(t.mutation(api.ingest.core.replayEvent, { eventId })).rejects.toThrow(/unauthorized/);
  const res = await asAdmin(t).mutation(api.ingest.core.replayEvent, { eventId });
  expect(res.status).toBe("processed");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(1);
  });
  const all = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(all.some((e) => e.replayOf === eventId)).toBe(true);
});

test("replayAllFailed replays every failed event", async () => {
  const t = convexTest(schema);
  const e1 = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.events.markFailed, { eventId: e1, error: "x" });
  const res = await asAdmin(t).mutation(api.ingest.core.replayAllFailed, {});
  expect(res.replayed).toBe(1);
  const failed = await asAdmin(t).query(api.ingest.events.listRecent, { status: "failed" });
  expect(failed).toHaveLength(0);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/core.test.ts`
Expected: FAIL — `internal.ingest.core` missing.

- [ ] **Step 5: Implement `core.ts`**

Create `convex/ingest/core.ts`:

```ts
import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { requireAdmin } from "../authz";
import { appendMessageCore } from "../messages";
import { parseKirimdevWebhook } from "./kirimdevAdapter";

// Resolve CS display name from a WABA phone_number_id via csConfigs.
// Matches BOTH the legacy single field and the new array field.
export async function resolveCsByPhoneNumberId(ctx: any, phoneNumberId: string | undefined) {
  if (!phoneNumberId) return undefined;
  const configs = await ctx.db.query("csConfigs").collect(); // small table (~5 rows)
  const hit = configs.find(
    (c: any) => c.providerNumberId === phoneNumberId || (c.providerNumberIds ?? []).includes(phoneNumberId),
  );
  return hit?.csName as string | undefined;
}

type ProcessOutcome =
  | { status: "processed"; resultRef?: string }
  | { status: "skipped"; skipReason: string };

// The single dispatcher both the HTTP path and replay use. Throws on real
// processing errors (caller decides how to record the failure).
export async function processCapturedEvent(
  ctx: any,
  event: { sourceKey: string; kind: string; rawHeaders: string; rawBody: string; receivedAt: number },
): Promise<ProcessOutcome> {
  const headers = JSON.parse(event.rawHeaders || "{}");
  const body = JSON.parse(event.rawBody);

  if (event.kind === "message.event") {
    const parsed = parseKirimdevWebhook(headers, body, event.receivedAt);
    if (parsed.kind === "skip") return { status: "skipped", skipReason: parsed.reason };
    const csName = await resolveCsByPhoneNumberId(ctx, parsed.event.phoneNumberId);
    const result = await appendMessageCore(ctx, {
      phone: parsed.event.phone,
      role: parsed.event.role,
      direction: parsed.event.direction,
      content: parsed.event.content,
      messageType: parsed.event.messageType,
      externalMessageId: parsed.event.externalMessageId,
      createdAt: parsed.event.createdAt,
      csName,
      source: "ingest",
    });
    return { status: "processed", resultRef: String(result?.messageId ?? "") };
  }

  // Task 10 adds "lead.created"; Task 12 adds "generic.message"/"generic.lead".
  return { status: "skipped", skipReason: `unsupported kind ${event.kind}` };
}

async function finishReplay(ctx: any, replayId: any, outcome: ProcessOutcome) {
  await ctx.db.patch(replayId, {
    ...(outcome.status === "processed"
      ? { status: "processed" as const, resultRef: outcome.resultRef }
      : { status: "skipped" as const, skipReason: outcome.skipReason }),
    processedAt: Date.now(),
  });
}

export const processEvent = internalMutation({
  args: { eventId: v.id("ingestEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("event not found");
    const outcome = await processCapturedEvent(ctx, event);
    await finishReplay(ctx, args.eventId, outcome);
    return outcome;
  },
});

export const replayEvent = mutation({
  args: { eventId: v.id("ingestEvents") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.core.replayEvent");
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("event not found");
    const replayId = await ctx.db.insert("ingestEvents", {
      sourceKey: event.sourceKey, kind: event.kind,
      rawHeaders: event.rawHeaders, rawBody: event.rawBody,
      signatureOk: event.signatureOk, status: "received",
      receivedAt: Date.now(), replayOf: args.eventId,
    });
    const outcome = await processCapturedEvent(ctx, { ...event, receivedAt: Date.now() });
    await finishReplay(ctx, replayId, outcome);
    // Close out the original so it stops counting as failed.
    if (event.status === "failed") {
      await ctx.db.patch(args.eventId, { status: "processed", processedAt: Date.now() });
    }
    return outcome;
  },
});

export const replayAllFailed = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "ingest.core.replayAllFailed");
    const failed = await ctx.db
      .query("ingestEvents")
      .withIndex("by_status_receivedAt", (q) => q.eq("status", "failed"))
      .take(100);
    let replayed = 0;
    for (const event of failed) {
      const replayId = await ctx.db.insert("ingestEvents", {
        sourceKey: event.sourceKey, kind: event.kind,
        rawHeaders: event.rawHeaders, rawBody: event.rawBody,
        signatureOk: event.signatureOk, status: "received",
        receivedAt: Date.now(), replayOf: event._id,
      });
      const outcome = await processCapturedEvent(ctx, { ...event, receivedAt: Date.now() });
      await finishReplay(ctx, replayId, outcome);
      await ctx.db.patch(event._id, { status: "processed", processedAt: Date.now() });
      replayed++;
    }
    return { replayed };
  },
});
```

- [ ] **Step 6: Add the HTTP route**

In `convex/http.ts`, after the `/n8n/state` route (leave it untouched), add:

```ts
import { verifySignature } from "./ingest/signature";

const MAX_BODY_BYTES = 262_144; // 256 KB

http.route({
  path: "/webhooks/kirimdev",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "payload too large" }, 400);
    }
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, {
      sourceKey: "kirimdev-pustakaislam",
    });
    if (!source || !source.enabled) return jsonResponse({ ok: false, error: "unknown source" }, 404);

    const sig = await verifySignature({
      header: request.headers.get("x-kirim-signature"),
      rawBody, secret: source.secret, nowMs: Date.now(),
    });
    if (!sig.ok && source.enforceSignature) {
      return jsonResponse({ ok: false, error: "invalid signature" }, 401);
    }
    try { JSON.parse(rawBody); } catch {
      return jsonResponse({ ok: false, error: "invalid json" }, 400);
    }

    const relevantHeaders: Record<string, string> = {};
    for (const h of ["x-kirim-event", "x-kirim-event-id", "x-kirim-delivery-id", "x-kirim-signature", "content-type"]) {
      const val = request.headers.get(h);
      if (val) relevantHeaders[h] = val;
    }
    const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
      sourceKey: source.sourceKey,
      kind: "message.event",
      rawHeaders: JSON.stringify(relevantHeaders),
      rawBody,
      signatureOk: sig.ok,
    });
    // Always-200 after capture: a processing bug must not make the vendor
    // count failures (that is what auto-disabled the subscription on 7 Jul).
    try {
      await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
    } catch (e) {
      await ctx.runMutation(internal.ingest.events.markFailed, {
        eventId, error: (e as Error).message || String(e),
      });
    }
    return jsonResponse({ ok: true, eventId });
  }),
});
```

- [ ] **Step 7: Run full suite + build**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build`
Expected: all green (144 + new), build exit 0.

- [ ] **Step 8: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/messages.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/http.ts && git commit -m "feat(ingest): /webhooks/kirimdev — capture-first, always-200, CS lookup via csConfigs, replay"
```

---

### Task 6: M1 deploy + rollout (dual-run cutover start)

**Files:**
- Create: `docs/superpowers/plans/2026-07-08-fase1-rollout-checklist.md` (living checklist, updated through M4)

**Interfaces:**
- Consumes: everything M1. No code changes.

- [ ] **Step 1: Deploy**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx convex deploy -y && git push origin main`
Expected: deploy success — route live at `https://helpful-spoonbill-863.convex.site/webhooks/kirimdev`.

- [ ] **Step 2: Seed csConfigs providerNumberIds (production, one-time)**

The CS→WABA mapping moves from n8n hardcode into csConfigs. Check `convex/csConfigs.ts` for an existing admin upsert/update mutation; extend it with `providerNumberIds` if it lacks the field, then set (values verbatim from n8n `CS_BY_PHONE_ID`):
- CS Aisyah → `["1197250776802755"]`
- CS Risma → `["433364286526515"]`
- CS Azelia → `["485071188032281"]`
- CS Lila → `["248236235032868"]`
- CS Nabila → `["589458990909040", "1149779461560484"]`

Fallback: patch rows via Convex dashboard data editor. Verify all 5 rows carry the field.

- [ ] **Step 3: Write the rollout checklist doc** with this exact content, then commit:

```markdown
# Fase 1 Rollout Checklist (living doc)

## M1 — KirimDev dual-run
- [ ] (Fandy, KirimDev dashboard) Create NEW webhook subscription:
      URL: https://helpful-spoonbill-863.convex.site/webhooks/kirimdev
      Events: message.received, message.sent — same as the wbs_A3A14 (n8n) subscription.
      Copy the signing secret (shown ONCE).
- [ ] (Fandy or Claude via authenticated panel/dashboard) upsertSource:
      sourceKey "kirimdev-pustakaislam", kind "kirimdev", secret <paste>,
      enabled true, enforceSignature FALSE (log-only).
- [ ] Old n8n subscription stays ENABLED (dual-run; dedup by externalMessageId
      makes double delivery safe).
- [ ] After ≥20 live events: check ingestEvents — every row signatureOk=true?
      → setEnforceSignature(true). If signatureOk=false consistently, the HMAC
      construction differs (e.g. body-only instead of t.body): adjust
      convex/ingest/signature.ts, redeploy, re-check. DO NOT enforce until true.
- [ ] Parity 2-3 days: daily compare ingest dailyStats vs n8n execution count for
      workflow STIyKl6dDgdZgKeh; spot-check closings in Laporan.
- [ ] Cutover: DISABLE (not delete) the OLD n8n subscription wbs_A3A14.
      Rollback at any time = re-enable it.

## M2 — Monitoring
- [ ] (Fandy, Convex dashboard → Settings → Environment Variables)
      TELEGRAM_BOT_TOKEN = <existing WaFaChat bot token, from n8n Telegram credential>
      TELEGRAM_ALERT_CHAT_ID = <Fandy's chat id with that bot>
- [ ] Live alert test: run internal.ingest.monitor.checkHealth from the dashboard
      function runner at a moment engineered to trip silence (e.g. before any
      ingest events exist, inside 08:00-21:00 WIB) → Telegram message arrives.

## M3 — Orders
- [ ] (Fandy, Berdu dashboard) Check: does Berdu allow >1 webhook URL per event?
      YES → Plan A: add second webhook → https://helpful-spoonbill-863.convex.site/webhooks/berdu
      NO  → Plan B: edit n8n "Order Trigger v2" Normalize node: change the
            order-sync URL from n8n.miqra.dev/webhook/conversation-state to
            https://helpful-spoonbill-863.convex.site/webhooks/berdu (keep 3 retries).
- [ ] (Fandy, Convex dashboard env) BERDU_APP_ID, BERDU_USER_ID, BERDU_APP_SECRET,
      BERDU_HMAC_KEY (value of the n8n credential "Berdu HMAC Secret v2" — open it
      in the n8n UI; if unreadable there, retrieve from Berdu developer settings).
- [ ] (Fandy or Claude) upsertSource: sourceKey "berdu-pustakaislam", kind "berdu",
      secret <generate a random 32+ char string>, enabled true, enforceSignature
      false (Plan B n8n calls carry no signature; keep log-only for this source).
- [ ] Verify one reconciler run in Convex logs pulls a real order (or reports 0 gaps).
- [ ] Disable n8n "WaFaChat · Order Reconciler (gap-heal)" after 2 clean days.

## M4 — Generic + closeout
- [ ] n8n "WaFaChat - KirimDev Message Receiver v2" deactivated (keep 2 weeks, then archive).
- [ ] Fire-drill: stop the n8n VPS for 1 hour during work hours — messages+orders keep
      flowing into the panel; silence alert does NOT fire; notif-order queues/fails
      as expected (separate service). Record results here.
```

- [ ] **Step 4: Commit checklist**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add docs/superpowers/plans/2026-07-08-fase1-rollout-checklist.md && git commit -m "docs(ingest): Fase 1 rollout checklist (dual-run cutover)" && git push origin main
```

**BLOCKER GATE:** the KirimDev-dashboard steps need Fandy. Report code DONE and flag the manual items; M2 tasks may proceed while dual-run soaks.

---

# Milestone M2 — Monitoring (silence + failure alerts)

### Task 7: `monitor.ts` — detector + Telegram alert

**Files:**
- Create: `convex/ingest/monitor.ts`
- Test: `convex/ingest/monitor.test.ts`

**Interfaces:**
- Consumes: `ingestEvents` indexes, `alertState` table.
- Produces:
  - `shouldAlert(snapshot: HealthSnapshot, nowMs: number): {silence: boolean, failureSpike: boolean}` pure export — business hours 08:00–21:00 WIB; silence ≥45 min; spike ≥5 failed/15 min
  - `getHealthSnapshot` internalQuery `{nowMs}` → `{lastProcessedMessageAt: number | null, failedLast15m: number}`
  - `stampAlertIfCool` internalMutation `{alertKey, nowMs}` → `{sent: boolean}` (60-min cooldown via `alertState`)
  - `checkHealth` internalAction — cron entry: snapshot → shouldAlert → cooldown → Telegram fetch (missing env → warn + skip, never throw)

- [ ] **Step 1: Write failing tests**

Create `convex/ingest/monitor.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { shouldAlert } from "./monitor";

// 2026-07-08 10:00 WIB == 03:00 UTC
const WORK_HOURS = Date.UTC(2026, 6, 8, 3, 0, 0);
// 2026-07-08 23:30 WIB == 16:30 UTC
const NIGHT = Date.UTC(2026, 6, 8, 16, 30, 0);

describe("shouldAlert (pure)", () => {
  test("silence >=45min inside work hours fires", () => {
    const r = shouldAlert({ lastProcessedMessageAt: WORK_HOURS - 46 * 60_000, failedLast15m: 0 }, WORK_HOURS);
    expect(r.silence).toBe(true);
  });
  test("silence <45min does not fire", () => {
    const r = shouldAlert({ lastProcessedMessageAt: WORK_HOURS - 44 * 60_000, failedLast15m: 0 }, WORK_HOURS);
    expect(r.silence).toBe(false);
  });
  test("outside work hours never fires silence", () => {
    const r = shouldAlert({ lastProcessedMessageAt: NIGHT - 5 * 3_600_000, failedLast15m: 0 }, NIGHT);
    expect(r.silence).toBe(false);
  });
  test("null last-message inside work hours fires (never ingested anything)", () => {
    expect(shouldAlert({ lastProcessedMessageAt: null, failedLast15m: 0 }, WORK_HOURS).silence).toBe(true);
  });
  test("failure spike >=5 fires regardless of hours", () => {
    expect(shouldAlert({ lastProcessedMessageAt: NIGHT, failedLast15m: 5 }, NIGHT).failureSpike).toBe(true);
    expect(shouldAlert({ lastProcessedMessageAt: NIGHT, failedLast15m: 4 }, NIGHT).failureSpike).toBe(false);
  });
});

describe("health snapshot + cooldown", () => {
  test("snapshot reads last processed message.event and failed count", async () => {
    const t = convexTest(schema);
    const e = await t.mutation(internal.ingest.events.captureEvent, {
      sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markProcessed, { eventId: e });
    const f = await t.mutation(internal.ingest.events.captureEvent, {
      sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markFailed, { eventId: f, error: "x" });
    const snap = await t.query(internal.ingest.monitor.getHealthSnapshot, { nowMs: Date.now() });
    expect(snap.lastProcessedMessageAt).toBeGreaterThan(0);
    expect(snap.failedLast15m).toBe(1);
  });

  test("cooldown: second stamp within 60min is blocked", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const first = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { alertKey: "silence", nowMs: now });
    expect(first.sent).toBe(true);
    const second = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { alertKey: "silence", nowMs: now + 59 * 60_000 });
    expect(second.sent).toBe(false);
    const third = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { alertKey: "silence", nowMs: now + 61 * 60_000 });
    expect(third.sent).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/monitor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `monitor.ts`**

```ts
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

const SILENCE_MIN = 45;
const SPIKE_THRESHOLD = 5;
const SPIKE_WINDOW_MS = 15 * 60_000;
const COOLDOWN_MS = 60 * 60_000;
const WORK_START_WIB = 8;
const WORK_END_WIB = 21;

export type HealthSnapshot = { lastProcessedMessageAt: number | null; failedLast15m: number };

export function shouldAlert(snap: HealthSnapshot, nowMs: number) {
  const wibHour = new Date(nowMs + 7 * 3_600_000).getUTCHours();
  const inWorkHours = wibHour >= WORK_START_WIB && wibHour < WORK_END_WIB;
  const silentFor = snap.lastProcessedMessageAt === null
    ? Number.POSITIVE_INFINITY
    : nowMs - snap.lastProcessedMessageAt;
  return {
    silence: inWorkHours && silentFor >= SILENCE_MIN * 60_000,
    failureSpike: snap.failedLast15m >= SPIKE_THRESHOLD,
  };
}

export const getHealthSnapshot = internalQuery({
  args: { nowMs: v.number() },
  handler: async (ctx, args): Promise<HealthSnapshot> => {
    const recentProcessed = await ctx.db
      .query("ingestEvents")
      .withIndex("by_status_receivedAt", (q) => q.eq("status", "processed"))
      .order("desc")
      .take(50);
    const lastMsg = recentProcessed.find((e) => e.kind === "message.event");
    const failed = await ctx.db
      .query("ingestEvents")
      .withIndex("by_status_receivedAt", (q) =>
        q.eq("status", "failed").gte("receivedAt", args.nowMs - SPIKE_WINDOW_MS))
      .collect();
    return {
      lastProcessedMessageAt: lastMsg?.processedAt ?? lastMsg?.receivedAt ?? null,
      failedLast15m: failed.length,
    };
  },
});

export const stampAlertIfCool = internalMutation({
  args: { alertKey: v.string(), nowMs: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertState")
      .withIndex("by_alertKey", (q) => q.eq("alertKey", args.alertKey))
      .unique();
    if (existing && args.nowMs - existing.lastSentAt < COOLDOWN_MS) return { sent: false };
    if (existing) await ctx.db.patch(existing._id, { lastSentAt: args.nowMs });
    else await ctx.db.insert("alertState", { alertKey: args.alertKey, lastSentAt: args.nowMs });
    return { sent: true };
  },
});

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[ingest-monitor] TELEGRAM env not set; alert suppressed:", text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("[ingest-monitor] telegram send failed:", res.status, await res.text());
}

export const checkHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const nowMs = Date.now();
    const snap = await ctx.runQuery(internal.ingest.monitor.getHealthSnapshot, { nowMs });
    const alerts = shouldAlert(snap, nowMs);
    if (alerts.silence) {
      const gate = await ctx.runMutation(internal.ingest.monitor.stampAlertIfCool, { alertKey: "silence", nowMs });
      if (gate.sent) {
        const mins = snap.lastProcessedMessageAt
          ? Math.round((nowMs - snap.lastProcessedMessageAt) / 60_000) : -1;
        await sendTelegram(
          `⚠️ WaFaChat: tidak ada pesan masuk ${mins >= 0 ? `${mins} menit` : "sama sekali"} di jam kerja. ` +
          `Cek KirimDev subscription (Disabled?) & endpoint Convex.`,
        );
      }
    }
    if (alerts.failureSpike) {
      const gate = await ctx.runMutation(internal.ingest.monitor.stampAlertIfCool, { alertKey: "failure-spike", nowMs });
      if (gate.sent) {
        await sendTelegram(
          `🔥 WaFaChat: ${snap.failedLast15m} ingest event GAGAL dalam 15 menit. ` +
          `Jalankan replayAllFailed setelah perbaikan.`,
        );
      }
    }
  },
});
```

- [ ] **Step 4: Run tests**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/monitor.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ingest/monitor.ts convex/ingest/monitor.test.ts && git commit -m "feat(ingest): silence + failure-spike detector with Telegram alert and cooldown"
```

---

### Task 8: Cron registration + M2 deploy

**Files:**
- Modify: `convex/crons.ts`, `convex/ingest/events.ts`

**Interfaces:**
- Consumes: `internal.ingest.monitor.checkHealth`, `internal.ingest.events.cleanupOldDaily`. (Reconciler cron lands in Task 11.)
- Produces: `cleanupOldDaily` internalMutation `{}` (30-day retention wrapper — crons pass static args, `cleanupOld` needs a computed cutoff).

- [ ] **Step 1: Add `cleanupOldDaily` to `convex/ingest/events.ts`**

```ts
export const cleanupOldDaily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 3_600_000;
    const old = await ctx.db
      .query("ingestEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return { deleted: old.length };
  },
});
```

- [ ] **Step 2: Register crons** — in `convex/crons.ts` (already has `crons.daily` + `crons.hourly`), add before `export default crons;`:

```ts
crons.interval(
  "ingest silence detector",
  { minutes: 5 },
  internal.ingest.monitor.checkHealth,
  {},
);

crons.daily(
  "ingest events retention (30d)",
  { hourUTC: 19, minuteUTC: 30 }, // 02:30 WIB, quiet window
  internal.ingest.events.cleanupOldDaily,
  {},
);
```

- [ ] **Step 3: Full suite + build + deploy**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build && npx convex deploy -y && git push origin main`
Expected: green; Convex dashboard → Crons shows both new entries.

- [ ] **Step 4: Manual (Fandy, per rollout checklist M2):** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`, run the live alert test, tick the checklist.

- [ ] **Step 5: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/crons.ts convex/ingest/events.ts && git commit -m "feat(ingest): register silence-detector + retention crons" && git push origin main
```

---

# Milestone M3 — Order path (Berdu)

### Task 9: Commit the pending `state.ts` createdAt-preservation diff

**Files:**
- Modify (already edited in working tree, uncommitted): `convex/state.ts`, `convex/state.test.ts`

- [ ] **Step 1: Inspect the pending diff**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && git diff convex/state.ts convex/state.test.ts`
Expected: `upsertOrderFromN8n` patches `createdAt` when provided (order + existing conversation), new conversation uses `args.createdAt ?? now`; the test file adds ~24 lines covering it. If the working tree is already clean (someone committed it), skip to done.

- [ ] **Step 2: Verify tests pass**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/state.test.ts`
Expected: PASS including the createdAt-preservation tests.

- [ ] **Step 3: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/state.ts convex/state.test.ts && git commit -m "fix(orders): preserve original createdAt on order upsert (replay/backfill lands at true time)"
```

---

### Task 10: `berduAdapter.ts` + `upsertOrderCore` + `/webhooks/berdu` route

**Files:**
- Create: `convex/ingest/berduAdapter.ts`
- Modify: `convex/state.ts` (extract `upsertOrderCore`, same pattern as Task 5 Step 1)
- Modify: `convex/ingest/core.ts` (add `lead.created` branch)
- Modify: `convex/http.ts` (add route)
- Test: `convex/ingest/berduAdapter.test.ts`, extend `convex/ingest/core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UniversalLeadEvent = {
    phone: string; csName: string; customerName: string;
    productName: string; products: string; productsSubtotal: string;
    shippingCost: string; total: string;
    shippingAddress: string; shippingDistrict: string; shippingCity: string;
    orderId: string; createdAt?: number;
  };
  export type BerduParseResult =
    | { kind: "lead"; event: UniversalLeadEvent }
    | { kind: "skip"; reason: string };
  export function parseBerduOrderDetail(order: unknown): BerduParseResult;
  ```
  `state.ts`: `export async function upsertOrderCore(ctx: any, args)` — extracted handler with the exact arg shape of `upsertOrderFromN8n` (`phone, csName, csNumber?, productName?, products?, productsSubtotal?, shippingCost?, total?, customerName?, shippingAddress?, shippingDistrict?, shippingCity?, order_id?, createdAt?`); the internalMutation becomes a thin wrapper.
- Berdu staff→CS mapping (verbatim from n8n): `B-1apQSy→Aisyah, B-1CxSmL→Risma, B-Z28TdYc→Azelia, B-NCIXt→Lila, B-ZDfQE9→Nabila` — constant `BERDU_STAFF_MAP` in `berduAdapter.ts`, commented as moving to orgSettings in Fase 0 Task E.

- [ ] **Step 1: Write failing adapter tests**

Create `convex/ingest/berduAdapter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseBerduOrderDetail } from "./berduAdapter";

// Shape per the n8n "Build Backfill" node (proven against Berdu GET /order/detail).
const ORDER = {
  id: "O-260708000123",
  created_at: "2026-07-08T09:15:00+07:00",
  assigned_to_staff: "B-Z28TdYc",
  shipping_cost: 15000,
  total: 100000,
  shipping_address: {
    phone: "0857 9953 3626", firstName: "Kurn",
    address: "Jl. Mawar 1", district: "Coblong", city: "Bandung",
  },
  products: [{ name: "Buku Sirah", price: 85000, count: 1 }],
};

describe("parseBerduOrderDetail", () => {
  test("maps full order with normalized phone, rupiah strings, staff->CS", () => {
    const r = parseBerduOrderDetail(ORDER);
    expect(r).toEqual({
      kind: "lead",
      event: {
        phone: "6285799533626",
        csName: "Azelia",
        customerName: "Kurn",
        productName: "Buku Sirah",
        products: "Buku Sirah (1x)",
        productsSubtotal: "Rp85.000",
        shippingCost: "Rp15.000",
        total: "Rp100.000",
        shippingAddress: "Jl. Mawar 1",
        shippingDistrict: "Coblong",
        shippingCity: "Bandung",
        orderId: "O-260708000123",
        createdAt: Date.parse("2026-07-08T09:15:00+07:00"),
      },
    });
  });
  test("unknown staff falls back to 'Staff <id>'", () => {
    const r = parseBerduOrderDetail({ ...ORDER, assigned_to_staff: "B-XXX" });
    expect(r.kind).toBe("lead");
    if (r.kind === "lead") expect(r.event.csName).toBe("Staff B-XXX");
  });
  test("missing shipping_address or phone skips", () => {
    expect(parseBerduOrderDetail({ id: "O-1" })).toEqual({ kind: "skip", reason: "no shipping_address" });
    expect(parseBerduOrderDetail({ ...ORDER, shipping_address: { firstName: "X" } }))
      .toEqual({ kind: "skip", reason: "no phone" });
  });
  test("phone normalization: +62 stays, leading 0 -> 62, leading 8 -> 628", () => {
    const a = parseBerduOrderDetail({ ...ORDER, shipping_address: { ...ORDER.shipping_address, phone: "+6285799533626" } });
    if (a.kind === "lead") expect(a.event.phone).toBe("6285799533626");
    const b = parseBerduOrderDetail({ ...ORDER, shipping_address: { ...ORDER.shipping_address, phone: "85799533626" } });
    if (b.kind === "lead") expect(b.event.phone).toBe("6285799533626");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run convex/ingest/berduAdapter.test.ts` → module not found.

- [ ] **Step 3: Implement `berduAdapter.ts`**

```ts
// Pure translation: Berdu order detail JSON -> universal lead.created.
// Port of n8n "Build Backfill" (reconciler) / "Normalize Order Data" (order trigger).

export type UniversalLeadEvent = {
  phone: string; csName: string; customerName: string;
  productName: string; products: string; productsSubtotal: string;
  shippingCost: string; total: string;
  shippingAddress: string; shippingDistrict: string; shippingCity: string;
  orderId: string; createdAt?: number;
};

export type BerduParseResult =
  | { kind: "lead"; event: UniversalLeadEvent }
  | { kind: "skip"; reason: string };

// Per-org glue inherited from n8n; moves to orgSettings in Fase 0 Task E.
const BERDU_STAFF_MAP: Record<string, string> = {
  "B-1apQSy": "Aisyah",
  "B-1CxSmL": "Risma",
  "B-Z28TdYc": "Azelia",
  "B-NCIXt": "Lila",
  "B-ZDfQE9": "Nabila",
};

function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  return String(raw).replace(/\s+/g, "").replace(/^\+/, "").replace(/^0/, "62").replace(/^8/, "628");
}

function formatRupiah(num: unknown): string {
  return "Rp" + Number(num || 0).toLocaleString("id-ID");
}

export function parseBerduOrderDetail(orderInput: unknown): BerduParseResult {
  const order = (orderInput ?? {}) as Record<string, any>;
  if (!order.id || !order.shipping_address) return { kind: "skip", reason: "no shipping_address" };
  const addr = order.shipping_address ?? {};
  const phone = normalizePhone(addr.phone);
  if (!phone) return { kind: "skip", reason: "no phone" };
  const products: any[] = order.products ?? [];
  const productsSubtotal = products.reduce((s, p) => s + p.price * p.count, 0);
  const staff = order.assigned_to_staff;
  const createdAt = order.created_at ? Date.parse(order.created_at) : undefined;
  return {
    kind: "lead",
    event: {
      phone,
      csName: BERDU_STAFF_MAP[staff] || `Staff ${staff || "?"}`,
      customerName: addr.firstName || "Pelanggan",
      productName: products[0]?.name || "",
      products: products.map((p) => `${p.name} (${p.count}x)`).join(", "),
      productsSubtotal: formatRupiah(productsSubtotal),
      shippingCost: formatRupiah(order.shipping_cost),
      total: formatRupiah(order.total),
      shippingAddress: addr.address || "",
      shippingDistrict: addr.district || "",
      shippingCity: addr.city || "",
      orderId: String(order.id),
      createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
    },
  };
}
```

- [ ] **Step 4: Extract `upsertOrderCore` in `state.ts`** — move the `upsertOrderFromN8n` handler body into `export async function upsertOrderCore(ctx: any, args: {...})` (same arg names/types as the internalMutation validators); the internalMutation delegates: `handler: async (ctx, args) => upsertOrderCore(ctx, args)`. Run `npx vitest run convex/state.test.ts` → still PASS.

- [ ] **Step 5: Add `lead.created` branch in `core.ts` `processCapturedEvent`** (after the `message.event` branch):

```ts
import { parseBerduOrderDetail } from "./berduAdapter";
import { upsertOrderCore } from "../state";

  if (event.kind === "lead.created") {
    const parsed = parseBerduOrderDetail((body as any).order ?? body);
    if (parsed.kind === "skip") return { status: "skipped", skipReason: parsed.reason };
    const e = parsed.event;
    const result = await upsertOrderCore(ctx, {
      phone: e.phone, csName: e.csName, customerName: e.customerName,
      productName: e.productName, products: e.products, productsSubtotal: e.productsSubtotal,
      shippingCost: e.shippingCost, total: e.total,
      shippingAddress: e.shippingAddress, shippingDistrict: e.shippingDistrict,
      shippingCity: e.shippingCity, order_id: e.orderId, createdAt: e.createdAt,
    });
    return { status: "processed", resultRef: String(result?.order_id ?? e.orderId) };
  }
```

- [ ] **Step 6: Add `/webhooks/berdu` route in `http.ts`**

The route accepts BOTH shapes: rich body containing the full order (Plan B: n8n forwards the detail it already fetched; also the reconciler's capture shape `{order: {...}}`) and thin body with only `order_id` (Plan A webhook) — thin bodies are enriched inline via `fetchBerduOrderDetail` (Task 11; until Task 11 lands, the import does not exist — Task 10 ships the route with the thin-body branch calling a local stub `async () => null`, replaced by the real import in Task 11 Step 5. The stub path yields a skipped event "no shipping_address", never a crash).

```ts
http.route({
  path: "/webhooks/berdu",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "payload too large" }, 400);
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, { sourceKey: "berdu-pustakaislam" });
    if (!source || !source.enabled) return jsonResponse({ ok: false, error: "unknown source" }, 404);
    const sig = await verifySignature({
      header: request.headers.get("x-wafachat-signature"),
      rawBody, secret: source.secret, nowMs: Date.now(),
    });
    if (!sig.ok && source.enforceSignature) return jsonResponse({ ok: false, error: "invalid signature" }, 401);
    let parsedBody: any;
    try { parsedBody = JSON.parse(rawBody); } catch { return jsonResponse({ ok: false, error: "invalid json" }, 400); }

    // Thin payload (order_id only) -> enrich BEFORE capture so the stored
    // rawBody is the full order (replayable without re-fetching).
    let effectiveBody = rawBody;
    if (!parsedBody.shipping_address && !parsedBody.order?.shipping_address && parsedBody.order_id) {
      const detail = await fetchBerduOrderDetail(String(parsedBody.order_id));
      if (detail) effectiveBody = JSON.stringify({ order: detail });
    }

    const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
      sourceKey: source.sourceKey, kind: "lead.created",
      rawHeaders: JSON.stringify({ "content-type": request.headers.get("content-type") ?? "" }),
      rawBody: effectiveBody, signatureOk: sig.ok,
    });
    try {
      await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
    } catch (e) {
      await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message || String(e) });
    }
    return jsonResponse({ ok: true, eventId });
  }),
});
```

- [ ] **Step 7: Extend `core.test.ts`**:

```ts
test("lead.created ingests order via upsertOrderCore with preserved createdAt", async () => {
  const t = convexTest(schema);
  const raw = JSON.stringify({ order: {
    id: "O-260708000123", created_at: "2026-07-08T09:15:00+07:00", assigned_to_staff: "B-Z28TdYc",
    shipping_cost: 15000, total: 100000,
    shipping_address: { phone: "085799533626", firstName: "Kurn", address: "Jl. Mawar 1", district: "Coblong", city: "Bandung" },
    products: [{ name: "Buku Sirah", price: 85000, count: 1 }],
  }});
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}", rawBody: raw, signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderId: "O-260708000123",
      createdAt: Date.parse("2026-07-08T09:15:00+07:00"),
    });
  });
});
```

- [ ] **Step 8: Full suite + build, then commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build && git add convex/ingest/berduAdapter.ts convex/ingest/berduAdapter.test.ts convex/ingest/core.ts convex/ingest/core.test.ts convex/state.ts convex/http.ts && git commit -m "feat(ingest): Berdu lead path — adapter, /webhooks/berdu, upsertOrderCore extraction"
```

---

### Task 11: `reconciler.ts` — Berdu gap-heal cron

**Files:**
- Create: `convex/ingest/reconciler.ts`
- Modify: `convex/crons.ts` (+1 cron), `convex/http.ts` (replace Task 10's stub with the real `fetchBerduOrderDetail` import)
- Test: `convex/ingest/reconciler.test.ts`

**Interfaces:**
- Consumes: `internal.state.listOrderCountersByPrefix` → `{datePrefix, counters: number[], min: number|null, max: number|null, count}`; `hmacBase64` (Task 2).
- Produces:
  - `wibDatePrefix(nowMs: number): string` pure — `YYMMDD` in WIB
  - `computeGaps(counters: number[], min: number|null, max: number|null): number[]` pure
  - `buildBerduAuth(appId, appSecret, hmacKey, nowSec): Promise<{authHeader: string}>` pure — HMAC-SHA256 **base64** of message `` `${appId}:${nowSec}:${appSecret}` `` keyed with `hmacKey`; header value `` `${appId}.${nowSec}.${signature}` `` (verbatim scheme from n8n nodes "Compute Gaps" + "HMAC SHA256" + "Build Auth Header")
  - `fetchBerduOrderDetail(orderId: string): Promise<any | null>` — GET `https://api.berdu.id/v0.0/order/detail?user_id=${BERDU_USER_ID}&order_id=${orderId}` with `Authorization: <authHeader>`; null on missing env / non-200
  - `runReconcile` internalAction — cron entry (5 min)

Env vars (Fandy sets in Convex dashboard, rollout checklist M3): `BERDU_APP_ID`, `BERDU_USER_ID`, `BERDU_APP_SECRET`, `BERDU_HMAC_KEY`. **Never hardcode values** (the n8n code node hardcoded them — part of what this migration fixes).

- [ ] **Step 1: Failing tests for the pure parts**

Create `convex/ingest/reconciler.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildBerduAuth, computeGaps, wibDatePrefix } from "./reconciler";
import { hmacBase64 } from "./signature";

describe("computeGaps", () => {
  test("finds holes between min and max", () => {
    expect(computeGaps([1, 2, 5, 6], 1, 6)).toEqual([3, 4]);
  });
  test("no gaps / empty -> empty", () => {
    expect(computeGaps([1, 2, 3], 1, 3)).toEqual([]);
    expect(computeGaps([], null, null)).toEqual([]);
  });
});

describe("wibDatePrefix", () => {
  test("formats YYMMDD in WIB", () => {
    // 2026-07-07 18:00 UTC == 2026-07-08 01:00 WIB
    expect(wibDatePrefix(Date.UTC(2026, 6, 7, 18, 0, 0))).toBe("260708");
  });
});

describe("buildBerduAuth", () => {
  test("header = appId.ts.base64hmac(appId:ts:appSecret, key)", async () => {
    const { authHeader } = await buildBerduAuth("app1", "sec1", "key1", 1783442989);
    const expectedSig = await hmacBase64("key1", "app1:1783442989:sec1");
    expect(authHeader).toBe(`app1.1783442989.${expectedSig}`);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement `reconciler.ts`**

```ts
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hmacBase64 } from "./signature";

export function wibDatePrefix(nowMs: number): string {
  const wib = new Date(nowMs + 7 * 3_600_000);
  const yy = String(wib.getUTCFullYear()).slice(2);
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function computeGaps(counters: number[], min: number | null, max: number | null): number[] {
  if (min === null || max === null) return [];
  const present = new Set(counters);
  const gaps: number[] = [];
  for (let c = min; c <= max; c++) if (!present.has(c)) gaps.push(c);
  return gaps;
}

export async function buildBerduAuth(appId: string, appSecret: string, hmacKey: string, nowSec: number) {
  const signature = await hmacBase64(hmacKey, `${appId}:${nowSec}:${appSecret}`);
  return { authHeader: `${appId}.${nowSec}.${signature}` };
}

export async function fetchBerduOrderDetail(orderId: string): Promise<any | null> {
  const appId = process.env.BERDU_APP_ID;
  const userId = process.env.BERDU_USER_ID;
  const appSecret = process.env.BERDU_APP_SECRET;
  const hmacKey = process.env.BERDU_HMAC_KEY;
  if (!appId || !userId || !appSecret || !hmacKey) {
    console.warn("[reconciler] BERDU_* env not set; skipping fetch");
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const { authHeader } = await buildBerduAuth(appId, appSecret, hmacKey, nowSec);
  const url = `https://api.berdu.id/v0.0/order/detail?user_id=${encodeURIComponent(userId)}&order_id=${encodeURIComponent(orderId)}`;
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    console.warn(`[reconciler] detail fetch ${orderId} -> ${res.status}`);
    return null;
  }
  return res.json();
}

export const runReconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const datePrefix = wibDatePrefix(Date.now());
    const counters = await ctx.runQuery(internal.state.listOrderCountersByPrefix, { datePrefix });
    const gaps = computeGaps(counters.counters, counters.min, counters.max);
    let healed = 0;
    for (const c of gaps.slice(0, 50)) { // bound one run
      const orderId = `O-${datePrefix}${String(c).padStart(6, "0")}`;
      const detail = await fetchBerduOrderDetail(orderId);
      if (!detail) continue;
      const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
        sourceKey: "berdu-reconciler", kind: "lead.created",
        rawHeaders: "{}", rawBody: JSON.stringify({ order: detail }), signatureOk: true,
      });
      try {
        await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
        healed++;
      } catch (e) {
        await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message });
      }
    }
    if (gaps.length > 0) console.log(`[reconciler] ${datePrefix}: ${gaps.length} gaps, ${healed} healed`);
  },
});
```

- [ ] **Step 4: Register cron** in `convex/crons.ts`:

```ts
crons.interval(
  "berdu order reconciler",
  { minutes: 5 },
  internal.ingest.reconciler.runReconcile,
  {},
);
```

- [ ] **Step 5: Replace Task 10's stub in `http.ts`** with `import { fetchBerduOrderDetail } from "./ingest/reconciler";`

- [ ] **Step 6: Full suite + build + deploy M3**

Run: `cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build && npx convex deploy -y && git push origin main`
Expected: green. Then walk rollout checklist M3 (Fandy: BERDU_* env vars, Plan A/B check, upsertSource `berdu-pustakaislam`, verify one reconciler run in logs).

- [ ] **Step 7: Commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && git add convex/ingest/reconciler.ts convex/ingest/reconciler.test.ts convex/crons.ts convex/http.ts && git commit -m "feat(ingest): Berdu reconciler cron — gap-heal every 5min, pull safety-net" && git push origin main
```

---

# Milestone M4 — Generic endpoints + closeout

### Task 12: `/ingest/message` + `/ingest/lead` generic routes

**Files:**
- Modify: `convex/ingest/core.ts` (add `generic.message` / `generic.lead` branches)
- Modify: `convex/http.ts` (add 2 routes via one helper)
- Test: extend `convex/ingest/core.test.ts`

**Interfaces:**
- Auth: headers `X-Wafachat-Source: <sourceKey>` + `X-Wafachat-Signature: t=…,v1=…` verified against that source's secret; generic sources are `kind: "custom"` rows in `ingestSources`.
- Body contracts (spec §7) — invalid field → skipped with reason (still 200 after capture):
  - message: `{phone, direction: "inbound"|"outbound", role: "customer"|"cs"|"ai", content, externalMessageId, timestamp?, csName?}`
  - lead: `{phone, orderId, csName, customerName?, products?, total?, timestamp?}`

- [ ] **Step 1: Add branches to `processCapturedEvent`** (after `lead.created`):

```ts
  if (event.kind === "generic.message") {
    const p = body as Record<string, any>;
    if (!p.phone || !p.content || !p.externalMessageId) return { status: "skipped", skipReason: "missing phone/content/externalMessageId" };
    if (p.direction !== "inbound" && p.direction !== "outbound") return { status: "skipped", skipReason: "invalid direction" };
    if (p.role !== "customer" && p.role !== "cs" && p.role !== "ai") return { status: "skipped", skipReason: "invalid role" };
    const result = await appendMessageCore(ctx, {
      phone: String(p.phone), role: p.role, direction: p.direction,
      content: String(p.content), messageType: "text",
      externalMessageId: String(p.externalMessageId),
      createdAt: typeof p.timestamp === "number" ? p.timestamp : event.receivedAt,
      csName: typeof p.csName === "string" ? p.csName : undefined,
      source: "ingest",
    });
    return { status: "processed", resultRef: String(result?.messageId ?? "") };
  }

  if (event.kind === "generic.lead") {
    const p = body as Record<string, any>;
    if (!p.phone || !p.orderId || !p.csName) return { status: "skipped", skipReason: "missing phone/orderId/csName" };
    const result = await upsertOrderCore(ctx, {
      phone: String(p.phone), csName: String(p.csName),
      customerName: p.customerName ? String(p.customerName) : undefined,
      products: p.products ? String(p.products) : undefined,
      total: p.total ? String(p.total) : undefined,
      order_id: String(p.orderId),
      createdAt: typeof p.timestamp === "number" ? p.timestamp : undefined,
    });
    return { status: "processed", resultRef: String(result?.order_id ?? p.orderId) };
  }
```

- [ ] **Step 2: Add routes in `http.ts`** — one DRY helper:

```ts
function genericIngestRoute(path: string, kind: "generic.message" | "generic.lead") {
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const rawBody = await request.text();
      if (rawBody.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "payload too large" }, 400);
      const sourceKey = request.headers.get("x-wafachat-source") ?? "";
      const source = sourceKey
        ? await ctx.runQuery(internal.ingest.sources.getBySourceKey, { sourceKey })
        : null;
      if (!source || !source.enabled) return jsonResponse({ ok: false, error: "unknown source" }, 404);
      const sig = await verifySignature({
        header: request.headers.get("x-wafachat-signature"),
        rawBody, secret: source.secret, nowMs: Date.now(),
      });
      if (!sig.ok && source.enforceSignature) return jsonResponse({ ok: false, error: "invalid signature" }, 401);
      try { JSON.parse(rawBody); } catch { return jsonResponse({ ok: false, error: "invalid json" }, 400); }
      const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
        sourceKey: source.sourceKey, kind,
        rawHeaders: JSON.stringify({ "x-wafachat-source": sourceKey }),
        rawBody, signatureOk: sig.ok,
      });
      try {
        await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
      } catch (e) {
        await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message || String(e) });
      }
      return jsonResponse({ ok: true, eventId });
    }),
  });
}

genericIngestRoute("/ingest/message", "generic.message");
genericIngestRoute("/ingest/lead", "generic.lead");
```

(Optional DRY: `/webhooks/kirimdev` and `/webhooks/berdu` MAY be rebuilt on the same helper only if the diff is behavior-identical; otherwise leave them as-is.)

- [ ] **Step 3: Extend `core.test.ts`**:

```ts
test("generic.message ingests via universal contract", async () => {
  const t = convexTest(schema);
  const raw = JSON.stringify({
    phone: "6281234567890", direction: "inbound", role: "customer",
    content: "tanya stok", externalMessageId: "ext-1", timestamp: 1783427359000,
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}", rawBody: raw, signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const msgs = await ctx.db.query("messages").collect();
    expect(msgs[0]).toMatchObject({ content: "tanya stok", createdAt: 1783427359000 });
  });
});

test("generic.lead validates required fields", async () => {
  const t = convexTest(schema);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.lead", rawHeaders: "{}",
    rawBody: JSON.stringify({ phone: "628123" }), signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  const asAdminT = t.withIdentity({ subject: "a1", role: "admin", name: "A", email: "a@w" });
  const skipped = await asAdminT.query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("missing phone/orderId/csName");
});
```

- [ ] **Step 4: Full suite + build + deploy + commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build && npx convex deploy -y && git add convex/http.ts convex/ingest/core.ts convex/ingest/core.test.ts && git commit -m "feat(ingest): generic /ingest/message + /ingest/lead (BSP-agnostic, per-source HMAC)" && git push origin main
```

---

### Task 13: Parity query + cutover completion

**Files:**
- Modify: `convex/ingest/events.ts` (+1 admin query)
- Test: extend `convex/ingest/events.test.ts`

**Interfaces:**
- Produces: `dailyStats` public query (requireAdmin) `{dayStartMs, dayEndMs}` → `{received, processed, skipped, failed, byKind: Record<string, number>}` — the eyeball tool for the 2–3 day parity window (spec §9.4).

- [ ] **Step 1: Failing test** (extend `convex/ingest/events.test.ts`):

```ts
test("dailyStats aggregates by status and kind", async () => {
  const t = convexTest(schema);
  const e1 = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markProcessed, { eventId: e1 });
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "lead.created", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  const stats = await asAdmin(t).query(api.ingest.events.dailyStats, {
    dayStartMs: Date.now() - 3_600_000, dayEndMs: Date.now() + 3_600_000,
  });
  expect(stats).toMatchObject({
    received: 1, processed: 1, skipped: 0, failed: 0,
    byKind: { "message.event": 1, "lead.created": 1 },
  });
});
```

- [ ] **Step 2: Implement** in `convex/ingest/events.ts`:

```ts
export const dailyStats = query({
  args: { dayStartMs: v.number(), dayEndMs: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "ingest.events.dailyStats");
    const rows = await ctx.db
      .query("ingestEvents")
      .withIndex("by_receivedAt", (q) => q.gte("receivedAt", args.dayStartMs).lte("receivedAt", args.dayEndMs))
      .collect();
    const out = { received: 0, processed: 0, skipped: 0, failed: 0, byKind: {} as Record<string, number> };
    for (const r of rows) {
      out[r.status]++;
      out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + 1;
    }
    return out;
  },
});
```

- [ ] **Step 3: Test PASS → full suite → build → deploy → commit**

```bash
cd /f/Projects/whatsapp_cs_automotion/wafachat && npx vitest run && npm run build && npx convex deploy -y && git add convex/ingest/events.ts convex/ingest/events.test.ts && git commit -m "feat(ingest): dailyStats parity query" && git push origin main
```

- [ ] **Step 4: Execute cutover to completion** — walk the rollout checklist: disable old KirimDev subscription after parity; deactivate n8n receiver + n8n reconciler; run the M4 fire-drill (VPS off 1 hour during work hours → messages+orders keep flowing, silence alert does NOT fire, notif-order behaves as a separate service). Record results in the checklist doc and commit it.

---

## Definition of Done (mirrors spec §12)

- [ ] KirimDev → Convex live; old subscription disabled; parity verified over ≥2 days.
- [ ] Orders flow instant (Plan A or B) + reconciler cron active; n8n reconciler off.
- [ ] Silence/failure alerts arrive on Telegram (tested live).
- [ ] Fire-drill passed: n8n VPS stopped 1 hour in work hours with zero data-path impact.
- [ ] All tests green; build green; everything pushed.
