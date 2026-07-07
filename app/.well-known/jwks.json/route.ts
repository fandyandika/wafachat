import { NextResponse } from "next/server";
import { publicJwks } from "@/lib/convex-token";

export const dynamic = "force-dynamic"; // key comes from env; don't prerender at build

// Public JWKS consumed by the Convex deployment (convex/auth.config.ts) to validate
// our RS256 Convex access tokens. Public-key material only — safe to expose.
export async function GET() {
  const jwks = await publicJwks();
  return NextResponse.json(jwks, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
