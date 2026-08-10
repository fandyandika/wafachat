import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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

test("thread list is paginated, newest first, and archive-aware", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    isActive: false,
  });
  await t.run(async (ctx) => {
    for (let index = 1; index <= 3; index += 1) {
      await ctx.db.insert("adminThreads", {
        orgId,
        channelId,
        customerPhone: `62811111111${index}`,
        customerName: `Customer ${index}`,
        archived: false,
        createdAt: index,
        updatedAt: index,
      });
    }
  });

  const first = await asAdmin.query(api.adminInbox.listThreads, {
    channelId,
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.page.map((row) => row.customerName)).toEqual(["Customer 3", "Customer 2"]);
  expect(first.isDone).toBe(false);
  const second = await asAdmin.query(api.adminInbox.listThreads, {
    channelId,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.page.map((row) => row.customerName)).toEqual(["Customer 1"]);

  await asAdmin.mutation(api.adminInbox.archiveThread, { threadId: first.page[0].id, archived: true });
  const active = await asAdmin.query(api.adminInbox.listThreads, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(active.page.map((row) => row.customerName)).not.toContain("Customer 3");
  const includingArchived = await asAdmin.query(api.adminInbox.listThreads, {
    channelId,
    includeArchived: true,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(includingArchived.page.map((row) => row.customerName)).toContain("Customer 3");
});

test("inbound admin message is idempotent and never writes sales tables", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi",
    isActive: false,
  });

  const before = await t.run(async (ctx) => ({
    conversations: (await ctx.db.query("conversations").collect()).length,
    messages: (await ctx.db.query("messages").collect()).length,
    dailyRollups: (await ctx.db.query("dailyRollups").collect()).length,
    shippingRecaps: (await ctx.db.query("shippingRecaps").collect()).length,
  }));
  const args = {
    orgId,
    channelId,
    customerPhone: "0857-1568-2110",
    customerName: "Fandi",
    content: "Paket saya di mana?",
    providerMessageId: "wamid.inbound.1",
    providerEventId: "evt-1",
    createdAt: 1_000,
  };
  const first = await t.mutation(internal.adminInbox.upsertInboundMessage, args);
  const duplicate = await t.mutation(internal.adminInbox.upsertInboundMessage, args);
  expect(duplicate).toEqual({ ...first, deduped: true });

  const after = await t.run(async (ctx) => ({
    conversations: (await ctx.db.query("conversations").collect()).length,
    messages: (await ctx.db.query("messages").collect()).length,
    dailyRollups: (await ctx.db.query("dailyRollups").collect()).length,
    shippingRecaps: (await ctx.db.query("shippingRecaps").collect()).length,
  }));
  expect(after).toEqual(before);

  const thread = (await asAdmin.query(api.adminInbox.listThreads, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  })).page[0];
  expect(thread.customerPhone).toBe("6285715682110");
  expect(thread.windowOpen).toBe(false);
  const messages = await asAdmin.query(api.adminInbox.listMessages, { threadId: thread.id, limit: 500 });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ direction: "inbound", content: "Paket saya di mana?", status: "delivered" });
});

test("thread and message reads enforce tenant ownership", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "org-b", name: "Org B", createdAt: 1, updatedAt: 1,
  }));
  const adminA = { ...ADMIN, subject: "admin-a", email: "a@wafachat.test" };
  const adminB = { ...ADMIN, subject: "admin-b", email: "b@wafachat.test" };
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { orgId: orgA, email: adminA.email, name: "A", passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("users", { orgId: orgB, email: adminB.email, name: "B", passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
  });
  const asA = t.withIdentity(adminA);
  const asB = t.withIdentity(adminB);
  const { channelId } = await asA.mutation(api.adminInbox.upsertChannel, { name: "A", isActive: false });
  const inbound = await t.mutation(internal.adminInbox.upsertInboundMessage, {
    orgId: orgA, channelId, customerPhone: "628111111111", content: "Halo",
    providerMessageId: "wamid-a", createdAt: 10,
  });

  await expect(asB.query(api.adminInbox.listThreads, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  })).rejects.toThrow(/channel not found/i);
  await expect(asB.query(api.adminInbox.listMessages, { threadId: inbound.threadId })).rejects.toThrow(/thread not found/i);
});
