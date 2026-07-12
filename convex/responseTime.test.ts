import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { windowKeyFor } from "./lib";

// 10:00 WIB (inside 05:30-18:00) so the active-hours gap equals the wall-clock gap below.
const t0 = Date.UTC(2026, 5, 24, 3, 0, 0);
const convBase = {
  orderId: "O-1", customerName: "A", status: "active" as const, aiEnabled: false, note: "",
  createdAt: t0, updatedAt: t0,
};
const msgBase = {
  orderId: "O-1", content: "x", source: "n8n" as const, createdAt: t0,
};

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

test("getResponseTimes: first-reply median/p90 + ongoing, template excluded, per-CS", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  let conv1: any, conv2: any, convX: any;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    conv1 = await ctx.db.insert("conversations", { orgId, ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    conv2 = await ctx.db.insert("conversations", { orgId, ...convBase, customerPhone: "62812", assignedCsName: "CS A" });
    convX = await ctx.db.insert("conversations", { orgId, ...convBase, customerPhone: "6285715682110", assignedCsName: "CS A" }); // internal phone

    const ins = (
      conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number,
      messageType: "text" | "image" | "template" | "button" = "text",
      role: "customer" | "ai" | "cs" | "system" = "cs",
    ) =>
      ctx.db.insert("messages", { orgId, ...msgBase, conversationId, customerPhone, direction, messageType, role, createdAt });

    // conv1: template (skip) -> greeting -> reply 60s -> COD -> reply 30s
    await ins(conv1, "62811", "outbound", t0 + 100, "template", "cs");
    await ins(conv1, "62811", "inbound", t0 + 1000, "text", "customer");
    await ins(conv1, "62811", "outbound", t0 + 61000, "text", "cs");
    await ins(conv1, "62811", "inbound", t0 + 100000, "button", "customer");
    await ins(conv1, "62811", "outbound", t0 + 130000, "text", "cs");
    // conv2: greeting -> reply 120s
    await ins(conv2, "62812", "inbound", t0 + 2000, "text", "customer");
    await ins(conv2, "62812", "outbound", t0 + 122000, "text", "cs");
    // convX (internal phone): greeting -> instant reply (must be EXCLUDED)
    await ins(convX, "6285715682110", "inbound", t0 + 3000, "text", "customer");
    await ins(convX, "6285715682110", "outbound", t0 + 3500, "text", "cs");
  });

  // Populate rollups and samples for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey });
  await t.mutation(internal.rollups.rebuildSamplesForWindow, { windowKey });

  const r = await asAdmin.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000 });
  expect(r.cs.length).toBe(1);
  const a = r.cs[0];
  expect(a.csName).toBe("CS A");
  expect(a.csNameRaw).toBe("CS A");
  expect(a.firstReplyCount).toBe(2);                 // conv1 + conv2 (convX internal excluded)
  expect(a.firstReplyMedianMs).toBe(90000);          // median(60000,120000)
  expect(a.firstReplyP90Ms).toBe(120000);            // nearest-rank
  expect(a.ongoingCount).toBe(3);                    // 60000, 30000, 120000
  expect(a.ongoingMedianMs).toBe(60000);
  expect(r.overall.firstReplyMedianMs).toBe(90000);
  expect(r.overall.firstReplyCount).toBe(2);
});

test("getResponseTimes: csName filter", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const cA = await ctx.db.insert("conversations", { orgId, ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    const cB = await ctx.db.insert("conversations", { orgId, ...convBase, customerPhone: "62820", assignedCsName: "CS B" });
    const ins = (conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number) =>
      ctx.db.insert("messages", { orgId, ...msgBase, conversationId, customerPhone, direction, messageType: "text", role: "cs", createdAt });
    await ins(cA, "62811", "inbound", t0 + 1000);
    await ins(cA, "62811", "outbound", t0 + 61000);
    await ins(cB, "62820", "inbound", t0 + 1000);
    await ins(cB, "62820", "outbound", t0 + 31000);
  });

  // Populate rollups and samples for the window
  const windowKey = windowKeyFor(t0);
  await t.mutation(internal.rollups.recomputeWindow, { windowKey });
  await t.mutation(internal.rollups.rebuildSamplesForWindow, { windowKey });

  const r = await asAdmin.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000, csName: "CS B" });
  expect(r.cs.length).toBe(1);
  expect(r.cs[0].csName).toBe("CS B");
  expect(r.cs[0].firstReplyMedianMs).toBe(30000);
});

test("getResponseTimes counts SLA breaches (active-hours)", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const wib = (h: number, mi: number) => Date.UTC(2026, 5, 24, h, mi) - 7 * 60 * 60 * 1000;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    const conv = await ctx.db.insert("conversations", {
      orgId, orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "Risma",
      status: "active", aiEnabled: false, note: "", createdAt: wib(10, 0), updatedAt: wib(10, 0),
    });
    // breach: inbound 10:00, reply 10:20 (20 active min)
    await ctx.db.insert("messages", { orgId, conversationId: conv, orderId: "O-1", customerPhone: "62811", direction: "inbound", role: "customer", messageType: "text", content: "hi", createdAt: wib(10, 0), source: "n8n" as const });
    await ctx.db.insert("messages", { orgId, conversationId: conv, orderId: "O-1", customerPhone: "62811", direction: "outbound", role: "cs", messageType: "text", content: "hai", createdAt: wib(10, 20), source: "n8n" as const });
  });

  // Populate rollups and samples for the window
  const windowKey = windowKeyFor(wib(10, 0));
  await t.mutation(internal.rollups.recomputeWindow, { windowKey });
  await t.mutation(internal.rollups.rebuildSamplesForWindow, { windowKey });

  const res = await asAdmin.query(api.responseTime.getResponseTimes, { startAt: wib(0, 0), endAt: wib(23, 59) });
  expect(res.overall.slaBreaches).toBe(1);
  const risma = res.cs.find((c) => c.csName === "Risma");
  expect(risma?.slaBreaches).toBe(1);
});
