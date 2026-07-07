import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";

const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "a1", role: "admin", name: "Admin", email: "a@w" });

test("capture -> mark lifecycle", async () => {
  const t = convexTest(schema);
  const eventId = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "kirimdev-pustakaislam", kind: "message.event",
    rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markProcessed, { eventId, resultRef: "msg123" });
  const rows = await asAdmin(t).query(api.ingest.events.listRecent, {});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "processed", resultRef: "msg123" });
  expect(rows[0].processedAt).toBeGreaterThan(0);
});

test("markFailed and markSkipped record reasons", async () => {
  const t = convexTest(schema);
  const a = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "unknown", rawHeaders: "{}", rawBody: "x", signatureOk: false,
  });
  const b = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "unknown", rawHeaders: "{}", rawBody: "y", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markFailed, { eventId: a, error: "boom" });
  await t.mutation(internal.ingest.events.markSkipped, { eventId: b, skipReason: "event x" });
  const failed = await asAdmin(t).query(api.ingest.events.listRecent, { status: "failed" });
  expect(failed).toHaveLength(1);
  expect(failed[0].error).toBe("boom");
  const skipped = await asAdmin(t).query(api.ingest.events.listRecent, { status: "skipped" });
  expect(skipped[0].skipReason).toBe("event x");
});

test("cleanupOld deletes only rows older than cutoff", async () => {
  const t = convexTest(schema);
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "k", rawHeaders: "{}", rawBody: "old", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "k", rawHeaders: "{}", rawBody: "new", signatureOk: true,
  });
  const res = await t.mutation(internal.ingest.events.cleanupOld, { olderThanMs: 0 });
  expect(res.deleted).toBe(0); // nothing older than epoch 0
  const res2 = await t.mutation(internal.ingest.events.cleanupOld, { olderThanMs: Date.now() + 60_000 });
  expect(res2.deleted).toBe(2); // everything older than future cutoff
});

test("listRecent requires admin", async () => {
  const t = convexTest(schema);
  await expect(t.query(api.ingest.events.listRecent, {})).rejects.toThrow(/unauthorized/);
});

test("sources: upsert, lookup, redact, enforce flip", async () => {
  const t = convexTest(schema);
  await asAdmin(t).mutation(api.ingest.sources.upsertSource, {
    sourceKey: "kirimdev-pustakaislam", name: "KirimDev Pustaka Islam",
    kind: "kirimdev", secret: "whsec_supersecret1234", enabled: true, enforceSignature: false,
  });
  const src = await t.query(internal.ingest.sources.getBySourceKey, { sourceKey: "kirimdev-pustakaislam" });
  expect(src?.secret).toBe("whsec_supersecret1234");
  expect(src?.enforceSignature).toBe(false);

  const listed = await asAdmin(t).query(api.ingest.sources.listSources, {});
  expect(listed[0].secret).toBe("…1234"); // redacted

  await asAdmin(t).mutation(api.ingest.sources.setEnforceSignature, {
    sourceKey: "kirimdev-pustakaislam", enforce: true,
  });
  const after = await t.query(internal.ingest.sources.getBySourceKey, { sourceKey: "kirimdev-pustakaislam" });
  expect(after?.enforceSignature).toBe(true);

  // upsert same key updates, not duplicates
  await asAdmin(t).mutation(api.ingest.sources.upsertSource, {
    sourceKey: "kirimdev-pustakaislam", name: "Renamed",
    kind: "kirimdev", secret: "whsec_other", enabled: true, enforceSignature: true,
  });
  expect((await asAdmin(t).query(api.ingest.sources.listSources, {})).length).toBe(1);
});

test("sources mutations require admin", async () => {
  const t = convexTest(schema);
  const asCs = t.withIdentity({ subject: "c1", role: "cs", name: "Lina", email: "c@w", csName: "Lina" });
  await expect(asCs.mutation(api.ingest.sources.upsertSource, {
    sourceKey: "x", name: "x", kind: "custom", secret: "s", enabled: true, enforceSignature: false,
  })).rejects.toThrow(/admin/);
});

test("dailyStats aggregates by status and kind", async () => {
  const t = convexTest(schema);
  const e1 = await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "message.event", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  await t.mutation(internal.ingest.events.markProcessed, { eventId: e1 });
  await t.mutation(internal.ingest.events.captureEvent, {
    sourceKey: "s", kind: "lead.created", rawHeaders: "{}", rawBody: "{}", signatureOk: true,
  });
  const stats = await asAdmin(t).query(api.ingest.events.dailyStats, {
    dayStartMs: Date.now() - 3_600_000, dayEndMs: Date.now() + 3_600_000,
  });
  expect(stats).toMatchObject({
    received: 1, processed: 1, skipped: 0, failed: 0,
    byKind: { "message.event": 1, "lead.created": 1 },
  });
});
