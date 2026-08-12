import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

test("lifecycle storage accepts legacy and enriched follow-up records", async () => {
  const t = convexTest(schema);

  await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      slug: "lifecycle-org",
      name: "Lifecycle Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const legacyConversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "LEGACY-1",
      customerPhone: "628111111111",
      customerName: "Legacy Customer",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      createdAt: 1,
      updatedAt: 1,
    });
    const conversationId = await ctx.db.insert("conversations", {
      orgId,
      orderId: "LIFECYCLE-1",
      customerPhone: "628222222222",
      customerName: "Lifecycle Customer",
      assignedCsName: "Aisyah",
      status: "active",
      aiEnabled: false,
      note: "",
      followUpState: "review",
      followUpCycleId: "cycle-1",
      followUpCycleStartedAt: 100,
      followUpLastTransitionAt: 200,
      followUpLastInboundPreview: "Masih minat",
      followUpLastInboundAt: 150,
      followUpLastOutboundPreview: "Kami bantu ya",
      followUpLastOutboundAt: 175,
      followUpLastDetectedStage: 2,
      followUpLastDetectedTemplate: "followup_h2",
      followUpProductName: "Buku",
      followUpOutcome: "manual_archive",
      followUpReviewReason: "Provider response unclear",
      createdAt: 1,
      updatedAt: 200,
    });

    await ctx.db.insert("messages", {
      orgId,
      conversationId,
      orderId: "LIFECYCLE-1",
      customerPhone: "628222222222",
      role: "cs",
      direction: "outbound",
      content: "Kami bantu ya",
      messageType: "template",
      source: "kirimchat",
      providerTemplateName: "followup_h2",
      createdAt: 175,
    });
    const templateId = await ctx.db.insert("followUpTemplates", {
      orgId,
      stage: 2,
      label: "H+2",
      templateName: "followup_h2",
      language: "id",
      variables: [],
      matchPatterns: ["followup_h2", "follow up h2"],
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("followUpAttempts", {
      orgId,
      conversationId,
      csKey: "aisyah",
      cycleInboundAt: 100,
      cycleId: "cycle-1",
      stage: 2,
      method: "provider_template",
      status: "accepted",
      bucket: "sent",
      attemptKey: "attempt-1",
      templateId,
      createdAt: 175,
      updatedAt: 175,
    });
    await ctx.db.insert("followUpTransitions", {
      orgId,
      conversationId,
      cycleId: "cycle-1",
      eventKey: "event-1",
      kind: "stage_completed",
      source: "provider_template",
      fromStage: 1,
      toStage: 2,
      templateName: "followup_h2",
      createdAt: 200,
    });
    await ctx.db.insert("followUpCounters", {
      orgId,
      csKey: "aisyah",
      h1: 1,
      h2: 1,
      h3: 0,
      review: 1,
      updatedAt: 200,
    });
    await ctx.db.insert("providerChannelHealth", {
      orgId,
      providerNumberId: "number-1",
      csKey: "aisyah",
      channelType: "cs",
      lastInboundAt: 150,
      lastOutboundAt: 175,
      updatedAt: 200,
    });

    expect(await ctx.db.get(legacyConversationId)).toMatchObject({ orderId: "LEGACY-1" });
    expect(await ctx.db.get(conversationId)).toMatchObject({
      followUpCycleId: "cycle-1",
      followUpState: "review",
      followUpOutcome: "manual_archive",
    });
    expect(await ctx.db.query("followUpTransitions").collect()).toHaveLength(1);
    expect(await ctx.db.query("followUpCounters").collect()).toHaveLength(1);
    expect(await ctx.db.query("providerChannelHealth").collect()).toHaveLength(1);
  });
});
