import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { startOfJakartaDayMs, csKey } from "./lib";

const modules = (import.meta as any).glob("./**/*.{ts,js}");

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const DAY = 86_400_000;

test("startOfJakartaDayMs: Jakarta midnight <= now and within today", () => {
  const now = Date.now();
  const start = startOfJakartaDayMs(now);
  expect(start).toBeLessThanOrEqual(now);
  expect(now - start).toBeLessThan(DAY);
  // (start + 7h) is exactly a UTC day boundary -> Jakarta 00:00
  expect((start + 7 * 60 * 60 * 1000) % DAY).toBe(0);
});

test("listConversations: closed bounded to today (Jakarta); active+handover always", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const base = { orgId, customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "H", customerPhone: "62812", status: "handover", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CO", customerPhone: "62814", status: "closed", updatedAt: now - 2 * DAY });
  });

  const rows = await t.query(internal.state.listConversations, { includeClosed: true, orgId });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811"); // active
  expect(phones).toContain("62812"); // handover
  expect(phones).toContain("62813"); // closed TODAY
  expect(phones).not.toContain("62814"); // closed 2 days ago -> excluded by DB bound
});

test("listConversations: includeClosed=false omits closed entirely", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const now = Date.now();
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const base = { orgId, customerName: "X", assignedCsName: "CS A", aiEnabled: true, note: "", createdAt: now };
    await ctx.db.insert("conversations", { ...base, orderId: "A", customerPhone: "62811", status: "active", updatedAt: now });
    await ctx.db.insert("conversations", { ...base, orderId: "CT", customerPhone: "62813", status: "closed", updatedAt: now });
  });
  const rows = await t.query(internal.state.listConversations, { includeClosed: false, orgId });
  const phones = rows.map((r) => r.phone);
  expect(phones).toContain("62811");
  expect(phones).not.toContain("62813");
});

test("upsertOrderFromN8n honors explicit createdAt on insert (reconciler backfill keeps real order time)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const backdated = Date.UTC(2026, 5, 23, 18, 10, 43); // real Berdu order time, not now
  await t.mutation(internal.state.upsertOrderFromN8n, { phone: "6285735647633", csName: "Risma", order_id: "O-260624000009", createdAt: backdated });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-260624000009")).unique());
  expect(order?.createdAt).toBe(backdated);
});

test("upsertOrderCore stores csKey = csKey(assignedCsName) for a raw name variant", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  await t.mutation(internal.state.upsertOrderFromN8n, { phone: "6285735647634", csName: "CS Aisyah", order_id: "O-CSKEY-1", createdAt: Date.UTC(2026, 6, 7, 10, 0, 0) });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-CSKEY-1")).unique());
  expect(order?.csKey).toBe(csKey("CS Aisyah"));
  // the csKey index returns this order for its csKey slice
  const viaIndex = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_org_csKey_createdAt", (q) => q.eq("orgId", orgId).eq("csKey", csKey("CS Aisyah"))).collect());
  expect(viaIndex.some((o) => o.orderId === "O-CSKEY-1")).toBe(true);
});

test("upsertOrderFromN8n updates explicit createdAt on existing order", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const replayedAt = Date.parse("2026-07-07T14:15:45.000Z");
  const orderedAt = Date.parse("2026-07-07T12:45:04.316Z");
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647633",
    csName: "Nabila",
    order_id: "O-260707000251",
    createdAt: replayedAt,
  });
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647633",
    csName: "Nabila",
    order_id: "O-260707000251",
    createdAt: orderedAt,
  });
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-260707000251")).unique());
  const conversation = await t.run(async (ctx) =>
    ctx.db.query("conversations").withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-260707000251")).unique());
  expect(order?.createdAt).toBe(orderedAt);
  expect(conversation?.createdAt).toBe(orderedAt);
});

test("orgId stamping: created rows carry orgId when org seeded", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });

  // Seed the default org
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  expect(orgId).not.toBeNull();

  // Create a conversation via createTestConversation — should stamp orgId
  const result = await asAdmin.mutation(api.state.createTestConversation, { phone: "6281234567890" });
  const createdConversation = await t.run(async (ctx) =>
    ctx.db.get(result.conversationId));
  expect(createdConversation?.orgId).toBe(orgId);
});

test("canonical stamp: upsertOrderCore via alias resolves to canonical csName + immutable key", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  // Seed registry: Aisyah with key "aisyah", alias "CS Aisyah"
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: ["CS Aisyah"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  // Create order via upsertOrderFromN8n with alias form "CS Aisyah"
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647635", csName: "CS Aisyah", order_id: "O-CANONICAL-1", createdAt: Date.UTC(2026, 6, 7, 10, 0, 0),
  });
  // Verify: stored order has canonical csName "Aisyah" and immutable key "aisyah"
  const order = await t.run(async (ctx) =>
    ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-CANONICAL-1")).unique());
  expect(order?.assignedCsName).toBe("Aisyah");
  expect(order?.csKey).toBe("aisyah");
});

test("org isolation: same orderId in two orgs = TWO rows; org-B upsert never patches org-A", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  let orgB: any;
  await t.run(async (ctx: any) => {
    orgB = await ctx.db.insert("organizations", { slug: "org-b", name: "B", createdAt: 1, updatedAt: 1 });
  });
  await t.run(async (ctx: any) => {
    const { upsertOrderCore } = await import("./state");
    const base = {
      phone: "6281234500001", csName: "Aisyah", customerName: "A-Cust", productName: "P",
      products: "P (1x)", productsSubtotal: "Rp1", shippingCost: "Rp1", total: "Rp2",
      shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z", order_id: "O-COLLIDE",
    };
    await upsertOrderCore(ctx, { ...base, orgId: orgA });
    await upsertOrderCore(ctx, { ...base, customerName: "B-Cust", orgId: orgB });
    const rows = (await ctx.db.query("orders").collect()).filter((o: any) => o.orderId === "O-COLLIDE");
    expect(rows.length).toBe(2); // NOT an overwrite
    const a = rows.find((r: any) => String(r.orgId) === String(orgA));
    const b = rows.find((r: any) => String(r.orgId) === String(orgB));
    expect(a?.customerName).toBe("A-Cust"); // org-B upsert did not clobber org-A
    expect(b?.customerName).toBe("B-Cust");
  });
});

test("order ingestion snapshots product context and the due queue does not reread a later order row", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({
    subject: "snapshot-admin", role: "admin", name: "Snapshot Admin", email: "snapshot@wafachat.test",
  });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const dueAt = Date.now() - 1_000;
  await t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285735647991",
    csName: "Aisyah",
    order_id: "O-PRODUCT-SNAPSHOT",
    customerName: "Snapshot Customer",
    productName: "Quran Mapping",
    products: "Quran Mapping (1x)",
    createdAt: dueAt - DAY,
  });

  const conversationId = await t.run(async (ctx) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-PRODUCT-SNAPSHOT"))
      .unique();
    expect(conversation?.followUpProductName).toBe("Quran Mapping");
    await ctx.db.patch(conversation!._id, {
      followUpCsKey: "aisyah",
      followUpCycleInboundAt: dueAt - DAY,
      followUpCycleId: "cycle:product-snapshot",
      followUpCycleStartedAt: dueAt - DAY + 1,
      followUpNextStage: 1,
      followUpDueAt: dueAt,
      followUpState: "waiting",
    });
    const order = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", "O-PRODUCT-SNAPSHOT"))
      .unique();
    await ctx.db.patch(order!._id, { productName: "Later Per-row Product" });
    return conversation!._id;
  });

  const queue = await asAdmin.query(api.followUp.listDueFollowUps, {
    now: dueAt + 1_000,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(queue.page).toEqual([
    expect.objectContaining({ conversationId, productName: "Quran Mapping" }),
  ]);
});

test("manual closing and cancellation terminate their lifecycle counters only once", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({
    subject: "terminal-admin", role: "admin", name: "Terminal Admin", email: "terminal@wafachat.test",
  });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const row of [
      { orderId: "O-MANUAL-CLOSING", phone: "6285735647992", cycleId: "cycle:manual-closing", stage: 1 as const },
      { orderId: "O-MANUAL-CANCEL", phone: "6285735647993", cycleId: "cycle:manual-cancel", stage: 2 as const },
      { orderId: "O-N8N-CLOSING", phone: "6285735647994", cycleId: "cycle:n8n-closing", stage: 3 as const },
    ]) {
      await ctx.db.insert("conversations", {
        orgId,
        orderId: row.orderId,
        customerPhone: row.phone,
        customerName: "Terminal Customer",
        assignedCsName: "Aisyah",
        status: "active",
        aiEnabled: false,
        note: "",
        followUpCsKey: "aisyah",
        followUpCycleInboundAt: 1_000,
        followUpCycleId: row.cycleId,
        followUpCycleStartedAt: 1_001,
        followUpNextStage: row.stage,
        followUpDueAt: 2_000,
        followUpState: "waiting",
        createdAt: 1_000,
        updatedAt: 2_000,
      });
    }
    await ctx.db.insert("followUpCounters", {
      orgId, csKey: "aisyah", h1: 1, h2: 1, h3: 1, review: 0, updatedAt: 2_000,
    });
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await asAdmin.mutation(api.state.markConversationClosing, {
      phone: "6285735647992", order_id: "O-MANUAL-CLOSING",
    });
    await asAdmin.mutation(api.state.markConversationCancelled, {
      phone: "6285735647993", order_id: "O-MANUAL-CANCEL",
    });
    await t.mutation(internal.state.recordStatEventFromN8n, {
      field: "closings", phone: "6285735647994", order_id: "O-N8N-CLOSING",
    });
  }

  expect(await t.run((ctx) => ctx.db.query("followUpCounters").collect())).toEqual([
    expect.objectContaining({ csKey: "aisyah", h1: 0, h2: 0, h3: 0, review: 0 }),
  ]);
  const transitions = await t.run((ctx) => ctx.db.query("followUpTransitions").collect());
  expect(transitions.filter((transition) => transition.kind === "closing")).toHaveLength(2);
  expect(transitions.filter((transition) => transition.kind === "cancelled")).toHaveLength(1);
});

test("cutover lock rejects direct lifecycle status, reactivation, and delete writers only for its org", async () => {
  const t = convexTest(schema, modules);
  const asAdmin = t.withIdentity({
    subject: "cutover-admin", role: "admin", name: "Cutover Admin", email: "cutover@wafachat.test",
  });
  const { orgId } = await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  const otherOrgId: any = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "cutover-other", name: "Other", createdAt: 1, updatedAt: 1,
  }));
  await t.run(async (ctx: any) => {
    for (const [orderId, phone, status] of [
      ["LOCK-ACTIVE", "6285000000001", "active"],
      ["LOCK-CLOSED", "6285000000002", "closed"],
      ["LOCK-DELETE", "6285000000003", "active"],
    ] as const) {
      await ctx.db.insert("conversations", {
        orgId, orderId, customerPhone: phone, customerName: "Locked", assignedCsName: "Aisyah",
        status, aiEnabled: true, note: "", followUpCsKey: "aisyah", followUpCycleId: `cycle:${orderId}`,
        followUpCycleStartedAt: 1_000, followUpNextStage: 1, followUpDueAt: 2_000,
        followUpState: status === "active" ? "waiting" : "archived", createdAt: 1_000, updatedAt: 2_000,
      });
    }
    const runId = await ctx.db.insert("followUpPreparationRuns", {
      orgId, mode: "apply", status: "running", phase: "counters_waiting",
      nextConversationStatus: "handover", scanned: 0, eligible: 0, updated: 0, skipped: 0,
      failed: 0, startedAt: 2_000, updatedAt: 2_000,
    });
    await ctx.db.insert("followUpCutoverLocks", { orgId, runId, lockedAt: 2_000 });
  });

  await expect(t.mutation(internal.state.setConversationStatusFromN8n, {
    phone: "6285000000001", order_id: "LOCK-ACTIVE", status: "closed",
  })).rejects.toThrow(/cutover/i);
  await expect(t.mutation(internal.state.upsertOrderFromN8n, {
    phone: "6285000000002", csName: "Aisyah", order_id: "LOCK-CLOSED",
  })).rejects.toThrow(/cutover/i);
  await expect(asAdmin.mutation(api.state.markConversationNotClosing, {
    phone: "6285000000002", order_id: "LOCK-CLOSED",
  })).rejects.toThrow(/cutover/i);
  await expect(asAdmin.mutation(api.state.deleteConversationOrder, {
    phone: "6285000000003", order_id: "LOCK-DELETE",
  })).rejects.toThrow(/cutover/i);

  await t.run(async (ctx: any) => {
    const { upsertOrderCore } = await import("./state");
    await upsertOrderCore(ctx, {
      orgId: otherOrgId, phone: "6285000000099", csName: "Aisyah", order_id: "OTHER-ALLOWED",
    });
    expect(await ctx.db.query("conversations")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", otherOrgId).eq("orderId", "OTHER-ALLOWED"))
      .unique()).not.toBeNull();
    expect((await ctx.db.query("conversations")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "LOCK-ACTIVE"))
      .unique())?.status).toBe("active");
    expect((await ctx.db.query("conversations")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "LOCK-CLOSED"))
      .unique())?.status).toBe("closed");
    expect(await ctx.db.query("conversations")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", "LOCK-DELETE"))
      .unique()).not.toBeNull();
  });
});
