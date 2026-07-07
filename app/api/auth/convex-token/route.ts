import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth-jwt";
import { signConvexToken } from "@/lib/convex-token";

// Exchange the httpOnly session cookie for a short-lived RS256 Convex access token.
// The browser can't read the cookie itself, so ConvexReactClient.setAuth fetches from
// here; Convex then validates the token against our JWKS (convex/auth.config.ts).
export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get("auth_token")?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = await signConvexToken(session);
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
