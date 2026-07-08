import { expect, test } from "vitest";
import { isInternalTestPhone, csKey } from "./lib";

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
    "6281220823210", // CS Nabila line
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

test("csKey collapses the 'CS ' prefix so config and data names match", () => {
  expect(csKey("CS Aisyah")).toBe("aisyah");
  expect(csKey("Aisyah")).toBe("aisyah");
  expect(csKey("CS Risma")).toBe("risma");
  expect(csKey("Risma")).toBe("risma");
  expect(csKey("Azelia")).toBe("azelia");
  expect(csKey(undefined)).toBe("");
  expect(csKey("")).toBe("");
  // does not over-strip a name that legitimately starts with "cs"
  expect(csKey("Cynthia Sari")).toBe("cynthiasari");
});

import { describe } from "vitest";
import { fourPmWibMs, windowKeyFor, windowRangeForKey, windowKeyToday } from "./lib";

describe("report window helpers (16:00 WIB)", () => {
  test("fourPmWibMs = 09:00 UTC of that date", () => {
    expect(fourPmWibMs(2026, 6, 8)).toBe(Date.UTC(2026, 6, 8, 9, 0, 0));
  });
  test("windowKeyFor: 15:59 WIB belongs to yesterday's window; 16:00 to today's", () => {
    expect(windowKeyFor(Date.UTC(2026, 6, 8, 8, 59, 59))).toBe("2026-07-07");
    expect(windowKeyFor(Date.UTC(2026, 6, 8, 9, 0, 0))).toBe("2026-07-08");
  });
  test("windowRangeForKey roundtrips", () => {
    const r = windowRangeForKey("2026-07-08");
    expect(r.startAt).toBe(fourPmWibMs(2026, 6, 8));
    expect(r.endAt).toBe(fourPmWibMs(2026, 6, 9));
    expect(windowKeyFor(r.startAt)).toBe("2026-07-08");
    expect(windowKeyFor(r.endAt - 1)).toBe("2026-07-08");
  });
  test("windowKeyToday delegates to windowKeyFor", () => {
    const now = Date.UTC(2026, 6, 8, 3, 0, 0); // 10:00 WIB -> window opened 7 Jul 16:00
    expect(windowKeyToday(now)).toBe("2026-07-07");
  });
  test("year boundary", () => {
    expect(windowKeyFor(Date.UTC(2026, 0, 1, 1, 0, 0))).toBe("2025-12-31");
  });
});
