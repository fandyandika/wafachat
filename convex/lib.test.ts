import { expect, test } from "vitest";
import { isInternalTestPhone, csKey } from "./lib";
import { DEFAULT_INTERNAL_PHONES } from "./orgSettings";

const PHONES: ReadonlySet<string> = new Set(DEFAULT_INTERNAL_PHONES);

test("isInternalTestPhone: owner/admin/CS numbers are excluded (default set)", () => {
  for (const phone of DEFAULT_INTERNAL_PHONES) {
    expect(isInternalTestPhone(phone, PHONES)).toBe(true);
  }
});

test("isInternalTestPhone: normalizes 0/8 prefixes before matching", () => {
  expect(isInternalTestPhone("081385708799", PHONES)).toBe(true); // CS Aisyah with leading 0
  expect(isInternalTestPhone("81385708799", PHONES)).toBe(true); // CS Aisyah with leading 8
});

test("isInternalTestPhone: group / non-MSISDN ids are excluded even with an empty set", () => {
  expect(isInternalTestPhone("120363042837849988", new Set())).toBe(true); // WhatsApp group JID
});

test("isInternalTestPhone: a normal customer number is NOT excluded", () => {
  expect(isInternalTestPhone("6281234567890", PHONES)).toBe(false);
  expect(isInternalTestPhone("6289653903889", PHONES)).toBe(false);
  expect(isInternalTestPhone("081234567890", PHONES)).toBe(false);
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
