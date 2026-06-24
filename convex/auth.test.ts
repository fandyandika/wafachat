import { convexTest } from "convex-test";
import { beforeEach, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const SECRET = "test-auth-secret";
beforeEach(() => {
  process.env.PANEL_AUTH_SECRET = SECRET;
});

test("seedFirstAdmin creates an admin only when the table is empty", async () => {
  const t = convexTest(schema);
  expect((await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "Owner@x.com", name: "Owner", password: "pw1" })).ok).toBe(true);
  const again = await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "Two@x.com", name: "Two", password: "pw2" });
  expect(again.ok).toBe(false);
  const users = await t.query(api.auth.listUsers, { authSecret: SECRET });
  expect(users).toHaveLength(1);
  expect(users[0].email).toBe("owner@x.com"); // lowercased
  expect(users[0].role).toBe("admin");
  expect((users[0] as Record<string, unknown>).passwordHash).toBeUndefined();
});

test("verifyCredentials: correct password ok; wrong/inactive/unknown not ok", async () => {
  const t = convexTest(schema);
  await t.mutation(api.auth.seedFirstAdmin, { authSecret: SECRET, email: "owner@x.com", name: "Owner", password: "ownerpw" });
  await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "Risma@x.com", name: "Risma", role: "cs", password: "rismapw" });

  const good = await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "rismapw" });
  expect(good.ok).toBe(true);
  expect(good.role).toBe("cs");
  expect(good.name).toBe("Risma");

  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "nope" })).ok).toBe(false);
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "ghost@x.com", password: "x" })).ok).toBe(false);

  await t.mutation(api.auth.setActive, { authSecret: SECRET, email: "risma@x.com", isActive: false });
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "risma@x.com", password: "rismapw" })).ok).toBe(false);
});

test("createUser rejects duplicate email; resetPassword changes the password", async () => {
  const t = convexTest(schema);
  await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "a@x.com", name: "A", role: "cs", password: "old" });
  expect((await t.mutation(api.auth.createUser, { authSecret: SECRET, email: "A@x.com", name: "A2", role: "cs", password: "y" })).ok).toBe(false);
  await t.mutation(api.auth.resetPassword, { authSecret: SECRET, email: "a@x.com", newPassword: "new" });
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "a@x.com", password: "new" })).ok).toBe(true);
  expect((await t.mutation(api.auth.verifyCredentials, { authSecret: SECRET, email: "a@x.com", password: "old" })).ok).toBe(false);
});

test("wrong authSecret is rejected", async () => {
  const t = convexTest(schema);
  await expect(t.query(api.auth.listUsers, { authSecret: "wrong" })).rejects.toThrow();
});
