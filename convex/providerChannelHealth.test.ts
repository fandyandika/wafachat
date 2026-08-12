import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { touchProviderChannelHealth } from "./providerChannelHealth";

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.insert("organizations", {
    slug: "pustakaislam",
    name: "Test Org",
    createdAt: 1,
    updatedAt: 1,
  }));
}

const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });

test("touchProviderChannelHealth upserts one row and clears an old safe diagnostic", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);

  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, {
      orgId,
      providerNumberId: "pn-cs",
      channelType: "unknown",
      direction: "inbound",
      touchedAt: 100,
    });
    await touchProviderChannelHealth(ctx, {
      orgId,
      providerNumberId: "pn-cs",
      channelType: "cs",
      csKey: "azelia",
      direction: "outbound",
      touchedAt: 200,
    });

    const rows = await ctx.db.query("providerChannelHealth").collect();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId,
      providerNumberId: "pn-cs",
      channelType: "cs",
      csKey: "azelia",
      lastInboundAt: 100,
      lastOutboundAt: 200,
      updatedAt: 200,
    });
    expect(rows[0].lastError).toBeUndefined();
    expect(rows[0].errorAt).toBeUndefined();
  });
});

test("older unknown replay does not move errorAt or direction timestamps backward", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, {
      orgId, providerNumberId: "pn-unknown", channelType: "unknown",
      direction: "inbound", touchedAt: 500,
    });
    await touchProviderChannelHealth(ctx, {
      orgId, providerNumberId: "pn-unknown", channelType: "unknown",
      direction: "inbound", touchedAt: 100,
    });
    await touchProviderChannelHealth(ctx, {
      orgId, providerNumberId: "pn-unknown", channelType: "cs", csKey: "stale-cs",
      direction: "outbound", touchedAt: 50,
    });
    expect(await ctx.db.query("providerChannelHealth").unique()).toMatchObject({
      channelType: "unknown",
      lastInboundAt: 500,
      lastOutboundAt: 50,
      errorAt: 500,
      updatedAt: 500,
    });
  });
});

test("listProviderChannelHealth is authenticated, tenant-scoped, paginated, and returns no webhook body", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const [providerNumberId, touchedAt] of [["pn-old", 100], ["pn-middle", 200], ["pn-new", 300]] as const) {
      await touchProviderChannelHealth(ctx, {
        orgId, providerNumberId, channelType: "unknown", direction: "inbound", touchedAt,
      });
    }
  });

  const channelHealthApi = api.providerChannelHealth.listProviderChannelHealth;
  await expect(t.query(channelHealthApi, { paginationOpts: { numItems: 2, cursor: null } })).rejects.toThrow(/unauthorized/);
  const first = await asAdmin(t).query(channelHealthApi, { paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page.map((row: any) => row.providerNumberId)).toEqual(["pn-new", "pn-middle"]);
  expect(first.isDone).toBe(false);
  const second = await asAdmin(t).query(channelHealthApi, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.page.map((row: any) => row.providerNumberId)).toEqual(["pn-old"]);
  expect(second.isDone).toBe(true);
  expect(first.page[0]).toEqual(expect.objectContaining({
    providerNumberId: "pn-new",
    channelType: "unknown",
    lastError: "Nomor provider belum dipetakan",
  }));
  expect(first.page[0]).not.toHaveProperty("rawBody");
  expect(first.page[0]).not.toHaveProperty("rawHeaders");
});

test.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -1])(
  "listProviderChannelHealth rejects invalid page size %s before pagination",
  async (numItems) => {
    const t = convexTest(schema);
    await seedOrg(t);
    await expect(asAdmin(t).query(api.providerChannelHealth.listProviderChannelHealth, {
      paginationOpts: { numItems, cursor: null },
    })).rejects.toThrow(/page size must be a positive finite integer/i);
  },
);

test('getProviderChannelHealthForCs finds an exact canonical key beyond the newest 50 rows', async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, {
      orgId, providerNumberId: 'pn-exact', channelType: 'cs', csKey: 'sitinuraulia', direction: 'inbound', touchedAt: 1,
    });
    for (let i = 0; i < 60; i++) {
      await touchProviderChannelHealth(ctx, {
        orgId, providerNumberId: `pn-new-${i}`, channelType: 'cs', csKey: `new-${i}`, direction: 'inbound', touchedAt: 100 + i,
      });
    }
  });
  await expect(asAdmin(t).query(api.providerChannelHealth.getProviderChannelHealthForCs, { csKey: 'siti-nur-aulia' }))
    .resolves.toMatchObject({ providerNumberId: 'pn-exact', csKey: 'sitinuraulia' });
});

test('exact channel health lookup is tenant-scoped and authenticated', async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const otherOrgId = await t.run((ctx) => ctx.db.insert('organizations', { slug: 'other-health', name: 'Other', createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'ours', channelType: 'cs', csKey: 'queenrisma', direction: 'inbound', touchedAt: 1 });
    await touchProviderChannelHealth(ctx, { orgId: otherOrgId, providerNumberId: 'theirs', channelType: 'cs', csKey: 'queenrisma', direction: 'inbound', touchedAt: 2 });
  });
  await expect(t.query(api.providerChannelHealth.getProviderChannelHealthForCs, { csKey: 'queen-risma' })).rejects.toThrow(/unauthorized/);
  await expect(asAdmin(t).query(api.providerChannelHealth.getProviderChannelHealthForCs, { csKey: 'queen-risma' }))
    .resolves.toMatchObject({ providerNumberId: 'ours' });
});

test('CS health lookup is server-scoped to its own canonical identity', async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const userId = await t.run((ctx) => ctx.db.insert('users', { orgId, email: 'siti@w', name: 'Siti Nur, Aulia', passwordHash: 'x', role: 'cs', csName: 'Siti Nur, Aulia', isActive: true, createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'siti-provider', channelType: 'cs', csKey: 'sitinuraulia', direction: 'inbound', touchedAt: 1 });
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'lila-provider', channelType: 'cs', csKey: 'lila', direction: 'inbound', touchedAt: 2 });
  });
  const cs = t.withIdentity({ subject: String(userId), role: 'cs', name: 'Siti Nur, Aulia', email: 'siti@w', csName: 'Siti Nur, Aulia' });
  await expect(cs.query(api.providerChannelHealth.getProviderChannelHealthForCs, { csKey: 'lila' }))
    .resolves.toMatchObject({ providerNumberId: 'siti-provider', csKey: 'sitinuraulia' });
});

test('exact health deterministically returns the newest error across multiple provider numbers', async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'healthy-newest', channelType: 'cs', csKey: 'aisyah', direction: 'inbound', touchedAt: 500 });
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'error-old', channelType: 'cs', csKey: 'aisyah', direction: 'outbound', touchedAt: 200, diagnostic: 'Old error' });
    await touchProviderChannelHealth(ctx, { orgId, providerNumberId: 'error-new', channelType: 'cs', csKey: 'aisyah', direction: 'outbound', touchedAt: 300, diagnostic: 'Newest error' });
  });
  await expect(asAdmin(t).query(api.providerChannelHealth.getProviderChannelHealthForCs, { csKey: 'CS Aisyah' }))
    .resolves.toMatchObject({ providerNumberId: 'error-new', lastError: 'Newest error' });
});
