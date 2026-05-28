# Shipping Recap and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build WaFaChat Rekap Pengiriman with Excel export, then add a Performance view for leads, closing rate, product performance, and CS discount metrics.

**Architecture:** Convex remains the source of truth. n8n detects final `PEMESANAN BERHASIL` outbound messages and sends them to a Convex recap mutation. The Next.js panel reads Convex queries in realtime, exports filtered rows to Excel-compatible CSV, and computes performance from `orders` plus clean `shippingRecaps`.

**Tech Stack:** Next.js 14 App Router, React 18, Convex, TypeScript, shadcn/ui components, n8n, KirimChat webhooks.

---

## Scope Order

Build this in two slices:

1. Shipping recap + export. This removes admin copy-paste first.
2. Performance dashboard. This depends on clean `shippingRecaps` for accurate closing and discount numbers.

Do not modify `WaFaChat - Order Trigger`.

## File Map

- Modify: `convex/schema.ts`
  - Add `shippingRecaps` table.
  - Extend `events.type` with recap/export/cancel event names.
- Create: `convex/shippingRecaps.ts`
  - Parser helpers, mutations, queries, export status actions, performance query.
- Modify: `convex/http.ts`
  - Add `action: "upsert_shipping_recap"` endpoint for n8n compatibility.
- Modify: `app/panel/page.tsx`
  - Add tab/view state for Dashboard, Rekap Pengiriman, and Performance.
  - Render recap table, filters, detail drawer, and performance tables.
- Create: `app/api/shipping-recaps/export/route.ts`
  - Build CSV export from selected recap ids or current filter.
- Create: `scripts/patch-n8n-shipping-recap.ps1`
  - Patch Chat Handler node `09 Parse AI Reply + Save History` or immediate post-send flow to call Convex when outbound message contains `PEMESANAN BERHASIL`.
- Optional Create: `docs/n8n-backups/YYYY-MM-DD/chat-handler.pre-shipping-recap-live.json`
  - Backup before n8n patch.

## Data Contracts

Use these status values:

```ts
type ShippingRecapStatus =
  | "ready"
  | "needs_review"
  | "exported"
  | "cancelled"
  | "cancelled_after_export";
```

Use these flag values:

```ts
type ShippingRecapFlag =
  | "ADDRESS_CHANGED"
  | "TOTAL_CHANGED"
  | "PHONE_CHANGED"
  | "PAYMENT_METHOD_CHANGED"
  | "MISSING_DISTRICT"
  | "MISSING_CITY"
  | "PARSE_LOW_CONFIDENCE"
  | "MISSING_ORDER_CONTEXT"
  | "INFERRED_DISCOUNT"
  | "UPDATED_AFTER_EXPORT";
```

Use these payment values:

```ts
type ShippingPaymentMethod = "cod" | "transfer" | "unknown";
```

### Task 1: Convex Schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add `shippingRecaps` schema**

Add this table before `dailyStats`:

```ts
  shippingRecaps: defineTable({
    orderIdBerdu: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    customerPhone: v.string(),
    customerName: v.string(),
    csName: v.string(),
    csPhone: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    closedAt: v.number(),
    recipientName: v.string(),
    recipientPhone: v.string(),
    recipientAddress: v.string(),
    recipientDistrict: v.string(),
    recipientCity: v.string(),
    packageContent: v.string(),
    paymentMethod: v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown")),
    nonCodItemPrice: v.optional(v.number()),
    codValue: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    total: v.optional(v.number()),
    discount: v.optional(v.number()),
    inferredDiscount: v.optional(v.number()),
    bumpOrder: v.optional(v.string()),
    upsell: v.optional(v.string()),
    specialBonus: v.optional(v.string()),
    shippingInstruction: v.optional(v.string()),
    status: v.union(
      v.literal("ready"),
      v.literal("needs_review"),
      v.literal("exported"),
      v.literal("cancelled"),
      v.literal("cancelled_after_export"),
    ),
    flags: v.array(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceMessageText: v.string(),
    version: v.number(),
    exportedAt: v.optional(v.number()),
    exportBatchId: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orderIdBerdu", ["orderIdBerdu"])
    .index("by_customerPhone", ["customerPhone"])
    .index("by_closedAt", ["closedAt"])
    .index("by_status_closedAt", ["status", "closedAt"])
    .index("by_paymentMethod_closedAt", ["paymentMethod", "closedAt"]),
```

- [ ] **Step 2: Extend event type union**

Add these event literals to the `events.type` union:

```ts
      v.literal("shipping_recap_upserted"),
      v.literal("shipping_recap_exported"),
      v.literal("shipping_recap_cancelled"),
      v.literal("shipping_recap_cancel_undone"),
      v.literal("shipping_recap_marked_ready"),
```

- [ ] **Step 3: Run build check**

Run:

```powershell
npm run build
```

Expected: build may fail if generated Convex types are stale. If it fails with missing generated types only, continue to Task 2 and run `npx convex dev --once` or `npx convex deploy --yes` at the verification checkpoint.

- [ ] **Step 4: Commit**

```powershell
git add convex/schema.ts
git commit -m "feat: add shipping recap schema"
```

### Task 2: Parser and Recap Mutations

**Files:**
- Create: `convex/shippingRecaps.ts`

- [ ] **Step 1: Create parser helpers**

Create `convex/shippingRecaps.ts` with these helpers at the top:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getJakartaDate } from "./lib";

type RecapStatus = "ready" | "needs_review" | "exported" | "cancelled" | "cancelled_after_export";
type PaymentMethod = "cod" | "transfer" | "unknown";

function parseRupiah(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  return Number(digits);
}

function normalizePhone(value: string | undefined): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function includesClosingMarker(text: string): boolean {
  return /\bPEMESANAN\s+BERHASIL\b/i.test(text);
}

function detectPaymentMethod(text: string): PaymentMethod {
  if (/\b(PEMBAYARAN|ORDER)\s+COD\b/i.test(text)) return "cod";
  if (/\b(PEMBAYARAN|ORDER)\s+TRANSFER\b/i.test(text)) return "transfer";
  if (/\bTRANSFER\b/i.test(text) && !/\bCOD\b/i.test(text)) return "transfer";
  return "unknown";
}

function extractLineValue(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function extractShippingBlock(text: string): string {
  const match = text.match(/(?:Dikirim ke|Dikirimkan ke)\s*:\s*\n([\s\S]+?)(?:\n\s*(?:PEMBAYARAN|ORDER|Catatan|Baarakallahu|$))/i);
  return match?.[1]?.trim() ?? "";
}

function parseRecipient(block: string) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const firstParts = first.split("|").map((part) => part.trim());
  const name = firstParts[0] ?? "";
  const phone = normalizePhone(firstParts[1] ?? "");
  const addressLines = lines.slice(1);
  const address = addressLines.join(" ").trim();
  const addressParts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    recipientName: name,
    recipientPhone: phone,
    recipientAddress: address,
    recipientDistrict: addressParts.length >= 2 ? addressParts[addressParts.length - 2] : "",
    recipientCity: addressParts.length >= 1 ? addressParts[addressParts.length - 1] : "",
  };
}

function parseClosingMessage(sourceMessageText: string) {
  const text = normalizeText(sourceMessageText);
  const shippingBlock = extractShippingBlock(text);
  const recipient = parseRecipient(shippingBlock);
  const product = extractLineValue(text, "Produk");
  const total = parseRupiah(extractLineValue(text, "Total"));
  const shippingCost = parseRupiah(extractLineValue(text, "Ongkir"));
  const itemPrice = parseRupiah(extractLineValue(text, "Harga"));
  const discount = parseRupiah(extractLineValue(text, "Diskon"));
  const paymentMethod = detectPaymentMethod(text);
  const flags: string[] = [];

  if (!includesClosingMarker(text)) flags.push("PARSE_LOW_CONFIDENCE");
  if (!recipient.recipientDistrict) flags.push("MISSING_DISTRICT");
  if (!recipient.recipientCity) flags.push("MISSING_CITY");
  if (!recipient.recipientName || !recipient.recipientPhone || !recipient.recipientAddress || !product || paymentMethod === "unknown") {
    flags.push("PARSE_LOW_CONFIDENCE");
  }

  return {
    ...recipient,
    packageContent: product,
    paymentMethod,
    nonCodItemPrice: paymentMethod === "transfer" ? itemPrice : undefined,
    codValue: paymentMethod === "cod" ? total : undefined,
    shippingCost,
    total,
    discount,
    status: flags.length > 0 ? "needs_review" as RecapStatus : "ready" as RecapStatus,
    flags: Array.from(new Set(flags)),
  };
}
```

- [ ] **Step 2: Add mismatch helpers**

Below the parser, add:

```ts
function normalizeComparable(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function compareWithOrder(parsed: ReturnType<typeof parseClosingMessage>, order: Doc<"orders"> | null) {
  const flags = [...parsed.flags];
  let inferredDiscount: number | undefined;

  if (!order) {
    flags.push("MISSING_ORDER_CONTEXT");
    return { flags: Array.from(new Set(flags)), inferredDiscount };
  }

  if (parsed.recipientAddress && normalizeComparable(order.shippingAddress) && normalizeComparable(parsed.recipientAddress) !== normalizeComparable(order.shippingAddress)) {
    flags.push("ADDRESS_CHANGED");
  }

  const originalTotal = parseRupiah(order.total);
  if (parsed.total !== undefined && originalTotal !== undefined && parsed.total !== originalTotal) {
    flags.push("TOTAL_CHANGED");
    if (parsed.total < originalTotal) {
      inferredDiscount = originalTotal - parsed.total;
      flags.push("INFERRED_DISCOUNT");
    }
  }

  const orderPhone = normalizePhone(order.customerPhone);
  if (parsed.recipientPhone && orderPhone && parsed.recipientPhone !== orderPhone) {
    flags.push("PHONE_CHANGED");
  }

  return { flags: Array.from(new Set(flags)), inferredDiscount };
}

async function findOrder(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }) {
  if (args.orderIdBerdu) {
    const byOrderId = await ctx.db
      .query("orders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrderId) return byOrderId;
  }

  return await ctx.db
    .query("orders")
    .withIndex("by_customerPhone", (q: any) => q.eq("customerPhone", args.customerPhone))
    .order("desc")
    .first();
}

async function findConversation(ctx: { db: any }, args: { orderIdBerdu?: string; customerPhone: string }) {
  if (args.orderIdBerdu) {
    const byOrder = await ctx.db
      .query("conversations")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderIdBerdu!))
      .unique();
    if (byOrder) return byOrder;
  }

  return await ctx.db
    .query("conversations")
    .withIndex("by_customerPhone_updatedAt", (q: any) => q.eq("customerPhone", args.customerPhone))
    .order("desc")
    .first();
}
```

- [ ] **Step 3: Add upsert mutation**

Add:

```ts
export const upsertFromN8n = mutation({
  args: {
    customerPhone: v.string(),
    customerName: v.optional(v.string()),
    csName: v.optional(v.string()),
    csPhone: v.optional(v.string()),
    orderIdBerdu: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceMessageText: v.string(),
    closedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const closedAt = args.closedAt ?? now;
    const order = await findOrder(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone });
    const conversation = await findConversation(ctx, { orderIdBerdu: args.orderIdBerdu, customerPhone: args.customerPhone });
    const parsed = parseClosingMessage(args.sourceMessageText);
    const comparison = compareWithOrder(parsed, order);
    const nextStatus: RecapStatus = comparison.flags.length > 0 ? "needs_review" : parsed.status;

    let existing = null;
    if (args.orderIdBerdu) {
      existing = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_orderIdBerdu", (q: any) => q.eq("orderIdBerdu", args.orderIdBerdu))
        .first();
    }
    if (!existing) {
      existing = await ctx.db
        .query("shippingRecaps")
        .withIndex("by_customerPhone", (q: any) => q.eq("customerPhone", args.customerPhone))
        .order("desc")
        .first();
    }

    const status = existing?.status === "exported" ? "needs_review" : nextStatus;
    const flags = existing?.status === "exported"
      ? Array.from(new Set([...comparison.flags, "UPDATED_AFTER_EXPORT"]))
      : comparison.flags;

    const payload = {
      orderIdBerdu: args.orderIdBerdu ?? order?.orderId,
      conversationId: conversation?._id,
      customerPhone: args.customerPhone,
      customerName: args.customerName ?? order?.customerName ?? conversation?.customerName ?? "",
      csName: args.csName ?? order?.assignedCsName ?? conversation?.assignedCsName ?? "",
      csPhone: args.csPhone ?? order?.assignedCsNumber,
      orderedAt: order?.createdAt,
      closedAt,
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
      sourceMessageId: args.sourceMessageId,
      sourceMessageText: args.sourceMessageText,
      updatedAt: now,
    };

    const recapId = existing
      ? existing._id
      : await ctx.db.insert("shippingRecaps", {
          ...payload,
          version: 1,
          createdAt: now,
        });

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        version: existing.version + 1,
      });
    }

    await ctx.db.insert("events", {
      conversationId: conversation?._id,
      orderId: args.orderIdBerdu ?? order?.orderId,
      customerPhone: args.customerPhone,
      type: "shipping_recap_upserted",
      actor: "n8n",
      metadata: { recapId, status, flags },
      createdAt: now,
    });

    return { success: true, recapId, status, flags, _action: "upsert_shipping_recap" };
  },
});
```

- [ ] **Step 4: Run type generation/build**

Run:

```powershell
npx convex dev --once
npm run build
```

Expected: both commands complete without TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add convex/schema.ts convex/shippingRecaps.ts
git commit -m "feat: parse shipping recap closings"
```

### Task 3: Recap Queries and Admin Mutations

**Files:**
- Modify: `convex/shippingRecaps.ts`

- [ ] **Step 1: Add list query**

Append:

```ts
const statusArg = v.optional(v.union(
  v.literal("ready"),
  v.literal("needs_review"),
  v.literal("exported"),
  v.literal("cancelled"),
  v.literal("cancelled_after_export"),
));

export const list = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    status: statusArg,
    paymentMethod: v.optional(v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown"))),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = args.status
      ? await ctx.db
          .query("shippingRecaps")
          .withIndex("by_status_closedAt", (q: any) => q.eq("status", args.status).gte("closedAt", args.startAt).lte("closedAt", args.endAt))
          .order("desc")
          .take(limit * 3)
      : await ctx.db
          .query("shippingRecaps")
          .withIndex("by_closedAt")
          .order("desc")
          .filter((q: any) => q.and(q.gte(q.field("closedAt"), args.startAt), q.lte(q.field("closedAt"), args.endAt)))
          .take(limit * 3);

    const search = String(args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row: any) => !args.paymentMethod || row.paymentMethod === args.paymentMethod)
      .filter((row: any) => {
        if (!search) return true;
        return [
          row.recipientName,
          row.recipientPhone,
          row.customerPhone,
          row.orderIdBerdu,
          row.packageContent,
          row.recipientCity,
          row.recipientDistrict,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      })
      .slice(0, limit);
  },
});
```

- [ ] **Step 2: Add update/edit mutation**

Append:

```ts
export const updateFields = mutation({
  args: {
    recapId: v.id("shippingRecaps"),
    recipientName: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    recipientDistrict: v.optional(v.string()),
    recipientCity: v.optional(v.string()),
    packageContent: v.optional(v.string()),
    paymentMethod: v.optional(v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown"))),
    nonCodItemPrice: v.optional(v.number()),
    codValue: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    total: v.optional(v.number()),
    discount: v.optional(v.number()),
    shippingInstruction: v.optional(v.string()),
    bumpOrder: v.optional(v.string()),
    upsell: v.optional(v.string()),
    specialBonus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { recapId, ...patch } = args;
    await ctx.db.patch(recapId, {
      ...patch,
      status: "ready",
      flags: [],
      updatedAt: Date.now(),
    });
    return { success: true, recapId };
  },
});
```

- [ ] **Step 3: Add status mutations**

Append:

```ts
export const markReady = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.recapId, { status: "ready", flags: [], updatedAt: Date.now() });
    return { success: true, recapId: args.recapId };
  },
});

export const markCancelled = mutation({
  args: { recapId: v.id("shippingRecaps"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status = row.status === "exported" ? "cancelled_after_export" : "cancelled";
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: args.reason,
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const undoCancelled = mutation({
  args: { recapId: v.id("shippingRecaps") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recapId);
    if (!row) return { success: false, error: "recap not found" };
    const status = row.flags.length > 0 ? "needs_review" : "ready";
    await ctx.db.patch(args.recapId, {
      status,
      cancelReason: undefined,
      cancelledAt: undefined,
      updatedAt: Date.now(),
    });
    return { success: true, recapId: args.recapId, status };
  },
});

export const markExported = mutation({
  args: { recapIds: v.array(v.id("shippingRecaps")), exportBatchId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const recapId of args.recapIds) {
      await ctx.db.patch(recapId, {
        status: "exported",
        exportedAt: now,
        exportBatchId: args.exportBatchId,
        updatedAt: now,
      });
    }
    return { success: true, count: args.recapIds.length, exportBatchId: args.exportBatchId };
  },
});
```

- [ ] **Step 4: Run build and commit**

Run:

```powershell
npx convex dev --once
npm run build
git add convex/shippingRecaps.ts
git commit -m "feat: manage shipping recap rows"
```

Expected: build passes and commit succeeds.

### Task 4: Convex HTTP Adapter for n8n

**Files:**
- Modify: `convex/http.ts`

- [ ] **Step 1: Import no new module manually**

Convex generated API will expose `api.shippingRecaps.upsertFromN8n` after type generation. Use that in the existing `/n8n/state` route.

- [ ] **Step 2: Add action branch**

Inside the `handler`, before `return unsupported action`, add:

```ts
    if (action === "upsert_shipping_recap") {
      const result = await ctx.runMutation(api.shippingRecaps.upsertFromN8n, {
        customerPhone: String(body.customerPhone || body.phone || ""),
        customerName: body.customerName ? String(body.customerName) : undefined,
        csName: body.csName ? String(body.csName) : undefined,
        csPhone: body.csPhone || body.csNumber ? String(body.csPhone || body.csNumber) : undefined,
        orderIdBerdu: body.orderIdBerdu || body.order_id ? String(body.orderIdBerdu || body.order_id) : undefined,
        sourceMessageId: body.sourceMessageId || body.messageId ? String(body.sourceMessageId || body.messageId) : undefined,
        sourceMessageText: String(body.sourceMessageText || body.message || ""),
        closedAt: body.closedAt ? Number(body.closedAt) : undefined,
      });
      return jsonResponse(result);
    }
```

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npx convex dev --once
npm run build
git add convex/http.ts convex/_generated
git commit -m "feat: expose shipping recap adapter"
```

Expected: build passes.

### Task 5: n8n Patch for Closing Recap Capture

**Files:**
- Create: `scripts/patch-n8n-shipping-recap.ps1`
- Creates backup under: `docs/n8n-backups/YYYY-MM-DD/`

- [ ] **Step 1: Create patch script**

Create `scripts/patch-n8n-shipping-recap.ps1` with the same API style as existing patch scripts. The patch must:

```powershell
$workflowId = '4eBFqyabDlIRx3ZY'
$nodeName = '09 Parse AI Reply + Save History'
$backupName = 'chat-handler.pre-shipping-recap-live.json'
```

Patch node `09` so that after final `replyText` is computed, it detects:

```js
const isFinalClosingMessage = /\bPEMESANAN\s+BERHASIL\b/i.test(replyText || '');
```

When true, include a property on the outgoing item:

```js
shippingRecap: {
  shouldUpsert: true,
  customerPhone: phone,
  customerName,
  csName,
  csPhone,
  orderIdBerdu: orderId,
  sourceMessageId: externalMessageId,
  sourceMessageText: replyText,
  closedAt: Date.now()
}
```

Then insert an HTTP Request node after `11B KirimChat - Send AI Reply` and after manual outbound closing path if present. The HTTP request must POST to the Convex adapter with:

```json
{
  "action": "upsert_shipping_recap",
  "phone": "={{ $json.shippingRecap.customerPhone }}",
  "customerName": "={{ $json.shippingRecap.customerName }}",
  "csName": "={{ $json.shippingRecap.csName }}",
  "csPhone": "={{ $json.shippingRecap.csPhone }}",
  "order_id": "={{ $json.shippingRecap.orderIdBerdu }}",
  "sourceMessageId": "={{ $json.shippingRecap.sourceMessageId }}",
  "sourceMessageText": "={{ $json.shippingRecap.sourceMessageText }}",
  "closedAt": "={{ $json.shippingRecap.closedAt }}"
}
```

The script must not modify `WaFaChat - Order Trigger`.

- [ ] **Step 2: Run patch script**

Run:

```powershell
.\scripts\patch-n8n-shipping-recap.ps1
```

Expected output includes:

```text
Patched workflow 4eBFqyabDlIRx3ZY
```

- [ ] **Step 3: Verify node syntax**

Run a syntax check on patched node code:

```powershell
$mcpConfig = Get-Content -Raw -Path 'F:\Projects\n8n\.mcp.json' | ConvertFrom-Json
$server = $mcpConfig.mcpServers.'n8n-mcp'
$baseUrl = $server.env.N8N_API_URL.TrimEnd('/')
$headers = @{ 'X-N8N-API-KEY' = $server.env.N8N_API_KEY; 'Content-Type' = 'application/json' }
$workflow = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/workflows/4eBFqyabDlIRx3ZY" -Headers $headers
$code = ($workflow.nodes | Where-Object { $_.name -eq '09 Parse AI Reply + Save History' }).parameters.jsCode
$tmp = Join-Path $env:TEMP 'wafachat-check-node09.js'
$wrapped = 'const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; new AsyncFunction(' + ($code | ConvertTo-Json -Compress) + ');'
Set-Content -Path $tmp -Value $wrapped -Encoding UTF8
node $tmp
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```powershell
git add scripts/patch-n8n-shipping-recap.ps1 docs/n8n-backups
git commit -m "feat: capture closing recaps from n8n"
```

### Task 6: Rekap Pengiriman Panel

**Files:**
- Modify: `app/panel/page.tsx`

- [ ] **Step 1: Add view types and state**

Near existing queue/search state, add:

```ts
type PanelView = 'dashboard' | 'shipping' | 'performance';
type RecapStatus = 'ready' | 'needs_review' | 'exported' | 'cancelled' | 'cancelled_after_export';
type PaymentFilter = 'all' | 'cod' | 'transfer';

const [panelView, setPanelView] = useState<PanelView>('dashboard');
const [recapStatus, setRecapStatus] = useState<RecapStatus | 'all'>('all');
const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
const [recapSearch, setRecapSearch] = useState('');
const [selectedRecapId, setSelectedRecapId] = useState<Id<'shippingRecaps'> | null>(null);
```

- [ ] **Step 2: Add date helper**

Inside `PanelPage`, add:

```ts
const todayRange = useMemo(() => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { startAt: start.getTime(), endAt: end.getTime() };
}, []);
```

- [ ] **Step 3: Add Convex query and mutations**

Add:

```ts
const shippingRecaps = useQuery(api.shippingRecaps.list, {
  startAt: todayRange.startAt,
  endAt: todayRange.endAt,
  status: recapStatus === 'all' ? undefined : recapStatus,
  paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
  search: recapSearch || undefined,
  limit: 50,
});
const markRecapReady = useMutation(api.shippingRecaps.markReady);
const markRecapCancelled = useMutation(api.shippingRecaps.markCancelled);
const undoRecapCancelled = useMutation(api.shippingRecaps.undoCancelled);
```

- [ ] **Step 4: Add nav items**

Change `navItems` so clicking `Dashboard`, `Rekap Pengiriman`, and `Performance` changes `panelView`.

Use labels:

```ts
const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'shipping', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
] as const;
```

- [ ] **Step 5: Render recap table**

Create a render block for `panelView === 'shipping'` with:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Rekap Pengiriman</CardTitle>
    <CardDescription>Data closing final untuk bulk upload pengiriman.</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="mb-4 flex flex-wrap gap-2">
      <input
        value={recapSearch}
        onChange={(event) => setRecapSearch(event.target.value)}
        aria-label="Cari nama, nomor, order ID, produk, kota"
        className="h-9 min-w-[260px] rounded-md border border-border bg-background px-3 text-sm"
      />
      <Button variant={recapStatus === 'all' ? 'default' : 'outline'} onClick={() => setRecapStatus('all')}>Semua</Button>
      <Button variant={recapStatus === 'ready' ? 'default' : 'outline'} onClick={() => setRecapStatus('ready')}>Siap Export</Button>
      <Button variant={recapStatus === 'needs_review' ? 'default' : 'outline'} onClick={() => setRecapStatus('needs_review')}>Perlu Cek</Button>
      <Button variant={paymentFilter === 'cod' ? 'default' : 'outline'} onClick={() => setPaymentFilter(paymentFilter === 'cod' ? 'all' : 'cod')}>COD</Button>
      <Button variant={paymentFilter === 'transfer' ? 'default' : 'outline'} onClick={() => setPaymentFilter(paymentFilter === 'transfer' ? 'all' : 'transfer')}>Transfer</Button>
    </div>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Closing</TableHead>
          <TableHead>Penerima</TableHead>
          <TableHead>Isi Paket</TableHead>
          <TableHead>Bayar</TableHead>
          <TableHead>Total/COD</TableHead>
          <TableHead>Kota</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(shippingRecaps ?? []).map((row) => (
          <TableRow key={row._id}>
            <TableCell>{new Date(row.closedAt).toLocaleString('id-ID')}</TableCell>
            <TableCell>
              <button className="text-left font-medium" onClick={() => setSelectedRecapId(row._id)}>{row.recipientName || row.customerName}</button>
              <div className="text-xs text-muted-foreground">{row.recipientPhone || row.customerPhone}</div>
            </TableCell>
            <TableCell>{row.packageContent}</TableCell>
            <TableCell>{row.paymentMethod.toUpperCase()}</TableCell>
            <TableCell>{new Intl.NumberFormat('id-ID').format(row.codValue ?? row.total ?? row.nonCodItemPrice ?? 0)}</TableCell>
            <TableCell>{row.recipientDistrict}, {row.recipientCity}</TableCell>
            <TableCell><Badge variant={row.status === 'needs_review' ? 'destructive' : 'secondary'}>{row.status}</Badge></TableCell>
            <TableCell className="space-x-2">
              {row.status === 'needs_review' ? <Button size="sm" onClick={() => markRecapReady({ recapId: row._id })}>Ready</Button> : null}
              {row.status === 'cancelled' || row.status === 'cancelled_after_export'
                ? <Button size="sm" variant="outline" onClick={() => undoRecapCancelled({ recapId: row._id })}>Undo</Button>
                : <Button size="sm" variant="outline" onClick={() => markRecapCancelled({ recapId: row._id, reason: 'cancelled from panel' })}>Cancel</Button>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </CardContent>
</Card>
```

- [ ] **Step 6: Build and commit**

Run:

```powershell
npm run build
git add app/panel/page.tsx
git commit -m "feat: add shipping recap panel"
```

Expected: build passes and panel has the Rekap Pengiriman view.

### Task 7: CSV Export Endpoint

**Files:**
- Create: `app/api/shipping-recaps/export/route.ts`

- [ ] **Step 1: Add export route**

Create the file:

```ts
import { NextResponse } from "next/server";

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function POST(request: Request) {
  const body = await request.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = [
    "Nama Pengirim",
    "No Telp. Pengirim",
    "Nama Penerima",
    "Alamat Penerima",
    "No Telp. Penerima",
    "Kecamatan Penerima",
    "Kota Penerima",
    "Isi Paket",
    "Metode Bayar",
    "Harga Barang (jika non-COD)",
    "Nilai COD (Jika COD)",
    "Diskon (opt)",
    "Instruksi Pengiriman (opt)",
    "Tanggal customer order",
    "Tanggal closing",
    "Order ID Berdu",
    "Bump Order/Upsale/Bonus Khusus (opt)",
  ];

  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row: any) => [
      row.csName,
      row.csPhone,
      row.recipientName,
      row.recipientAddress,
      row.recipientPhone,
      row.recipientDistrict,
      row.recipientCity,
      row.packageContent,
      row.paymentMethod === "cod" ? "COD" : "TRANSFER",
      row.paymentMethod === "transfer" ? row.nonCodItemPrice ?? row.total ?? "" : "",
      row.paymentMethod === "cod" ? row.codValue ?? row.total ?? "" : "",
      row.discount ?? "",
      row.shippingInstruction ?? "",
      row.orderedAt ? new Date(row.orderedAt).toISOString() : "",
      row.closedAt ? new Date(row.closedAt).toISOString() : "",
      row.orderIdBerdu ?? "",
      [row.bumpOrder, row.upsell, row.specialBonus].filter(Boolean).join(" | "),
    ].map(csvEscape).join(",")),
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wafachat-rekap-pengiriman.csv"`,
    },
  });
}
```

- [ ] **Step 2: Add panel download action**

In `app/panel/page.tsx`, add a button that POSTs current ready rows:

```ts
const downloadRecapCsv = async () => {
  const rows = (shippingRecaps ?? []).filter((row) => row.status === 'ready');
  const response = await fetch('/api/shipping-recaps/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'wafachat-rekap-pengiriman.csv';
  link.click();
  URL.revokeObjectURL(url);
};
```

Render:

```tsx
<Button onClick={downloadRecapCsv}>Download Excel</Button>
```

- [ ] **Step 3: Build and commit**

Run:

```powershell
npm run build
git add app/api/shipping-recaps/export/route.ts app/panel/page.tsx
git commit -m "feat: export shipping recaps"
```

Expected: build passes and CSV downloads.

### Task 8: Performance Query

**Files:**
- Modify: `convex/shippingRecaps.ts`

- [ ] **Step 1: Add performance query**

Append:

```ts
export const getPerformance = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    includeInferredDiscount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_aiEligible_createdAt", (q: any) => q.eq("aiEligible", true).gte("createdAt", args.startAt).lte("createdAt", args.endAt))
      .collect();

    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt")
      .order("desc")
      .filter((q: any) => q.and(q.gte(q.field("closedAt"), args.startAt), q.lte(q.field("closedAt"), args.endAt)))
      .collect();

    const validClosings = recaps.filter((row: any) => row.status === "ready" || row.status === "exported");
    const productMap = new Map<string, { product: string; leads: number; closing: number; revenue: number; discount: number }>();
    const csMap = new Map<string, { csName: string; leads: number; closing: number; revenue: number; discount: number }>();

    for (const order of orders) {
      const product = order.productName || order.products || "Unknown";
      const current = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      current.leads += 1;
      productMap.set(product, current);

      const csName = order.assignedCsName || "Unknown";
      const cs = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      cs.leads += 1;
      csMap.set(csName, cs);
    }

    for (const recap of validClosings) {
      const product = recap.packageContent || "Unknown";
      const revenue = recap.total ?? recap.codValue ?? recap.nonCodItemPrice ?? 0;
      const discount = recap.discount ?? (args.includeInferredDiscount ? recap.inferredDiscount ?? 0 : 0);
      const productRow = productMap.get(product) ?? { product, leads: 0, closing: 0, revenue: 0, discount: 0 };
      productRow.closing += 1;
      productRow.revenue += revenue;
      productRow.discount += discount;
      productMap.set(product, productRow);

      const csName = recap.csName || "Unknown";
      const csRow = csMap.get(csName) ?? { csName, leads: 0, closing: 0, revenue: 0, discount: 0 };
      csRow.closing += 1;
      csRow.revenue += revenue;
      csRow.discount += discount;
      csMap.set(csName, csRow);
    }

    const totalLeads = orders.length;
    const totalClosing = validClosings.length;
    const totalDiscount = validClosings.reduce((sum: number, row: any) => sum + (row.discount ?? (args.includeInferredDiscount ? row.inferredDiscount ?? 0 : 0)), 0);
    const totalRevenue = validClosings.reduce((sum: number, row: any) => sum + (row.total ?? row.codValue ?? row.nonCodItemPrice ?? 0), 0);

    return {
      totalLeads,
      totalClosing,
      overallCr: totalLeads > 0 ? Math.round((totalClosing / totalLeads) * 1000) / 10 : 0,
      totalCod: validClosings.filter((row: any) => row.paymentMethod === "cod").length,
      totalTransfer: validClosings.filter((row: any) => row.paymentMethod === "transfer").length,
      totalRevenue,
      totalDiscount,
      cancelled: recaps.filter((row: any) => row.status === "cancelled" || row.status === "cancelled_after_export").length,
      products: Array.from(productMap.values()).map((row) => ({
        ...row,
        cr: row.leads > 0 ? Math.round((row.closing / row.leads) * 1000) / 10 : 0,
      })),
      cs: Array.from(csMap.values()).map((row) => ({
        ...row,
        cr: row.leads > 0 ? Math.round((row.closing / row.leads) * 1000) / 10 : 0,
      })),
    };
  },
});
```

- [ ] **Step 2: Build and commit**

Run:

```powershell
npx convex dev --once
npm run build
git add convex/shippingRecaps.ts
git commit -m "feat: add shipping performance query"
```

Expected: build passes.

### Task 9: Performance Panel

**Files:**
- Modify: `app/panel/page.tsx`

- [ ] **Step 1: Add performance query**

Inside `PanelPage`, add:

```ts
const performanceData = useQuery(api.shippingRecaps.getPerformance, {
  startAt: todayRange.startAt,
  endAt: todayRange.endAt,
  includeInferredDiscount: false,
});
```

- [ ] **Step 2: Render Performance view**

Add `panelView === 'performance'` section:

```tsx
<div className="space-y-6">
  <div className="grid gap-3 md:grid-cols-4">
    <Card><CardHeader><CardDescription>Total Leads</CardDescription><CardTitle>{performanceData?.totalLeads ?? 0}</CardTitle></CardHeader></Card>
    <Card><CardHeader><CardDescription>Total Closing</CardDescription><CardTitle>{performanceData?.totalClosing ?? 0}</CardTitle></CardHeader></Card>
    <Card><CardHeader><CardDescription>CR</CardDescription><CardTitle>{performanceData?.overallCr ?? 0}%</CardTitle></CardHeader></Card>
    <Card><CardHeader><CardDescription>Total Diskon</CardDescription><CardTitle>Rp{new Intl.NumberFormat('id-ID').format(performanceData?.totalDiscount ?? 0)}</CardTitle></CardHeader></Card>
  </div>
  <Card>
    <CardHeader>
      <CardTitle>Performance Produk</CardTitle>
      <CardDescription>Leads, closing, CR, omzet, dan diskon per produk.</CardDescription>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produk</TableHead>
            <TableHead>Leads</TableHead>
            <TableHead>Closing</TableHead>
            <TableHead>CR</TableHead>
            <TableHead>Omzet</TableHead>
            <TableHead>Diskon</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(performanceData?.products ?? []).map((row) => (
            <TableRow key={row.product}>
              <TableCell>{row.product}</TableCell>
              <TableCell>{row.leads}</TableCell>
              <TableCell>{row.closing}</TableCell>
              <TableCell>{row.cr}%</TableCell>
              <TableCell>Rp{new Intl.NumberFormat('id-ID').format(row.revenue)}</TableCell>
              <TableCell>Rp{new Intl.NumberFormat('id-ID').format(row.discount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
  <Card>
    <CardHeader>
      <CardTitle>Performance CS</CardTitle>
      <CardDescription>Leads, closing, CR, omzet, dan diskon per CS.</CardDescription>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>CS</TableHead>
            <TableHead>Leads</TableHead>
            <TableHead>Closing</TableHead>
            <TableHead>CR</TableHead>
            <TableHead>Omzet</TableHead>
            <TableHead>Diskon</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(performanceData?.cs ?? []).map((row) => (
            <TableRow key={row.csName}>
              <TableCell>{row.csName}</TableCell>
              <TableCell>{row.leads}</TableCell>
              <TableCell>{row.closing}</TableCell>
              <TableCell>{row.cr}%</TableCell>
              <TableCell>Rp{new Intl.NumberFormat('id-ID').format(row.revenue)}</TableCell>
              <TableCell>Rp{new Intl.NumberFormat('id-ID').format(row.discount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</div>
```

- [ ] **Step 3: Build and commit**

Run:

```powershell
npm run build
git add app/panel/page.tsx
git commit -m "feat: add performance dashboard"
```

Expected: build passes.

### Task 10: Verification and Deployment

**Files:**
- No new files unless verification notes are added.

- [ ] **Step 1: Deploy Convex**

Run:

```powershell
npx convex deploy --yes
```

Expected: deploy succeeds.

- [ ] **Step 2: Build Next.js**

Run:

```powershell
npm run build
```

Expected: build passes.

- [ ] **Step 3: Verify adapter health**

Send a health request through the existing n8n Convex adapter:

```powershell
Invoke-RestMethod -Method Post -Uri 'https://helpful-spoonbill-863.convex.site/n8n/state' -Headers @{ 'Content-Type' = 'application/json' } -Body (@{ action = 'health' } | ConvertTo-Json)
```

Expected: response has `success: true`.

- [ ] **Step 4: Simulate recap upsert**

Call the adapter with one controlled sample:

```powershell
$sample = @{
  action = 'upsert_shipping_recap'
  phone = '6283111337625'
  customerName = 'Wawan Hermawan'
  csName = 'CS Aisyah'
  csPhone = '6280000000000'
  order_id = 'TEST-RECAP-001'
  sourceMessageText = @'
PEMESANAN BERHASIL

Detail pesanan:
Produk: Quran Mapping (1x)
Harga: Rp179.000
Ongkir: Rp15.000
Total: Rp194.000

Dikirim ke:
Wawan Hermawan | 6283111337625
Kmp sukaati rt02rw12desa Cipelah kec Ranca Bali kab Bandung Jawa Barat, Rancabali, Kab. Bandung

PEMBAYARAN COD
'@
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://helpful-spoonbill-863.convex.site/n8n/state' -Headers @{ 'Content-Type' = 'application/json' } -Body $sample
```

Expected: response has `success: true` and `status` is `ready` or `needs_review`.

- [ ] **Step 5: Verify dashboard locally**

Run:

```powershell
npm run dev
```

Open the panel and verify:

- `Rekap Pengiriman` loads.
- Search works.
- COD/Transfer filters work.
- `Perlu Cek` rows are visible.
- CSV download works.
- `Performance` loads cards and product/CS tables.

- [ ] **Step 6: Deploy Vercel**

Use the existing Vercel deployment process for the project.

Expected: `https://wafachat.vercel.app` loads the updated panel after deployment.

- [ ] **Step 7: Commit verification notes if created**

If verification notes are written:

```powershell
git add docs
git commit -m "docs: record shipping recap verification"
```
