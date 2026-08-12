import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { captureAndScheduleKirimdev } from "./dispatch";

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

  await t.action(internal.ingest.dispatch.processScheduledEvent, { eventId });

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
