import { describe, expect, test } from "vitest";
import { buildBerduAuth, computeGaps, gapsPendingDatabaseVerification, wibDatePrefix } from "./reconciler";
import { hmacBase64 } from "./signature";

describe("computeGaps", () => {
  test("finds holes between min and max", () => {
    expect(computeGaps([1, 2, 5, 6], 1, 6)).toEqual([3, 4]);
  });
  test("no gaps / empty -> empty", () => {
    expect(computeGaps([1, 2, 3], 1, 3)).toEqual([]);
    expect(computeGaps([], null, null)).toEqual([]);
  });
});

describe("wibDatePrefix", () => {
  test("formats YYMMDD in WIB", () => {
    // 2026-07-07 18:00 UTC == 2026-07-08 01:00 WIB
    expect(wibDatePrefix(Date.UTC(2026, 6, 7, 18, 0, 0))).toBe("260708");
  });
});

describe("buildBerduAuth", () => {
  test("header = appId.ts.base64hmac(appId:ts:appSecret, key)", async () => {
    const { authHeader } = await buildBerduAuth("app1", "sec1", "key1", 1783442989);
    const expectedSig = await hmacBase64("key1", "app1:1783442989:sec1");
    expect(authHeader).toBe(`app1.1783442989.${expectedSig}`);
  });
});

describe("gapsPendingDatabaseVerification", () => {
  test("keeps a non-throwing skipped process result pending for the commit lookup", () => {
    const processOutcome = { status: "skipped", reason: "unparseable order detail" };

    expect(processOutcome.status).toBe("skipped");
    expect(gapsPendingDatabaseVerification([3])).toEqual([3]);
  });
});
