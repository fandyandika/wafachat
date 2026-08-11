import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { attemptKey, recordAcceptedAttempt } from "./followUpAttempts";

const acceptedAt = Date.UTC(2026, 7, 11, 8, 0, 0);

test("attemptKey distinguishes retries while remaining stable for one request", () => {
  const first = attemptKey("conv-1", 10_000, 1, "provider_template", "request-1");
  expect(first).toBe(attemptKey("conv-1", 10_000, 1, "provider_template", "request-1"));
  expect(first).not.toBe(attemptKey("conv-1", 10_000, 1, "provider_template", "request-2"));
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
  expect(await t.run((ctx) => ctx.db.query("followUpAttempts").collect())).toHaveLength(1);
});
