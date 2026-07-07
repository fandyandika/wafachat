import { describe, expect, test } from "vitest";
import { hmacHex, parseSignatureHeader, signPayload, verifySignature } from "./signature";

describe("parseSignatureHeader", () => {
  test("parses t and v1", () => {
    expect(parseSignatureHeader("t=1783442989,v1=abc123")).toEqual({ t: 1783442989, v1: "abc123" });
  });
  test("rejects null, garbage, missing parts", () => {
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader("nonsense")).toBeNull();
    expect(parseSignatureHeader("t=notanumber,v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=123")).toBeNull();
  });
});

describe("verify/sign roundtrip", () => {
  const secret = "whsec_testsecret";
  const body = JSON.stringify({ hello: "world" });

  test("hmacHex is deterministic hex", async () => {
    const h = await hmacHex(secret, "msg");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex(secret, "msg")).toBe(h);
  });

  test("signPayload output verifies", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    expect(header).toMatch(/^t=1783442989,v1=[0-9a-f]{64}$/);
    const res = await verifySignature({ header, rawBody: body, secret, nowMs: now });
    expect(res).toEqual({ ok: true });
  });

  test("wrong secret fails", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    const res = await verifySignature({ header, rawBody: body, secret: "other", nowMs: now });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("mismatch");
  });

  test("tampered body fails", async () => {
    const now = 1783442989000;
    const header = await signPayload(secret, body, now);
    const res = await verifySignature({ header, rawBody: body + "x", secret, nowMs: now });
    expect(res.ok).toBe(false);
  });

  test("stale timestamp outside tolerance fails; inside passes", async () => {
    const signedAt = 1783442989000;
    const header = await signPayload(secret, body, signedAt);
    const late = await verifySignature({ header, rawBody: body, secret, nowMs: signedAt + 301_000 });
    expect(late).toEqual({ ok: false, reason: "timestamp out of tolerance" });
    const okLate = await verifySignature({ header, rawBody: body, secret, nowMs: signedAt + 299_000 });
    expect(okLate.ok).toBe(true);
  });

  test("missing header fails with reason", async () => {
    const res = await verifySignature({ header: null, rawBody: body, secret, nowMs: 0 });
    expect(res).toEqual({ ok: false, reason: "missing or malformed header" });
  });
});
