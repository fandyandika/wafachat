# Folder Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `whatsapp_cs_automotion/` root so each concern has one clear home — delete obsolete scripts and bulk backups, move knowledge files, create `automations/` and `knowledge/` folders, export canonical workflow JSONs.

**Architecture:** Pure filesystem operations — delete, move, create. `wafachat/` is never touched. No code changes.

**Tech Stack:** PowerShell (Windows), n8n MCP tools for workflow export.

---

### Task 1: Delete obsolete folders

**Files:**
- Delete: `f:\Projects\whatsapp_cs_automotion\arsip\`
- Delete: `f:\Projects\whatsapp_cs_automotion\docs\prompt-archive\`
- Delete: `f:\Projects\whatsapp_cs_automotion\scripts\`
- Delete: `f:\Projects\whatsapp_cs_automotion\wafachat\docs\n8n-backups\`

- [ ] **Step 1: Verify folders exist before deleting**

```powershell
@(
  "f:\Projects\whatsapp_cs_automotion\arsip",
  "f:\Projects\whatsapp_cs_automotion\docs\prompt-archive",
  "f:\Projects\whatsapp_cs_automotion\scripts",
  "f:\Projects\whatsapp_cs_automotion\wafachat\docs\n8n-backups"
) | ForEach-Object { [PSCustomObject]@{ Path = $_; Exists = Test-Path $_ } } | Format-Table -AutoSize
```

Expected: All 4 rows show `Exists = True`

- [ ] **Step 2: Delete all 4 folders**

```powershell
Remove-Item -Recurse -Force "f:\Projects\whatsapp_cs_automotion\arsip"
Remove-Item -Recurse -Force "f:\Projects\whatsapp_cs_automotion\docs\prompt-archive"
Remove-Item -Recurse -Force "f:\Projects\whatsapp_cs_automotion\scripts"
Remove-Item -Recurse -Force "f:\Projects\whatsapp_cs_automotion\wafachat\docs\n8n-backups"
```

- [ ] **Step 3: Verify deletion**

```powershell
@(
  "f:\Projects\whatsapp_cs_automotion\arsip",
  "f:\Projects\whatsapp_cs_automotion\docs\prompt-archive",
  "f:\Projects\whatsapp_cs_automotion\scripts",
  "f:\Projects\whatsapp_cs_automotion\wafachat\docs\n8n-backups"
) | ForEach-Object { [PSCustomObject]@{ Path = $_; Exists = Test-Path $_ } } | Format-Table -AutoSize
```

Expected: All 4 rows show `Exists = False`

---

### Task 2: Trim n8n-backups to 10 most recent files

**Files:**
- Modify: `f:\Projects\whatsapp_cs_automotion\docs\n8n-backups\` (delete all but 10 newest)

- [ ] **Step 1: Preview which files will be deleted (dry run)**

```powershell
$allFiles = Get-ChildItem -Recurse -File "f:\Projects\whatsapp_cs_automotion\docs\n8n-backups" |
  Sort-Object LastWriteTime -Descending
$keep = $allFiles | Select-Object -First 10
$delete = $allFiles | Select-Object -Skip 10

Write-Host "KEEP ($($keep.Count) files):"
$keep | Select-Object Name, LastWriteTime | Format-Table -AutoSize

Write-Host "DELETE ($($delete.Count) files):"
$delete | Select-Object Name, LastWriteTime | Format-Table -AutoSize
```

Expected: 10 files in KEEP list (most recent), rest in DELETE list.

- [ ] **Step 2: Delete files beyond the 10 most recent**

```powershell
Get-ChildItem -Recurse -File "f:\Projects\whatsapp_cs_automotion\docs\n8n-backups" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 10 |
  Remove-Item -Force
```

- [ ] **Step 3: Remove now-empty subdirectories**

```powershell
Get-ChildItem -Recurse -Directory "f:\Projects\whatsapp_cs_automotion\docs\n8n-backups" |
  Sort-Object FullName -Descending |
  Where-Object { (Get-ChildItem $_.FullName).Count -eq 0 } |
  Remove-Item -Force
```

- [ ] **Step 4: Verify result**

```powershell
Get-ChildItem -Recurse -File "f:\Projects\whatsapp_cs_automotion\docs\n8n-backups" |
  Sort-Object LastWriteTime -Descending |
  Select-Object Name, LastWriteTime | Format-Table -AutoSize
```

Expected: Exactly 10 files listed.

---

### Task 3: Move knowledge files

**Files:**
- Create: `f:\Projects\whatsapp_cs_automotion\knowledge\products\`
- Create: `f:\Projects\whatsapp_cs_automotion\knowledge\prompts\`
- Move: `products\*.md` → `knowledge\products\`
- Move: `system-prompt-v3.md` → `knowledge\prompts\system-prompt-v3.md`
- Delete: `f:\Projects\whatsapp_cs_automotion\products\` (now empty)

- [ ] **Step 1: Create knowledge folder structure**

```powershell
New-Item -ItemType Directory -Force "f:\Projects\whatsapp_cs_automotion\knowledge\products"
New-Item -ItemType Directory -Force "f:\Projects\whatsapp_cs_automotion\knowledge\prompts"
```

- [ ] **Step 2: Move product files**

```powershell
Move-Item "f:\Projects\whatsapp_cs_automotion\products\alquran-tulis-tazyin-v2.md" `
          "f:\Projects\whatsapp_cs_automotion\knowledge\products\"
Move-Item "f:\Projects\whatsapp_cs_automotion\products\alquran-medis-v1.md" `
          "f:\Projects\whatsapp_cs_automotion\knowledge\products\"
Move-Item "f:\Projects\whatsapp_cs_automotion\products\quran-mapping-v1.md" `
          "f:\Projects\whatsapp_cs_automotion\knowledge\products\"
```

- [ ] **Step 3: Move system prompt**

```powershell
Move-Item "f:\Projects\whatsapp_cs_automotion\system-prompt-v3.md" `
          "f:\Projects\whatsapp_cs_automotion\knowledge\prompts\system-prompt-v3.md"
```

- [ ] **Step 4: Remove empty products folder**

```powershell
Remove-Item "f:\Projects\whatsapp_cs_automotion\products"
```

- [ ] **Step 5: Verify**

```powershell
Get-ChildItem "f:\Projects\whatsapp_cs_automotion\knowledge" -Recurse | Select-Object FullName | Format-Table -AutoSize
Test-Path "f:\Projects\whatsapp_cs_automotion\products"            # should be False
Test-Path "f:\Projects\whatsapp_cs_automotion\system-prompt-v3.md" # should be False
```

Expected: 3 product .md files in `knowledge/products/`, `system-prompt-v3.md` in `knowledge/prompts/`, both old paths gone.

---

### Task 4: Create automations structure and README

**Files:**
- Create: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\`
- Create: `f:\Projects\whatsapp_cs_automotion\automations\n8n\README.md`

- [ ] **Step 1: Create folder structure**

```powershell
New-Item -ItemType Directory -Force "f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows"
```

- [ ] **Step 2: Write README.md**

Create `f:\Projects\whatsapp_cs_automotion\automations\n8n\README.md` with this exact content:

```markdown
# n8n Workflows

**n8n instance:** https://n8n.miqra.dev

## Active Workflows

| File | Workflow ID | Name | Status |
|---|---|---|---|
| `workflows/chat-handler.json` | `4eBFqyabDlIRx3ZY` | WaFaChat - Chat Handler | Active |
| `workflows/order-trigger.json` | `wgOVQrzkYOijDta1` | WaFaChat - Order Trigger | Active |
| `workflows/state-manager.json` | `oTNay1fDleMibZ3J` | WaFaChat - State Manager | Active |
| `workflows/handover-notifier.json` | `GUQJrCIn1xGKJjH0` | WaFaChat · Handover Notifier | Active |
| `workflows/telegram-setup.json` | `Pu5qEcSpu7e7NV09` | WaFaChat · Telegram Setup | Active |
| `workflows/telegram-callback.json` | `PvMTP5Ex3kzvjNgG` | WaFaChat · Telegram Callback | Active |

## How to Export (update canonical JSONs)

Use MCP tool `n8n_get_workflow` for each workflow ID above, then save the response JSON to the corresponding file in `workflows/`.

## Credentials Required
- KirimChat API key (WhatsApp sending)
- Telegram Bot token
- Berdu webhook secret
- Convex deployment URL + key (in wafachat/.env.local)
```

- [ ] **Step 3: Verify**

```powershell
Test-Path "f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows"  # True
Test-Path "f:\Projects\whatsapp_cs_automotion\automations\n8n\README.md"  # True
```

---

### Task 5: Export canonical workflow JSONs

**Files:**
- Create: `automations\n8n\workflows\chat-handler.json`
- Create: `automations\n8n\workflows\order-trigger.json`
- Create: `automations\n8n\workflows\state-manager.json`
- Create: `automations\n8n\workflows\handover-notifier.json`
- Create: `automations\n8n\workflows\telegram-setup.json`
- Create: `automations\n8n\workflows\telegram-callback.json`

For each workflow, call MCP tool `n8n_get_workflow` with the given ID, then write the full JSON response to the file path.

- [ ] **Step 1: Export chat-handler**

MCP: `n8n_get_workflow({ "id": "4eBFqyabDlIRx3ZY" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\chat-handler.json`

- [ ] **Step 2: Export order-trigger**

MCP: `n8n_get_workflow({ "id": "wgOVQrzkYOijDta1" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\order-trigger.json`

- [ ] **Step 3: Export state-manager**

MCP: `n8n_get_workflow({ "id": "oTNay1fDleMibZ3J" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\state-manager.json`

- [ ] **Step 4: Export handover-notifier**

MCP: `n8n_get_workflow({ "id": "GUQJrCIn1xGKJjH0" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\handover-notifier.json`

- [ ] **Step 5: Export telegram-setup**

MCP: `n8n_get_workflow({ "id": "Pu5qEcSpu7e7NV09" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\telegram-setup.json`

- [ ] **Step 6: Export telegram-callback**

MCP: `n8n_get_workflow({ "id": "PvMTP5Ex3kzvjNgG" })`
Save to: `f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows\telegram-callback.json`

- [ ] **Step 7: Verify all 6 files exist**

```powershell
Get-ChildItem "f:\Projects\whatsapp_cs_automotion\automations\n8n\workflows" |
  Select-Object Name, Length | Format-Table -AutoSize
```

Expected: 6 `.json` files, each > 1KB.

---

### Task 6: Final verification

- [ ] **Step 1: Check root is clean**

```powershell
Get-ChildItem "f:\Projects\whatsapp_cs_automotion" |
  Where-Object { $_.Name -notin @('.claude', '.superpowers', '.mcp.json', 'automations', 'knowledge', 'docs', 'wafachat', 'CONTEXT.md', 'WORKFLOW-OVERVIEW.md') } |
  Select-Object Name
```

Expected: Empty output (nothing unexpected at root).

- [ ] **Step 2: Confirm wafachat untouched**

```powershell
Test-Path "f:\Projects\whatsapp_cs_automotion\wafachat\.env.local"  # True
Test-Path "f:\Projects\whatsapp_cs_automotion\wafachat\.vercel"     # True
Test-Path "f:\Projects\whatsapp_cs_automotion\wafachat\convex"      # True
```

Expected: All True.

- [ ] **Step 3: Print final structure**

```powershell
Get-ChildItem "f:\Projects\whatsapp_cs_automotion" -Depth 2 |
  Where-Object { $_.FullName -notlike "*\node_modules\*" -and $_.FullName -notlike "*\.next\*" } |
  Select-Object FullName | Format-Table -AutoSize
```

Expected: Clean tree with `automations/`, `knowledge/`, `docs/`, `wafachat/` at root.
