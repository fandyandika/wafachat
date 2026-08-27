async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): ArrayBuffer | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function hmacBase64(secret: string, rawBody: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret),
    new TextEncoder().encode(rawBody),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyScalevSignature(args: {
  header: string | null;
  rawBody: string;
  secret: string;
}): Promise<{ ok: boolean; reason?: "missing header" | "malformed header" | "mismatch" }> {
  if (!args.header) return { ok: false, reason: "missing header" };
  const received = base64ToBytes(args.header.trim());
  if (!received) return { ok: false, reason: "malformed header" };
  const ok = await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(args.secret),
    received,
    new TextEncoder().encode(args.rawBody),
  );
  return ok ? { ok: true } : { ok: false, reason: "mismatch" };
}
