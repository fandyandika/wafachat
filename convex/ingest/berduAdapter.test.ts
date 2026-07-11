import { describe, expect, test } from "vitest";
import { parseBerduOrderDetail, DEFAULT_BERDU_STAFF_MAP } from "./berduAdapter";

// Shape per the n8n "Build Backfill" node (proven against Berdu GET /order/detail).
const ORDER = {
  id: "O-260708000123",
  created_at: "2026-07-08T09:15:00+07:00",
  assigned_to_staff: "B-Z28TdYc",
  shipping_cost: 15000,
  total: 100000,
  shipping_address: {
    phone: "0857 9953 3626", firstName: "Kurn",
    address: "Jl. Mawar 1", district: "Coblong", city: "Bandung",
  },
  products: [{ name: "Buku Sirah", price: 85000, count: 1 }],
};

describe("parseBerduOrderDetail", () => {
  test("maps full order with normalized phone, rupiah strings, staff->CS", () => {
    const r = parseBerduOrderDetail(ORDER, DEFAULT_BERDU_STAFF_MAP);
    expect(r).toEqual({
      kind: "lead",
      event: {
        phone: "6285799533626",
        csName: "Azelia",
        customerName: "Kurn",
        productName: "Buku Sirah",
        products: "Buku Sirah (1x)",
        productsSubtotal: "Rp85.000",
        shippingCost: "Rp15.000",
        total: "Rp100.000",
        shippingAddress: "Jl. Mawar 1",
        shippingDistrict: "Coblong",
        shippingCity: "Bandung",
        orderId: "O-260708000123",
        createdAt: Date.parse("2026-07-08T09:15:00+07:00"),
      },
    });
  });
  test("unknown staff falls back to 'Staff <id>'", () => {
    const r = parseBerduOrderDetail({ ...ORDER, assigned_to_staff: "B-XXX" }, DEFAULT_BERDU_STAFF_MAP);
    expect(r.kind).toBe("lead");
    if (r.kind === "lead") expect(r.event.csName).toBe("Staff B-XXX");
  });
  test("missing shipping_address or phone skips", () => {
    expect(parseBerduOrderDetail({ id: "O-1" }, DEFAULT_BERDU_STAFF_MAP)).toEqual({ kind: "skip", reason: "no shipping_address" });
    expect(parseBerduOrderDetail({ ...ORDER, shipping_address: { firstName: "X" } }, DEFAULT_BERDU_STAFF_MAP))
      .toEqual({ kind: "skip", reason: "no phone" });
  });
  test("phone normalization: +62 stays, leading 0 -> 62, leading 8 -> 628", () => {
    const a = parseBerduOrderDetail({ ...ORDER, shipping_address: { ...ORDER.shipping_address, phone: "+6285799533626" } }, DEFAULT_BERDU_STAFF_MAP);
    if (a.kind === "lead") expect(a.event.phone).toBe("6285799533626");
    const b = parseBerduOrderDetail({ ...ORDER, shipping_address: { ...ORDER.shipping_address, phone: "85799533626" } }, DEFAULT_BERDU_STAFF_MAP);
    if (b.kind === "lead") expect(b.event.phone).toBe("6285799533626");
  });
  test("staff map is injected: a custom map wins over the default", () => {
    const r = parseBerduOrderDetail(ORDER, { [ORDER.assigned_to_staff]: "Tenant2CS" });
    expect(r.kind).toBe("lead");
    if (r.kind === "lead") expect(r.event.csName).toBe("Tenant2CS");
  });
});
