import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = (import.meta as any).glob("./**/*.{ts,js}");

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "pustakaislam",
    name: "Test Org",
    createdAt: 1,
    updatedAt: 1,
  }));
}

async function seedConversation(t: any, orgId: any, assignedCsName = "Nabila") {
  return t.run((ctx: any) => ctx.db.insert("conversations", {
    orgId,
    orderId: "TRANSITION-1",
    customerPhone: "628123456789",
    customerName: "Budi",
    assignedCsName,
    status: "active",
    aiEnabled: false,
    note: "",
    createdAt: 1,
    updatedAt: 1,
  }));
}

test("listConversationTransitions paginates the newest 50 owned transition rows", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({
    subject: "transition-admin",
    role: "admin",
    name: "Transition Admin",
    email: "transition-admin@wafachat.test",
  });
  const orgId = await seedOrg(t);
  const conversationId = await seedConversation(t, orgId);
  await t.run(async (ctx) => {
    for (let i = 0; i < 55; i++) {
      await ctx.db.insert("followUpTransitions", {
        orgId,
        conversationId,
        cycleId: "cycle-1",
        eventKey: `transition-${i}`,
        kind: i === 0 ? "cycle_armed" : "stage_completed",
        source: "provider_webhook",
        fromStage: i === 0 ? undefined : 1,
        toStage: i === 0 ? 1 : 2,
        providerMessageId: `wamid.${i}`,
        templateName: i === 0 ? undefined : "follow_up_h1",
        actorName: "Nabila",
        createdAt: 1_000 + i,
      });
    }
  });

  const first = await asAdmin.query(api.followUpTransitions.listConversationTransitions, {
    conversationId,
    paginationOpts: { numItems: 100, cursor: null },
  });
  const second = await asAdmin.query(api.followUpTransitions.listConversationTransitions, {
    conversationId,
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });

  expect(first.page).toHaveLength(50);
  expect(second.page).toHaveLength(5);
  expect(first.page[0]).toMatchObject({
    cycleId: "cycle-1",
    kind: "stage_completed",
    source: "provider_webhook",
    providerMessageId: "wamid.54",
    actorName: "Nabila",
    createdAt: 1_054,
  });
  expect(second.page.at(-1)).toMatchObject({
    kind: "cycle_armed",
    toStage: 1,
    createdAt: 1_000,
  });
});

test("listConversationTransitions authenticates and enforces the CS conversation assignment", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const conversationId = await seedConversation(t, orgId, "Lila");
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    orgId,
    email: "transition-aisyah@wafachat.test",
    name: "Aisyah",
    passwordHash: "test",
    role: "cs",
    csName: "Aisyah",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  await t.run((ctx) => ctx.db.insert("followUpTransitions", {
    orgId,
    conversationId,
    cycleId: "private-cycle",
    eventKey: "private-transition",
    kind: "cycle_armed",
    source: "system",
    toStage: 1,
    createdAt: 2,
  }));

  await expect(t.query(api.followUpTransitions.listConversationTransitions, {
    conversationId,
    paginationOpts: { numItems: 50, cursor: null },
  })).rejects.toThrow(/requires a logged-in user/);

  const asAisyah = t.withIdentity({
    subject: String(userId),
    role: "cs",
    name: "Aisyah",
    email: "transition-aisyah@wafachat.test",
    csName: "Aisyah",
  });
  await expect(asAisyah.query(api.followUpTransitions.listConversationTransitions, {
    conversationId,
    paginationOpts: { numItems: 50, cursor: null },
  })).rejects.toThrow(/conversation scope mismatch/);
});
