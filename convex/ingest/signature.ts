// Pure HMAC helpers for the Ingestion API. One scheme, dogfooded:
// we VERIFY it on inbound vendor webhooks (KirimDev) and ISSUE it on our
// generic /ingest/* endpoints. Stripe convention: sign `${t}.${rawBody}`.
// Runs on Web Crypto (available in Convex httpAction runtime and edge-runtime tests).

export type ParsedSignature = { t: number; v1: string };

export function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null;
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || t <= 0 || !v1) return null;
  return { t, v1 };
}

async function hmacRaw(secret: string, message: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const buf = await hmacRaw(secret, message);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacBase64(secret: string, message: string): Promise<string> {
  const buf = await hmacRaw(secret, message);
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

const DEFAULT_TOLERANCE_SEC = 300;

export async function verifySignature(opts: {
  header: string | null;
  rawBody: string;
  secret: string;
  nowMs: number;
  toleranceSec?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { ok: false, reason: "missing or malformed header" };
  const tolerance = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(opts.nowMs / 1000 - parsed.t) > tolerance) {
    return { ok: false, reason: "timestamp out of tolerance" };
  }
  const expected = await hmacHex(opts.secret, `${parsed.t}.${opts.rawBody}`);
  if (expected !== parsed.v1.toLowerCase()) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

export async function signPayload(secret: string, rawBody: string, nowMs: number): Promise<string> {
  const t = Math.floor(nowMs / 1000);
  const v1 = await hmacHex(secret, `${t}.${rawBody}`);
  return `t=${t},v1=${v1}`;
}
