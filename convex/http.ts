import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { verifySignature } from "./ingest/signature";

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
      const result = await ctx.runQuery(internal.state.listOrderCountersByPrefix, {
        datePrefix: String(body.datePrefix || ""),
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
      const result = await ctx.runMutation(internal.shippingRecaps.markLatestCancelledByPhone, {
        customerPhone: String(body.customerPhone || body.phone || ""),
        orderIdBerdu: body.orderIdBerdu || body.order_id ? String(body.orderIdBerdu || body.order_id) : undefined,
        reason: body.reason ? String(body.reason) : undefined,
      });
      return jsonResponse({ ...result, _action: "cancel_shipping_recap" });
    }


    if (action === "list_all") {
      const result = await ctx.runQuery(internal.state.listConversations, {
        includeClosed: body.includeClosed === true || body.includeClosed === "true",
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
      const result = await ctx.runMutation(internal.settings.setGlobalAiEnabled, {
        enabled: body.enabled !== false,
      });
      return jsonResponse({ ...result, _action: "set_global" });
    }

    if (action === "get_global") {
      const globalEnabled = await ctx.runQuery(internal.settings.getGlobalAiEnabled, {});
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
    const source = await ctx.runQuery(internal.ingest.sources.getBySourceKey, {
      sourceKey: "kirimdev-pustakaislam",
    });
    if (!source || !source.enabled) return jsonResponse({ ok: false, error: "unknown source" }, 404);

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

export default http;
