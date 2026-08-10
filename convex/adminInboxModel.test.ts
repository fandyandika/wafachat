import { describe, expect, test } from "vitest";
import {
  ADMIN_WINDOW_MS,
  adminWindowExpiresAt,
  isAdminWindowOpen,
  normalizeAdminRecipient,
  validateTemplateValues,
} from "./adminInboxModel";

describe("admin inbox rules", () => {
  test("normalizes Indonesian recipients", () => {
    expect(normalizeAdminRecipient("0857-1568-2110")).toBe("6285715682110");
    expect(normalizeAdminRecipient("+62 857 1568 2110")).toBe("6285715682110");
  });

  test("rejects invalid recipient lengths", () => {
    expect(() => normalizeAdminRecipient("123"))
      .toThrow("Nomor WhatsApp tidak valid.");
    expect(() => normalizeAdminRecipient("1234567890123456"))
      .toThrow("Nomor WhatsApp tidak valid.");
  });

  test("closes the free-form window at exactly 24 hours", () => {
    const inbound = 1_000;
    expect(adminWindowExpiresAt(inbound)).toBe(inbound + ADMIN_WINDOW_MS);
    expect(isAdminWindowOpen(inbound, inbound + ADMIN_WINDOW_MS - 1)).toBe(true);
    expect(isAdminWindowOpen(inbound, inbound + ADMIN_WINDOW_MS)).toBe(false);
    expect(isAdminWindowOpen(undefined, inbound)).toBe(false);
  });

  test("orders and trims required template values", () => {
    expect(validateTemplateValues(
      [
        { key: "name", label: "Nama", required: true },
        { key: "resi", label: "Resi", required: true },
      ],
      { resi: " JX01 ", name: " Hasna " },
    )).toEqual({ ok: true, ordered: ["Hasna", "JX01"] });
  });

  test("reports the exact missing template variable", () => {
    expect(validateTemplateValues(
      [{ key: "resi", label: "Nomor resi", required: true }],
      { resi: " " },
    )).toEqual({ ok: false, error: "Template Nomor resi wajib diisi." });
  });
});
