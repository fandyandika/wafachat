import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { resolveAgent, canonicalizeCs } from "./agents";
import type { Id } from "./_generated/dataModel";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

async function seedAgent(t: any, orgId: any, over: Record<string, unknown> = {}) {
  return t.run((ctx: any) => ctx.db.insert("csConfigs", {
    orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah",
    nameAliases: ["CS Aisyah"], berduStaffIds: ["B-1apQSy"],
    providerNumberIds: ["1197250776802755"],
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
    isActive: true, createdAt: 1, updatedAt: 1, ...over,
  }));
}

test("resolveAgent: matches by phoneNumberId, berduStaffId, current csName, alias, csKey — with priority", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const agentId = await seedAgent(t, orgId);
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "1197250776802755" }))?.key).toBe("aisyah");
    expect((await resolveAgent(ctx, orgId, { berduStaffId: "B-1apQSy" }))?.csName).toBe("Aisyah");
    expect((await resolveAgent(ctx, orgId, { name: "Aisyah" }))?.key).toBe("aisyah");        // current csName
    expect((await resolveAgent(ctx, orgId, { name: "  cs aisyah " }))?.key).toBe("aisyah");  // alias, case/trim-insensitive
    expect((await resolveAgent(ctx, orgId, { name: "CS AISYAH" }))?.key).toBe("aisyah");     // csKey(name)==key
    expect((await resolveAgent(ctx, orgId, { name: "Aisyah" }))?.agentId).toEqual(agentId);
    expect(await resolveAgent(ctx, orgId, { name: "Bambang" })).toBeNull();                  // miss = discovery
    expect(await resolveAgent(ctx, orgId, {})).toBeNull();
  });
});

test("resolveAgent: post-rename, the CURRENT csName returns the OLD immutable key", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  // renamed agent: display "Ayesha", key stays "aisyah", old name kept as alias
  await seedAgent(t, orgId, { csName: "Ayesha", nameAliases: ["Aisyah"], normalizedName: "ayesha" });
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { name: "Ayesha" }))?.key).toBe("aisyah");  // csName-match (csKey("Ayesha") != "aisyah"!)
    expect((await resolveAgent(ctx, orgId, { name: "Aisyah" }))?.key).toBe("aisyah");  // old name via alias
  });
});

test("resolveAgent: row without key falls back to csKey(csName) matching", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { key: undefined, nameAliases: undefined });
  await t.run(async (ctx: any) => {
    const hit = await resolveAgent(ctx, orgId, { name: "CS Aisyah" }); // csKey("CS Aisyah")=="aisyah"==csKey(csName)
    expect(hit?.key).toBe("aisyah");
    expect(hit?.csName).toBe("Aisyah");
  });
});

test("canonicalizeCs: hit returns registry canonical form; miss falls back to raw+csKey(raw); empty tolerated", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId);
  await t.run(async (ctx: any) => {
    expect(await canonicalizeCs(ctx, orgId, "cs aisyah")).toEqual({ csName: "Aisyah", key: "aisyah" });
    expect(await canonicalizeCs(ctx, orgId, "Bambang")).toEqual({ csName: "Bambang", key: "bambang" });
    expect(await canonicalizeCs(ctx, orgId, "")).toEqual({ csName: "", key: "" });
    expect(await canonicalizeCs(ctx, orgId, undefined)).toEqual({ csName: "", key: "" });
  });
});

test("resolveAgent applies one active-only policy to phone, staff, name, alias, key, and legacy paths", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Retired", normalizedName: "retired", key: "disabled", isActive: false,
    nameAliases: ["Former Alias"], providerNumberIds: ["PHONE-DISABLED"], berduStaffIds: ["STAFF-DISABLED"],
  });
  await seedAgent(t, orgId, {
    csName: "Legacy Retired", normalizedName: "legacy retired", key: undefined, isActive: false,
    nameAliases: [], providerNumberIds: [], berduStaffIds: [],
  });
  const activeId = await seedAgent(t, orgId, {
    csName: "Current", normalizedName: "current", key: "enabled",
    nameAliases: [], providerNumberIds: [], berduStaffIds: [],
  });

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-DISABLED" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { berduStaffId: "STAFF-DISABLED" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { name: "Retired" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { name: "Former Alias" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { name: "CS Disabled" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { name: "CS Legacy Retired" })).toBeNull();
    expect((await resolveAgent(ctx, orgId, { name: "CS Enabled" }))?.agentId).toEqual(activeId);
  });
});

test("resolveAgent: canonical-key and legacy fallbacks stay inside the requested org", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "other", name: "Other Org", createdAt: 1, updatedAt: 1 })) as Id<"organizations">;
  await seedAgent(t, orgA, { csName: "Alfa", normalizedName: "alfa", key: "shared", providerNumberIds: ["PHONE-SHARED"] });
  await seedAgent(t, orgB, { csName: "Beta", normalizedName: "beta", key: "shared", providerNumberIds: ["PHONE-SHARED"], berduStaffIds: [] });
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgB, { name: "CS Shared" }))?.csName).toBe("Beta");
    expect((await resolveAgent(ctx, orgB, { phoneNumberId: "PHONE-SHARED" }))?.csName).toBe("Beta");
  });
});

test("resolveAgent: legacy no-key fallback returns only the requested org's matching row", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "other", name: "Other Org", createdAt: 1, updatedAt: 1,
  })) as Id<"organizations">;
  const agentA = await seedAgent(t, orgA, { key: undefined });
  const agentB = await seedAgent(t, orgB, { key: undefined });

  await t.run(async (ctx: any) => {
    const result = await resolveAgent(ctx, orgB, { name: "CS Aisyah" });
    expect(result?.agentId).toEqual(agentB);
    expect(result?.agentId).not.toEqual(agentA);
    expect(result?.csName).toBe("Aisyah");
  });
});

test("seedKeys: idempotent — stamps key=csKey(csName) + nameAliases=[] only where missing", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { key: undefined, nameAliases: undefined });
  await seedAgent(t, orgId, { csName: "Risma", normalizedName: "risma", key: "risma", nameAliases: [], berduStaffIds: ["B-1CxSmL"], providerNumberIds: ["433364286526515"] });
  const asAdmin = t.withIdentity(ADMIN);
  const r1 = await asAdmin.mutation(api.agents.seedKeys, {});
  expect(r1.seeded).toBe(1);
  const r2 = await asAdmin.mutation(api.agents.seedKeys, {});
  expect(r2.seeded).toBe(0);
  await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("csConfigs").collect();
    for (const row of rows) { expect(row.key).toBeDefined(); expect(row.nameAliases).toBeDefined(); }
  });
});

test("setNameAliases: patches a stored config; errors when no stored row", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId);
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.agents.setNameAliases, { csName: "Aisyah", nameAliases: ["CS Aisyah", "Kak Aisyah"] });
  expect(r.success).toBe(true);
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "aisyah")).unique();
    expect(row?.nameAliases).toEqual(["CS Aisyah", "Kak Aisyah"]);
  });
  await expect(asAdmin.mutation(api.agents.setNameAliases, { csName: "Ghost", nameAliases: [] })).rejects.toThrow(/csConfig not found/);
});
