import type { Doc } from "./_generated/dataModel";

export type ConversationStatus = "active" | "handover" | "closed";

export function normalizeCsName(csName: string): string {
  return csName.toLowerCase().replace(/[^a-z]/g, "");
}

export function isAisyah(csName: string): boolean {
  return normalizeCsName(csName).includes("aisyah");
}

export function normalizePhone(value: string | undefined): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

const INTERNAL_TEST_PHONES = new Set(["6285715682110", "6285774076061", "628211900201"]);

export function isInternalTestPhone(value: string | undefined): boolean {
  return INTERNAL_TEST_PHONES.has(normalizePhone(value));
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

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7 (no DST)
const DAY_MS = 86_400_000;

/** Epoch ms of the most recent Asia/Jakarta midnight at or before `timestamp`. */
export function startOfJakartaDayMs(timestamp = Date.now()): number {
  return Math.floor((timestamp + JAKARTA_OFFSET_MS) / DAY_MS) * DAY_MS - JAKARTA_OFFSET_MS;
}
