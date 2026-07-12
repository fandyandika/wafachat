import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseClosingMessage, canonicalizeProduct } from "./shippingRecaps";

const t0 = 1_750_000_000_000;

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

test("canonicalizeProduct: SKU-style closing names collapse into the order's canonical product", () => {
  // Each SKU fragment (orphan closing) maps to the same canonical name the leads use.
  expect(canonicalizeProduct("QURAN MAPPING 1 PCS")).toBe("Quran Mapping");
  expect(canonicalizeProduct("Quran Mapping")).toBe("Quran Mapping");
  expect(canonicalizeProduct("QURAN MEDIS 1 PCS")).toBe("Al Qur'an Medis [A5] dengan Hadis Medis + Jurnal Kesehatan");
  expect(canonicalizeProduct("Al Qur'an Medis [A5] dengan Hadis Medis + Jurnal Kesehatan")).toBe("Al Qur'an Medis [A5] dengan Hadis Medis + Jurnal Kesehatan");
  expect(canonicalizeProduct("BUKU 7 SURAT PILIHAN 1 PCS")).toBe("7 Surat Istimewa");
  expect(canonicalizeProduct("BUKU LEARNING SHALAT 1 PCS")).toBe("Sound Book: Learning How To Do Shalat");
  expect(canonicalizeProduct("BUKU TULIS TAZYIN 3 PAKET LENGKAP")).toBe("Alquran Tulis Tazyin 1 Jilid");
  expect(canonicalizeProduct("BUKU KUMPULAN DOA ACARA 1 PCS")).toBe("Kumpulan Doa Berbagai Acara & Keperluan");
  // Unknown products fall through unchanged — never mis-merged.
  expect(canonicalizeProduct("Buku Iqro Jilid 1")).toBe("Buku Iqro Jilid 1");
  expect(canonicalizeProduct(undefined)).toBe("Tanpa Data Produk");
});

test("backfillFromMessages still upserts one recap for an outbound PEMESANAN BERHASIL", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", {
      orgId, orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
      status: "active", aiEnabled: true, note: "", createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("messages", {
      orgId, conversationId: convId, orderId: "O-1", customerPhone: "62811", role: "cs",
      direction: "outbound", content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
      messageType: "text", source: "n8n", externalMessageId: "msg_1", createdAt: t0,
    });
  });
  const res = await asAdmin.mutation(api.shippingRecaps.backfillFromMessages, {});
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
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", {
      orgId, orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "Risma",
      productName: "Quran Mapping", products: "Quran Mapping", productsSubtotal: "", shippingCost: "",
      total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu",
      aiEligible: true, createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "Risma",
      closedAt: t0, recipientName: "A", recipientPhone: "62811", recipientAddress: "", recipientDistrict: "",
      recipientCity: "", packageContent: "QURAN MAPPING 1 PCS", paymentMethod: "transfer",
      nonCodItemPrice: 200000, total: 200000, status: "ready", flags: [], sourceMessageText: "",
      version: 1, createdAt: t0, updatedAt: t0,
    });
  });
  const perf = await asAdmin.query(api.shippingRecaps.getPerformance, { startAt: t0 - 1000, endAt: t0 + 1000 });
  const names = perf.products.map((row) => row.product);
  expect(names).toContain("Quran Mapping");
  expect(names).not.toContain("QURAN MAPPING 1 PCS");
  const row = perf.products.find((p) => p.product === "Quran Mapping")!;
  expect(row.leads).toBe(1);
  expect(row.closing).toBe(1);
});

test("renameCsName: renames CS across orders/recaps/conversations, others untouched", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const ord = { products: "", productName: "Q", productsSubtotal: "", shippingCost: "", total: "", shippingAddress: "", shippingDistrict: "", shippingCity: "", source: "berdu" as const, aiEligible: true, createdAt: t0, updatedAt: t0 };
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("orders", { orgId, ...ord, orderId: "O-1", customerName: "A", customerPhone: "62811", assignedCsName: "Afisah" });
    await ctx.db.insert("orders", { orgId, ...ord, orderId: "O-2", customerName: "B", customerPhone: "62812", assignedCsName: "Lila" });
    await ctx.db.insert("shippingRecaps", { orgId, orderIdBerdu: "O-1", customerPhone: "62811", customerName: "A", csName: "Afisah", recipientName: "A", recipientPhone: "x", recipientAddress: "", recipientDistrict: "", recipientCity: "", packageContent: "Q", paymentMethod: "cod" as const, flags: [], sourceMessageText: "", version: 1, closedAt: t0, status: "ready" as const, createdAt: t0, updatedAt: t0 });
    await ctx.db.insert("conversations", { orgId, orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "Afisah", status: "active" as const, aiEnabled: false, note: "", createdAt: t0, updatedAt: t0 });
  });
  const res = await asAdmin.mutation(api.shippingRecaps.renameCsName, { from: "Afisah", to: "Nabila" });
  expect(res).toEqual({ from: "Afisah", to: "Nabila", orders: 1, recaps: 1, conversations: 1 });
  await t.run(async (ctx) => {
    const o1 = await ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-1")).unique();
    expect(o1!.assignedCsName).toBe("Nabila");
    const o2 = await ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", "O-2")).unique();
    expect(o2!.assignedCsName).toBe("Lila"); // untouched
    const rec = (await ctx.db.query("shippingRecaps").collect())[0];
    expect(rec.csName).toBe("Nabila");
  });
});

test("importBerduVerifiedRows: canonicalizes raw csName through the registry (alias/case forms)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  // Seed a csConfigs row with key and nameAliases
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: ["CS Aisyah", "cs aisyah"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  // Import a verified row with raw csName "cs aisyah" (alias form)
  await t.run(async (ctx: any) => {
    const { internal } = await import("./_generated/api");
    await ctx.runMutation(internal.shippingRecaps.importBerduVerifiedRows, {
      rows: [{
        orderIdBerdu: "BERDU-001", customerPhone: "62811111", recipientPhone: "62811111",
        customerName: "Test", recipientName: "Test", recipientAddress: "X", recipientDistrict: "Y", recipientCity: "Z",
        csName: "cs aisyah",  // raw alias form
        packageContent: "Book", paymentMethod: "cod", itemPrice: 100000, total: 100000, shippingCost: 10000,
        closedAt: t0, orderedAt: t0, sourceMessageText: "",
      }],
      importBatchId: "batch-1",
    });
  });
  const recaps = await t.run(async (ctx: any) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  expect(recaps[0].csName).toBe("Aisyah");  // canonical form
  expect(recaps[0].csKey).toBe("aisyah");   // immutable key
});
