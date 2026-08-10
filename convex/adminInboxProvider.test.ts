import { expect, test } from "vitest";
import { parseAdminKirimdevEvent } from "./adminInboxProvider";

test("parses an inbound KirimDev message for the admin number", () => {
  const result = parseAdminKirimdevEvent({ "x-kirim-event": "message.received", "x-kirim-event-id": "evt-1" }, {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "pn-admin" },
      contacts: [{ wa_id: "6285715682110", profile: { name: "Fandi" } }],
      messages: [{ id: "wamid.in.1", from: "6285715682110", type: "text", text: { body: "Paket saya di mana?" }, timestamp: "1786370400" }],
    } }] }],
  }, 1);
  expect(result).toEqual({
    kind: "inbound", providerNumberId: "pn-admin", customerPhone: "6285715682110",
    customerName: "Fandi", content: "Paket saya di mana?", providerMessageId: "wamid.in.1",
    providerEventId: "evt-1", createdAt: 1_786_370_400_000,
  });
});

test("parses delivery status and rejects events without a provider number", () => {
  expect(parseAdminKirimdevEvent({ "x-kirim-event": "message.status" }, {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "pn-admin" },
      statuses: [{ id: "wamid.out.1", status: "read", timestamp: "1786370500" }],
    } }] }],
  }, 1)).toEqual({
    kind: "status", providerNumberId: "pn-admin", providerMessageId: "wamid.out.1",
    status: "read", providerEventId: "wamid.out.1:read:1786370500", createdAt: 1_786_370_500_000,
  });
  expect(parseAdminKirimdevEvent({}, { type: "unknown" }, 1)).toEqual({ kind: "skip", reason: "missing provider number" });
});
