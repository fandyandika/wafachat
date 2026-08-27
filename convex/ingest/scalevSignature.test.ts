import { describe, expect, test } from "vitest";
import { hmacBase64, verifyScalevSignature } from "./scalevSignature";

describe("verifyScalevSignature", () => {
  test("verifies the Base64 HMAC over the exact raw request body", async () => {
    const secret = "scalev-secret";
    const body = '{"event":"order.created","data":{"id":"1"}}';
    const signature = await hmacBase64(secret, body);

    await expect(verifyScalevSignature({ header: signature, rawBody: body, secret }))
      .resolves.toEqual({ ok: true });
    await expect(verifyScalevSignature({ header: signature, rawBody: `${body} `, secret }))
      .resolves.toEqual({ ok: false, reason: "mismatch" });
  });

  test("rejects missing and malformed Base64 signatures", async () => {
    await expect(verifyScalevSignature({ header: null, rawBody: "{}", secret: "secret" }))
      .resolves.toEqual({ ok: false, reason: "missing header" });
    await expect(verifyScalevSignature({ header: "%%%", rawBody: "{}", secret: "secret" }))
      .resolves.toEqual({ ok: false, reason: "malformed header" });
  });
});
