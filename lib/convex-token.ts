import { SignJWT, importPKCS8, exportJWK, type JWK } from "jose";
import type { Session } from "@/lib/auth-jwt";

// Short-lived RS256 access token for Convex (Custom JWT auth). Deliberately SEPARATE
// from the HS256 session cookie: the cookie flow stays untouched (zero login risk),
// while Convex validates these tokens against our public JWKS. See
// docs/superpowers/plans/2026-07-07-fase0-hardening.md.

export const CONVEX_JWT_ISSUER = "https://wafachat.vercel.app";
export const CONVEX_JWT_AUDIENCE = "convex";
export const CONVEX_JWT_KID = "wafachat-2026-07";
const TOKEN_TTL_SECONDS = 15 * 60;

let cachedPrivateKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;
async function privateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;
  const b64 = process.env.CONVEX_JWT_PRIVATE_KEY_B64;
  if (!b64) throw new Error("CONVEX_JWT_PRIVATE_KEY_B64 is not set");
  const pem = Buffer.from(b64, "base64").toString("utf8");
  // extractable: publicJwks() must be able to export the public half as a JWK.
  cachedPrivateKey = await importPKCS8(pem, "RS256", { extractable: true });
  return cachedPrivateKey;
}

export async function signConvexToken(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, name: s.name, email: s.email, csName: s.csName })
    .setProtectedHeader({ alg: "RS256", kid: CONVEX_JWT_KID })
    .setSubject(s.userId)
    .setIssuer(CONVEX_JWT_ISSUER)
    .setAudience(CONVEX_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(await privateKey());
}

/** Public JWK derived from the private key (private params stripped) — served at /.well-known/jwks.json. */
export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const jwk = await exportJWK(await privateKey());
  const { kty, n, e } = jwk as { kty?: string; n?: string; e?: string };
  if (!kty || !n || !e) throw new Error("failed to derive public JWK");
  return { keys: [{ kty, n, e, alg: "RS256", use: "sig", kid: CONVEX_JWT_KID }] };
}
