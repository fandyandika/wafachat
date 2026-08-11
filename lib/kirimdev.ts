type KirimDevPayload = Record<string, unknown>;

type SendArgs = {
  apiKey: string;
  baseUrl: string;
  phoneNumberId: string;
  payload: KirimDevPayload;
  idempotencyKey: string;
  request?: typeof fetch;
};

export type KirimDevSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; statusUnknown: boolean };

const ERROR_MESSAGES: Record<string, string> = {
  template_not_found: "Template KirimDev tidak ditemukan atau belum disetujui.",
  invalid_parameter: "Parameter template tidak valid.",
  recipient_not_found: "Nomor tujuan tidak dapat ditemukan.",
  rate_limit_exceeded: "Batas pengiriman KirimDev sedang tercapai. Coba beberapa saat lagi.",
};

export function buildTemplatePayload(to: string, templateName: string, language: string, orderedValues: string[]): KirimDevPayload {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language,
      components: [{
        type: "body",
        parameters: orderedValues.map((text) => ({ type: "text", text })),
      }],
    },
  };
}

export function buildTextPayload(to: string, text: string): KirimDevPayload {
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
}

function providerMessageId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = body as Record<string, unknown>;
  const data = value.data;
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).id === "string") {
    return (data as Record<string, unknown>).id as string;
  }
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const first = messages[0];
  if (first && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string") {
    return (first as Record<string, unknown>).id as string;
  }
  for (const key of ["message_id", "messageId", "id"]) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return undefined;
}

export async function sendKirimDevMessage(args: SendArgs): Promise<KirimDevSendResult> {
  const request = args.request ?? fetch;
  let response: Response;
  try {
    response = await request(`${args.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(args.phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify(args.payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return {
      ok: false,
      error: "Status pengiriman belum diketahui. Periksa riwayat sebelum mencoba lagi.",
      statusUnknown: true,
    };
  }

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : undefined;
    const code = typeof error?.code === "string" ? error.code : undefined;
    return {
      ok: false,
      error: (code && ERROR_MESSAGES[code]) || `KirimDev menolak pengiriman${code ? ` (${code})` : ""}.`,
      statusUnknown: false,
    };
  }

  const id = providerMessageId(body);
  if (!id) {
    return {
      ok: false,
      error: "KirimDev menerima permintaan tanpa ID pesan. Periksa riwayat sebelum mencoba lagi.",
      statusUnknown: true,
    };
  }
  return { ok: true, providerMessageId: id };
}
