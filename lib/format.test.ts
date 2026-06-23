import { expect, test } from "vitest";
import { formatDuration } from "./format";

test("formatDuration: seconds, minutes, hours, null", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(45000)).toBe("45s");
  expect(formatDuration(250000)).toBe("4m");      // 250s -> ~4m
  expect(formatDuration(4_320_000)).toBe("1j 12m"); // 72m
  expect(formatDuration(3_600_000)).toBe("1j");     // exactly 60m
  expect(formatDuration(null)).toBe("–");
  expect(formatDuration(undefined)).toBe("–");
});
