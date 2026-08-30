export type UniversalScalevOrder = {
  internalOrderId: string;
  externalOrderId: string;
  providerRecordId: string;
  phone: string;
  csName: string;
  handlerId?: string;
  customerName: string;
  productName: string;
  products: string;
  productsSubtotal: string;
  shippingCost: string;
  total: string;
  shippingAddress: string;
  shippingDistrict: string;
  shippingCity: string;
  orderStatus?: string;
  paymentStatus?: string;
  createdAt?: number;
};

export type ScalevParseResult =
  | { kind: "order"; eventId: string; eventType: string; event: UniversalScalevOrder }
  | { kind: "test"; eventId: string }
  | { kind: "skip"; reason: string };

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function cleanString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = String(value).trim();
  return cleaned || undefined;
}

function normalizePhone(value: unknown): string | null {
  const digits = cleanString(value)?.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function formatRupiah(value: unknown): string {
  const amount = Number(value ?? 0);
  return `Rp${(Number.isFinite(amount) ? amount : 0).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function extractHandler(data: Record<string, any>): { id?: string; name?: string } {
  const handler = data.handler;
  if (typeof handler === "string" || typeof handler === "number") {
    return { id: cleanString(handler) };
  }
  const record = asRecord(handler);
  return {
    id: cleanString(data.handler_id ?? record.id ?? record.unique_id ?? record.code),
    name: cleanString(data.handler_name ?? record.name ?? record.display_name),
  };
}

export function parseScalevOrderHandler(input: unknown): { handlerId: string; handlerName?: string } | null {
  const order = asRecord(input);
  const handler = asRecord(order.handler);
  const handlerId = cleanString(handler.id);
  if (!handlerId) return null;
  return {
    handlerId,
    handlerName: cleanString(handler.fullname ?? handler.name ?? handler.display_name),
  };
}

function productRows(data: Record<string, any>): Array<{ name: string; quantity: number }> {
  if (Array.isArray(data.orderlines) && data.orderlines.length > 0) {
    return data.orderlines.flatMap((line: unknown) => {
      const row = asRecord(line);
      const name = cleanString(row.product_name ?? row.name);
      if (!name) return [];
      const quantity = Math.max(1, Math.trunc(Number(row.quantity ?? 1)) || 1);
      return [{ name, quantity }];
    });
  }
  const variants = asRecord(data.final_variants);
  return Object.entries(variants).map(([name, quantity]) => ({
    name,
    quantity: Math.max(1, Math.trunc(Number(quantity)) || 1),
  }));
}

export function parseScalevOrderEvent(
  input: unknown,
  handlerMap: Record<string, string>,
): ScalevParseResult {
  const payload = asRecord(input);
  const eventType = cleanString(payload.event);
  const eventId = cleanString(payload.unique_id);
  if (!eventType) return { kind: "skip", reason: "missing event type" };
  if (!eventId) return { kind: "skip", reason: "missing event id" };
  if (eventType === "business.test_event") return { kind: "test", eventId };
  if (!eventType.startsWith("order.") && !eventType.startsWith("payment.")) {
    return { kind: "skip", reason: `unsupported Scalev event ${eventType}` };
  }

  const data = asRecord(payload.data);
  const providerRecordId = cleanString(data.id ?? data.order_uuid);
  const externalOrderId = cleanString(data.order_id ?? providerRecordId);
  const stableProviderId = providerRecordId ?? externalOrderId;
  if (!stableProviderId || !externalOrderId) return { kind: "skip", reason: "missing order identity" };

  const address = asRecord(data.destination_address);
  const phone = normalizePhone(address.phone ?? data.customer_phone);
  if (!phone) return { kind: "skip", reason: "missing customer phone" };
  const handler = extractHandler(data);
  const products = productRows(data);
  const createdAt = Date.parse(cleanString(data.created_at) ?? cleanString(payload.timestamp) ?? "");
  const fallbackCsName = handler.name ?? (handler.id ? `Scalev ${handler.id}` : "Scalev Unassigned");

  return {
    kind: "order",
    eventId,
    eventType,
    event: {
      internalOrderId: `scalev:${stableProviderId}`,
      externalOrderId,
      providerRecordId: stableProviderId,
      phone,
      csName: handler.id ? handlerMap[handler.id] ?? fallbackCsName : fallbackCsName,
      handlerId: handler.id,
      customerName: cleanString(address.name ?? data.customer_name) ?? "Pelanggan",
      productName: products[0]?.name ?? "",
      products: products.map((product) => `${product.name} (${product.quantity}x)`).join(", "),
      productsSubtotal: formatRupiah(data.product_price),
      shippingCost: formatRupiah(data.shipping_cost),
      total: formatRupiah(data.gross_revenue ?? data.total),
      shippingAddress: cleanString(address.address) ?? "",
      shippingDistrict: cleanString(address.subdistrict ?? address.district) ?? "",
      shippingCity: cleanString(address.city) ?? "",
      orderStatus: cleanString(data.status),
      paymentStatus: cleanString(data.payment_status),
      createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
    },
  };
}
