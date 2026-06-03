# Status Transition Counters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Done, Pause AI, and Reactivate behavior accurate and idempotent in WaFaChat production.

**Architecture:** n8n State Manager owns conversation state and daily counters. The Next.js panel only sends status transitions and renders active, handover, and closed-today queues.

**Tech Stack:** n8n workflow static data, PowerShell n8n API patch script, Next.js 14 App Router, shadcn/ui.

---

### Task 1: Patch n8n State Manager

**Files:**
- Create: `scripts/patch-n8n-status-transitions.ps1`
- Backup: `docs/n8n-backups/2026-05-26/state-manager.pre-status-transitions-live.json`
- Backup: `docs/n8n-backups/2026-05-26/state-manager.post-status-transitions-live.json`

- [ ] **Step 1: Replace State Logic with transition-aware code**

Rules:
- `active|handover` statuses are present in `phone_index`.
- `closed` status is removed from `phone_index`, but remains in static data for reopening/history.
- `closed_today` is backed by `closed_keys`, so repeated `Done` on the same order does not double-count.
- `handovers` is backed by `handover_keys`, so `Pause AI` counts once per order/day.
- Moving from `closed` back to `active|handover` removes the closed key so accidental Done can be corrected.
- `list_all` supports `includeClosed: true` and only includes closed rows from today's Jakarta date.

- [ ] **Step 2: Run the patch script**

Run:
```powershell
.\scripts\patch-n8n-status-transitions.ps1
```

Expected:
- Workflow remains active.
- `get_stats` returns `closed_today: 1` for the current duplicated Done state.
- Calling `set` with the same `closed` status again does not increment `closed_today`.

### Task 2: Patch Next.js Panel

**Files:**
- Modify: `wafachat/app/api/conversations/route.ts`
- Modify: `wafachat/app/panel/page.tsx`

- [ ] **Step 1: Request closed rows**

Change `/api/conversations` to send:
```ts
body: JSON.stringify({ action: 'list_all', includeClosed: true }),
```

- [ ] **Step 2: Render Closed today queue**

Add:
```ts
const closed = conversations.filter((conversation) => conversation.status === 'closed');
```

Render `ConversationPanel` for closed rows with `onResumeAI={(phone) => setStatus(phone, 'active', 'reactivated by CS')}`.

- [ ] **Step 3: Update row actions**

Rules:
- `active`: WhatsApp, Pause AI, Done
- `handover`: WhatsApp, Resume, Done
- `closed`: WhatsApp, Reactivate

### Task 3: Verify and Deploy

- [ ] **Step 1: Build**

Run:
```powershell
npm run build
```

Expected: Next.js build passes.

- [ ] **Step 2: Verify live stats**

Run:
```powershell
Invoke-RestMethod -Uri https://wafachat.vercel.app/api/stats
```

Expected:
- `closed_today` is no longer duplicated for the current single closed conversation.

- [ ] **Step 3: Deploy**

Run:
```powershell
npx vercel deploy --prod --yes
```

Expected:
- Deployment status is `Ready`.
- Alias includes `https://wafachat.vercel.app`.
