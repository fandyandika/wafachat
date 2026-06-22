import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseClosingMessage } from "./shippingRecaps";

const t0 = 1_750_000_000_000;

test("backfillFromMessages still upserts one recap for an outbound PEMESANAN BERHASIL", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", {
      orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
      status: "active", aiEnabled: true, note: "", createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("messages", {
      conversationId: convId, orderId: "O-1", customerPhone: "62811", role: "cs",
      direction: "outbound", content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
      messageType: "text", source: "n8n", externalMessageId: "msg_1", createdAt: t0,
    });
  });
  const res = await t.mutation(api.shippingRecaps.backfillFromMessages, {});
  expect(res.upserted).toBe(1);
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  expect(recaps[0].orderIdBerdu).toBe("O-1");
});

test("parseClosingMessage: Aisyah template (Pembayaran:/Produk:/Total:)", () => {
  const text = [
    "Siap kak, pesanan bukunya sudah berhasil kami terima 🙏",
    "",
    "*PEMESANAN BERHASIL*",
    "Pembayaran: `COD / Bayar di Tempat`",
    "",
    "Detail pesanan:",
    "Produk: *Quran Mapping (1x)*",
    "Harga: *Rp179.000*",
    "Ongkir: Rp19.000",
    "*Total: Rp198.000*",
    "",
    "📦 Dikirim ke:",
    "Dadang Tasripin | 6285163546727",
    "Perumahan Pilahan, Kotagede, Kota Yogyakarta",
  ].join("\n");
  const p = parseClosingMessage(text);
  expect(p.paymentMethod).toBe("cod");
  expect(p.packageContent).toBe("Quran Mapping (1x)");
  expect(p.total).toBe(198000);
});

test("parseClosingMessage: CS template (header product / Harga / PEMBAYARAN)", () => {
  const text = [
    "*PEMESANAN BERHASIL*",
    "",
    "Nama : Kasiyanto",
    "No HP : +62 812-3456-605",
    "Alamat : JL. Pahlawan, Jombang, Kab. Jombang",
    "",
    "*QURAN MAPPING 1 PCS*",
    "Harga Rp. *205.000*",
    "",
    "PEMBAYARAN TRANSFER",
  ].join("\n");
  const p = parseClosingMessage(text);
  expect(p.paymentMethod).toBe("transfer");
  expect(p.packageContent).toBe("QURAN MAPPING 1 PCS");
  expect(p.total).toBe(205000);
});

test("parseClosingMessage: CS template COD uses Harga as total", () => {
  const text = [
    "Semoga lancar rezeki dan sehat selalu,",
    "Baarakallahu fiik 🙏",
    "",
    "*PEMESANAN BERHASIL*",
    "",
    "Nama : Zainani",
    "No HP : 6281370911120",
    "Alamat : Jln Setiabudi, Jatinunggal, Kab. Sumedang",
    "",
    "*QURAN MAPPING 1 PCS*",
    "Harga Rp.197.000",
    "",
    "PEMBAYARAN COD",
  ].join("\n");
  const p = parseClosingMessage(text);
  expect(p.paymentMethod).toBe("cod");
  expect(p.packageContent).toBe("QURAN MAPPING 1 PCS");
  expect(p.total).toBe(197000);
  expect(p.codValue).toBe(197000);
});

test("getPerformance: closing groups under the order product name, not the message SKU", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", {
      orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "Risma",
      productName: "Quran Mapping", products: "Quran Mapping", productsSubtotal: "", shippingCost: "",
      total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu",
      aiEligible: true, createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("shippingRecaps", {
      orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "Risma",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "QURAN MAPPING 1 PCS", paymentMethod: "transfer",
      nonCodItemPrice: 200000, total: 200000, status: "ready", flags: [], sourceMessageText: "",
      version: 1, createdAt: t0, updatedAt: t0,
    });
  });
  const perf = await t.query(api.shippingRecaps.getPerformance, { startAt: t0 - 1000, endAt: t0 + 1000 });
  const names = perf.products.map((row) => row.product);
  expect(names).toContain("Quran Mapping");
  expect(names).not.toContain("QURAN MAPPING 1 PCS");
  const row = perf.products.find((p) => p.product === "Quran Mapping")!;
  expect(row.leads).toBe(1);
  expect(row.closing).toBe(1);
});
