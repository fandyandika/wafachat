import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("setBerduStaffIds: patches a stored config; errors when no stored row", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      normalizedName: "aisyah", csName: "Aisyah",
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const r = await asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "Aisyah", berduStaffIds: ["B-1apQSy"] });
  expect(r.success).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", "aisyah")).unique();
    expect(row?.berduStaffIds).toEqual(["B-1apQSy"]);
  });
  await expect(
    asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "GhostCS", berduStaffIds: ["B-1"] }),
  ).rejects.toThrow(/csConfig not found/);
});
