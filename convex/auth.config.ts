// Convex Custom JWT auth: validates the short-lived RS256 tokens minted by the Next
// app (lib/convex-token.ts) against our public JWKS. issuer/audience/kid must match
// the constants in lib/convex-token.ts exactly.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex", // must equal the token's `aud` claim
      issuer: "https://wafachat.vercel.app",
      jwks: "https://wafachat.vercel.app/.well-known/jwks.json",
      algorithm: "RS256",
    },
  ],
};
