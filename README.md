# WaFaChat

WaFaChat is the WhatsApp CS automation and reporting workspace for Pustaka Islam.

## Folder Map

| Path | Purpose |
|---|---|
| `app/`, `components/`, `lib/` | Next.js dashboard and UI |
| `convex/` | Convex source of truth for conversations, messages, CS configs, shipping recap, and performance |
| `automations/n8n/` | Canonical n8n workflow exports and workflow documentation |
| `docs/n8n-backups/` | Timestamped n8n workflow backups for rollback |
| `docs/superpowers/` | Specs and implementation plans |
| `knowledge/prompts/` | System prompts used by n8n/AI workflow |
| `knowledge/products/` | Product knowledge for the AI assistant |
| `scripts/` | Local verification and utility scripts |

## Source Of Truth

Keep project-owned files inside this `wafachat/` repository. The parent folder can contain local machine config such as `.mcp.json`, but app code, n8n workflow exports, product knowledge, prompts, plans, and rollback backups should live here so they can be reviewed and committed together.
