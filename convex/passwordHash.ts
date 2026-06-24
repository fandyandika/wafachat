// PBKDF2-HMAC-SHA256 password hashing using Web Crypto only — runs in the
// Convex V8 isolate, Next edge middleware, and convex-test (edge runtime).
const ITER = 100_000;
const KEYLEN_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function derive(plain: string, salt: Uint8Array, iter: number, bits: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const out = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" }, key, bits);
  return new Uint8Array(out);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(plain, salt, ITER, KEYLEN_BITS);
  return `pbkdf2$${ITER}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = fromB64(parts[2]);
    expected = fromB64(parts[3]);
  } catch {
    return false;
  }
  const got = await derive(plain, salt, iter, expected.length * 8);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}
