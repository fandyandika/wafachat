import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Helper: seed the default org ("pustakaislam") for tests
async function seedOrg(t: any) {
  return await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1 }));
}

// Enforcement contract (Fase 0 Task D): with AUTH_ENFORCE=on, anonymous callers are
// rejected, members pass member-guards, and only admins pass admin-guards.
test("enforcement on: anonymous rejected; admin passes; cs passes member but not admin guards", async () => {
  const prev = process.env.AUTH_ENFORCE;
  process.env.AUTH_ENFORCE = "on";
  try {
    const t = convexTest(schema);
    const orgId = await seedOrg(t); // seed default org for requireMemberOrg/requireAdminOrg
    // Create users rows for org resolution
    await t.run(async (ctx: any) => {
      await ctx.db.insert("users", {
        orgId, email: "c@w", name: "Lina", passwordHash: "x", role: "cs",
        csName: "Lina", isActive: true, createdAt: 1, updatedAt: 1,
      });
    });
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

// B2b: requireMemberOrg & requireAdminOrg tests (org resolution from the viewer)
test("requireMemberOrg: user WITH a users row resolves that row's org (not default)", async () => {
  const t = convexTest(schema);
  const defaultOrg = await seedOrg(t); // slug "pustakaislam"
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "Org B", createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx: any) => {
    await ctx.db.insert("users", {
      orgId: orgB, email: "csb@test", name: "CS B", passwordHash: "x", role: "cs",
      csName: "Bela", isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asCsB = t.withIdentity({ subject: "u-b", role: "cs", name: "CS B", email: "csb@test" });
  const probe = await asCsB.query(api.authz.probeOrg, {});
  expect(probe.orgId).toEqual(orgB);
  expect(probe.orgId).not.toEqual(defaultOrg);
});

test("requireMemberOrg: ADMIN without users row falls back to the default org", async () => {
  const t = convexTest(schema);
  const defaultOrg = await seedOrg(t);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const probe = await asAdmin.query(api.authz.probeOrg, {});
  expect(probe.orgId).toEqual(defaultOrg);
});

test("requireMemberOrg: CS without users row THROWS (no silent default fallback)", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const asGhostCs = t.withIdentity({ subject: "u-x", role: "cs", name: "Ghost", email: "ghost@test" });
  await expect(asGhostCs.query(api.authz.probeOrg, {})).rejects.toThrow(/no user record/);
});

test("requireMemberOrg: admin fallback with NO org seeded throws clearly", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  await expect(asAdmin.query(api.authz.probeOrg, {})).rejects.toThrow(/org not seeded/);
});
