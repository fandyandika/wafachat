import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const ADMIN = { subject: "admin-1", role: "admin", name: "Owner", email: "owner@wafachat.test" };
const CS = { subject: "cs-1", role: "cs", name: "Aisyah", email: "aisyah@wafachat.test", csName: "Aisyah" };
const originalApiKey = process.env.KIRIMDEV_API_KEY;
const originalPanelSecret = process.env.PANEL_AUTH_SECRET;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.KIRIMDEV_API_KEY;
  else process.env.KIRIMDEV_API_KEY = originalApiKey;
  if (originalPanelSecret === undefined) delete process.env.PANEL_AUTH_SECRET;
  else process.env.PANEL_AUTH_SECRET = originalPanelSecret;
  vi.unstubAllGlobals();
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
  expect(setup.templates).toMatchObject([{
    templateName: "expedition_status_v1",
    language: "id",
    variables: [],
    isActive: true,
  }]);
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

test("admin channel cannot claim a provider number owned through a CS alias array", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run((ctx) => ctx.db.insert("csConfigs", {
    orgId, normalizedName: "aisyah", csName: "Aisyah", providerNumberIds: ["pn-admin"],
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
    isActive: true, createdAt: 1, updatedAt: 1,
  }));
  await expect(t.withIdentity(ADMIN).mutation(api.adminInbox.upsertChannel, {
    name: "Admin", providerNumberId: "pn-admin", isActive: true,
  })).rejects.toThrow(/proven unique/i);
});

test("a CS cannot later claim the admin channel provider number", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin", providerNumberId: "pn-admin", isActive: true,
  });
  await expect(asAdmin.mutation(api.csConfigs.upsert, {
    csName: "Aisyah", providerNumberIds: ["pn-admin"],
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
  })).rejects.toThrow(/proven unique/i);
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

test("template send reservation is allowlisted, ordered, and idempotent", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  process.env.PANEL_AUTH_SECRET = "server-secret";
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi", providerNumberId: "pn_admin", isActive: true,
  });
  const { templateId } = await asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId, label: "Status paket", templateName: "status_paket", language: "id",
    variables: [
      { key: "name", label: "Nama", required: true },
      { key: "resi", label: "Resi", required: true },
    ],
    isActive: true,
  });
  const args = {
    authSecret: "server-secret", orgId, actorUserId: "admin-1", actorName: "Owner",
    channelId, customerPhone: "0857-1568-2110", customerName: "Fandi", orderId: "ORD-1",
    templateId, values: [{ key: "resi", value: "JP123" }, { key: "name", value: "Fandi" }],
    clientRequestId: "request-1",
  };

  const first = await t.mutation(api.adminInbox.prepareTemplateSend, args);
  const duplicate = await t.mutation(api.adminInbox.prepareTemplateSend, args);
  expect(first).toMatchObject({
    shouldSend: true, customerPhone: "6285715682110", providerNumberId: "pn_admin",
    templateName: "status_paket", language: "id", orderedValues: ["Fandi", "JP123"],
  });
  expect(duplicate).toMatchObject({ shouldSend: false, messageId: first.messageId });
  const messages = await t.run((ctx) => ctx.db.query("adminThreadMessages").collect());
  expect(messages).toHaveLength(1);
});

test("sendTemplate action uses Convex KirimDev secret and does not resend a duplicate request", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  process.env.PANEL_AUTH_SECRET = "server-secret";
  process.env.KIRIMDEV_API_KEY = "kdv-secret";
  process.env.KIRIMDEV_BASE_URL = "https://api.test/v1";
  const request = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.action.1" }] }), { status: 200 }));
  vi.stubGlobal("fetch", request);
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin", providerNumberId: "pn-admin", isActive: true,
  });
  const { templateId } = await asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId, label: "Status", templateName: "status_paket", language: "id", variables: [], isActive: true,
  });
  const args = {
    authSecret: "server-secret", orgId, actorUserId: "admin-1", actorName: "Owner", channelId,
    customerPhone: "085715682110", templateId, values: [], clientRequestId: "action-request-1",
  };
  expect(await t.action(api.adminInbox.sendTemplate, args)).toMatchObject({ ok: true, duplicate: false });
  expect(await t.action(api.adminInbox.sendTemplate, args)).toMatchObject({ ok: true, duplicate: true });
  expect(request).toHaveBeenCalledTimes(1);
  const messages = await t.run((ctx) => ctx.db.query("adminThreadMessages").collect());
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ status: "accepted", providerMessageId: "wamid.action.1" });

  const timeout = vi.fn(async () => { throw new Error("timeout"); });
  vi.stubGlobal("fetch", timeout);
  const unknownArgs = { ...args, clientRequestId: "action-request-unknown" };
  expect(await t.action(api.adminInbox.sendTemplate, unknownArgs)).toMatchObject({ ok: false, statusUnknown: true });
  expect(await t.action(api.adminInbox.sendTemplate, unknownArgs)).toMatchObject({ ok: false, statusUnknown: true });
  expect(timeout).toHaveBeenCalledTimes(1);
});

test("template reservation rejects missing variables and foreign or inactive templates", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  process.env.PANEL_AUTH_SECRET = "server-secret";
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi", providerNumberId: "pn_admin", isActive: true,
  });
  const { templateId } = await asAdmin.mutation(api.adminInbox.upsertTemplate, {
    channelId, label: "Status paket", templateName: "status_paket", language: "id",
    variables: [{ key: "name", label: "Nama", required: true }], isActive: false,
  });
  await expect(t.mutation(api.adminInbox.prepareTemplateSend, {
    authSecret: "server-secret", orgId, actorUserId: "admin-1", actorName: "Owner", channelId,
    customerPhone: "085715682110", templateId, values: [], clientRequestId: "request-2",
  })).rejects.toThrow(/template.*aktif/i);
});

test("session text requires an open 24 hour window and finalize records provider outcome", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  process.env.PANEL_AUTH_SECRET = "server-secret";
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, {
    name: "Admin Ekspedisi", providerNumberId: "pn_admin", isActive: true,
  });
  const inbound = await t.mutation(internal.adminInbox.upsertInboundMessage, {
    orgId, channelId, customerPhone: "6285715682110", content: "Paket saya di mana?",
    providerMessageId: "wamid.in.24h", createdAt: Date.now(),
  });
  const reservation = await t.mutation(api.adminInbox.prepareTextSend, {
    authSecret: "server-secret", orgId, actorUserId: "admin-1", actorName: "Owner",
    threadId: inbound.threadId, text: "Baik, kami cek dulu ya.", clientRequestId: "request-text-1",
  });
  expect(reservation).toMatchObject({ shouldSend: true, customerPhone: "6285715682110", providerNumberId: "pn_admin" });
  await t.mutation(api.adminInbox.finalizeOutbound, {
    authSecret: "server-secret", orgId, messageId: reservation.messageId,
    status: "accepted", providerMessageId: "wamid.out.24h",
  });
  const messages = await asAdmin.query(api.adminInbox.listMessages, { threadId: inbound.threadId });
  expect(messages.at(-1)).toMatchObject({ status: "accepted", providerMessageId: "wamid.out.24h" });

  await t.run((ctx) => ctx.db.patch(inbound.threadId, { lastInboundAt: Date.now() - 24 * 60 * 60 * 1000 - 1 }));
  await expect(t.mutation(api.adminInbox.prepareTextSend, {
    authSecret: "server-secret", orgId, actorUserId: "admin-1", actorName: "Owner",
    threadId: inbound.threadId, text: "Halo lagi", clientRequestId: "request-text-2",
  })).rejects.toThrow(/24 jam/i);
});

test("admin inbox cancels and undoes only the exact linked order with an audit trail", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const asAdmin = t.withIdentity(ADMIN);
  const { channelId } = await asAdmin.mutation(api.adminInbox.upsertChannel, { name: "Admin", isActive: false });
  const inbound = await t.mutation(internal.adminInbox.upsertInboundMessage, {
    orgId, channelId, customerPhone: "6285715682110", orderId: "260810000001",
    content: "Paket bermasalah", providerMessageId: "wamid.cancel.1", createdAt: Date.now(),
  });
  const base = {
    orgId, customerPhone: "6285715682110", customerName: "Fandi", csName: "Aisyah", csKey: "aisyah",
    closedAt: Date.now(), recipientName: "Fandi", recipientPhone: "6285715682110",
    recipientAddress: "Bekasi", recipientDistrict: "Tambun", recipientCity: "Bekasi",
    packageContent: "Quran", paymentMethod: "transfer" as const, status: "ready" as const,
    flags: [] as string[], sourceMessageText: "closing", version: 1, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const [linkedId, otherId] = await t.run(async (ctx) => [
    await ctx.db.insert("shippingRecaps", { ...base, orderIdBerdu: "O-260810000001" }),
    await ctx.db.insert("shippingRecaps", { ...base, orderIdBerdu: "O-260810000002" }),
  ]);

  const cancelled = await asAdmin.mutation(api.adminInbox.cancelLinkedOrder, { threadId: inbound.threadId, reason: "Alamat perlu dikoreksi" });
  expect(cancelled).toMatchObject({ success: true, orderId: "O-260810000001", status: "cancelled" });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(linkedId))?.status).toBe("cancelled");
    expect((await ctx.db.get(otherId))?.status).toBe("ready");
    const events = await ctx.db.query("events").collect();
    expect(events.at(-1)?.metadata).toMatchObject({ source: "admin_expedition_inbox", actorUserId: "admin-1", actorName: "Owner" });
  });

  const undone = await asAdmin.mutation(api.adminInbox.undoLinkedOrderCancellation, { threadId: inbound.threadId });
  expect(undone).toMatchObject({ success: true, status: "ready" });
  expect((await asAdmin.query(api.adminInbox.getLinkedOrderState, { threadId: inbound.threadId }))?.status).toBe("ready");
  await expect(t.withIdentity(CS).mutation(api.adminInbox.cancelLinkedOrder, { threadId: inbound.threadId, reason: "Nope" })).rejects.toThrow(/requires admin/);
});
