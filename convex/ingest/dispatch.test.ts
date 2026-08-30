import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { captureAndScheduleKirimdev, captureAndScheduleScalev } from "./dispatch";
import { hmacBase64 } from "./scalevSignature";

const modules = (import.meta as any).glob("/convex/**/*.{ts,js}");

const input = {
  sourceKey: "kirimdev-pustakaislam",
  kind: "message.event" as const,
  rawHeaders: "{}",
  rawBody: "{}",
  signatureOk: true,
  orgId: "org-1",
};

test("captures before scheduling and never processes inline", async () => {
  const calls: string[] = [];
  const ctx = {
    runMutation: vi.fn(async () => {
      calls.push("capture");
      return "event-1";
    }),
    scheduler: {
      runAfter: vi.fn(async () => {
        calls.push("schedule");
      }),
    },
  };

  await captureAndScheduleKirimdev(ctx as never, input as never);

  expect(calls).toEqual(["capture", "schedule"]);
  expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
    0,
    internal.ingest.dispatch.processScheduledEvent,
    { eventId: "event-1" },
  );
  expect(ctx.runMutation).toHaveBeenCalledTimes(1);
});

test("Scalev duplicate capture is acknowledged without scheduling duplicate processing", async () => {
  const ctx = {
    runMutation: vi.fn(async () => ({ eventId: "event-1", duplicate: true })),
    scheduler: { runAfter: vi.fn(async () => undefined) },
  };

  await expect(captureAndScheduleScalev(ctx as never, {
    ...input,
    kind: "scalev.event",
    externalEventId: "event_scalev_001",
  } as never)).resolves.toEqual({ eventId: "event-1", duplicate: true });
  expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
});

test("a cutover rejection rolls back message writes and leaves the failed raw event replayable", async () => {
  const t = convexTest(schema);
  const { orgId, rawBody, eventId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: "pustakaislam",
      name: "Test Org",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "cs azelia",
      csName: "CS Azelia",
      key: "azelia",
      providerNumberIds: ["485071188032281"],
      orderAutomationEnabled: false,
      aiAssistantEnabled: false,
      reportingEnabled: true,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const runId = await ctx.db.insert("followUpPreparationRuns", {
      orgId,
      mode: "apply",
      status: "running",
      phase: "counters_delete",
      nextConversationStatus: "active",
      scanned: 0,
      eligible: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("followUpCutoverLocks", { orgId, runId, lockedAt: 1 });
    const rawBody = JSON.stringify({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "6285799533626" }],
        messages: [{
          id: "wamid.rollback",
          from: "6285799533626",
          text: { body: "halo kak" },
          type: "text",
          timestamp: "1783427359",
        }],
        metadata: { phone_number_id: "485071188032281" },
      } }] }],
    });
    const eventId = await ctx.db.insert("ingestEvents", {
      sourceKey: "kirimdev-pustakaislam",
      kind: "message.event",
      rawHeaders: JSON.stringify({ "x-kirim-event": "message.received" }),
      rawBody,
      signatureOk: true,
      orgId,
      status: "received",
      receivedAt: Date.now(),
    });
    return { orgId, rawBody, eventId };
  });

  expect(await t.action(internal.ingest.dispatch.processScheduledEvent, { eventId }))
    .toBeNull();

  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(0);
    expect(await ctx.db.query("conversations").collect()).toHaveLength(0);
    expect(await ctx.db.query("events").collect()).toHaveLength(0);
    expect(await ctx.db.query("providerChannelHealth").collect()).toHaveLength(0);
    expect(await ctx.db.get(eventId)).toMatchObject({
      status: "failed",
      rawBody,
      error: "Event processing failed. The captured raw event remains available for replay.",
    });
    const lock = await ctx.db.query("followUpCutoverLocks")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (lock) await ctx.db.delete(lock._id);
  });

  const asAdmin = t.withIdentity({
    subject: "a1",
    role: "admin",
    name: "Admin",
    email: "admin@example.com",
  });
  await expect(asAdmin.mutation(api.ingest.core.replayEvent, { eventId }))
    .resolves.toMatchObject({ status: "processed" });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("messages").collect()).toHaveLength(1);
  });
});

test("the KirimDev HTTP route acknowledges after capture without waiting for processing", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        slug: "pustakaislam",
        name: "Test Org",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("ingestSources", {
        orgId,
        sourceKey: "kirimdev-fast-ack",
        name: "KirimDev Fast ACK",
        kind: "kirimdev",
        secret: "test-secret",
        enabled: true,
        enforceSignature: false,
        createdAt: 1,
      });
    });
    const rawBody = JSON.stringify({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "6285799533626" }],
        messages: [{
          id: "wamid.fast-ack",
          from: "6285799533626",
          text: { body: "halo kak" },
          type: "text",
          timestamp: "1783427359",
        }],
        metadata: { phone_number_id: "unmapped-provider" },
      } }] }],
    });

    const response = await t.fetch("/webhooks/kirimdev?source=kirimdev-fast-ack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kirim-event": "message.received",
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    const responseBody = await response.json() as { ok: boolean; eventId: string };
    expect(responseBody).toMatchObject({ ok: true, eventId: expect.any(String) });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("messages").collect()).toHaveLength(0);
      expect(await ctx.db.get(responseBody.eventId as never)).toMatchObject({
        status: "received",
        rawBody,
      });
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(responseBody.eventId as never)).toMatchObject({
        status: "skipped",
      });
    });
  } finally {
    vi.useRealTimers();
  }
});

test("the Scalev HTTP route verifies, deduplicates, and asynchronously creates one provider-scoped order", async () => {
  vi.useFakeTimers();
  const previousSecret = process.env.SCALEV_WEBHOOK_SIGNING_SECRET;
  const previousApiKey = process.env.SCALEV_API_KEY;
  process.env.SCALEV_WEBHOOK_SIGNING_SECRET = "scalev-test-secret";
  process.env.SCALEV_API_KEY = "scalev-api-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
    id: "0198-route-order",
    handler: { id: 482913, fullname: "Aisyah" },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        slug: "pustakaislam",
        name: "Test Org",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("csConfigs", {
        orgId,
        normalizedName: "aisyah",
        csName: "Aisyah",
        key: "aisyah",
        scalevHandlerIds: ["482913"],
        orderAutomationEnabled: false,
        aiAssistantEnabled: false,
        reportingEnabled: true,
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("ingestSources", {
        orgId,
        sourceKey: "scalev-test",
        name: "Scalev Test",
        kind: "scalev",
        secret: "env:SCALEV_WEBHOOK_SIGNING_SECRET",
        enabled: true,
        enforceSignature: true,
        createdAt: 1,
      });
    });
    const rawBody = JSON.stringify({
      event: "order.created",
      unique_id: "event_scalev_route_001",
      timestamp: "2026-08-27T08:00:05.000Z",
      data: {
        id: "0198-route-order",
        order_id: "260827ROUTE",
        status: "pending",
        payment_status: "unpaid",
        gross_revenue: "189000.00",
        product_price: "179000.00",
        shipping_cost: "10000.00",
        destination_address: {
          name: "Fandi",
          phone: "085715682110",
          address: "Test",
          subdistrict: "Tambun Utara",
          city: "Kab. Bekasi",
        },
        orderlines: [{ product_name: "Quran Mapping", quantity: 1 }],
        created_at: "2026-08-27T15:00:00+07:00",
      },
    });
    const signature = await hmacBase64("scalev-test-secret", rawBody);

    const first = await t.fetch("/webhooks/scalev?source=scalev-test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-scalev-hmac-sha256": signature },
      body: rawBody,
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { eventId: string; duplicate: boolean };
    expect(firstBody).toMatchObject({ eventId: expect.any(String), duplicate: false });

    await t.run(async (ctx) => {
      expect(await ctx.db.query("orders").collect()).toHaveLength(0);
      expect(await ctx.db.query("ingestEvents").collect()).toHaveLength(1);
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const duplicate = await t.fetch("/webhooks/scalev?source=scalev-test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-scalev-hmac-sha256": signature },
      body: rawBody,
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ eventId: firstBody.eventId, duplicate: true });

    await t.run(async (ctx) => {
      expect(await ctx.db.query("ingestEvents").collect()).toHaveLength(1);
      expect(await ctx.db.query("orders").collect()).toEqual([
        expect.objectContaining({
          orderId: "scalev:0198-route-order",
          externalOrderId: "260827ROUTE",
          providerRecordId: "0198-route-order",
          source: "scalev",
          assignedCsName: "Aisyah",
          csKey: "aisyah",
        }),
      ]);
      expect(await ctx.db.query("conversations").collect()).toHaveLength(1);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SCALEV_WEBHOOK_SIGNING_SECRET;
    else process.env.SCALEV_WEBHOOK_SIGNING_SECRET = previousSecret;
    if (previousApiKey === undefined) delete process.env.SCALEV_API_KEY;
    else process.env.SCALEV_API_KEY = previousApiKey;
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  }
});
