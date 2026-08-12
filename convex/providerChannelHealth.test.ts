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

test("listProviderChannelHealth is authenticated and returns no webhook body", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run((ctx) => touchProviderChannelHealth(ctx, {
    orgId,
    providerNumberId: "pn-unknown",
    channelType: "unknown",
    direction: "inbound",
    touchedAt: 300,
  }));

  const channelHealthApi = (api as any).providerChannelHealth.listProviderChannelHealth;
  await expect(t.query(channelHealthApi, {})).rejects.toThrow(/unauthorized/);
  const rows = await asAdmin(t).query(channelHealthApi, {});
  expect(rows).toEqual([expect.objectContaining({
    providerNumberId: "pn-unknown",
    channelType: "unknown",
    lastError: "Nomor provider belum dipetakan",
  })]);
  expect(rows[0]).not.toHaveProperty("rawBody");
  expect(rows[0]).not.toHaveProperty("rawHeaders");
});
