export const ADMIN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AdminTemplateVariable = {
  key: string;
  label: string;
  required: boolean;
};

export type TemplateValueResult =
  | { ok: true; ordered: string[] }
  | { ok: false; error: string };

export function normalizeAdminRecipient(value: string): string {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("Nomor WhatsApp tidak valid.");
  }
  return digits;
}

export function normalizeOptionalAdminTotal(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Harga total harus berupa rupiah bulat yang tidak negatif.");
  }
  return value;
}

export function adminWindowExpiresAt(lastInboundAt?: number): number | undefined {
  return lastInboundAt === undefined ? undefined : lastInboundAt + ADMIN_WINDOW_MS;
}

export function isAdminWindowOpen(lastInboundAt: number | undefined, now: number): boolean {
  const expiresAt = adminWindowExpiresAt(lastInboundAt);
  return expiresAt !== undefined && now < expiresAt;
}

export function validateTemplateValues(
  definitions: AdminTemplateVariable[],
  values: Record<string, string>,
): TemplateValueResult {
  const ordered: string[] = [];
  for (const definition of definitions) {
    const value = String(values[definition.key] ?? "").trim();
    if (definition.required && !value) {
      return { ok: false, error: `Template ${definition.label} wajib diisi.` };
    }
    ordered.push(value);
  }
  return { ok: true, ordered };
}
