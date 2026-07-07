import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";

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

async function captureKirimdev(t: ReturnType<typeof convexTest>, rawBody: string, rawHeaders = RECEIVED_HEADERS) {
  return t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders, rawBody, signatureOk: true,
  });
}

test("processEvent ingests message with original timestamp + CS from providerNumberIds", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberIds: ["485071188032281"],
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
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
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "cs azelia", csName: "CS Azelia",
      providerNumberId: "485071188032281",
      orderAutomationEnabled: false, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const convs = await ctx.db.query("conversations").collect();
    expect(convs[0].assignedCsName).toBe("CS Azelia");
  });
});

test("idempotent: same externalMessageId twice -> one message, both events processed", async () => {
  const t = convexTest(schema);
  const e1 = await captureKirimdev(t, RECEIVED_RAW);
  const e2 = await captureKirimdev(t, RECEIVED_RAW);
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
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
  const eventId = await captureKirimdev(t, raw);
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  const skipped = await asAdmin(t).query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("inbound no message");
});

test("closing detection fires through the ingest path", async () => {
  const t = convexTest(schema);
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
    rawHeaders: JSON.stringify({ "x-kirim-event": "message.sent" }), rawBody: sentRaw, signatureOk: true,
  });
  await t.mutation(internal.ingest.core.processEvent, { eventId });
  await t.run(async (ctx) => {
    const recaps = await ctx.db.query("shippingRecaps").collect();
    expect(recaps).toHaveLength(1);
  });
});

test("replayEvent re-processes an event (admin only), bookkeeping via replayOf", async () => {
  const t = convexTest(schema);
  const eventId = await captureKirimdev(t, RECEIVED_RAW);
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
  const e1 = await captureKirimdev(t, RECEIVED_RAW);
  await t.mutation(internal.ingest.events.markFailed, { eventId: e1, error: "x" });
  const res = await asAdmin(t).mutation(api.ingest.core.replayAllFailed, {});
  expect(res.replayed).toBe(1);
  const failed = await asAdmin(t).query(api.ingest.events.listRecent, { status: "failed" });
  expect(failed).toHaveLength(0);
});
