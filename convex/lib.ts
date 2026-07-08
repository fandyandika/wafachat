import type { Doc } from "./_generated/dataModel";

export type ConversationStatus = "active" | "handover" | "closed";

export function normalizeCsName(csName: string): string {
  return csName.toLowerCase().replace(/[^a-z]/g, "");
}

// Canonical CS identity: collapses the "CS " prefix so config ("CS Aisyah")
// and data ("Aisyah") resolve to the same key. Only strips a leading "cs"
// when the remainder is non-empty (so "Cs"-only inputs keep a key).
export function csKey(name: string | undefined): string {
  const n = normalizeCsName(name ?? "");
  return n.startsWith("cs") && n.length > 2 ? n.slice(2) : n;
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

// Phones excluded from all closing/leads/revenue metrics: owner + admin input
// numbers, every CS WhatsApp line (CS may forward closing cases to each other),
// plus group / non-MSISDN ids.
const INTERNAL_TEST_PHONES = new Set([
  "6285715682110", // owner Pustaka Islam
  "6285774076061", // admin input
  "628211900201", // admin input
  "6282280000661", // owner Pustaka Islam
  "6281385708799", // CS Aisyah line
  "6282321381742", // CS Risma line
  "6285210047441", // CS Lila line
  "6282113515152", // CS Azelia line
  "6281220823210", // CS Nabila line
]);

export function isInternalTestPhone(value: string | undefined): boolean {
  const normalized = normalizePhone(value);
  if (INTERNAL_TEST_PHONES.has(normalized)) return true;
  // WhatsApp group JIDs / non-MSISDN ids are far longer than any Indonesian
  // number (62 + <=12 digits = <=14 chars). Treat them as internal (don't count).
  if (normalized.length > 15) return true;
  return false;
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

// ── Report-window helpers (16:00→16:00 WIB business day) ─────────────────────
// Single source of truth; components/panel/report-window.ts re-exports these (Task 10).
export function fourPmWibMs(y: number, mIdx: number, d: number): number {
  return Date.UTC(y, mIdx, d, 9, 0, 0); // 16:00 WIB == 09:00 UTC
}

/** Label date ("YYYY-MM-DD") of the 16:00-WIB window containing `ms` (date the window OPENS). */
export function windowKeyFor(ms: number): string {
  const shifted = new Date(ms - 9 * 3_600_000); // 16:00 WIB becomes UTC midnight
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function windowRangeForKey(key: string): { startAt: number; endAt: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { startAt: fourPmWibMs(y, m - 1, d), endAt: fourPmWibMs(y, m - 1, d + 1) };
}

export function windowKeyToday(now = Date.now()): string {
  return windowKeyFor(now);
}

// ── Product canonicalization ──────────────────────────────────────────────────
// Shared helpers to avoid circular imports when rollupReaders needs canonicalizeProduct.

function cleanMarkdown(value: string): string {
  return value
    .replace(/[*_`]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function normalizeProductName(value: string | undefined): string {
  return cleanMarkdown(value ?? "")
    .replace(/\(\s*\d+\s*x\s*\)/gi, "")
    .replace(/\s+-\s+Pilih Paket:.*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Tanpa Data Produk";
}

// A closing with no matching order carries the message's SKU-style name
// ("QURAN MAPPING 1 PCS") instead of the order's display name, which fragments the
// per-product breakdown. Collapse every known variant to one canonical display name so
// leads and closings group identically. Each keyword is unique within the catalog;
// unknown products fall through unchanged (never mis-merged).
const PRODUCT_ALIASES: Array<{ canonical: string; match: RegExp }> = [
  { canonical: "Quran Mapping", match: /quran mapping/i },
  { canonical: "Al Qur'an Medis [A5] dengan Hadis Medis + Jurnal Kesehatan", match: /medis/i },
  { canonical: "7 Surat Istimewa", match: /surat/i },
  { canonical: "Sound Book: Learning How To Do Shalat", match: /sound book|learning.*shalat/i },
  { canonical: "Alquran Tulis Tazyin 1 Jilid", match: /tazyin/i },
  { canonical: "Kumpulan Doa Berbagai Acara & Keperluan", match: /kumpulan doa|doa acara/i },
];

export function canonicalizeProduct(value: string | undefined): string {
  const name = normalizeProductName(value);
  for (const { canonical, match } of PRODUCT_ALIASES) {
    if (match.test(name)) return canonical;
  }
  return name;
}
