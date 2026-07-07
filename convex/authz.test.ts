import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Enforcement contract (Fase 0 Task D): with AUTH_ENFORCE=on, anonymous callers are
// rejected, members pass member-guards, and only admins pass admin-guards.
test("enforcement on: anonymous rejected; admin passes; cs passes member but not admin guards", async () => {
  const prev = process.env.AUTH_ENFORCE;
  process.env.AUTH_ENFORCE = "on";
  try {
    const t = convexTest(schema);
    await expect(t.query(api.cs.listCs, {})).rejects.toThrow(/unauthorized/);

    const asAdmin = t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });
    await expect(asAdmin.query(api.cs.listCs, {})).resolves.toBeDefined();

    const asCs = t.withIdentity({ subject: "c1", role: "cs", name: "Lina", email: "c@w", csName: "Lina" });
    await expect(asCs.query(api.cs.listCs, {})).resolves.toBeDefined(); // member guard OK
    await expect(asCs.mutation(api.csConfigs.deleteCsConfig, { csName: "X" })).rejects.toThrow(/admin/); // admin guard rejects cs
  } finally {
    if (prev === undefined) delete process.env.AUTH_ENFORCE;
    else process.env.AUTH_ENFORCE = prev;
  }
});

test("whoami reflects identity claims (and null when anonymous)", async () => {
  const t = convexTest(schema);
  expect(await t.query(api.authz.whoami, {})).toBeNull();
  const asCs = t.withIdentity({ subject: "u9", role: "cs", name: "Lina", email: "l@x", csName: "Lina" });
  expect(await asCs.query(api.authz.whoami, {})).toMatchObject({ role: "cs", csName: "Lina" });
});
