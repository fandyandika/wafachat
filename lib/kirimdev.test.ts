import { describe, expect, test, vi } from "vitest";
import { buildTemplatePayload, buildTextPayload, sendKirimDevMessage } from "./kirimdev";

describe("KirimDev admin inbox payloads", () => {
  test("builds positional template parameters in the configured order", () => {
    expect(buildTemplatePayload("6285715682110", "status_paket", "id", ["Fandi", "JP123"])).toEqual({
      messaging_product: "whatsapp",
      to: "6285715682110",
      type: "template",
      template: {
        name: "status_paket",
        language: "id",
        components: [{
          type: "body",
          parameters: [{ type: "text", text: "Fandi" }, { type: "text", text: "JP123" }],
        }],
      },
    });
  });

  test("builds a session text payload", () => {
    expect(buildTextPayload("6285715682110", "Baik, kami cek dulu ya.")).toEqual({
      messaging_product: "whatsapp",
      to: "6285715682110",
      type: "text",
      text: { body: "Baik, kami cek dulu ya." },
    });
  });

  test("returns the provider message id on acceptance", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out.1" }] }), { status: 200 }));
    const result = await sendKirimDevMessage({
      apiKey: "secret",
      baseUrl: "https://api.test/v1",
      phoneNumberId: "pn_admin",
      payload: buildTextPayload("6285715682110", "Halo"),
      idempotencyKey: "admin-text-org-request",
      request,
    });
    expect(result).toEqual({ ok: true, providerMessageId: "wamid.out.1" });
    expect(request).toHaveBeenCalledWith("https://api.test/v1/pn_admin/messages", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "admin-text-org-request" }),
    }));
  });

  test("returns the provider message id from KirimDev's data envelope", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      data: { id: "wamid.out.enveloped" },
      request_id: "req-1",
    }), { status: 200 }));

    const result = await sendKirimDevMessage({
      apiKey: "secret",
      baseUrl: "https://api.test/v1",
      phoneNumberId: "pn_admin",
      payload: buildTextPayload("6285715682110", "Halo"),
      idempotencyKey: "admin-text-enveloped",
      request,
    });

    expect(result).toEqual({ ok: true, providerMessageId: "wamid.out.enveloped" });
  });

  test("maps provider rejection and treats transport failure as unknown", async () => {
    const rejected = await sendKirimDevMessage({
      apiKey: "secret",
      baseUrl: "https://api.test/v1",
      phoneNumberId: "pn_admin",
      payload: buildTextPayload("6285715682110", "Halo"),
      idempotencyKey: "request-1",
      request: vi.fn(async () => new Response(JSON.stringify({ error: { code: "template_not_found" } }), { status: 400 })),
    });
    expect(rejected).toEqual({ ok: false, error: "Template KirimDev tidak ditemukan atau belum disetujui.", statusUnknown: false });

    const unknown = await sendKirimDevMessage({
      apiKey: "secret",
      baseUrl: "https://api.test/v1",
      phoneNumberId: "pn_admin",
      payload: buildTextPayload("6285715682110", "Halo"),
      idempotencyKey: "request-2",
      request: vi.fn(async () => { throw new Error("timeout"); }),
    });
    expect(unknown).toEqual({
      ok: false,
      error: "Status pengiriman belum diketahui. Periksa riwayat sebelum mencoba lagi.",
      statusUnknown: true,
    });
  });
});
