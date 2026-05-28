import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

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
      const result = await ctx.runQuery(api.state.health, {});
      return jsonResponse(result);
    }

    if (action === "set_order") {
      const result = await ctx.runMutation(api.state.upsertOrderFromN8n, {
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
      });
      return jsonResponse({ ...result, _action: "set_order" });
    }

    if (action === "get_with_global") {
      const result = await ctx.runQuery(api.state.getConversationContextForN8n, {
        phone: String(body.phone || ""),
        messageLimit: body.messageLimit ? Number(body.messageLimit) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "get") {
      const result = await ctx.runQuery(api.state.getConversationContextForN8n, {
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
      const result = await ctx.runMutation(api.state.setConversationStatusFromN8n, {
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
      const result = await ctx.runMutation(api.state.recordStatEventFromN8n, {
        field: body.field,
        phone: body.phone ? String(body.phone) : undefined,
        order_id: body.order_id ? String(body.order_id) : undefined,
        productName: body.productName ? String(body.productName) : undefined,
        date: body.date ? String(body.date) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "append_message") {
      const result = await ctx.runMutation(api.messages.appendMessageFromN8n, {
        phone: String(body.phone || ""),
        order_id: body.order_id ? String(body.order_id) : undefined,
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
      const result = await ctx.runMutation(api.shippingRecaps.upsertFromN8n, {
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
      const result = await ctx.runMutation(api.shippingRecaps.importBerduVerifiedRows, {
        importBatchId: String(body.importBatchId || `berdu-${Date.now()}`),
        rows: Array.isArray(body.rows) ? body.rows : [],
      });
      return jsonResponse(result);
    }


    if (action === "list_all") {
      const result = await ctx.runQuery(api.state.listConversations, {
        includeClosed: body.includeClosed === true || body.includeClosed === "true",
      });
      return jsonResponse({ success: true, conversations: result, _action: "list_all" });
    }

    if (action === "get_stats") {
      const result = await ctx.runQuery(api.state.getDailyStats, {
        date: body.date ? String(body.date) : undefined,
      });
      return jsonResponse(result);
    }

    if (action === "set_global") {
      const result = await ctx.runMutation(api.settings.setGlobalAiEnabled, {
        enabled: body.enabled !== false,
      });
      return jsonResponse({ ...result, _action: "set_global" });
    }

    if (action === "get_global") {
      const globalEnabled = await ctx.runQuery(api.settings.getGlobalAiEnabled, {});
      return jsonResponse({ success: true, globalEnabled, _action: "get_global" });
    }

    return jsonResponse({ success: false, error: `unsupported action: ${action}` }, 400);
  }),
});

export default http;
