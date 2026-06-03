# Folder Reorganization Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize `whatsapp_cs_automotion/` root folder so each concern has one clear home, without touching the `wafachat/` app or risking Vercel/Convex deployment.

**Architecture:** Minimal-cleanup approach — move knowledge and automation files into dedicated subfolders, delete obsolete scripts and bulk backups, keep `wafachat/` completely untouched.

---

## Target Structure

```
whatsapp_cs_automotion/
  wafachat/               ← NOT TOUCHED
  automations/
    n8n/
      workflows/          ← 1 canonical JSON per active workflow (exported fresh)
      README.md           ← workflow IDs, n8n URL, active workflow list
  knowledge/
    products/             ← moved from root/products/
    prompts/
      system-prompt-v3.md ← moved from root
  docs/
    superpowers/          ← unchanged (specs & plans stay here)
      specs/
      plans/
    n8n-backups/          ← TRIMMED to 10 most recent files only
  CONTEXT.md              ← stays at root
  WORKFLOW-OVERVIEW.md    ← stays at root
  .mcp.json               ← stays at root
  .claude/                ← stays at root
  .superpowers/           ← stays at root
```

---

## Actions

### Delete entirely
| Path | Reason |
|---|---|
| `arsip/` | Outdated archive (superseded by current docs) |
| `docs/prompt-archive/` | Old prompt versions — no longer referenced |
| `scripts/` (all 15 `patch-n8n-*.ps1`) | Obsolete since MCP is operational |
| `wafachat/docs/n8n-backups/` | Duplicate of root `docs/n8n-backups/` |

### Trim (keep 10 most recent files)
| Path | Action |
|---|---|
| `docs/n8n-backups/` | Sort all files by LastWriteTime, delete all except the 10 newest |

### Move
| From | To |
|---|---|
| `products/alquran-tulis-tazyin-v2.md` | `knowledge/products/alquran-tulis-tazyin-v2.md` |
| `products/alquran-medis-v1.md` | `knowledge/products/alquran-medis-v1.md` |
| `products/quran-mapping-v1.md` | `knowledge/products/quran-mapping-v1.md` |
| `system-prompt-v3.md` | `knowledge/prompts/system-prompt-v3.md` |

### Create new
| Path | Content |
|---|---|
| `automations/n8n/workflows/` | Empty folder, populated by workflow export step |
| `automations/n8n/README.md` | Workflow IDs, n8n URL, active workflow list, how to export |

### Export canonical workflows
Export current live JSON for each active workflow via MCP into `automations/n8n/workflows/`:
- `chat-handler.json` — `4eBFqyabDlIRx3ZY`
- `order-trigger.json` — `wgOVQrzkYOijDta1`
- `state-manager.json` — `oTNay1fDleMibZ3J`
- `handover-notifier.json` — `GUQJrCIn1xGKJjH0`
- `telegram-setup.json` — `Pu5qEcSpu7e7NV09`
- `telegram-callback.json` — `PvMTP5Ex3kzvjNgG`

### Leave unchanged
- `wafachat/` — entirely untouched (app, .vercel, .convex, .env.local, scripts, docs)
- `docs/superpowers/` — specs and plans stay in place
- `CONTEXT.md`, `WORKFLOW-OVERVIEW.md`, `.mcp.json`

---

## Constraints
- **Do not move or rename `wafachat/`** — Vercel and Convex are bound to this path
- **Do not touch `wafachat/.env.local`** — production secrets
- **Do not remove `docs/superpowers/`** — active planning artifacts
- `CONTEXT.md` at root stays — Claude Code loads it as session context
