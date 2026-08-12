export type AdminInboxView = "all" | "needs_reply" | "window_open";

export type AdminInboxThreadView = {
  id: string;
  customerPhone: string;
  customerName?: string;
  productName?: string;
  totalAmount?: number;
  orderId?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  windowOpen: boolean;
  updatedAt: number;
};

export function adminThreadNeedsReply(thread: AdminInboxThreadView): boolean {
  return thread.lastInboundAt !== undefined
    && thread.lastInboundAt > (thread.lastOutboundAt ?? Number.NEGATIVE_INFINITY);
}

export function adminThreadPreview(thread: AdminInboxThreadView): string {
  return thread.productName || (thread.orderId ? `Order ${thread.orderId}` : thread.customerPhone);
}

function normalizePhoneSearch(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

export function filterAdminThreads(
  threads: AdminInboxThreadView[],
  search: string,
  view: AdminInboxView,
): AdminInboxThreadView[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("id-ID");
  const searchDigits = normalizePhoneSearch(normalizedSearch);

  return threads.filter((thread) => {
    if (view === "needs_reply" && !adminThreadNeedsReply(thread)) return false;
    if (view === "window_open" && !thread.windowOpen) return false;
    if (!normalizedSearch) return true;

    const text = [thread.customerName, thread.customerPhone, thread.productName, thread.orderId]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("id-ID");
    const phoneDigits = normalizePhoneSearch(thread.customerPhone);

    return text.includes(normalizedSearch)
      || (searchDigits.length > 0 && phoneDigits.includes(searchDigits));
  });
}
