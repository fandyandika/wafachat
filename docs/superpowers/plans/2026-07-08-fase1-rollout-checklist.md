# Fase 1 Rollout Checklist (living doc)

> All code is built + reviewed. Deploys and vendor-dashboard steps are deliberately
> gated to Fandy — no unattended prod cutover. Convex functions go live only via
> `npx convex deploy`; git push alone does not deploy Convex.

## DEPLOY GATE (do these together, supervised)

- [ ] `cd /f/Projects/whatsapp_cs_automotion/wafachat && npm run build && npx vitest run` — green.
- [ ] `npx convex deploy -y` — deploys schema (additive) + ingest functions + `/webhooks/*` routes.
      Endpoints are INERT until a subscription points at them; the refactored
      `appendMessageCore` now serves the live n8n `/n8n/state` path (behavior-neutral, tested).
- [ ] `git push origin main`.

## M1 — KirimDev dual-run
- [ ] (Fandy, KirimDev dashboard) Create NEW webhook subscription:
      URL: https://helpful-spoonbill-863.convex.site/webhooks/kirimdev
      Events: message.received, message.sent — same as the wbs_A3A14 (n8n) subscription.
      Copy the signing secret (shown ONCE).
- [ ] (Fandy or Claude via authenticated panel/dashboard) `ingest.sources.upsertSource`:
      sourceKey "kirimdev-pustakaislam", kind "kirimdev", secret <paste>,
      enabled true, enforceSignature FALSE (log-only).
- [ ] (Fandy, Convex dashboard data editor OR extend a csConfigs mutation) Seed
      csConfigs.providerNumberIds so the ingest path attributes CS correctly
      (values verbatim from n8n CS_BY_PHONE_ID):
      - CS Aisyah → ["1197250776802755"]
      - CS Risma  → ["433364286526515"]
      - CS Azelia → ["485071188032281"]
      - CS Lila   → ["248236235032868"]
      - CS Nabila → ["589458990909040", "1149779461560484"]
- [ ] Old n8n subscription stays ENABLED (dual-run; dedup by externalMessageId
      makes double delivery safe).
- [ ] After ≥20 live events: check ingestEvents (ingest.events.listRecent) — every
      row signatureOk=true? → ingest.sources.setEnforceSignature(true). If
      signatureOk=false consistently, the HMAC construction differs (e.g. body-only
      instead of t.body): adjust convex/ingest/signature.ts, redeploy, re-check.
      DO NOT enforce until true.
- [ ] Parity 2-3 days: daily compare ingest.events.dailyStats vs the n8n execution
      count for workflow STIyKl6dDgdZgKeh; spot-check closings in Laporan.
- [ ] Cutover: DISABLE (not delete) the OLD n8n subscription wbs_A3A14.
      Rollback at any time = re-enable it.

## M2 — Monitoring
- [ ] (Fandy, Convex dashboard → Settings → Environment Variables)
      TELEGRAM_BOT_TOKEN = <existing WaFaChat bot token, from the n8n Telegram credential>
      TELEGRAM_ALERT_CHAT_ID = <Fandy's chat id with that bot>
- [ ] Live alert test: run internal.ingest.monitor.checkHealth from the dashboard
      function runner at a moment engineered to trip silence (e.g. before any ingest
      events exist, inside 08:00-21:00 WIB) → Telegram message arrives.

## M3 — Orders
- [ ] (Fandy, Berdu dashboard) Check: does Berdu allow >1 webhook URL per event?
      YES → Plan A: add second webhook → https://helpful-spoonbill-863.convex.site/webhooks/berdu
      NO  → Plan B: edit the n8n "Order Trigger v2" Normalize node: change the
            order-sync URL from n8n.miqra.dev/webhook/conversation-state to
            https://helpful-spoonbill-863.convex.site/webhooks/berdu (keep 3 retries).
- [ ] (Fandy, Convex dashboard env) BERDU_APP_ID, BERDU_USER_ID, BERDU_APP_SECRET,
      BERDU_HMAC_KEY (value of the n8n credential "Berdu HMAC Secret v2" — open it in
      the n8n UI; if unreadable there, retrieve from Berdu developer settings).
- [ ] (Fandy or Claude) upsertSource: sourceKey "berdu-pustakaislam", kind "berdu",
      secret <random 32+ char string>, enabled true, enforceSignature false
      (Plan B n8n calls carry no signature; keep log-only for this source).
- [ ] Verify one reconciler run in Convex logs pulls a real order (or reports 0 gaps).
- [ ] Disable n8n "WaFaChat · Order Reconciler (gap-heal)" after 2 clean days.

## M4 — Generic + closeout
- [ ] n8n "WaFaChat - KirimDev Message Receiver v2" deactivated (keep 2 weeks, then archive).
- [ ] Fire-drill: stop the n8n VPS for 1 hour during work hours — messages+orders keep
      flowing into the panel; silence alert does NOT fire; notif-order queues/fails
      as expected (separate service). Record results here.
