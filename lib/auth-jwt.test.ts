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

test("routeGuard: unauthenticated -> /login; cs hitting settings -> /panel; allowed -> null", () => {
  expect(routeGuard("/panel", null).redirect).toBe("/login");
  expect(routeGuard("/panel/settings", cs).redirect).toBe("/panel");
  expect(routeGuard("/panel/settings", admin).redirect).toBeNull();
  expect(routeGuard("/panel", cs).redirect).toBeNull();
  expect(routeGuard("/", admin).redirect).toBe("/panel");
  expect(routeGuard("/", null).redirect).toBe("/login");
});
