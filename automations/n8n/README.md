# n8n Workflows

**n8n instance:** https://n8n.miqra.dev

## Active Workflows

| File | Workflow ID | Name | Status |
|---|---|---|---|
| `workflows/chat-handler.json` | `4eBFqyabDlIRx3ZY` | WaFaChat - Chat Handler | Active |
| `workflows/order-trigger.json` | `wgOVQrzkYOijDta1` | WaFaChat - Order Trigger (kirim.chat, v1) | Inactive (retired 2026-06-18 → semua CS pindah ke v2/KirimDev; staffMap utuh untuk fallback) |
| `workflows/state-manager.json` | `oTNay1fDleMibZ3J` | WaFaChat - State Manager | Active |
| `workflows/handover-notifier.json` | `GUQJrCIn1xGKJjH0` | WaFaChat · Handover Notifier | Active |
| `workflows/telegram-setup.json` | `Pu5qEcSpu7e7NV09` | WaFaChat · Telegram Setup | Active |
| `workflows/telegram-callback.json` | `PvMTP5Ex3kzvjNgG` | WaFaChat · Telegram Callback | Active |
| `workflows/order-trigger-v2-kirimdev.json` | `M16ChgpsZsbDAlqC` | WaFaChat - Order Trigger v2 (KirimDev) | Active (semua CS: Aisyah, Risma, Azelia, Lila) |

### Order Trigger v2 (KirimDev) — Aisyah pilot

Parallel migration of the new-order WhatsApp notification from kirim.chat to **KirimDev**, piloting **CS Aisyah only**. Webhook path `/berdu-order-v2`, fed by a **second Berdu App** (`WhatsApp CS Automation v2 (KirimDev)`) with pustakaislam.net as Test User, so `order.new` fans out to both this and the v1 workflow. Filters to Aisyah (`B-1apQSy`), fetches `/order/detail`, and sends the `whatsapp_notif_order_aisyah` template via `POST https://api.kirimdev.com/v1/{PHONE_ID}/messages`. Risma and other CS stay on v1 (`wgOVQrzkYOijDta1`). At cutover, Aisyah is removed from the v1 `staffMap` to avoid double-notification.

- **Placeholders** in the committed JSON: `NEW_APP_ID`, `NEW_APP_SECRET` (new Berdu app), `AISYAH_PHONE_ID` (KirimDev). Real values live only in n8n.
- **Credentials in n8n:** `Berdu HMAC Secret v2` (crypto) on *HMAC SHA256*; `KirimDev API` (httpHeaderAuth, `Authorization: Bearer kdv_live_…`) on *Send Template KirimDev*.
- **Plan/spec:** `wafachat/docs/superpowers/plans/2026-06-17-order-notif-kirimdev-migration.md`, `…/specs/2026-06-17-order-notif-kirimdev-migration-design.md`.

## How to Export (update canonical JSONs)

Export the live workflow by workflow ID, then save the response JSON to the corresponding file in `workflows/`. The canonical workflow files live in this directory so n8n changes are reviewable together with the WaFaChat app.

## Credentials Required
- KirimChat API key (WhatsApp sending)
- Telegram Bot token
- Berdu webhook secret
- Convex deployment URL + key (in `.env.local`)
