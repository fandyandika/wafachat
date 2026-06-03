# Closing Dedup n8n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI closing stats count at most one closing per Berdu order so `CR AI = closings / orders` cannot exceed reality when the same conversation emits `PEMESANAN BERHASIL` more than once.

**Architecture:** Keep the panel unchanged and fix the source of truth in `WaFaChat · State Manager`. Add a `closing_keys` dedup set under each `daily_stats[date]`, keyed by `order_id` first and falling back to `phone:productName` only when `order_id` is unavailable. Update `WaFaChat · Chat Handler` so the `Increment Closing` node sends the order identity to State Manager.

**Tech Stack:** n8n v2.21.7, n8n Code node JavaScript, n8n Webhook/HTTP Request nodes, Vercel-hosted Next.js panel.

---

## Scope

This plan fixes only duplicate metric counting. It does not change OpenAI prompts, KirimChat routing, Google Sheet logging, panel UI, or the conversation lifecycle.

Current reproduced production state:

```json
{"orders":1,"closings":2,"handovers":0,"closed_today":0}
```

Current active conversation:

```json
{
  "phone": "6285715682110",
  "productName": "Quran Mapping [V2]",
  "order_id": "O-260526000058",
  "status": "active"
}
```

Correct behavior after this plan:

```json
{"orders":1,"closings":1,"handovers":0,"closed_today":0}
```

## File And Workflow Map

- Modify n8n workflow `WaFaChat · State Manager` (`oTNay1fDleMibZ3J`)
  - Node to edit: main Code node that handles `get`, `set`, `set_order`, `increment_stat`, `get_stats`, `list_all`.
  - Responsibility: own stats storage, migration, and dedup logic.

- Modify n8n workflow `WaFaChat · Chat Handler` (`4eBFqyabDlIRx3ZY`)
  - Node to edit: `Increment Closing`.
  - Responsibility: call State Manager with enough identity fields to dedup a closing.

- No code changes required in `wafachat/` for this fix.

## Data Model

Extend `state.daily_stats[date]` from:

```javascript
{
  orders: 1,
  closings: 2,
  handovers: 0,
  closed_today: 0,
  order_keys: ["6285715682110:Quran Mapping [V2]"]
}
```

to:

```javascript
{
  orders: 1,
  closings: 1,
  handovers: 0,
  closed_today: 0,
  order_keys: ["6285715682110:Quran Mapping [V2]"],
  closing_keys: ["O-260526000058"]
}
```

Dedup key rules:

```javascript
function makeOrderScopedKey(input, existingRecord) {
  if (input.order_id) return String(input.order_id);
  if (existingRecord?.order_id) return String(existingRecord.order_id);

  const phone = String(input.phone || existingRecord?.phone || '').trim();
  const productName = String(input.productName || existingRecord?.productName || '').trim();
  return `${phone}:${productName}`;
}
```

`order_id` is the canonical key because one phone can buy the same product more than once. `phone:productName` is only a fallback for older records.

---

### Task 1: Back Up Production Workflows

**Files:**
- Create: `docs/n8n-backups/2026-05-26/README.md`
- Export from n8n UI/API:
  - `WaFaChat · State Manager`
  - `WaFaChat · Chat Handler`

- [ ] **Step 1: Create backup folder**

Run:

```powershell
New-Item -ItemType Directory -Force -Path docs\n8n-backups\2026-05-26
```

Expected: folder exists.

- [ ] **Step 2: Export workflows**

If using n8n UI:

```text
n8n.miqra.dev
→ Workflows
→ WaFaChat · State Manager
→ Download
→ save as docs/n8n-backups/2026-05-26/state-manager.json

n8n.miqra.dev
→ Workflows
→ WaFaChat · Chat Handler
→ Download
→ save as docs/n8n-backups/2026-05-26/chat-handler.json
```

If using n8n API, use the production API key and export the two workflow IDs:

```powershell
$headers = @{ "X-N8N-API-KEY" = $env:N8N_API_KEY }
Invoke-WebRequest -Uri "https://n8n.miqra.dev/api/v1/workflows/oTNay1fDleMibZ3J" -Headers $headers -OutFile "docs\n8n-backups\2026-05-26\state-manager.json"
Invoke-WebRequest -Uri "https://n8n.miqra.dev/api/v1/workflows/4eBFqyabDlIRx3ZY" -Headers $headers -OutFile "docs\n8n-backups\2026-05-26\chat-handler.json"
```

Expected: both JSON files exist and are non-empty.

---

### Task 2: Add `closing_keys` Migration In State Manager

**Workflow:** `WaFaChat · State Manager`

**Node:** main Code node

- [ ] **Step 1: Find the stats initializer**

Find the code that creates today stats. It should be conceptually similar to:

```javascript
state.daily_stats[date] = state.daily_stats[date] || {
  orders: 0,
  closings: 0,
  handovers: 0,
  closed_today: 0,
  order_keys: []
};
```

- [ ] **Step 2: Replace with normalized initializer**

Use this helper near the top of the Code node:

```javascript
function todayWIB() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ensureDailyStats(state, date) {
  state.daily_stats = state.daily_stats || {};
  const stats = state.daily_stats[date] || {};

  stats.orders = Number(stats.orders || 0);
  stats.closings = Number(stats.closings || 0);
  stats.handovers = Number(stats.handovers || 0);
  stats.closed_today = Number(stats.closed_today || 0);
  stats.order_keys = Array.isArray(stats.order_keys) ? stats.order_keys : [];
  stats.closing_keys = Array.isArray(stats.closing_keys) ? stats.closing_keys : [];

  state.daily_stats[date] = stats;
  return stats;
}

function makeOrderScopedKey(input, existingRecord) {
  if (input.order_id) return String(input.order_id);
  if (existingRecord && existingRecord.order_id) return String(existingRecord.order_id);

  const phone = String(input.phone || (existingRecord && existingRecord.phone) || '').trim();
  const productName = String(input.productName || (existingRecord && existingRecord.productName) || '').trim();
  return `${phone}:${productName}`;
}
```

- [ ] **Step 3: Use the initializer everywhere stats are read or written**

For each action that reads/writes stats, set:

```javascript
const date = $json.date || todayWIB();
const stats = ensureDailyStats(state, date);
```

Expected: `get_stats`, `set_order`, `set status=closed`, and `increment_stat` all use `ensureDailyStats`.

---

### Task 3: Make `increment_stat` Dedup Closings

**Workflow:** `WaFaChat · State Manager`

**Node:** main Code node

- [ ] **Step 1: Replace the current `increment_stat` branch**

Replace the `increment_stat` handling with:

```javascript
if (action === 'increment_stat') {
  const date = $json.date || todayWIB();
  const stats = ensureDailyStats(state, date);
  const field = String($json.field || '').trim();

  if (field === 'closings') {
    const existingRecord = $json.phone ? state[$json.phone] : undefined;
    const closingKey = makeOrderScopedKey($json, existingRecord);

    if (!closingKey || closingKey === ':') {
      return [{
        json: {
          success: false,
          error: 'closing identity missing',
          required: ['order_id or phone+productName'],
          _action: action
        }
      }];
    }

    if (!stats.closing_keys.includes(closingKey)) {
      stats.closing_keys.push(closingKey);
      stats.closings = stats.closing_keys.length;
    }

    return [{
      json: {
        success: true,
        date,
        field,
        key: closingKey,
        deduped: true,
        closings: stats.closings,
        _action: action
      }
    }];
  }

  if (field === 'handovers') {
    stats.handovers += 1;
    return [{
      json: {
        success: true,
        date,
        field,
        handovers: stats.handovers,
        _action: action
      }
    }];
  }

  return [{
    json: {
      success: false,
      error: `unsupported stat field: ${field}`,
      allowed: ['closings', 'handovers'],
      _action: action
    }
  }];
}
```

- [ ] **Step 2: Update `get_stats` to report normalized counts**

Ensure `get_stats` returns the normalized `stats.closings` value:

```javascript
if (action === 'get_stats') {
  const date = $json.date || todayWIB();
  const stats = ensureDailyStats(state, date);

  return [{
    json: {
      success: true,
      date,
      orders: stats.orders,
      closings: stats.closings,
      handovers: stats.handovers,
      closed_today: stats.closed_today,
      _action: action
    }
  }];
}
```

Expected: after duplicate `increment_stat closings` calls with the same `order_id`, `closings` remains unchanged.

---

### Task 4: Repair Today's Existing Duplicate Count

**Workflow:** `WaFaChat · State Manager`

**Node:** main Code node

- [ ] **Step 1: Add one-time repair action**

Add this temporary action below the helper functions and before the default error branch:

```javascript
if (action === 'repair_today_closing_dedup') {
  const date = $json.date || todayWIB();
  const stats = ensureDailyStats(state, date);
  const closingKeys = new Set(stats.closing_keys);

  for (const phone of state.phone_index || []) {
    const record = state[phone];
    if (!record || !record.order_id) continue;
    closingKeys.add(String(record.order_id));
  }

  stats.closing_keys = Array.from(closingKeys);
  stats.closings = Math.min(stats.closings, stats.closing_keys.length);

  return [{
    json: {
      success: true,
      date,
      closings: stats.closings,
      closing_keys: stats.closing_keys,
      _action: action
    }
  }];
}
```

- [ ] **Step 2: Run repair once for 2026-05-26**

Run:

```powershell
$url = (Get-Content wafachat\.env.local | Where-Object { $_ -match '^N8N_STATE_MANAGER_URL=' }) -replace '^N8N_STATE_MANAGER_URL=', ''
$body = @{ action = 'repair_today_closing_dedup'; date = '2026-05-26' } | ConvertTo-Json
Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing
```

Expected:

```json
{"success":true,"date":"2026-05-26","closings":1,"closing_keys":["O-260526000058"],"_action":"repair_today_closing_dedup"}
```

- [ ] **Step 3: Remove the temporary repair action**

After the repair succeeds, delete the `repair_today_closing_dedup` branch from the Code node so it cannot be used accidentally later.

Expected: only normal production actions remain.

---

### Task 5: Update Chat Handler `Increment Closing` Payload

**Workflow:** `WaFaChat · Chat Handler`

**Node:** `Increment Closing`

- [ ] **Step 1: Update request body**

Set the HTTP Request body to:

```json
{
  "action": "increment_stat",
  "field": "closings",
  "phone": "={{ $json.phone }}",
  "order_id": "={{ $json.order_id }}",
  "productName": "={{ $json.productName }}"
}
```

Expected: State Manager receives stable order identity when the AI emits `PEMESANAN BERHASIL`.

- [ ] **Step 2: Confirm upstream fields exist**

In the `Parse AI Response` output, confirm the item contains:

```json
{
  "phone": "6285715682110",
  "order_id": "O-260526000058",
  "productName": "Quran Mapping [V2]",
  "isClosing": true
}
```

If `order_id` is missing at `Parse AI Response`, copy it through from the parsed State Manager response in the previous Code node.

---

### Task 6: Verify Production Behavior

**Files:**
- No file changes.

- [ ] **Step 1: Confirm stats after repair**

Run:

```powershell
$url = (Get-Content wafachat\.env.local | Where-Object { $_ -match '^N8N_STATE_MANAGER_URL=' }) -replace '^N8N_STATE_MANAGER_URL=', ''
$body = @{ action = 'get_stats' } | ConvertTo-Json
(Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing).Content
```

Expected:

```json
{"success":true,"date":"2026-05-26","orders":1,"closings":1,"handovers":0,"closed_today":0,"_action":"get_stats"}
```

- [ ] **Step 2: Confirm duplicate closing is ignored**

Run the same increment twice:

```powershell
$url = (Get-Content wafachat\.env.local | Where-Object { $_ -match '^N8N_STATE_MANAGER_URL=' }) -replace '^N8N_STATE_MANAGER_URL=', ''
$body = @{
  action = 'increment_stat'
  field = 'closings'
  phone = '6285715682110'
  order_id = 'O-260526000058'
  productName = 'Quran Mapping [V2]'
} | ConvertTo-Json
(Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing).Content
(Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing).Content
```

Expected both responses report:

```json
{"success":true,"field":"closings","key":"O-260526000058","deduped":true,"closings":1}
```

- [ ] **Step 3: Confirm panel math**

Open:

```text
https://wafachat.vercel.app/panel
```

Expected cards:

```text
Pesanan Hari Ini: 1
Closing AI: 1
CR AI: 100%
```

---

### Task 7: Document The Metric Contract

**Files:**
- Modify: `CONTEXT.md`
- Modify: `WORKFLOW-OVERVIEW.md`

- [ ] **Step 1: Update `CONTEXT.md` State Manager section**

Add this line under `increment_stat`:

```markdown
| `increment_stat` | `{ action, field, phone, order_id, productName }` | Increment `closings` with dedup per `order_id`; `handovers` remains simple increment |
```

- [ ] **Step 2: Update `WORKFLOW-OVERVIEW.md` stats structure**

Add `closing_keys`:

```javascript
state.daily_stats[date] = {
  orders, closings, handovers, closed_today,
  order_keys: ["628xxx:ProductName"],
  closing_keys: ["O-260526000058"]
}
```

- [ ] **Step 3: Record the production fix**

Add progress log entry:

```markdown
| 2026-05-26 | Fix stats: Closing AI dedup per `order_id` via `closing_keys`; CR AI no longer exceeds valid order count from repeated closing messages | ✅ |
```

---

## Self-Review

Spec coverage:

- Closing duplicate bug: covered by Tasks 2, 3, 4, 5, 6.
- CR AI inflated by duplicate closings: covered by State Manager source-of-truth fix; no panel change needed.
- n8n access and context: covered by backup/export and implementation workflow IDs.

Placeholder scan:

- No `TBD`, vague "add validation", or unspecified test steps remain.

Type consistency:

- `order_id`, `phone`, and `productName` names match existing State Manager and panel conversation fields.
- `closing_keys` is always an array.
- `closings` is derived from `closing_keys.length` for deduped closings.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-05-26-closing-dedup-n8n.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh worker for n8n State Manager, review, then a second worker for Chat Handler and verification.
2. **Inline Execution** - Execute in this session using n8n access, with checkpoints after backup, State Manager change, and verification.
