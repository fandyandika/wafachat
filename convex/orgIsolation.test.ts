import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";

async function seedFullOrg(t: any, slug: string, email: string, csName: string, phone: string) {
  const orgId = await t.run((ctx: any) => ctx.db.insert("organizations", { slug, name: slug, createdAt: 1, updatedAt: 1 }));
  await t.run(async (ctx: any) => {
    await ctx.db.insert("users", { orgId, email, name: email, passwordHash: "x", role: "admin", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: csName.toLowerCase(), csName, key: csName.toLowerCase(), nameAliases: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true, createdAt: 1, updatedAt: 1,
    });
    const NOW = Date.now();
    await ctx.db.insert("orders", {
      orgId, orderId: "O-SAME", customerPhone: phone, customerName: `cust-${slug}`, assignedCsName: csName,
      csKey: csName.toLowerCase(), productName: "P", products: "P (1x)", productsSubtotal: "Rp1", shippingCost: "Rp1",
      total: "Rp2", shippingAddress: "X", shippingDistrict: "Y", shippingCity: "Z", source: "berdu",
      aiEligible: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("shippingRecaps", {
      orgId, orderIdBerdu: "O-SAME", customerPhone: phone, customerName: `cust-${slug}`, csName, csKey: csName.toLowerCase(),
      closedAt: NOW, recipientName: `cust-${slug}`, recipientPhone: phone, recipientAddress: "X",
      recipientDistrict: "Y", recipientCity: "Z", packageContent: "P", paymentMethod: "cod", codValue: 100000,
      status: "ready", flags: [], sourceMessageText: "", version: 1, createdAt: NOW, updatedAt: NOW,
    });
  });
  return orgId;
}

const ID_A = { subject: "ua", role: "admin" as const, name: "A", email: "a@test" };
const ID_B = { subject: "ub", role: "admin" as const, name: "B", email: "b@test" };

test("ISOLATION #1: same orderId+phone in two orgs stay two separate worlds (dedup + summary + leaderboard)", async () => {
  const t = convexTest(schema);
  await seedFullOrg(t, "org-a", "a@test", "Alfa", "62811111");
  await seedFullOrg(t, "org-b", "b@test", "Beta", "62811111");
  await t.run(async (ctx: any) => {
    const orders = (await ctx.db.query("orders").collect()).filter((o: any) => o.orderId === "O-SAME");
    expect(orders.length).toBe(2);
    expect(new Set(orders.map((o: any) => String(o.orgId))).size).toBe(2);
  });
  const now = Date.now();
  const range = { startAt: now - 86_400_000, endAt: now + 86_400_000 };
  const sumA = await t.withIdentity(ID_A).query(api.metrics.getDashboardSummary, { ...range, raw: true });
  expect(sumA.leads).toBe(1);    // ONLY org-A's order
  expect(sumA.closings).toBe(1); // ONLY org-A's recap
  const lbA = await t.withIdentity(ID_A).query(api.analytics.getCsLeaderboard, { ...range, raw: true });
  expect(lbA.map((r: any) => r.csName)).toEqual(["Alfa"]); // no "Beta" leak
  const lbB = await t.withIdentity(ID_B).query(api.analytics.getCsLeaderboard, { ...range, raw: true });
  expect(lbB.map((r: any) => r.csName)).toEqual(["Beta"]);
});

test("ISOLATION #2: conversations list is org-scoped", async () => {
  const t = convexTest(schema);
  const orgA = await seedFullOrg(t, "org-a", "a@test", "Alfa", "62822222");
  const orgB = await seedFullOrg(t, "org-b", "b@test", "Beta", "62822222");
  await t.run(async (ctx: any) => {
    const NOW = Date.now();
    for (const [orgId, name] of [[orgA, "A-conv"], [orgB, "B-conv"]] as const) {
      await ctx.db.insert("conversations", {
        orgId, orderId: "O-SAME", customerPhone: "62822222", customerName: name, assignedCsName: "X",
        status: "active", aiEnabled: false, note: "", createdAt: NOW, updatedAt: NOW,
      });
    }
  });
  const listA = await t.run((ctx) => ctx.runQuery(internal.state.listConversations, { orgId: orgA }));
  const dump = JSON.stringify(listA);
  expect(dump).toContain("A-conv");
  expect(dump).not.toContain("B-conv");
});
