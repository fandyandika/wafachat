import { describe, expect, test } from "vitest";
import { parseScalevOrderEvent, parseScalevOrderHandler } from "./scalevAdapter";

const SCALEV_EVENT = {
  event: "order.created",
  unique_id: "event_scalev_001",
  timestamp: "2026-08-27T08:00:05.000Z",
  data: {
    id: "0198-scalev-order-id",
    order_id: "260827ABC123",
    status: "pending",
    payment_status: "unpaid",
    gross_revenue: "189000.00",
    product_price: "179000.00",
    shipping_cost: "10000.00",
    final_variants: { "Quran Mapping": 1 },
    handler: { id: "482913", name: "CS Scalev Aisyah" },
    destination_address: {
      name: "Fandi",
      phone: "0857 1568 2110",
      address: "Tambun Utara",
      subdistrict: "Tambun Utara",
      city: "Kab. Bekasi",
    },
    orderlines: [{ product_name: "Quran Mapping", quantity: 1 }],
    created_at: "2026-08-27T15:00:00+07:00",
  },
};

describe("parseScalevOrderEvent", () => {
  test("reads the assigned handler from the official Scalev order detail response", () => {
    expect(parseScalevOrderHandler({
      id: "0198-scalev-order-id",
      handler: { id: 104794, fullname: "Aisyah" },
    })).toEqual({ handlerId: "104794", handlerName: "Aisyah" });

    expect(parseScalevOrderHandler({ id: "0198-scalev-order-id", handler: null })).toBeNull();
  });

  test("normalizes a Scalev order without changing the provider order identity", () => {
    expect(parseScalevOrderEvent(SCALEV_EVENT, { "482913": "Aisyah" })).toEqual({
      kind: "order",
      eventId: "event_scalev_001",
      eventType: "order.created",
      event: {
        internalOrderId: "scalev:0198-scalev-order-id",
        externalOrderId: "260827ABC123",
        providerRecordId: "0198-scalev-order-id",
        phone: "6285715682110",
        csName: "Aisyah",
        handlerId: "482913",
        customerName: "Fandi",
        productName: "Quran Mapping",
        products: "Quran Mapping (1x)",
        productsSubtotal: "Rp179.000",
        shippingCost: "Rp10.000",
        total: "Rp189.000",
        shippingAddress: "Tambun Utara",
        shippingDistrict: "Tambun Utara",
        shippingCity: "Kab. Bekasi",
        orderStatus: "pending",
        paymentStatus: "unpaid",
        createdAt: Date.parse("2026-08-27T15:00:00+07:00"),
      },
    });
  });

  test("uses a stable handler name fallback and rejects malformed events", () => {
    const withUnknownHandler = structuredClone(SCALEV_EVENT);
    withUnknownHandler.data.handler = { id: "999999", name: "Salwa" };
    const parsed = parseScalevOrderEvent(withUnknownHandler, {});
    expect(parsed.kind).toBe("order");
    if (parsed.kind === "order") expect(parsed.event.csName).toBe("Salwa");

    expect(parseScalevOrderEvent({ event: "order.created", unique_id: "evt", data: {} }, {}))
      .toEqual({ kind: "skip", reason: "missing order identity" });
    expect(parseScalevOrderEvent({ event: "business.test_event", unique_id: "test", data: {} }, {}))
      .toEqual({ kind: "test", eventId: "test" });
  });
});
