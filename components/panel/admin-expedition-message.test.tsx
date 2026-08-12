import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AdminExpeditionMessage } from "./admin-expedition-message";

function renderMessage(overrides: Partial<React.ComponentProps<typeof AdminExpeditionMessage>> = {}) {
  return renderToStaticMarkup(
    <AdminExpeditionMessage
      direction="outbound"
      messageType="text"
      content="Halo Kak, paket sedang kami periksa."
      status="accepted"
      actorName="Admin Ekspedisi"
      createdAt={Date.UTC(2026, 7, 12, 5, 30)}
      {...overrides}
    />,
  );
}

describe("AdminExpeditionMessage", () => {
  test("shows outbound delivery state and actor as text", () => {
    const html = renderMessage({ status: "read" });
    expect(html).toContain("Admin Ekspedisi");
    expect(html).toContain("Dibaca");
    expect(html).toContain("Halo Kak, paket sedang kami periksa.");
  });

  test("attaches failed and unknown recovery guidance to the affected message", () => {
    const failed = renderMessage({ status: "failed", failureReason: "Nomor tujuan tidak valid." });
    expect(failed).toContain("Nomor tujuan tidak valid.");
    expect(failed).toContain("Periksa pesan lalu kirim ulang sebagai pesan baru");

    const unknown = renderMessage({ status: "unknown", failureReason: "Respons KirimDev tidak lengkap." });
    expect(unknown).toContain("Status belum dapat dipastikan");
    expect(unknown).toContain("Periksa riwayat sebelum mengirim ulang");
  });

  test("keeps inbound messages visually and semantically distinct", () => {
    const html = renderMessage({ direction: "inbound", status: "delivered", actorName: undefined, content: "Baik Kak." });
    expect(html).toContain('data-direction="inbound"');
    expect(html).toContain("Pesan customer");
    expect(html).not.toContain("Diterima");
  });
});
