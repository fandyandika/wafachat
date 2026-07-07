// Pure translation: KirimDev webhook payload -> universal message.event.
// 1:1 port of the proven n8n "Map to append_message" node (workflow STIyKl6dDgdZgKeh),
// with ONE deviation: CS attribution returns phoneNumberId; core resolves the CS
// name from csConfigs (n8n used a hardcoded map).

export type UniversalMessageEvent = {
  phone: string;
  content: string;
  direction: "inbound" | "outbound";
  role: "customer" | "cs" | "ai";
  messageType: "text";
  externalMessageId: string;
  createdAt: number;
  phoneNumberId?: string;
};

export type KirimdevParseResult =
  | { kind: "message"; event: UniversalMessageEvent }
  | { kind: "skip"; reason: string };

function skip(reason: string): KirimdevParseResult {
  return { kind: "skip", reason };
}

export function parseKirimdevWebhook(
  headers: Record<string, string>,
  body: unknown,
  nowMs: number,
): KirimdevParseResult {
  const b = (body ?? {}) as Record<string, any>;
  const event = headers["x-kirim-event"] || b.type || "";

  if (event === "message.sent") {
    const d = b.data ?? {};
    const m = d.message ?? {};
    if ((m.type || "text") !== "text") return skip("outbound not text");
    const phone = String(d.contact?.phone_number || m.to || "").replace(/^\+/, "");
    const content = m.body || "";
    if (!phone || !content) return skip("missing phone/content");
    const createdAt = d.timestamp ? Date.parse(d.timestamp) : nowMs;
    return {
      kind: "message",
      event: {
        phone,
        content,
        direction: "outbound",
        role: m.source === "dashboard" ? "cs" : "ai",
        messageType: "text",
        externalMessageId: String(m.provider_id || m.id || ""),
        createdAt: Number.isFinite(createdAt) ? createdAt : nowMs,
        phoneNumberId: (d.meta?.phone_number_id || d.session || undefined) as string | undefined,
      },
    };
  }

  if (event === "message.received") {
    const value = b.entry?.[0]?.changes?.[0]?.value ?? {};
    const msg = value.messages?.[0];
    if (!msg) return skip("inbound no message");
    let content = "";
    if (msg.type === "text") content = msg.text?.body || "";
    else if (msg.type === "button") content = msg.button?.text || "";
    else return skip(`inbound type ${msg.type}`);
    const kirim = b.kirim ?? {};
    const phone = String(
      value.contacts?.[0]?.wa_id || msg.from || kirim.contact?.phone_number || "",
    ).replace(/^\+/, "");
    if (!phone || !content) return skip("missing phone/content");
    return {
      kind: "message",
      event: {
        phone,
        content,
        direction: "inbound",
        role: "customer",
        messageType: "text",
        externalMessageId: String(msg.id || headers["x-kirim-event-id"] || ""),
        createdAt: msg.timestamp ? Number(msg.timestamp) * 1000 : nowMs,
        phoneNumberId: (value.metadata?.phone_number_id || undefined) as string | undefined,
      },
    };
  }

  return skip(`event ${event}`);
}
