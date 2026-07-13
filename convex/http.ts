import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { verifySignature } from "./ingest/signature";
import { fetchBerduOrderDetail } from "./ingest/reconciler";

const http = httpRouter();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.N8N_CONVEX_ADAPTER_SECRET;
  if (!expected) return true;

  return request.headers.get("x-wafachat-adapter-secret") === expected;
}

function normalizeMessageType(value: unknown): "text" | "image" | "template" | "button" {
  if (value === "image" || value === "template" || value === "button") return value;
  return "text";
}

const MAX_BODY_BYTES = 262_144; // 256 KB

http.route({
  path: "/n8n/state",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) {
      return jsonResponse({ success: false, error: "unauthorized" }, 401);
    }

    const body = await request.json();
    const action = body.action;

    if (action === "health") {
      const result = await ctx.runQuery(internal.state.health, {});
      return jsonResponse(result);
    }

    if (action === "set_order") {
      const result = await ctx.runMutation(internal.state.upsertOrderFromN8n, {
        phone: String(body.phone || ""),
        csName: String(body.csName || ""),
        csNumber: body.csNumber ? String(body.csNumber) : undefined,
        productName: body.productName ? String(body.productName) : undefined,
        products: body.products ? String(body.products) : undefined,
        productsSubtotal: body.productsSubtotal ? String(body.productsSubtotal) : undefined,
        shippingCost: body.shippingCost ? String(body.shippingCost) : undefined,
        total: body.total ? String(body.total) : undefined,
        customerName: body.customerName ? String(body.customerName) : undefined,
        shippingAddress: body.shippingAddress ? String(body.shippingAddress) : undefined,
        shippingDistrict: body.shippingDistrict ? String(body.shippingDistrict) : undefined,
        shippingCity: body.shippingCity ? String(body.shippingCity) : undefined,
        order_id: body.order_id ? String(body.order_id) : undefined,
        createdAt: body.createdAt ? Number(body.createdAt) : undefined,
      });
      return jsonResponse({ ...result, _action: "set_order" });
    }

    if (action === "list_order_counters") {
      const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
      if (!orgId) return jsonResponse({ success: false, error: "no default org" }, 500);
      const result = await ctx.runQuery(internal.state.listOrderCountersByPrefix, {
        datePrefix: String(body.datePrefix || ""),
        orgId,
      });
      return jsonResponse({ ...result, _action: "list_order_counters" });
    }

    if (action === "get_with_global") {
      const result = await ctx.runQuery(internal.state.getConversationContextForN8n, {
        phone: String(body.phone || ""),
        messageLimit: body.messageLimit ? Number(body.messageLimit) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "get") {
      const result = await ctx.runQuery(internal.state.getConversationContextForN8n, {
        phone: String(body.phone || ""),
        messageLimit: 0,
      });
      return jsonResponse({
        success: result.success,
        phone: result.phone,
        status: result.status,
        note: result.note || "",
        updated_at: result.updated_at || null,
        _action: "get",
      });
    }

    if (action === "set") {
      const result = await ctx.runMutation(internal.state.setConversationStatusFromN8n, {
        phone: String(body.phone || ""),
        order_id: body.order_id ? String(body.order_id) : undefined,
        status: body.status,
        note: body.note ? String(body.note) : undefined,
        customerName: body.customerName ? String(body.customerName) : undefined,
        csNumber: body.csNumber ? String(body.csNumber) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "increment_stat") {
      const result = await ctx.runMutation(internal.state.recordStatEventFromN8n, {
        field: body.field,
        phone: body.phone ? String(body.phone) : undefined,
        order_id: body.order_id ? String(body.order_id) : undefined,
        productName: body.productName ? String(body.productName) : undefined,
        date: body.date ? String(body.date) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "append_message") {
      const result = await ctx.runMutation(internal.messages.appendMessageFromN8n, {
        phone: String(body.phone || ""),
        order_id: body.order_id ? String(body.order_id) : undefined,
        customerName: body.customerName ? String(body.customerName) : undefined,
        csName: body.csName ? String(body.csName) : undefined,
        role: body.role,
        direction: body.direction,
        content: String(body.content || ""),
        messageType: normalizeMessageType(body.messageType),
        externalMessageId: body.externalMessageId ? String(body.externalMessageId) : undefined,
        createdAt: body.createdAt ? Number(body.createdAt) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "upsert_shipping_recap") {
      const result = await ctx.runMutation(internal.shippingRecaps.upsertFromN8n, {
        customerPhone: String(body.customerPhone || body.phone || ""),
        customerName: body.customerName ? String(body.customerName) : undefined,
        csName: body.csName ? String(body.csName) : undefined,
        csPhone: body.csPhone || body.csNumber ? String(body.csPhone || body.csNumber) : undefined,
        orderIdBerdu: body.orderIdBerdu || body.order_id ? String(body.orderIdBerdu || body.order_id) : undefined,
        sourceMessageId: body.sourceMessageId || body.messageId ? String(body.sourceMessageId || body.messageId) : undefined,
        sourceMessageText: String(body.sourceMessageText || body.message || ""),
        closedAt: body.closedAt ? Number(body.closedAt) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "import_berdu_verified_rows") {
      const result = await ctx.runMutation(internal.shippingRecaps.importBerduVerifiedRows, {
        importBatchId: String(body.importBatchId || `berdu-${Date.now()}`),
        rows: Array.isArray(body.rows) ? body.rows : [],
      });
      return jsonResponse(result);
    }

    if (action === "cancel_shipping_recap") {
      const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
      if (!orgId) return jsonResponse({ success: false, error: "org not found" }, 500);
      const result = await ctx.runMutation(internal.shippingRecaps.markLatestCancelledByPhone, {
        customerPhone: String(body.customerPhone || body.phone || ""),
        orderIdBerdu: body.orderIdBerdu || body.order_id ? String(body.orderIdBerdu || body.order_id) : undefined,
        reason: body.reason ? String(body.reason) : undefined,
        orgId,
      });
      return jsonResponse({ ...result, _action: "cancel_shipping_recap" });
    }


    if (action === "list_all") {
      const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
      if (!orgId) return jsonResponse({ success: false, error: "no default org" }, 500);
      const result = await ctx.runQuery(internal.state.listConversations, {
        includeClosed: body.includeClosed === true || body.includeClosed === "true",
        orgId,
      });
      return jsonResponse({ success: true, conversations: result, _action: "list_all" });
    }

    if (action === "get_stats") {
      const result = await ctx.runQuery(internal.state.getDailyStats, {
        date: body.date ? String(body.date) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "set_global") {
      const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
      if (!orgId) return jsonResponse({ success: false, error: "no default org" }, 500);
      const result = await ctx.runMutation(internal.settings.setGlobalAiEnabled, { enabled: body.enabled !== false, orgId });
      return jsonResponse({ ...result, _action: "set_global" });
    }

    if (action === "get_global") {
      const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
      if (!orgId) return jsonResponse({ success: false, error: "no default org" }, 500);
      const globalEnabled = await ctx.runQuery(internal.settings.getGlobalAiEnabled, { orgId });
      return jsonResponse({ success: true, globalEnabled, _action: "get_global" });
    }

    return jsonResponse({ success: false, error: `unsupported action: ${action}` }, 400);
  }),
});

http.route({
  path: "/webhooks/kirimdev",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "payload too large" }, 400);
    }
    // B3: sourceKey from URL (?source=...). Old bare URL (tenant #1's registered
    // webhook) keeps working via the legacy alias — do NOT break that contract.
    const sourceKeyParam = new URL(request.url).searchParams.get("source");
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, {
      sourceKey: sourceKeyParam || "kirimdev-pustakaislam",
    });
    if (!source || !source.enabled) { console.warn("[ingest] unknown/disabled source; acked 200 to avoid vendor auto-disable"); return jsonResponse({ ok: true, ignored: "unknown or disabled source" }, 200); }

    const sig = await verifySignature({
      header: request.headers.get("x-kirim-signature"),
      rawBody, secret: source.secret, nowMs: Date.now(),
    });
    if (!sig.ok && source.enforceSignature) {
      return jsonResponse({ ok: false, error: "invalid signature" }, 401);
    }
    try { JSON.parse(rawBody); } catch {
      return jsonResponse({ ok: false, error: "invalid json" }, 400);
    }

    const relevantHeaders: Record<string, string> = {};
    for (const h of ["x-kirim-event", "x-kirim-event-id", "x-kirim-delivery-id", "x-kirim-signature", "content-type"]) {
      const val = request.headers.get(h);
      if (val) relevantHeaders[h] = val;
    }
    const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
      sourceKey: source.sourceKey,
      kind: "message.event",
      rawHeaders: JSON.stringify(relevantHeaders),
      rawBody,
      signatureOk: sig.ok,
      orgId: source.orgId,
    });
    // Always-200 after capture: a processing bug must not make the vendor
    // count failures (that is what auto-disabled the subscription on 7 Jul).
    try {
      await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
    } catch (e) {
      await ctx.runMutation(internal.ingest.events.markFailed, {
        eventId, error: (e as Error).message || String(e),
      });
    }
    return jsonResponse({ ok: true, eventId });
  }),
});

http.route({
  path: "/webhooks/berdu",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "payload too large" }, 400);
    const sourceKeyParam = new URL(request.url).searchParams.get("source");
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, { sourceKey: sourceKeyParam || "berdu-pustakaislam" });
    if (!source || !source.enabled) { console.warn("[ingest] unknown/disabled source; acked 200 to avoid vendor auto-disable"); return jsonResponse({ ok: true, ignored: "unknown or disabled source" }, 200); }
    const sig = await verifySignature({
      header: request.headers.get("x-wafachat-signature"),
      rawBody, secret: source.secret, nowMs: Date.now(),
    });
    if (!sig.ok && source.enforceSignature) return jsonResponse({ ok: false, error: "invalid signature" }, 401);
    let parsedBody: any;
    try { parsedBody = JSON.parse(rawBody); } catch { return jsonResponse({ ok: false, error: "invalid json" }, 400); }

    // Thin payload (order_id only) -> enrich BEFORE capture so the stored
    // rawBody is the full order (replayable without re-fetching).
    // Berdu ENV creds are tenant #1's (spec §1.3): never enrich another org's
    // thin payload with tenant #1's Berdu account.
    const defaultOrgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
    let effectiveBody = rawBody;
    if (String(source.orgId) === String(defaultOrgId) &&
        !parsedBody.shipping_address && !parsedBody.order?.shipping_address && parsedBody.order_id) {
      const detail = await fetchBerduOrderDetail(String(parsedBody.order_id));
      if (detail) effectiveBody = JSON.stringify({ order: detail });
    }

    const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
      sourceKey: source.sourceKey, kind: "lead.created",
      rawHeaders: JSON.stringify({ "content-type": request.headers.get("content-type") ?? "" }),
      rawBody: effectiveBody, signatureOk: sig.ok,
      orgId: source.orgId,
    });
    try {
      await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
    } catch (e) {
      await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message || String(e) });
    }
    return jsonResponse({ ok: true, eventId });
  }),
});

function genericIngestRoute(path: string, kind: "generic.message" | "generic.lead") {
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const rawBody = await request.text();
      if (rawBody.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "payload too large" }, 400);
      const sourceKey = request.headers.get("x-wafachat-source") ?? "";
      const source = sourceKey
        ? await ctx.runQuery(internal.ingest.sources.getBySourceKey, { sourceKey })
        : null;
      if (!source || !source.enabled) { console.warn("[ingest] unknown/disabled source; acked 200 to avoid vendor auto-disable"); return jsonResponse({ ok: true, ignored: "unknown or disabled source" }, 200); }
      const sig = await verifySignature({
        header: request.headers.get("x-wafachat-signature"),
        rawBody, secret: source.secret, nowMs: Date.now(),
      });
      if (!sig.ok && source.enforceSignature) return jsonResponse({ ok: false, error: "invalid signature" }, 401);
      try { JSON.parse(rawBody); } catch { return jsonResponse({ ok: false, error: "invalid json" }, 400); }
      const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
        sourceKey: source.sourceKey, kind,
        rawHeaders: JSON.stringify({ "x-wafachat-source": sourceKey }),
        rawBody, signatureOk: sig.ok,
        orgId: source.orgId,
      });
      try {
        await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
      } catch (e) {
        await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message || String(e) });
      }
      return jsonResponse({ ok: true, eventId });
    }),
  });
}

genericIngestRoute("/ingest/message", "generic.message");
genericIngestRoute("/ingest/lead", "generic.lead");

export default http;
