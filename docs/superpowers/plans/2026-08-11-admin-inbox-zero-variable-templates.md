# Admin Inbox Zero-Variable Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox notation so progress can be audited.

**Goal:** Let an admin start an expedition WhatsApp conversation using an approved KirimDev template with a required customer phone and optional customer name, product, and total amount—including templates that have no Meta variables.

**Architecture:** Keep the current authenticated Next.js route → Convex action → KirimDev flow. Store optional customer context on the tenant-scoped admin thread, while template parameters remain a separate allowlisted array defined by the selected template. The manual form must never infer or attach an order from a phone number; existing cancellation controls remain available only for threads that already have a verified `orderId` from another source.

**Tech Stack:** Next.js App Router, React, TypeScript, Convex, Vitest, Testing Library, KirimDev Public API.

## Global Constraints

- Follow test-driven development: add a failing focused test, run it, implement the minimum change, rerun it.
- Preserve organization/admin authorization, channel ownership checks, provider-number uniqueness, idempotency, and unknown-delivery handling.
- Do not add polling, cron jobs, live aggregation, n8n, or new environment variables.
- Do not create or approve Meta templates from WafaChat.
- Do not expose `KIRIMDEV_API_KEY` to the browser.
- Do not use customer phone to guess an order. The manual send route must not accept a user-supplied `orderId`.
- Keep all new thread fields optional so the Convex schema deployment requires no historical backfill.
- Store total as an integer number of rupiah (`>= 0`), not as a formatted string or floating-point currency.
- The four current KirimDev templates (`no_respons_kurir`, `penerima_tidak_di_tempat`, `alamat_belum_lengkap`, `paket_ditolak`) use language `id` and an empty variable list.

## File Map

- Modify: `components/panel/admin-expedition-settings.tsx`
- Modify: `components/panel/admin-expedition-settings.test.tsx`
- Modify: `convex/adminInboxModel.ts`
- Modify: `convex/adminInboxModel.test.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/adminInbox.ts`
- Modify: `convex/adminInbox.test.ts`
- Modify: `app/api/admin-inbox/send-template/route.ts`
- Modify: `app/api/admin-inbox/routes.test.ts`
- Modify: `components/panel/admin-expedition-inbox.tsx`
- Modify: `components/panel/admin-expedition-inbox.test.tsx`
- Modify: `docs/runbooks/admin-expedition-inbox.md`

---

## Task 1: Allow templates with zero variables in Settings

**Files:**

- Modify: `components/panel/admin-expedition-settings.test.tsx`
- Modify: `components/panel/admin-expedition-settings.tsx`
- Modify: `convex/adminInbox.test.ts`

- [ ] **Step 1: Add failing UI assertions for the empty-variable state**

Extend the Settings component test so a fresh template draft renders:

```tsx
expect(html).toContain("Template tanpa variabel");
expect(html).toContain("Tambah variabel");
expect(html).not.toContain("admin-variable-key-0");
```

Also assert the helper copy explains that variables should only be added when the approved Meta template defines them.

- [ ] **Step 2: Run the focused UI test and confirm failure**

```powershell
rtk vitest run components/panel/admin-expedition-settings.test.tsx
```

Expected: FAIL because the draft currently starts with one blank variable row.

- [ ] **Step 3: Implement the zero-variable Settings state**

In `admin-expedition-settings.tsx`:

```tsx
const [variables, setVariables] = useState<VariableDraft[]>([]);
```

Make `resetTemplateDraft()` restore `[]`. Render the explicit empty state when `variables.length === 0`. Keep “Tambah variabel” as the only way to create a row. Allow every row to be deleted; remove `disabled={variables.length === 1}` from the delete button.

Do not change the Convex template contract: `variables` remains an array and an empty array is valid.

- [ ] **Step 4: Add a Convex regression test for an empty allowlist**

Add a test that calls `upsertTemplate` with:

```ts
variables: [],
language: "id",
isActive: true,
```

Then verify `getSetup` returns the active template with `variables: []` and marks the template requirement ready.

- [ ] **Step 5: Run focused tests**

```powershell
rtk vitest run components/panel/admin-expedition-settings.test.tsx convex/adminInbox.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
rtk git add components/panel/admin-expedition-settings.tsx components/panel/admin-expedition-settings.test.tsx convex/adminInbox.test.ts
rtk git commit -m "fix: support zero-variable admin templates"
```

---

## Task 2: Define and persist lean customer context

**Files:**

- Modify: `convex/adminInboxModel.test.ts`
- Modify: `convex/adminInboxModel.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/adminInbox.test.ts`
- Modify: `convex/adminInbox.ts`

- [ ] **Step 1: Add failing model tests for optional rupiah totals**

Add a pure helper contract to `adminInboxModel.test.ts`:

```ts
expect(normalizeOptionalAdminTotal(undefined)).toBeUndefined();
expect(normalizeOptionalAdminTotal(null)).toBeUndefined();
expect(normalizeOptionalAdminTotal(189000)).toBe(189000);
expect(() => normalizeOptionalAdminTotal(-1)).toThrow("Harga total");
expect(() => normalizeOptionalAdminTotal(189000.5)).toThrow("Harga total");
expect(() => normalizeOptionalAdminTotal(Number.NaN)).toThrow("Harga total");
```

- [ ] **Step 2: Run the model test and confirm failure**

```powershell
rtk vitest run convex/adminInboxModel.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the total normalizer**

Export this behavior from `convex/adminInboxModel.ts`:

```ts
export function normalizeOptionalAdminTotal(value: number | null | undefined) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Harga total harus berupa rupiah bulat yang tidak negatif.");
  }
  return value;
}
```

- [ ] **Step 4: Add optional thread fields to the schema**

Add to `adminThreads` in `convex/schema.ts`:

```ts
productName: v.optional(v.string()),
totalAmount: v.optional(v.number()),
```

Do not add an index; these are display context, not query keys.

- [ ] **Step 5: Add failing persistence and idempotency tests**

Extend `convex/adminInbox.test.ts` to prove:

1. A zero-variable template reservation accepts `values: []` and returns `orderedValues: []`.
2. A new thread stores trimmed `customerName`, trimmed `productName`, and integer `totalAmount`.
3. A repeated send to the same channel + normalized phone updates supplied context without creating another thread.
4. Omitted optional context does not erase existing non-empty context.
5. A negative or fractional total is rejected before a message reservation is inserted.
6. Reusing the same `clientRequestId` still returns the original reservation and does not create a second message.

- [ ] **Step 6: Run the Convex test and confirm failure**

```powershell
rtk vitest run convex/adminInbox.test.ts
```

Expected: FAIL because the new arguments and schema fields are not wired.

- [ ] **Step 7: Wire context through Convex**

Add these optional arguments to `prepareTemplateSend` and `sendTemplate`:

```ts
productName: v.optional(v.string()),
totalAmount: v.optional(v.number()),
```

Normalize before inserting or patching:

```ts
const customerName = cleanOptional(args.customerName);
const productName = cleanOptional(args.productName);
const totalAmount = normalizeOptionalAdminTotal(args.totalAmount);
```

For a new thread, store the normalized values. For an existing thread, patch only supplied values:

```ts
customerName: customerName ?? thread.customerName,
productName: productName ?? thread.productName,
totalAmount: totalAmount ?? thread.totalAmount,
```

Update every thread result validator/object returned by `listThreads` so the UI receives `productName` and `totalAmount`.

Keep `orderId` on the internal thread model and inbound path for verified future integrations. Do not infer or modify it from the manual customer context.

- [ ] **Step 8: Generate Convex types and run focused tests**

```powershell
rtk npx convex codegen
rtk vitest run convex/adminInboxModel.test.ts convex/adminInbox.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
rtk git add convex/adminInboxModel.ts convex/adminInboxModel.test.ts convex/schema.ts convex/adminInbox.ts convex/adminInbox.test.ts convex/_generated
rtk git commit -m "feat: store admin inbox customer context"
```

---

## Task 3: Harden the manual send HTTP contract

**Files:**

- Modify: `app/api/admin-inbox/routes.test.ts`
- Modify: `app/api/admin-inbox/send-template/route.ts`

- [ ] **Step 1: Add failing route tests**

Cover these cases in `routes.test.ts`:

```ts
{
  customerPhone: "085715682110",
  customerName: " Fandi ",
  productName: " Quran Mapping ",
  totalAmount: 189000,
  values: [],
}
```

Verify the route forwards all four fields and `values: []` to `api.adminInbox.sendTemplate`.

Add rejection tests for `totalAmount: -1`, `totalAmount: 1.5`, `totalAmount: "189000"`, and non-string optional name/product values. Assert the Convex action is not called.

Add a test that submits `orderId` and verifies it is not forwarded. This prevents the manual admin form/API from attaching an unverified order link.

- [ ] **Step 2: Run the route tests and confirm failure**

```powershell
rtk vitest run app/api/admin-inbox/routes.test.ts
```

Expected: FAIL because product and total are not validated or forwarded, and `orderId` is currently forwarded.

- [ ] **Step 3: Implement strict request parsing**

In `send-template/route.ts`:

- Require `channelId`, `customerPhone`, `templateId`, `clientRequestId`, and array `values` as today.
- Accept `customerName` and `productName` only when absent or strings.
- Accept `totalAmount` only when absent or a safe non-negative integer.
- Forward `customerName`, `productName`, and `totalAmount`.
- Remove `orderId` from the forwarded manual-send payload.
- Keep the existing admin session, organization, server-secret, value-array, provider-error, and status-unknown behavior unchanged.

Return clear Indonesian validation errors, for example:

```ts
"Harga total harus berupa rupiah bulat yang tidak negatif."
```

- [ ] **Step 4: Run focused route tests**

```powershell
rtk vitest run app/api/admin-inbox/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
rtk git add app/api/admin-inbox/send-template/route.ts app/api/admin-inbox/routes.test.ts
rtk git commit -m "feat: validate admin inbox customer context"
```

---

## Task 4: Replace Order ID with the approved four-field admin form

**Files:**

- Modify: `components/panel/admin-expedition-inbox.test.tsx`
- Modify: `components/panel/admin-expedition-inbox.tsx`

- [ ] **Step 1: Add failing UI assertions**

Update the inbox test to require these labels/copies:

```tsx
"Nomor WhatsApp"
"Nama customer (opsional)"
"Produk (opsional)"
"Harga total (opsional)"
"Template tanpa variabel"
```

Assert the new-chat form no longer includes `ID order`. Keep assertions for the existing exact-order cancellation controls elsewhere in the selected-thread view.

- [ ] **Step 2: Run the focused UI test and confirm failure**

```powershell
rtk vitest run components/panel/admin-expedition-inbox.test.tsx
```

Expected: FAIL because the form still exposes Order ID and lacks product/total.

- [ ] **Step 3: Add lean form state and parsing**

Replace the manual `orderId` state with:

```ts
const [productName, setProductName] = useState("");
const [totalAmount, setTotalAmount] = useState("");
```

Keep the phone required. Mark all other context labels visibly optional. Use `inputMode="numeric"` for total. Before submitting, strip Indonesian grouping punctuation/spaces, reject non-digits, and convert to a safe non-negative integer. Send:

```ts
{
  customerPhone,
  customerName: customerName.trim() || undefined,
  productName: productName.trim() || undefined,
  totalAmount: parsedTotal,
  values: selectedTemplate.variables.map(/* existing allowlisted mapping */),
}
```

Clear all four fields only after KirimDev accepts the request. Preserve `clientRequestId` on unknown status exactly as today.

- [ ] **Step 4: Make zero-variable templates explicit**

When `selectedTemplate.variables.length === 0`, render a compact informational row:

```tsx
<p>Template tanpa variabel — siap dikirim sesuai isi approved di KirimDev.</p>
```

Do not create placeholder parameter inputs and submit `values: []`.

- [ ] **Step 5: Show useful context without clutter**

In the conversation list/detail:

- Use customer name when present, otherwise the normalized phone.
- Show phone consistently.
- Show product and formatted rupiah total only when present.
- Do not show empty labels or em-dash placeholders for optional context.
- Keep the cancellation/undo controls conditional on `linkedOrder`/existing verified `thread.orderId`; never expose them merely because the phone matches an order.
- When reopening a closed 24-hour thread with “Kirim template,” prefill phone, name, product, and total from that thread.

Use `Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })` for display only.

- [ ] **Step 6: Run focused UI and route tests**

```powershell
rtk vitest run components/panel/admin-expedition-inbox.test.tsx app/api/admin-inbox/routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
rtk git add components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx
rtk git commit -m "feat: add lean admin contact fields"
```

---

## Task 5: Document configuration, run release gates, and smoke test

**Files:**

- Modify: `docs/runbooks/admin-expedition-inbox.md`

- [ ] **Step 1: Update the runbook**

Document the production setup:

- Admin channel uses the dedicated KirimDev `phone_number_id` already configured in WafaChat.
- `KIRIMDEV_API_KEY` remains a Convex production environment variable.
- Add each of the four approved templates with language `id` and `variables: []`.
- Admin enters required customer phone and optional name/product/total.
- The optional context is internal WafaChat metadata and is not sent as Meta variables unless a future approved template explicitly declares matching variables.
- Free-text replies work only inside the WhatsApp 24-hour customer-service window; otherwise start again with an approved template.
- Manual sends do not attach an order and therefore cannot cancel an order unless a verified linkage exists from another source.

- [ ] **Step 2: Run the complete local quality gate**

```powershell
rtk vitest run
rtk npx tsc --noEmit
rtk npx convex codegen
rtk run "npx next build"
rtk git diff --check
```

Expected: all tests, typecheck, codegen, production build, and whitespace checks pass.

- [ ] **Step 3: Review the final diff for scope and safety**

```powershell
rtk git status --short
rtk git diff --stat HEAD~4..HEAD
rtk git diff HEAD~4..HEAD -- app/api/admin-inbox convex/adminInbox.ts convex/schema.ts components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-settings.tsx
```

Confirm there are no changes to sales metrics, follow-up candidate generation, n8n, webhook routing, or provider secrets.

- [ ] **Step 4: Commit documentation**

```powershell
rtk git add docs/runbooks/admin-expedition-inbox.md
rtk git commit -m "docs: update admin inbox template setup"
```

- [ ] **Step 5: Deploy only after all gates pass**

Deploy Convex first because the frontend depends on the optional thread fields, then push/merge and let Vercel deploy the frontend. Verify the production deployment is ready before testing.

- [ ] **Step 6: Perform a controlled production smoke test**

Use the owner's test number, not a real customer:

1. Open Settings → Admin Ekspedisi and confirm the channel is ready.
2. Confirm one approved template displays as “tanpa variabel.”
3. Open Inbox → Hubungi customer.
4. Enter the test phone, optional name/product/total, and send one template.
5. Confirm exactly one thread and one outbound message appear.
6. Confirm the optional context displays correctly and no cancellation action appears without a verified order link.
7. Reply from WhatsApp and verify the inbound message opens the 24-hour free-text window.
8. Check Convex logs for the request and confirm no repeated query/cron activity was introduced.

Expected: one accepted template send, one tenant-scoped thread, correct optional context, and no sales/reporting side effects.

