import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { runHealthChecksByOrg, shouldAlert } from "./monitor";

// 2026-07-08 10:00 WIB == 03:00 UTC
const WORK_HOURS = Date.UTC(2026, 6, 8, 3, 0, 0);
// 2026-07-08 23:30 WIB == 16:30 UTC
const NIGHT = Date.UTC(2026, 6, 8, 16, 30, 0);

describe("shouldAlert (pure)", () => {
  test("silence >=45min inside work hours fires", () => {
    const r = shouldAlert({ lastProcessedMessageAt: WORK_HOURS - 46 * 60_000, failedLast15m: 0 }, WORK_HOURS);
    expect(r.silence).toBe(true);
  });
  test("silence <45min does not fire", () => {
    const r = shouldAlert({ lastProcessedMessageAt: WORK_HOURS - 44 * 60_000, failedLast15m: 0 }, WORK_HOURS);
    expect(r.silence).toBe(false);
  });
  test("outside work hours never fires silence", () => {
    const r = shouldAlert({ lastProcessedMessageAt: NIGHT - 5 * 3_600_000, failedLast15m: 0 }, NIGHT);
    expect(r.silence).toBe(false);
  });
  test("null last-message inside work hours fires (never ingested anything)", () => {
    expect(shouldAlert({ lastProcessedMessageAt: null, failedLast15m: 0 }, WORK_HOURS).silence).toBe(true);
  });
  test("failure spike >=5 fires regardless of hours", () => {
    expect(shouldAlert({ lastProcessedMessageAt: NIGHT, failedLast15m: 5 }, NIGHT).failureSpike).toBe(true);
    expect(shouldAlert({ lastProcessedMessageAt: NIGHT, failedLast15m: 4 }, NIGHT).failureSpike).toBe(false);
  });
});

describe("per-organization health loop", () => {
  test("logs a failed organization and continues with later organizations", async () => {
    const visited: string[] = [];
    const failures: Array<{ slug: string; message: string }> = [];

    await runHealthChecksByOrg(
      [{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }],
      async (org) => {
        visited.push(org.slug);
        if (org.slug === "org-a") throw new Error("snapshot unavailable");
      },
      (org, error) => failures.push({ slug: org.slug, message: (error as Error).message }),
    );

    expect(visited).toEqual(["org-a", "org-b"]);
    expect(failures).toEqual([{ slug: "org-a", message: "snapshot unavailable" }]);
  });
});

describe("health snapshot + cooldown", () => {
  test("snapshot isolates each organization and finds message events past unrelated kinds", async () => {
    const t = convexTest(schema);
    const [orgA, orgB] = await Promise.all([
      t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-a", name: "Org A", createdAt: 1, updatedAt: 1 })),
      t.run((ctx: any) => ctx.db.insert("organizations", { slug: "org-b", name: "Org B", createdAt: 1, updatedAt: 1 })),
    ]) as any[];
    const processedMessage = await t.mutation(internal.ingest.events.captureEvent, {
      orgId: orgA, sourceKey: "a", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markProcessed, { eventId: processedMessage });
    for (let i = 0; i < 51; i++) {
      const eventId = await t.mutation(internal.ingest.events.captureEvent, {
        orgId: orgA, sourceKey: "a", kind: "lead.created", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
      });
      await t.mutation(internal.ingest.events.markProcessed, { eventId });
    }
    for (let i = 0; i < 5; i++) {
      const eventId = await t.mutation(internal.ingest.events.captureEvent, {
        orgId: orgA, sourceKey: "a", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
      });
      await t.mutation(internal.ingest.events.markFailed, { eventId, error: "a" });
    }
    const orgBMessage = await t.mutation(internal.ingest.events.captureEvent, {
      orgId: orgB, sourceKey: "b", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markProcessed, { eventId: orgBMessage });
    const orgBFailure = await t.mutation(internal.ingest.events.captureEvent, {
      orgId: orgB, sourceKey: "b", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markFailed, { eventId: orgBFailure, error: "b" });
    const nowMs = Date.now();
    const futureFailure = await t.mutation(internal.ingest.events.captureEvent, {
      orgId: orgA, sourceKey: "a", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
    });
    await t.mutation(internal.ingest.events.markFailed, { eventId: futureFailure, error: "future" });
    await t.run((ctx: any) => ctx.db.patch(futureFailure, { receivedAt: nowMs + 60_000 }));

    const [snapA, snapB] = await Promise.all([
      t.query(internal.ingest.monitor.getHealthSnapshot, { orgId: orgA, nowMs }),
      t.query(internal.ingest.monitor.getHealthSnapshot, { orgId: orgB, nowMs }),
    ]);
    expect(snapA.lastProcessedMessageAt).toBeGreaterThan(0);
    expect(snapA.failedLast15m).toBe(5);
    expect(snapB.lastProcessedMessageAt).toBeGreaterThan(0);
    expect(snapB.failedLast15m).toBe(1);
  });

  test("snapshot reads last processed message.event and failed count", async () => {
    const t = convexTest(schema);
    const orgId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 })) as any;
    const e = await t.mutation(internal.ingest.events.captureEvent, {
      sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true, orgId,
    });
    await t.mutation(internal.ingest.events.markProcessed, { eventId: e });
    const f = await t.mutation(internal.ingest.events.captureEvent, {
      sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true, orgId,
    });
    await t.mutation(internal.ingest.events.markFailed, { eventId: f, error: "x" });
    const snap = await t.query(internal.ingest.monitor.getHealthSnapshot, { orgId, nowMs: Date.now() });
    expect(snap.lastProcessedMessageAt).toBeGreaterThan(0);
    expect(snap.failedLast15m).toBe(1);
  });

  test("cooldown: second stamp within 60min is blocked", async () => {
    const t = convexTest(schema);
    const orgId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 })) as any;
    const now = Date.now();
    const first = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { orgId, alertKey: "silence", nowMs: now });
    expect(first.sent).toBe(true);
    const second = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { orgId, alertKey: "silence", nowMs: now + 59 * 60_000 });
    expect(second.sent).toBe(false);
    const third = await t.mutation(internal.ingest.monitor.stampAlertIfCool, { orgId, alertKey: "silence", nowMs: now + 61 * 60_000 });
    expect(third.sent).toBe(true);
  });
});
