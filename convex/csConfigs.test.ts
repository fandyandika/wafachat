import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { resolveAgent } from "./agents";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("setBerduStaffIds: patches a stored config; errors when no stored row", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("csConfigs", {
      orgId,
      normalizedName: "aisyah", csName: "Aisyah",
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const r = await asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "Aisyah", berduStaffIds: ["B-1apQSy"] });
  expect(r.success).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", "aisyah")).unique();
    expect(row?.berduStaffIds).toEqual(["B-1apQSy"]);
  });
  await expect(
    asAdmin.mutation(api.csConfigs.setBerduStaffIds, { csName: "GhostCS", berduStaffIds: ["B-1"] }),
  ).rejects.toThrow(/csConfig not found/);
});

test("renameCs: key is IMMUTABLE; old csName becomes an alias; display fields update", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", key: "aisyah", nameAliases: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);
  const r = await asAdmin.mutation(api.csConfigs.renameCs, { fromCsName: "Aisyah", toCsName: "Ayesha" });
  expect(r.ok).toBe(true);
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "ayesha")).unique();
    expect(row?.csName).toBe("Ayesha");
    expect(row?.key).toBe("aisyah");                 // immutable
    expect(row?.nameAliases).toContain("Aisyah");    // old name preserved as alias
  });
});

test("renameCs backstop: row without key gets key=csKey(oldName) before renaming", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "risma", csName: "Risma", // NO key (pre-seed row)
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.csConfigs.renameCs, { fromCsName: "Risma", toCsName: "Rismawati" });
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "rismawati")).unique();
    expect(row?.key).toBe("risma"); // from the OLD name, not csKey("Rismawati")
  });
});

test("setProviderNumberIds synchronizes scalar after a backfill and clears it for ambiguous replacements", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", providerNumberId: "PHONE-OLD", providerNumberIds: ["PHONE-OLD"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "risma", csName: "Risma", providerNumberId: "PHONE-SHARED", providerNumberIds: ["PHONE-SHARED"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);

  await asAdmin.mutation(api.csConfigs.setProviderNumberIds, { csName: "Aisyah", providerNumberIds: [] });
  await t.run(async (ctx: any) => {
    const aisyah = await ctx.db.query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "aisyah"))
      .unique();
    expect(aisyah?.providerNumberId).toBeUndefined();
  });
  await asAdmin.mutation(api.csConfigs.setProviderNumberIds, { csName: "Aisyah", providerNumberIds: ["PHONE-NEW"] });
  await t.run(async (ctx: any) => {
    const aisyah = await ctx.db.query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "aisyah"))
      .unique();
    expect(aisyah?.providerNumberId).toBe("PHONE-NEW");
  });
  await expect(asAdmin.mutation(api.csConfigs.setProviderNumberIds, {
    csName: "Aisyah", providerNumberIds: ["PHONE-SHARED"],
  })).rejects.toThrow(/providerNumberId/);

  await t.run(async (ctx: any) => {
    const aisyah = await ctx.db.query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "aisyah"))
      .unique();
    expect(aisyah?.providerNumberIds).toEqual(["PHONE-NEW"]);
    expect(aisyah?.providerNumberId).toBe("PHONE-NEW");
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-SHARED" }))?.csName).toBe("Risma");
  });
});

test("upsert rejects a same-org scalar provider ID collision", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", providerNumberId: "PHONE-SHARED",
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });
  const asAdmin = t.withIdentity(ADMIN);

  await expect(asAdmin.mutation(api.csConfigs.upsert, {
    csName: "Risma", providerNumberId: "PHONE-SHARED",
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
  })).rejects.toThrow(/providerNumberId/);
});

test("upsert scalar replacement synchronizes legacy aliases so the old ID stops resolving", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", providerNumberId: "PHONE-OLD", providerNumberIds: ["PHONE-OLD"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });

  await t.withIdentity(ADMIN).mutation(api.csConfigs.upsert, {
    csName: "Aisyah", providerNumberId: "PHONE-NEW",
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
  });

  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", "aisyah"))
      .unique();
    expect(row?.providerNumberIds).toEqual(["PHONE-NEW"]);
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-OLD" })).toBeNull();
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-NEW" }))?.csName).toBe("Aisyah");
  });
});

test("upsert accepts an explicitly synchronized provider alias array", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "aisyah", csName: "Aisyah", providerNumberId: "PHONE-OLD", providerNumberIds: ["PHONE-OLD"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
  });

  await t.withIdentity(ADMIN).mutation(api.csConfigs.upsert, {
    csName: "Aisyah", providerNumberId: "PHONE-NEW", providerNumberIds: ["PHONE-NEW"],
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
  });

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-NEW" }))?.csName).toBe("Aisyah");
  });
});

test("upsert rejects activating an inactive config whose provider claim collides with an active config", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "current", csName: "Current", providerNumberId: "PHONE-SHARED", providerNumberIds: ["PHONE-SHARED"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "retired", csName: "Retired", providerNumberId: "PHONE-SHARED", providerNumberIds: ["PHONE-SHARED"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: false, createdAt: 2, updatedAt: 1,
    });
  });

  await expect(t.withIdentity(ADMIN).mutation(api.csConfigs.upsert, {
    csName: "Retired",
    orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true, isActive: true,
  })).rejects.toThrow(/providerNumberId/);

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-SHARED" }))?.csName).toBe("Current");
  });
});
