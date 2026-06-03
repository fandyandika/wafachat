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

Export the live workflow by workflow ID, then save the response JSON to the corresponding file in `workflows/`. The canonical workflow files live in this directory so n8n changes are reviewable together with the WaFaChat app.

## Credentials Required
- KirimChat API key (WhatsApp sending)
- Telegram Bot token
- Berdu webhook secret
- Convex deployment URL + key (in `.env.local`)
