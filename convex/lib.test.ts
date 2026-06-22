import { expect, test } from "vitest";
import { isInternalTestPhone } from "./lib";

test("isInternalTestPhone: owner/admin/CS numbers are excluded", () => {
  const excluded = [
    "6285715682110", // owner
    "6285774076061", // admin input
    "628211900201", // admin input
    "6282280000661", // owner
    "6281385708799", // CS Aisyah line
    "6282321381742", // CS Risma line
    "6285210047441", // CS Lila line
    "6282113515152", // CS Azelia line
  ];
  for (const phone of excluded) {
    expect(isInternalTestPhone(phone)).toBe(true);
  }
});

test("isInternalTestPhone: normalizes 0/8 prefixes before matching", () => {
  expect(isInternalTestPhone("081385708799")).toBe(true); // CS Aisyah with leading 0
  expect(isInternalTestPhone("81385708799")).toBe(true); // CS Aisyah with leading 8
});

test("isInternalTestPhone: group / non-MSISDN ids are excluded", () => {
  expect(isInternalTestPhone("120363042837849988")).toBe(true); // WhatsApp group JID digits
});

test("isInternalTestPhone: a normal customer number is NOT excluded", () => {
  expect(isInternalTestPhone("6281234567890")).toBe(false);
  expect(isInternalTestPhone("6289653903889")).toBe(false);
  expect(isInternalTestPhone("081234567890")).toBe(false);
});
