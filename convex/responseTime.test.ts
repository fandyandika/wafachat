import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const t0 = 1_750_000_000_000;
const convBase = {
  orderId: "O-1", customerName: "A", status: "active" as const, aiEnabled: false, note: "",
  createdAt: t0, updatedAt: t0,
};
const msgBase = {
  orderId: "O-1", content: "x", source: "n8n" as const, createdAt: t0,
};

test("getResponseTimes: first-reply median/p90 + ongoing, template excluded, per-CS", async () => {
  const t = convexTest(schema);
  let conv1: any, conv2: any, convX: any;
  await t.run(async (ctx) => {
    conv1 = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    conv2 = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62812", assignedCsName: "CS A" });
    convX = await ctx.db.insert("conversations", { ...convBase, customerPhone: "6285715682110", assignedCsName: "CS A" }); // internal phone

    const ins = (conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number, messageType = "text", role = "cs") =>
      ctx.db.insert("messages", { ...msgBase, conversationId, customerPhone, direction, messageType, role, createdAt });

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

  const r = await t.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000 });
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
  await t.run(async (ctx) => {
    const cA = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62811", assignedCsName: "CS A" });
    const cB = await ctx.db.insert("conversations", { ...convBase, customerPhone: "62820", assignedCsName: "CS B" });
    const ins = (conversationId: any, customerPhone: string, direction: "inbound" | "outbound", createdAt: number) =>
      ctx.db.insert("messages", { ...msgBase, conversationId, customerPhone, direction, messageType: "text", role: "cs", createdAt });
    await ins(cA, "62811", "inbound", t0 + 1000);
    await ins(cA, "62811", "outbound", t0 + 61000);
    await ins(cB, "62820", "inbound", t0 + 1000);
    await ins(cB, "62820", "outbound", t0 + 31000);
  });
  const r = await t.query(api.responseTime.getResponseTimes, { startAt: t0, endAt: t0 + 200000, csName: "CS B" });
  expect(r.cs.length).toBe(1);
  expect(r.cs[0].csName).toBe("CS B");
  expect(r.cs[0].firstReplyMedianMs).toBe(30000);
});
