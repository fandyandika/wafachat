export type AdminProviderEvent =
  | {
      kind: "inbound";
      providerNumberId: string;
      customerPhone: string;
      customerName?: string;
      content: string;
      providerMessageId: string;
      providerEventId: string;
      createdAt: number;
    }
  | {
      kind: "status";
      providerNumberId: string;
      providerMessageId: string;
      status: "accepted" | "delivered" | "read" | "failed";
      providerEventId: string;
      createdAt: number;
    }
  | { kind: "skip"; reason: string };

function timestamp(value: unknown, fallback: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

export function extractAdminProviderNumberId(body: unknown): string | undefined {
  const data = (body ?? {}) as Record<string, any>;
  const value = data.entry?.[0]?.changes?.[0]?.value ?? {};
  const result = String(value.metadata?.phone_number_id || data.data?.meta?.phone_number_id || data.kirim?.phone_number_id || "");
  return result || undefined;
}

export function parseAdminKirimdevEvent(
  headers: Record<string, string>,
  body: unknown,
  nowMs: number,
): AdminProviderEvent {
  const data = (body ?? {}) as Record<string, any>;
  const value = data.entry?.[0]?.changes?.[0]?.value ?? {};
  const providerNumberId = extractAdminProviderNumberId(body) ?? "";
  if (!providerNumberId) return { kind: "skip", reason: "missing provider number" };

  const statusRow = value.statuses?.[0];
  if (statusRow?.id && statusRow?.status) {
    const rawStatus = String(statusRow.status).toLowerCase();
    const status = rawStatus === "sent" ? "accepted" : rawStatus;
    if (status !== "accepted" && status !== "delivered" && status !== "read" && status !== "failed") {
      return { kind: "skip", reason: `unsupported status ${rawStatus}` };
    }
    const eventTimestamp = String(statusRow.timestamp || "");
    return {
      kind: "status",
      providerNumberId,
      providerMessageId: String(statusRow.id),
      status,
      providerEventId: headers["x-kirim-event-id"] || `${statusRow.id}:${rawStatus}:${eventTimestamp}`,
      createdAt: timestamp(statusRow.timestamp, nowMs),
    };
  }

  const message = value.messages?.[0];
  if (!message) return { kind: "skip", reason: "admin event has no inbound message or status" };
  let content = "";
  if (message.type === "text") content = String(message.text?.body || "");
  else if (message.type === "button") content = String(message.button?.text || "");
  else return { kind: "skip", reason: `unsupported inbound type ${message.type}` };
  const customerPhone = String(value.contacts?.[0]?.wa_id || message.from || data.kirim?.contact?.phone_number || "").replace(/^\+/, "");
  const providerMessageId = String(message.id || headers["x-kirim-event-id"] || "");
  if (!customerPhone || !content || !providerMessageId) return { kind: "skip", reason: "missing inbound fields" };
  return {
    kind: "inbound",
    providerNumberId,
    customerPhone,
    customerName: value.contacts?.[0]?.profile?.name || data.kirim?.contact?.name || undefined,
    content,
    providerMessageId,
    providerEventId: headers["x-kirim-event-id"] || providerMessageId,
    createdAt: timestamp(message.timestamp, nowMs),
  };
}
