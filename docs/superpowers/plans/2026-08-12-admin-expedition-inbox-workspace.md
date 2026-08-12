# Admin Expedition Inbox Workspace Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Keep KirimDev delivery, Convex storage, webhook ingestion, and cancellation semantics unchanged.

**Goal:** Turn the existing desktop Admin Expedition Inbox into a compact support workspace where an admin can find a customer, see whether a reply is needed, review message history and order context together, and take the correct messaging or cancellation action.

**Architecture:** Keep the existing reactive Convex subscriptions and cursor pagination. Extract deterministic client-side thread presentation/filtering into a small view-model module, extract the conversation rail and context panel into focused presentational components, and leave mutations plus send orchestration in the current inbox container. Search and filters operate only on already-loaded rows, so the change adds no database query or polling.

**Tech Stack:** Next.js App Router, React, TypeScript, Convex React hooks, Tailwind CSS, Lucide icons, Vitest, React server rendering tests.

## Global Constraints

- Use the approved design in `docs/superpowers/specs/2026-08-12-admin-expedition-inbox-workspace-design.md`.
- Run the Impeccable context command once before editing the UI, then apply its layout, clarification, and craft-floor guidance.
- Do not add Convex functions, indexes, tables, migrations, polling, timers, or broader message retention.
- Preserve `adminInbox.getSetup`, `adminInbox.listThreads`, `adminInbox.listMessages`, `adminInbox.getLinkedOrderState`, send endpoints, and cancellation mutations.
- The `Belum dibalas` view means `lastInboundAt > lastOutboundAt`; it is reply-needed state, not a new unread/read receipt system.
- Search applies only to loaded paginated results. Keep `Muat lainnya` visible and label the behavior honestly.
- Desktop is the design target; preserve the current functional smaller-screen fallback without expanding scope into a mobile redesign.
- Use Indonesian UI copy, Jakarta time, existing design tokens, and existing button/focus conventions.
- Correct any mojibake in touched Inbox copy (`Â·`, `â€¦`, `â€”`, `Ã—`) to the intended UTF-8 characters.

---

### Task 1: Add deterministic thread presentation and filtering

**Files:**

- Create: `components/panel/admin-expedition-inbox-model.ts`
- Create: `components/panel/admin-expedition-inbox-model.test.ts`
- Modify: `components/panel/admin-expedition-inbox.tsx`
- Test: `components/panel/admin-expedition-inbox.test.tsx`

**Interfaces:**

```ts
export type AdminInboxView = "all" | "needs_reply" | "window_open";

export type AdminInboxThreadView = {
  id: string;
  customerPhone: string;
  customerName?: string;
  productName?: string;
  totalAmount?: number;
  orderId?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  windowOpen: boolean;
  updatedAt: number;
};

export function adminThreadNeedsReply(thread: AdminInboxThreadView): boolean;
export function filterAdminThreads(
  threads: AdminInboxThreadView[],
  search: string,
  view: AdminInboxView,
): AdminInboxThreadView[];
export function adminThreadPreview(thread: AdminInboxThreadView): string;
```

**Behavior:**

- Normalize search case-insensitively and compare phone numbers by digits.
- Match customer name, phone, product, and exact order context.
- `needs_reply` includes only rows whose latest known inbound timestamp is newer than the latest known outbound timestamp.
- `window_open` includes only rows with `windowOpen === true`.
- Preview priority is product, then `Order {orderId}`, then phone.
- Keep selected-thread lookup against the unfiltered paginated result so changing a filter does not silently discard an already-open conversation.

**Steps:**

1. Write failing unit tests for search normalization, all three views, inbound/outbound edge cases, and preview fallbacks.
2. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-inbox-model.test.ts
   ```

   Expected: FAIL because the new module is missing.
3. Implement only the pure model functions above.
4. Run the same test and confirm PASS.
5. Import the helpers in `admin-expedition-inbox.tsx`; add local `search` and `view` state and derive `visibleThreads` with `useMemo`.
6. Extend the existing inbox component test to assert the search label, `Semua`, `Belum dibalas`, `24 jam aktif`, and honest loaded-results guidance.
7. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-inbox-model.test.ts components/panel/admin-expedition-inbox.test.tsx
   ```

8. Commit:

   ```powershell
   rtk git add components/panel/admin-expedition-inbox-model.ts components/panel/admin-expedition-inbox-model.test.ts components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx
   rtk git commit -m "feat: add expedition inbox thread views"
   ```

---

### Task 2: Build the scannable conversation rail

**Files:**

- Create: `components/panel/admin-expedition-thread-list.tsx`
- Create: `components/panel/admin-expedition-thread-list.test.tsx`
- Modify: `components/panel/admin-expedition-inbox.tsx`

**Component contract:**

```ts
type AdminExpeditionThreadListProps = {
  threads: AdminInboxThreadView[];
  totalLoaded: number;
  selectedId: string | null;
  search: string;
  view: AdminInboxView;
  loadingFirstPage: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  onSearchChange: (value: string) => void;
  onViewChange: (view: AdminInboxView) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
};
```

**Behavior and layout:**

- Place one labelled search field above a three-option segmented filter.
- Show loaded count, not an implied database-wide total.
- Each row shows identity, preview, Jakarta activity time, and one primary state badge.
- Reply-needed rows receive a restrained visual emphasis and explicit `Menunggu balasan` text.
- The selected row uses `aria-current="true"` and a clear active surface/border.
- Keep row height compact enough to scan, but retain at least a 44px click target.
- Empty states distinguish no conversations from no local search/filter matches.
- Keep cursor pagination through `Muat lainnya`; show `Memuat…` while loading the next page.

**Steps:**

1. Write failing render tests for selected state, reply-needed state, empty-filter state, search labelling, and load-more state.
2. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-thread-list.test.tsx
   ```

   Expected: FAIL because the component is missing.
3. Implement the presentational rail using existing tokens and Lucide icons; do not call Convex hooks inside it.
4. Replace the inline `<aside>` list markup in `AdminExpeditionInbox` with this component.
5. Preserve the existing selected-thread mobile fallback behavior.
6. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-thread-list.test.tsx components/panel/admin-expedition-inbox.test.tsx components/panel/admin-expedition-inbox-model.test.ts
   ```

7. Commit:

   ```powershell
   rtk git add components/panel/admin-expedition-thread-list.tsx components/panel/admin-expedition-thread-list.test.tsx components/panel/admin-expedition-inbox.tsx
   rtk git commit -m "feat: refine expedition conversation rail"
   ```

---

### Task 3: Add the desktop customer and order context panel

**Files:**

- Create: `components/panel/admin-expedition-context.tsx`
- Create: `components/panel/admin-expedition-context.test.tsx`
- Modify: `components/panel/admin-expedition-inbox.tsx`

**Component contract:**

```ts
type LinkedOrderContext = {
  orderId: string;
  status: string;
  cancelReason?: string;
  canUndo: boolean;
} | null | undefined;

type AdminExpeditionContextProps = {
  thread: AdminInboxThreadView;
  linkedOrder: LinkedOrderContext;
  busy: boolean;
  onCancel: () => void;
  onUndoCancellation: () => void;
};
```

**Behavior and layout:**

- Change the desktop workspace to three columns: approximately `320px / minmax(0, 1fr) / 280px` at the wide breakpoint.
- Keep the center column visually dominant.
- Show only known facts: phone, product, total, order ID, and linked-order status; use an unobtrusive dash when missing.
- Move cancellation and undo controls from the message header into the order section.
- Show `Memeriksa status order…` while the linked-order query is unresolved.
- Explain unavailable cancellation only when no verified order is linked; never infer an order from the phone number.
- Keep confirmation dialog and mutation behavior in the parent container.

**Steps:**

1. Write failing render tests for complete context, missing optional facts, loading linked order, cancellable order, cancelled order with undo, and cancelled order without undo.
2. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-context.test.tsx
   ```

   Expected: FAIL because the component is missing.
3. Implement the context panel as a presentational component with no queries or mutations.
4. Wire it into the selected-thread desktop layout and remove the duplicate order action from the center header.
5. Ensure the context panel is hidden below the wide desktop breakpoint so the existing smaller-screen flow remains usable.
6. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-context.test.tsx components/panel/admin-expedition-inbox.test.tsx
   ```

7. Commit:

   ```powershell
   rtk git add components/panel/admin-expedition-context.tsx components/panel/admin-expedition-context.test.tsx components/panel/admin-expedition-inbox.tsx
   rtk git commit -m "feat: add expedition order context panel"
   ```

---

### Task 4: Refine the message workspace and action feedback

**Files:**

- Create: `components/panel/admin-expedition-message.tsx`
- Create: `components/panel/admin-expedition-message.test.tsx`
- Modify: `components/panel/admin-expedition-inbox.tsx`
- Test: `components/panel/admin-expedition-inbox.test.tsx`

**Component contract:**

```ts
type AdminExpeditionMessageProps = {
  direction: "inbound" | "outbound";
  messageType: string;
  content: string;
  status: string;
  failureReason?: string;
  actorName?: string;
  createdAt: number;
};
```

**Behavior and layout:**

- Keep the selected-customer header compact and sticky inside the workspace.
- Render delivery state as text beside the timestamp; color is supplemental.
- Attach failed or unknown-delivery guidance to the affected outbound bubble.
- Use bounded loading placeholders for messages and a purposeful no-message empty state.
- Keep free-text composer stable at the bottom when the 24-hour window is open.
- When closed, replace the composer with a concise window explanation and `Kirim template` action.
- Reserve global feedback for validation, cancellation, and requests rejected before a persisted message exists. Clear stale feedback when switching threads or after a successful action.
- Preserve existing request IDs and duplicate-submit prevention.

**Steps:**

1. Write failing render tests for inbound, outbound delivered/read, failed, unknown, and actor-labelled messages.
2. Add an integration test proving the selected workspace exposes a message-specific failure without relying on a page-level delivery banner.
3. Run:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-message.test.tsx components/panel/admin-expedition-inbox.test.tsx
   ```

   Expected: FAIL for the new message component and updated UI contract.
4. Implement the message component and replace inline bubble markup.
5. Refine header, loading, empty, composer, disabled, and sending states without changing send endpoints or Convex calls.
6. Add a selected-thread effect that clears stale action feedback without clearing a retained request ID.
7. Run the same focused tests and confirm PASS.
8. Commit:

   ```powershell
   rtk git add components/panel/admin-expedition-message.tsx components/panel/admin-expedition-message.test.tsx components/panel/admin-expedition-inbox.tsx components/panel/admin-expedition-inbox.test.tsx
   rtk git commit -m "feat: polish expedition message workspace"
   ```

---

### Task 5: Integrate, visually verify, and run release gates

**Files:**

- Modify if needed: `components/panel/admin-expedition-inbox.tsx`
- Modify if needed: `components/panel/admin-expedition-thread-list.tsx`
- Modify if needed: `components/panel/admin-expedition-context.tsx`
- Modify if needed: `components/panel/admin-expedition-message.tsx`
- Modify if needed: their focused test files
- Record evidence: `docs/superpowers/specs/2026-08-12-admin-expedition-inbox-workspace-design.md`

**Steps:**

1. Run the Impeccable self-review against the design spec: hierarchy, spacing, density, selected state, action priority, focus visibility, and contrast.
2. Run focused Inbox tests:

   ```powershell
   rtk npx vitest run components/panel/admin-expedition-inbox-model.test.ts components/panel/admin-expedition-thread-list.test.tsx components/panel/admin-expedition-context.test.tsx components/panel/admin-expedition-message.test.tsx components/panel/admin-expedition-inbox.test.tsx
   ```

3. Run repository gates:

   ```powershell
   rtk npm test
   rtk npx tsc --noEmit
   rtk npx convex codegen
   rtk npm run build
   rtk git diff --check
   ```

4. Start the local application and visually verify the authenticated Inbox at a desktop viewport near `1440 × 900`. Check ready, empty, selected, reply-needed, 24-hour-open, template-only, delivery failure, loading, cancel, and undo states when fixtures or live data make them available.
5. Confirm from source and browser evidence that no timer, interval, polling hook, or new Convex query was added.
6. Append concise gate and visual-verification evidence to the design spec. Do not claim an unavailable live state as verified.
7. Commit only any verification-driven refinements and evidence:

   ```powershell
   rtk git add components/panel docs/superpowers/specs/2026-08-12-admin-expedition-inbox-workspace-design.md
   rtk git commit -m "test: verify expedition inbox workspace"
   ```

8. Use the branch-finishing workflow only after every required gate is green; merge and deploy require a separate explicit execution decision.
