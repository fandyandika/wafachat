import { expect, test } from "vitest";
import { formatDuration } from "./format";

test("formatDuration: seconds, minutes, hours, null", () => {
  expect(formatDuration(0)).toBe("0 dtk");
  expect(formatDuration(45000)).toBe("45 dtk");
  expect(formatDuration(250000)).toBe("4 mnt");      // 250s -> ~4m
  expect(formatDuration(4_320_000)).toBe("1 jam 12 mnt"); // 72m
  expect(formatDuration(3_600_000)).toBe("1 jam");     // exactly 60m
  expect(formatDuration(null)).toBe("–");
  expect(formatDuration(undefined)).toBe("–");
});
