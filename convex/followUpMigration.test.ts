import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = (import.meta as any).glob("./**/*.{ts,js}");
const DAY = 24 * 60 * 60 * 1_000;
const now = Date.UTC(2026, 7, 11, 12, 0, 0);

async function seedEligible(t: any) {
  return t.run(async (ctx: any) => {
    const orgId = await ctx.db.insert("organizations", { slug: "pustakaislam", name: "Org", createdAt: 1, updatedAt: 1 });
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "PREP-1",
      customerPhone: "628111111111",
      customerName: "Fandi",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: now - 3 * DAY,
      updatedAt: now - DAY,
    });
    await ctx.db.insert("messages", {
      orgId, conversationId, orderId: "PREP-1", customerPhone: "628111111111",
      role: "customer", direction: "inbound", content: "Halo", messageType: "text", source: "ingest",
      createdAt: now - 2 * DAY,
    });
    const outboundAt = now - 40 * 60 * 60 * 1_000;
    await ctx.db.insert("messages", {
      orgId, conversationId, orderId: "PREP-1", customerPhone: "628111111111",
      role: "cs", direction: "outbound", content: "Ada yang bisa dibantu?", messageType: "text", source: "ingest",
      createdAt: outboundAt,
    });
    return { orgId, conversationId, outboundAt };
  });
}

test("dry-run counts eligible state without changing the conversation", async () => {
  const t = convexTest(schema, modules);
  const { orgId, conversationId } = await seedEligible(t);
  const runId = await t.run((ctx) => ctx.db.insert("followUpPreparationRuns", {
    orgId, mode: "dry_run", status: "running", nextConversationStatus: "active",
    scanned: 0, eligible: 0, updated: 0, skipped: 0, failed: 0, startedAt: now, updatedAt: now,
  }));

  const result = await t.mutation(internal.followUpMigration.preparePage, {
    runId, orgId, status: "active", now, scheduleNext: false,
  });
  expect(result).toMatchObject({ processed: 1, eligible: 1, updated: 0 });
  const conversation = await t.run((ctx) => ctx.db.get(conversationId)) as Doc<"conversations"> | null;
  expect(conversation?.followUpState).toBeUndefined();
});

test("apply materializes H+1 from the last CS reply and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const { orgId, conversationId, outboundAt } = await seedEligible(t);
  const runId = await t.run((ctx) => ctx.db.insert("followUpPreparationRuns", {
    orgId, mode: "apply", status: "running", nextConversationStatus: "active",
    scanned: 0, eligible: 0, updated: 0, skipped: 0, failed: 0, startedAt: now, updatedAt: now,
  }));
  await t.mutation(internal.followUpMigration.preparePage, {
    runId, orgId, status: "active", now, scheduleNext: false,
  });
  expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
    followUpNextStage: 1,
    followUpDueAt: outboundAt + DAY,
    followUpState: "waiting",
  });
});

test("an admin starts and inspects one resumable preparation run", async () => {
  const t = convexTest(schema, modules);
  await seedEligible(t);
  const asAdmin = t.withIdentity({ subject: "prep-admin", role: "admin", name: "Admin", email: "prep@test" });
  const started = await asAdmin.mutation(api.followUpMigration.startRecentFollowUpPreparation, { mode: "dry_run" });
  const status = await asAdmin.query(api.followUpMigration.getFollowUpPreparationRun, { runId: started.runId });
  expect(status).toMatchObject({ mode: "dry_run", status: "running", scanned: 0, updated: 0 });
  await expect(asAdmin.mutation(api.followUpMigration.startRecentFollowUpPreparation, { mode: "apply" }))
    .rejects.toThrow(/masih berjalan/i);
});
