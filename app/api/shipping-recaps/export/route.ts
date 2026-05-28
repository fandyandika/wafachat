import { NextResponse } from "next/server";

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function isoDate(value: unknown): string {
  if (!value || typeof value !== "number") return "";
  return new Date(value).toISOString();
}

export async function POST(request: Request) {
  const body = await request.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = [
    "Nama Pengirim",
    "No Telp. Pengirim",
    "Nama Penerima",
    "Alamat Penerima",
    "No Telp. Penerima",
    "Kecamatan Penerima",
    "Kota Penerima",
    "Isi Paket",
    "Metode Bayar",
    "Harga Barang (jika non-COD)",
    "Nilai COD (Jika COD)",
    "Diskon (opt)",
    "Instruksi Pengiriman (opt)",
    "Tanggal customer order",
    "Tanggal closing",
    "Order ID Berdu",
    "Bump Order/Upsale/Bonus Khusus (opt)",
  ];

  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row: any) =>
      [
        row.csName,
        row.csPhone,
        row.recipientName,
        row.recipientAddress,
        row.recipientPhone,
        row.recipientDistrict,
        row.recipientCity,
        row.packageContent,
        row.paymentMethod === "cod" ? "COD" : "TRANSFER",
        row.paymentMethod === "transfer" ? row.nonCodItemPrice ?? row.total ?? "" : "",
        row.paymentMethod === "cod" ? row.codValue ?? row.total ?? "" : "",
        row.discount ?? "",
        row.shippingInstruction ?? "",
        isoDate(row.orderedAt),
        isoDate(row.closedAt),
        row.orderIdBerdu ?? "",
        [row.bumpOrder, row.upsell, row.specialBonus].filter(Boolean).join(" | "),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="wafachat-rekap-pengiriman.csv"',
    },
  });
}
