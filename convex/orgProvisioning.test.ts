import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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

test("E2E: provisioned org #2 ingests via its own source and its admin sees ONLY its data", async () => {
  const t = convexTest(schema);
  const defaultOrgId = await seedDefaultOrg(t);
  // tenant #1 baseline: an admin (users row) + one order
  await t.run(async (ctx: any) => {
    const NOW = Date.now();
    await ctx.db.insert("users", { orgId: defaultOrgId, email: "admin@pi.test", name: "PI", passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("orders", {
      orgId: defaultOrgId, orderId: "O-PI-1", customerPhone: "62800000001", customerName: "cust-pi",
      assignedCsName: "Aisyah", csKey: "aisyah", productName: "P", products: "P (1x)", productsSubtotal: "Rp1",
      shippingCost: "Rp1", total: "Rp2", shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z",
      source: "berdu", aiEligible: false, createdAt: NOW, updatedAt: NOW,
    });
  });
  // provision org #2 with its own berdu source
  const prov = await t.withIdentity(ADMIN).mutation(api.orgs.provisionOrg, {
    slug: "org-two", orgName: "Org Two", adminEmail: "admin@two.test", adminPassword: "pw-123456",
    sources: [{ kind: "berdu", name: "Berdu Two" }],
  });
  const source = await t.run(async (ctx: any) =>
    (await ctx.db.query("ingestSources").collect()).find((s: any) => s.sourceKey === "berdu-org-two"));
  expect(String(source.orgId)).toBe(String(prov.orgId));
  // ingest a lead.created order through org #2's source (same internal path the webhook route uses)
  const rawBody = JSON.stringify({ order: {
    id: "O-ORGTWO-1", created_at: "2026-07-14T09:15:00+07:00", assigned_to_staff: "B-Z28TdYc",
    shipping_cost: 15000, total: 100000,
    shipping_address: { phone: "62899999001", firstName: "Dua", address: "Jl. Dua 2", district: "D", city: "E" },
    products: [{ name: "Buku Dua", price: 85000, count: 1 }],
  }});
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: source.sourceKey, kind: "lead.created", rawHeaders: "{}", rawBody, signatureOk: true, orgId: source.orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  // order landed in org #2, tenant #1 untouched
  await t.run(async (ctx: any) => {
    const orders = await ctx.db.query("orders").collect();
    expect(orders.filter((o: any) => String(o.orgId) === String(prov.orgId)).length).toBeGreaterThan(0);
    expect(orders.filter((o: any) => String(o.orgId) === String(defaultOrgId)).length).toBe(1);
  });
  // org #2 admin (users row from provisionOrg + matching orgId claim) sees ONLY org #2
  const now = Date.now();
  const range = { startAt: now - 86_400_000, endAt: now + 86_400_000 };
  const sumTwo = await t.withIdentity({ subject: "u2", role: "admin", name: "T", email: "admin@two.test", orgId: String(prov.orgId) } as any)
    .query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumTwo.leads).toBe(1);   // only org #2's order — NOT 2
  // tenant #1 admin sees ONLY tenant #1
  const sumPi = await t.withIdentity({ subject: "u1", role: "admin", name: "PI", email: "admin@pi.test" } as any)
    .query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumPi.leads).toBe(1);    // only tenant #1's order — no leak either direction
});
