import { beforeEach, expect, test } from "vitest";
import { signSession, verifySession, routeGuard, type Session } from "./auth-jwt";

beforeEach(() => { process.env.PANEL_AUTH_SECRET = "test-auth-secret"; });
const admin: Session = { userId: "u1", role: "admin", name: "Owner", email: "o@x.com" };
const cs: Session = { userId: "u2", role: "cs", name: "Risma", email: "r@x.com" };

test("signSession/verifySession round-trips; tampered/empty -> null", async () => {
  const token = await signSession(cs);
  const back = await verifySession(token);
  expect(back?.email).toBe("r@x.com");
  expect(back?.role).toBe("cs");
  expect(await verifySession(token + "x")).toBeNull();
  expect(await verifySession(undefined)).toBeNull();
});

test("routeGuard: unauth -> /login; cs scoped to Laporan+Follow-up; admin full", () => {
  expect(routeGuard("/panel", null).redirect).toBe("/login");
  // CS: only Laporan + Follow-up are allowed; everything else redirects to Laporan.
  expect(routeGuard("/panel/laporan", cs).redirect).toBeNull();
  expect(routeGuard("/panel/follow-up", cs).redirect).toBeNull();
  expect(routeGuard("/panel", cs).redirect).toBe("/panel/laporan");
  expect(routeGuard("/panel/performance", cs).redirect).toBe("/panel/laporan");
  expect(routeGuard("/panel/queen", cs).redirect).toBe("/panel/laporan");
  expect(routeGuard("/panel/settings", cs).redirect).toBe("/panel/laporan");
  // Admin: full access.
  expect(routeGuard("/panel", admin).redirect).toBeNull();
  expect(routeGuard("/panel/settings", admin).redirect).toBeNull();
  expect(routeGuard("/", admin).redirect).toBe("/panel");
  expect(routeGuard("/", null).redirect).toBe("/login");
});

test("signSession round-trips orgId; old token without orgId stays valid", async () => {
  const withOrg = await signSession({ userId: "u1", role: "admin", name: "A", email: "a@t.co", orgId: "org123" });
  const s1 = await verifySession(withOrg);
  expect(s1?.orgId).toBe("org123");
  const withoutOrg = await signSession({ userId: "u2", role: "cs", name: "B", email: "b@t.co", csName: "B" });
  const s2 = await verifySession(withoutOrg);
  expect(s2).not.toBeNull();      // backward compat: absence is NOT invalid
  expect(s2?.orgId).toBeUndefined();
});
