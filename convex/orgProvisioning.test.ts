import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ADMIN = { subject: "op", role: "admin" as const, name: "Op", email: "op@wafachat.test" };

async function seedDefaultOrg(t: any) {
  return t.run((ctx: any) =>
    ctx.db.insert("organizations", { slug: "pustakaislam", name: "Pustaka Islam", createdAt: 1, updatedAt: 1 }),
  );
}

test("provisionOrg: creates org + orgSettings + admin user + sources atomically", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t); // _admin.mjs-style admin resolves via default-org fallback
  const res = await t.withIdentity(ADMIN).mutation(api.orgs.provisionOrg, {
    slug: "toko-buku", orgName: "Toko Buku", adminEmail: "owner@tokobuku.test",
    adminPassword: "rahasia-123", sources: [{ kind: "kirimdev", name: "KirimDev Toko Buku" }],
  });
  expect(res.orgId).toBeDefined();
  expect(res.sourceKeys).toHaveLength(1);
  expect(res.sourceKeys[0].sourceKey).toBe("kirimdev-toko-buku");
  expect(res.sourceKeys[0].secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  await t.run(async (ctx: any) => {
    const org = (await ctx.db.query("organizations").collect()).find((o: any) => o.slug === "toko-buku");
    expect(org).toBeDefined();
    const os = (await ctx.db.query("orgSettings").collect()).filter((r: any) => String(r.orgId) === String(org._id));
    expect(os).toHaveLength(1);
    expect(os[0].internalPhones).toEqual([]);
    const user = (await ctx.db.query("users").collect()).find((u: any) => u.email === "owner@tokobuku.test");
    expect(user.role).toBe("admin");
    expect(String(user.orgId)).toBe(String(org._id));
    expect(user.passwordHash).not.toBe("rahasia-123"); // hashed
    const src = (await ctx.db.query("ingestSources").collect()).find((s: any) => s.sourceKey === "kirimdev-toko-buku");
    expect(String(src.orgId)).toBe(String(org._id));
    expect(src.enforceSignature).toBe(false);
    expect(src.enabled).toBe(true);
  });
});

test("provisionOrg: duplicate slug / duplicate email / invalid slug all THROW (no partial state)", async () => {
  const t = convexTest(schema);
  await seedDefaultOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  const base = { orgName: "X", adminPassword: "pw-123456", sources: [] as { kind: "kirimdev"; name: string }[] };
  await asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-x", adminEmail: "x@x.test" });
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-x", adminEmail: "y@y.test" })).rejects.toThrow(/slug/);
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "org-y", adminEmail: "x@x.test" })).rejects.toThrow(/email/);
  await expect(asAdmin.mutation(api.orgs.provisionOrg, { ...base, slug: "Bad Slug!", adminEmail: "z@z.test" })).rejects.toThrow(/slug/);
  await t.run(async (ctx: any) => {
    const orgs = await ctx.db.query("organizations").collect();
    expect(orgs.filter((o: any) => o.slug === "org-y" || o.slug === "bad slug!").length).toBe(0); // THROW = transaksi batal, nol partial
  });
});
