import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ADMIN = { subject: "admin-1", role: "admin", name: "Owner", email: "owner@wafachat.test" };
const CS = { subject: "cs-1", role: "cs", name: "Aisyah", email: "aisyah@wafachat.test", csName: "Aisyah" };
const originalApiKey = process.env.KIRIMDEV_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.KIRIMDEV_API_KEY;
  else process.env.KIRIMDEV_API_KEY = originalApiKey;
});

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.insert("organizations", {
    slug: "pustakaislam",
    name: "Test Org",
    createdAt: 1,
    updatedAt: 1,
  }));
}

test("admin configures one channel and an allowlisted expedition template", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  process.env.KIRIMDEV_API_KEY = "kdv_test";
  const asAdmin = t.withIdentity(ADMIN);

  const channel = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    displayPhone: "6285715682110",
    providerNumberId: "pn_admin",
    isActive: true,
  });
  const template = await asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId: channel.channelId,
    label: "Status pengiriman",
    templateName: "expedition_status_v1",
    language: "id",
    variables: [
      { key: "name", label: "Nama", required: true },
      { key: "resi", label: "Nomor resi", required: true },
    ],
    isActive: true,
  });

  expect(template.templateId).toBeTruthy();
  expect(await asAdmin.query(api.adminInbox.getSetup, {})).toMatchObject({
    ready: true,
    missing: [],
    channel: { name: "Admin Ekspedisi", providerNumberId: "pn_admin" },
    templates: [{ templateName: "expedition_status_v1", category: "expedition" }],
  });
});

test("setup reports exact missing requirements without exposing secrets", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  delete process.env.KIRIMDEV_API_KEY;
  const asAdmin = t.withIdentity(ADMIN);

  const channel = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    isActive: true,
  });
  await asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId: channel.channelId,
    label: "Status pengiriman",
    templateName: "expedition_status_v1",
    language: "id",
    variables: [],
    isActive: true,
  });

  const setup = await asAdmin.query(api.adminInbox.getSetup, {});
  expect(setup.ready).toBe(false);
  expect(setup.missing).toEqual(["Nomor API KirimDev", "KIRIMDEV_API_KEY"]);
  expect(JSON.stringify(setup)).not.toContain("kdv_");
});

test("CS cannot read or mutate admin expedition configuration", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: CS.email,
    name: CS.name,
    passwordHash: "hash",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  const asCs = t.withIdentity(CS);

  await expect(asCs.query(api.adminInbox.getSetup, {})).rejects.toThrow(/requires admin/);
  await expect(asCs.mutation(api.adminInbox.upsertChannel, {
    name: "Nope",
    isActive: true,
  })).rejects.toThrow(/requires admin/);
});

test("configuration rejects invalid template names and foreign channels", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const foreignOrgId = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "foreign",
    name: "Foreign",
    createdAt: 1,
    updatedAt: 1,
  }));
  const foreignChannelId = await t.run((ctx) => ctx.db.insert("adminChannels", {
    orgId: foreignOrgId,
    name: "Foreign",
    provider: "kirimdev",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  expect(orgId).not.toBe(foreignOrgId);
  const asAdmin = t.withIdentity(ADMIN);
  const channel = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    isActive: true,
  });

  await expect(asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId: channel.channelId,
    label: "Invalid",
    templateName: "Invalid Template!",
    language: "id",
    variables: [],
    isActive: true,
  })).rejects.toThrow(/template name/i);

  await expect(asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId: foreignChannelId,
    label: "Foreign",
    templateName: "expedition_status_v1",
    language: "id",
    variables: [],
    isActive: true,
  })).rejects.toThrow(/channel not found/);
});

test("phase one refuses an organization with multiple channel rows", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const name of ["One", "Two"]) {
      await ctx.db.insert("adminChannels", {
        orgId,
        name,
        provider: "kirimdev",
        isActive: name === "One",
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });

  await expect(t.withIdentity(ADMIN).mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    isActive: true,
  })).rejects.toThrow(/one admin channel/i);
});
