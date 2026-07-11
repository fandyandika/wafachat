// Pure translation: Berdu order detail JSON -> universal lead.created.
// Port of n8n "Build Backfill" (reconciler) / "Normalize Order Data" (order trigger).

export type UniversalLeadEvent = {
  phone: string; csName: string; customerName: string;
  productName: string; products: string; productsSubtotal: string;
  shippingCost: string; total: string;
  shippingAddress: string; shippingDistrict: string; shippingCity: string;
  orderId: string; createdAt?: number;
};

export type BerduParseResult =
  | { kind: "lead"; event: UniversalLeadEvent }
  | { kind: "skip"; reason: string };

// Tenant #1's inherited glue, now the FALLBACK only: the live map is built from
// csConfigs.berduStaffIds (see resolveBerduStaffMap in core.ts). Used verbatim when
// no csConfig row carries staff ids yet (fresh env / pre-seed transition).
export const DEFAULT_BERDU_STAFF_MAP: Record<string, string> = {
  "B-1apQSy": "Aisyah",
  "B-1CxSmL": "Risma",
  "B-Z28TdYc": "Azelia",
  "B-NCIXt": "Lila",
  "B-ZDfQE9": "Nabila",
};

function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  return String(raw).replace(/\s+/g, "").replace(/^\+/, "").replace(/^0/, "62").replace(/^8/, "628");
}

function formatRupiah(num: unknown): string {
  return "Rp" + Number(num || 0).toLocaleString("id-ID");
}

export function parseBerduOrderDetail(orderInput: unknown, staffMap: Record<string, string>): BerduParseResult {
  const order = (orderInput ?? {}) as Record<string, any>;
  if (!order.id || !order.shipping_address) return { kind: "skip", reason: "no shipping_address" };
  const addr = order.shipping_address ?? {};
  const phone = normalizePhone(addr.phone);
  if (!phone) return { kind: "skip", reason: "no phone" };
  const products: any[] = order.products ?? [];
  const productsSubtotal = products.reduce((s, p) => s + p.price * p.count, 0);
  const staff = order.assigned_to_staff;
  const createdAt = order.created_at ? Date.parse(order.created_at) : undefined;
  return {
    kind: "lead",
    event: {
      phone,
      csName: staffMap[staff] || `Staff ${staff || "?"}`,
      customerName: addr.firstName || "Pelanggan",
      productName: products[0]?.name || "",
      products: products.map((p) => `${p.name} (${p.count}x)`).join(", "),
      productsSubtotal: formatRupiah(productsSubtotal),
      shippingCost: formatRupiah(order.shipping_cost),
      total: formatRupiah(order.total),
      shippingAddress: addr.address || "",
      shippingDistrict: addr.district || "",
      shippingCity: addr.city || "",
      orderId: String(order.id),
      createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
    },
  };
}
