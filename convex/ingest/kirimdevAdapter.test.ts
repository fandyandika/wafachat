import { describe, expect, test } from "vitest";
import { parseKirimdevWebhook } from "./kirimdevAdapter";

const NOW = 1783443000000;

// Real message.received payload captured from production (n8n execution 223992),
// phone/name/text kept verbatim — this is the shape KirimDev actually sends.
const RECEIVED_BODY = {
  object: "whatsapp_business_account",
  entry: [{
    id: "563030666884136",
    changes: [{
      field: "messages",
      value: {
        contacts: [{ wa_id: "6285799533626", profile: { name: "Kurn" } }],
        messages: [{
          id: "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
          from: "6285799533626",
          text: { body: "Belom dulu min" },
          type: "text",
          timestamp: "1783427359",
        }],
        metadata: { phone_number_id: "485071188032281", display_phone_number: "+62 821-1351-5152" },
        messaging_product: "whatsapp",
      },
    }],
  }],
  kirim: {
    contact: { name: "Kurn", phone_number: "+6285799533626" },
    message_id: "msg_86HD2ZRSEVJK3NWQT1XTCZMSW6",
    conversation_id: "cnv_WNYBPWH82YHPH8828JVJ8JMK7E",
    phone_number_id: "485071188032281",
  },
};

const RECEIVED_HEADERS = {
  "x-kirim-event": "message.received",
  "x-kirim-event-id": "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
};

// message.sent shape per the proven n8n mapper contract (spec §5, risk table
// notes the raw shape gets re-verified from dual-run captures).
const SENT_BODY = {
  type: "message.sent",
  data: {
    contact: { phone_number: "+6285799533626" },
    message: {
      id: "msg_ABC", provider_id: "wamid.SENT123", to: "+6285799533626",
      body: "PEMESANAN BERHASIL\nTerima kasih kak", type: "text", source: "dashboard",
    },
    timestamp: "2026-07-07T12:29:19.000Z",
    meta: { phone_number_id: "485071188032281" },
  },
};

describe("message.received", () => {
  test("maps to inbound customer event with original timestamp", () => {
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, RECEIVED_BODY, NOW);
    expect(r).toEqual({
      kind: "message",
      event: {
        phone: "6285799533626",
        content: "Belom dulu min",
        direction: "inbound",
        role: "customer",
        messageType: "text",
        externalMessageId: "wamid.HBgNNjI4NTc5OTUzMzYyNhUCABIYIEFDRDVFNTQyNjlFOThGQ0IwNDBDMzFBRjdBREQzMEQ3AA==",
        createdAt: 1783427359000,
        phoneNumberId: "485071188032281",
      },
    });
  });

  test("button message uses button.text", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages[0] = {
      id: "wamid.BTN", from: "6285799533626", type: "button",
      button: { text: "Ya, lanjutkan" }, timestamp: "1783427360",
    };
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW);
    expect(r.kind).toBe("message");
    if (r.kind === "message") expect(r.event.content).toBe("Ya, lanjutkan");
  });

  test("media inbound skips with type reason", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages[0].type = "image";
    const r = parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW);
    expect(r).toEqual({ kind: "skip", reason: "inbound type image" });
  });

  test("no message in payload skips", () => {
    const body = structuredClone(RECEIVED_BODY) as any;
    body.entry[0].changes[0].value.messages = [];
    expect(parseKirimdevWebhook(RECEIVED_HEADERS, body, NOW)).toEqual({
      kind: "skip", reason: "inbound no message",
    });
  });
});

describe("message.sent", () => {
  test("dashboard source maps to role cs, outbound, provider_id, parsed timestamp", () => {
    const r = parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, SENT_BODY, NOW);
    expect(r).toEqual({
      kind: "message",
      event: {
        phone: "6285799533626",
        content: "PEMESANAN BERHASIL\nTerima kasih kak",
        direction: "outbound",
        role: "cs",
        messageType: "text",
        externalMessageId: "wamid.SENT123",
        createdAt: Date.parse("2026-07-07T12:29:19.000Z"),
        phoneNumberId: "485071188032281",
      },
    });
  });

  test("non-dashboard source maps to role ai", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.source = "api";
    const r = parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW);
    expect(r.kind).toBe("message");
    if (r.kind === "message") expect(r.event.role).toBe("ai");
  });

  test("non-text outbound skips", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.type = "image";
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW)).toEqual({
      kind: "skip", reason: "outbound not text",
    });
  });

  test("event type from body.type when header missing", () => {
    const r = parseKirimdevWebhook({}, SENT_BODY, NOW);
    expect(r.kind).toBe("message");
  });
});

describe("edge cases", () => {
  test("unknown event skips", () => {
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.status" }, {}, NOW)).toEqual({
      kind: "skip", reason: "event message.status",
    });
  });
  test("missing phone/content skips", () => {
    const body = structuredClone(SENT_BODY) as any;
    body.data.message.body = "";
    expect(parseKirimdevWebhook({ "x-kirim-event": "message.sent" }, body, NOW)).toEqual({
      kind: "skip", reason: "missing phone/content",
    });
  });
});
