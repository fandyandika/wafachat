import { SignJWT, jwtVerify } from "jose";

export type Session = { userId: string; role: "admin" | "cs"; name: string; email: string };

function key(): Uint8Array {
  const secret = process.env.PANEL_AUTH_SECRET;
  if (!secret) throw new Error("PANEL_AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ userId: s.userId, role: s.role, name: s.name, email: s.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());
}

export async function verifySession(token?: string): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const { userId, role, name, email } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || (role !== "admin" && role !== "cs") || typeof name !== "string" || typeof email !== "string") {
      return null;
    }
    return { userId, role, name, email };
  } catch {
    return null;
  }
}

export function routeGuard(pathname: string, session: Session | null): { redirect: string | null } {
  if (pathname === "/") return { redirect: session ? "/panel" : "/login" };
  if (pathname.startsWith("/panel")) {
    if (!session) return { redirect: "/login" };
    // CS staff are scoped to their own Laporan + Follow-up only — no Dashboard/Performance/
    // Settings (hides total-business figures like omzet and the heaviest reads). Anything else
    // redirects to Laporan. Admins fall through with full access.
    if (session.role === "cs") {
      const allowed = pathname.startsWith("/panel/laporan") || pathname.startsWith("/panel/follow-up");
      return { redirect: allowed ? null : "/panel/laporan" };
    }
  }
  return { redirect: null };
}
