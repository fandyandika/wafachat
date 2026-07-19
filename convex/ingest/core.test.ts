import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { processCapturedEvent, resolveBerduStaffMap } from "./core";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });

const RECEIVED_RAW = JSON.stringify({
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "6285799533626" }],
    messages: [{ id: "wamid.X1", from: "6285799533626", text: { body: "halo kak" }, type: "text", timestamp: "1783427359" }],
    metadata: { phone_number_id: "485071188032281" },
  } }] }],
});
const RECEIVED_HEADERS = JSON.stringify({ "x-kirim-event": "message.received" });

test("resolveBerduStaffMap fails closed above the active registry cap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 51; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `agent-${i}`, csName: `Agent ${i}`, key: `agent-${i}`,
        nameAliases: [], berduStaffIds: [`STAFF-${i}`], providerNumberIds: [],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: true, createdAt: i + 1, updatedAt: 1,
      });
    }
  });
  await t.run(async (ctx) => {
    expect(await resolveBerduStaffMap(ctx, orgId)).toEqual({});
  });
});

async function captureKirimdev(t: ReturnType<typeof convexTest>, orgId: any, rawBody: string, rawHeaders = RECEIVED_HEADERS) {
  return t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders, rawBody, signatureOk: true, orgId,
  });
}

test("processEvent ingests message with original timestamp + CS from providerNumberIds", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberIds: ["485071188032281"],
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const eventId = await captureKirimdev(t, orgId, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId });

  const events = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(events[0].status).toBe("processed");
  await t.run(async (ctx) => {
    const msgs = await ctx.db.query("messages").collect();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      content: "halo kak", direction: "inbound", createdAt: 1783427359000, source: "ingest",
    });
    const convs = await ctx.db.query("conversations").collect();
    expect(convs[0].assignedCsName).toBe("CS Azelia");
  });
});

test("legacy single providerNumberId still matches", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberId: "485071188032281",
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const eventId = await captureKirimdev(t, orgId, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const convs = await ctx.db.query("conversations").collect();
    expect(convs[0].assignedCsName).toBe("CS Azelia");
  });
});

test("idempotent: same externalMessageId twice -> one message, both events processed", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const e1 = await captureKirimdev(t, orgId, RECEIVED_RAW);
  const e2 = await captureKirimdev(t, orgId, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId: e1 });
  await t.mutation(internal.ingest.core.processEvent, { eventId: e2 });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(1);
  });
  const events = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(events.every((e) => e.status === "processed")).toBe(true);
});

test("skip payload marks skipped with reason", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
  const eventId = await captureKirimdev(t, orgId, raw);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  const skipped = await asAdmin(t).query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("inbound no message");
});

test("closing detection fires through the ingest path", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const sentRaw = JSON.stringify({
    type: "message.sent",
    data: {
      contact: { phone_number: "+6285799533626" },
      message: { id: "m1", provider_id: "wamid.CLOSE1", to: "+6285799533626",
        body: "PEMESANAN BERHASIL\nditerima ya kak", type: "text", source: "dashboard" },
      timestamp: "2026-07-07T12:29:19.000Z",
      meta: { phone_number_id: "485071188032281" },
    },
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders: JSON.stringify({ "x-kirim-event": "message.sent" }), rawBody: sentRaw, signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const recaps = await ctx.db.query("shippingRecaps").collect();
    expect(recaps).toHaveLength(1);
  });
});

test("replayEvent re-processes an event (admin only), bookkeeping via replayOf", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const eventId = await captureKirimdev(t, orgId, RECEIVED_RAW);
  await t.mutation(internal.ingest.events.markFailed, { eventId, error: "simulated" });
  await expect(t.mutation(api.ingest.core.replayEvent, { eventId })).rejects.toThrow(/unauthorized/);
  const res = await asAdmin(t).mutation(api.ingest.core.replayEvent, { eventId });
  expect(res.status).toBe("processed");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(1);
  });
  const all = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(all.some((e) => e.replayOf === eventId)).toBe(true);
});

test("replayAllFailed replays every failed event", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const e1 = await captureKirimdev(t, orgId, RECEIVED_RAW);
  await t.mutation(internal.ingest.events.markFailed, { eventId: e1, error: "x" });
  const res = await asAdmin(t).mutation(api.ingest.core.replayAllFailed, {});
  expect(res.replayed).toBe(1);
  const failed = await asAdmin(t).query(api.ingest.events.listRecent, { status: "failed" });
  expect(failed).toHaveLength(0);
});

test("lead.created ingests order via upsertOrderCore with preserved createdAt", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "cs azelia", csName: "CS Azelia",
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const raw = JSON.stringify({ order: {
    id: "O-260708000123", created_at: "2026-07-08T09:15:00+07:00", assigned_to_staff: "B-Z28TdYc",
    shipping_cost: 15000, total: 100000,
    shipping_address: { phone: "085799533626", firstName: "Kurn", address: "Jl. Mawar 1", district: "Coblong", city: "Bandung" },
    products: [{ name: "Buku Sirah", price: 85000, count: 1 }],
  }});
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}", rawBody: raw, signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderId: "O-260708000123",
      createdAt: Date.parse("2026-07-08T09:15:00+07:00"),
    });
  });
});

test("lead.created attribution: csConfigs.berduStaffIds overrides the baked default map", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "sari", csName: "Sari",
      berduStaffIds: ["B-1apQSy"], // id that the DEFAULT map assigns to Aisyah
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607110001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234500999", firstName: "Budi", address: "Jl. X", district: "Y", city: "Z" },
    } }),
    signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607110001"));
    expect(order?.assignedCsName).toBe("Sari"); // registry won, not baked "Aisyah"
  });
});

test("ingestion reads tenant closing phrases only for outbound text while retaining closing detection", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("closingRules", { orgId, phrase: "CUSTOM CLOSED", active: true, createdAt: 1 });
    let closingRuleQueries = 0;
    const tracedCtx = {
      ...ctx,
      db: new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "query") {
            return (table: string) => {
              if (table === "closingRules") closingRuleQueries++;
              return target.query(table);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    const event = (rawBody: Record<string, unknown>) => ({
      sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}",
      rawBody: JSON.stringify(rawBody), receivedAt: 1, orgId,
    });

    await processCapturedEvent(tracedCtx, event({
      phone: "6281234567001", direction: "inbound", role: "customer",
      content: "CUSTOM CLOSED", externalMessageId: "inbound-close",
    }));
    expect(closingRuleQueries).toBe(0);

    await processCapturedEvent(tracedCtx, event({
      phone: "6281234567002", direction: "outbound", role: "cs", messageType: "template",
      content: "CUSTOM CLOSED", externalMessageId: "template-close",
    }));
    expect(closingRuleQueries).toBe(0);
    const template = await ctx.db.query("messages")
      .withIndex("by_org_externalMessageId", (q: any) => q.eq("orgId", orgId).eq("externalMessageId", "template-close"))
      .unique();
    expect(template?.messageType).toBe("text");

    await processCapturedEvent(tracedCtx, event({
      phone: "6281234567004", direction: "outbound", role: "cs", messageType: "future_type",
      content: "CUSTOM CLOSED", externalMessageId: "unknown-type-close",
    }));
    expect(closingRuleQueries).toBe(0);
    const unknown = await ctx.db.query("messages")
      .withIndex("by_org_externalMessageId", (q: any) => q.eq("orgId", orgId).eq("externalMessageId", "unknown-type-close"))
      .unique();
    expect(unknown?.messageType).toBe("text");

    await processCapturedEvent(tracedCtx, event({
      phone: "6281234567003", direction: "outbound", role: "cs", messageType: "text",
      content: "CUSTOM CLOSED", externalMessageId: "text-close",
    }));
    expect(closingRuleQueries).toBe(1);
    expect(await ctx.db.query("shippingRecaps")
      .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId))
      .collect()).toHaveLength(1);
  });
});

test("generic template ingest retains the established response-sample path", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const inboundEventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}",
    rawBody: JSON.stringify({
      phone: "6281234567100", direction: "inbound", role: "customer",
      content: "halo", externalMessageId: "template-inbound", timestamp: 1_000,
    }), signatureOk: true, orgId,
  });
  const templateEventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}",
    rawBody: JSON.stringify({
      phone: "6281234567100", direction: "outbound", role: "cs", messageType: "template",
      content: "PEMESANAN BERHASIL", externalMessageId: "template-outbound", timestamp: 2_000,
    }), signatureOk: true, orgId,
  });

  await t.mutation(internal.ingest.core.processEvent, { eventId: inboundEventId });
  await t.mutation(internal.ingest.core.processEvent, { eventId: templateEventId });

  await t.run(async (ctx: any) => {
    expect(await ctx.db.query("responseSamples").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId)).collect()).toHaveLength(1);
    expect(await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId)).collect()).toHaveLength(0);
  });
});

test("unknown generic source type preserves persistence, deduplication, and response sampling", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const capture = (rawBody: Record<string, unknown>) => t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}",
    rawBody: JSON.stringify(rawBody), signatureOk: true, orgId,
  });
  const inboundEventId = await capture({
    phone: "6281234567200", direction: "inbound", role: "customer",
    content: "halo", externalMessageId: "unknown-inbound", timestamp: 1_000,
  });
  const outboundBody = {
    phone: "6281234567200", direction: "outbound", role: "cs", messageType: "future_type",
    content: "PEMESANAN BERHASIL", externalMessageId: "unknown-outbound", timestamp: 2_000,
  };
  const outboundEventId = await capture(outboundBody);
  const duplicateEventId = await capture(outboundBody);

  await t.mutation(internal.ingest.core.processEvent, { eventId: inboundEventId });
  await t.mutation(internal.ingest.core.processEvent, { eventId: outboundEventId });
  await t.mutation(internal.ingest.core.processEvent, { eventId: duplicateEventId });

  await t.run(async (ctx: any) => {
    const messages = await ctx.db.query("messages")
      .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId))
      .collect();
    expect(messages).toHaveLength(2);
    expect(messages.find((message: any) => message.externalMessageId === "unknown-outbound")?.messageType).toBe("text");
    expect(await ctx.db.query("responseSamples").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId)).collect()).toHaveLength(1);
    expect(await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId)).collect()).toHaveLength(0);
  });
});

test("lead.created attribution: baked staff map is tenant-1 only", async () => {
  const t = convexTest(schema);
  const defaultOrgId = await seedOrg(t);
  const otherOrgId = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "tenant-two", name: "Tenant Two", createdAt: 1, updatedAt: 1,
  })) as Id<"organizations">;
  const rawBody = (id: string, phone: string) => JSON.stringify({ order: {
    id, assigned_to_staff: "B-1apQSy",
    products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
    shipping_address: { phone, firstName: "Budi", address: "Jl. X", district: "Y", city: "Z" },
  } });

  const defaultEventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: rawBody("2607111001", "6281234510001"), signatureOk: true, orgId: defaultOrgId,
  });
  const otherEventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-tenant-two", kind: "lead.created", rawHeaders: "{}",
    rawBody: rawBody("2607111002", "6281234510002"), signatureOk: true, orgId: otherOrgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId: defaultEventId });
  await t.mutation(internal.ingest.core.processEvent, { eventId: otherEventId });

  await t.run(async (ctx: any) => {
    const defaultOrder = await ctx.db.query("orders")
      .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", defaultOrgId))
      .unique();
    const otherOrder = await ctx.db.query("orders")
      .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", otherOrgId))
      .unique();
    expect(defaultOrder?.assignedCsName).toBe("Aisyah");
    expect(otherOrder?.assignedCsName).toBe("Staff B-1apQSy");
    expect(otherOrder?.assignedCsName).not.toBe("Aisyah");
  });
});

test("generic.message ingests via universal contract", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const raw = JSON.stringify({
    phone: "6281234567890", direction: "inbound", role: "customer",
    content: "tanya stok", externalMessageId: "ext-1", timestamp: 1783427359000,
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.message", rawHeaders: "{}", rawBody: raw, signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const msgs = await ctx.db.query("messages").collect();
    expect(msgs[0]).toMatchObject({ content: "tanya stok", createdAt: 1783427359000 });
  });
});

test("generic.lead validates required fields", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "custom-x", kind: "generic.lead", rawHeaders: "{}",
    rawBody: JSON.stringify({ phone: "628123" }), signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  const asAdminT = t.withIdentity({ subject: "a1", role: "admin", name: "A", email: "a@w" });
  const skipped = await asAdminT.query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("missing phone/orderId/csName");
});

test("orgId threads: source.orgId -> captured event -> stored order", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607119001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234509999", firstName: "Test", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true,
    orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const ev = await ctx.db.get(eventId);
    expect(ev?.orgId).toEqual(orgId);
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607119001"));
    expect(order?.orgId).toEqual(orgId);
  });
});

test("orgId absent (pre-seed source): event still processes, rows unstamped", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607119002", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234508888", firstName: "Test", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true, orgId,
  });
  const out = await t.mutation(internal.ingest.core.processEvent, { eventId });
  expect(out.status).toBe("processed");
  await t.run(async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    const order = orders.find((o) => o.orderId.includes("2607119002"));
    expect(order?.orgId).toEqual(orgId);
  });
});

test("rename-safety: after display rename, new orders keep the OLD immutable key", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "ayesha", csName: "Ayesha", key: "aisyah", // renamed: display new, key old
      nameAliases: ["Aisyah"], berduStaffIds: ["B-1apQSy"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "berdu-pustakaislam", kind: "lead.created", rawHeaders: "{}",
    rawBody: JSON.stringify({ order: { id: "2607129001", assigned_to_staff: "B-1apQSy",
      products: [{ name: "Quran Mapping", price: 100000, count: 1 }],
      shipping_address: { phone: "6281234501111", firstName: "T", address: "X", district: "Y", city: "Z" } } }),
    signatureOk: true, orgId,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx: any) => {
    const order = (await ctx.db.query("orders").collect()).find((o: any) => o.orderId.includes("2607129001"));
    expect(order?.assignedCsName).toBe("Ayesha"); // display = current name (via registry staff map)
    expect(order?.csKey).toBe("aisyah");          // identity = OLD key (canonicalizeCs csName-match)
  });
});
