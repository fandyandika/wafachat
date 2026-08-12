import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { attemptKey, recordAcceptedAttempt } from "./followUpAttempts";
import { api } from "./_generated/api";

const modules = (import.meta as any).glob("./**/*.{ts,js}");

const acceptedAt = Date.UTC(2026, 7, 11, 8, 0, 0);

test("attemptKey distinguishes retries while remaining stable for one request", () => {
  const first = attemptKey("conv-1", "cycle-1", 1, "provider_template", "request-1");
  expect(first).toBe(attemptKey("conv-1", "cycle-1", 1, "provider_template", "request-1"));
  expect(first).not.toBe(attemptKey("conv-1", "cycle-2", 1, "provider_template", "request-1"));
  expect(first).not.toBe(attemptKey("conv-1", "cycle-1", 1, "provider_template", "request-2"));
});

test("accepted attempts are idempotent for the same cycle stage method and nonce", async () => {
  const t = convexTest(schema);
  const { orgId, conversationId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: "attempt-org",
      name: "Attempt Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "ORDER-ATTEMPT-1",
      customerPhone: "6285715682110",
      customerName: "Fandi",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: 1,
      updatedAt: 1,
    });
    return { orgId, conversationId };
  });

  const input = {
    orgId,
    conversationId,
    csKey: "aisyah",
    cycleInboundAt: 10_000,
    cycleId: "cycle-attempt-1",
    stage: 1 as const,
    method: "provider_webhook" as const,
    nonce: "wamid.phone.1",
    providerMessageId: "wamid.phone.1",
    acceptedAt,
  };

  const first = await t.run((ctx) => recordAcceptedAttempt(ctx, input));
  const second = await t.run((ctx) => recordAcceptedAttempt(ctx, input));

  expect(first.duplicate).toBe(false);
  expect(second).toEqual({ attemptId: first.attemptId, duplicate: true });
  expect(await t.run((ctx) => ctx.db.query("followUpAttempts").unique()))
    .toMatchObject({ cycleId: "cycle-attempt-1" });
});

test("listFollowUpHistory paginates accepted attempts by organization", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({ subject: "attempt-admin", role: "admin", name: "Admin", email: "attempt@test" });
  const { orgId, conversationId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: "pustakaislam",
      name: "Attempt Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "ORDER-HISTORY-1",
      customerPhone: "6285715682110",
      customerName: "Fandi",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: 1,
      updatedAt: 1,
    });
    return { orgId, conversationId };
  });
  await t.run((ctx) => recordAcceptedAttempt(ctx, {
    orgId,
    conversationId,
    csKey: "aisyah",
    cycleInboundAt: 10_000,
    stage: 1,
    method: "manual_confirmation",
    nonce: "11111111-1111-4111-8111-111111111111",
    requestId: "11111111-1111-4111-8111-111111111111",
    actorName: "Admin",
    acceptedAt,
  }));

  const result = await asAdmin.query(api.followUpAttempts.listFollowUpHistory, {
    view: "sent",
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(result.page).toHaveLength(1);
  expect(result.page[0]).toMatchObject({
    customerName: "Fandi",
    stage: 1,
    method: "manual_confirmation",
    status: "accepted",
  });
});
