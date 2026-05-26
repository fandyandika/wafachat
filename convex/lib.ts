import type { Doc } from "./_generated/dataModel";

export type ConversationStatus = "active" | "handover" | "closed";

export function normalizeCsName(csName: string): string {
  return csName.toLowerCase().replace(/[^a-z]/g, "");
}

export function isAisyah(csName: string): boolean {
  return normalizeCsName(csName).includes("aisyah");
}

export function getJakartaDate(timestamp = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function makeOrderKey(args: { orderId?: string; phone: string; productName?: string }): string {
  if (args.orderId) return args.orderId;
  return `${args.phone}:${args.productName ?? ""}`;
}

export function makeTransitionKey(args: {
  orderId?: string;
  phone: string;
  productName?: string;
  conversation?: Doc<"conversations"> | null;
}): string {
  if (args.orderId) return args.orderId;
  if (args.conversation?.orderId) return args.conversation.orderId;
  return `${args.phone}:${args.productName ?? ""}`;
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
