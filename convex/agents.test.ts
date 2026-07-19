import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import * as agents from "./agents";
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

async function runSeedKeysToCompletion(asAdmin: any, maxCalls = 12) {
  let totalSeeded = 0;
  let calls = 0;
  let result: any;
  do {
    result = await asAdmin.mutation(api.agents.seedKeys, {});
    totalSeeded += result.seeded;
    calls++;
  } while (!result.done && calls < maxCalls);
  expect(result.done).toBe(true);
  return { totalSeeded, calls };
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

test("resolveAgent: scalar provider IDs stay tenant-scoped and legacy arrays still fall back inside the requested org", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", { slug: "other", name: "Other Org", createdAt: 1, updatedAt: 1 })) as Id<"organizations">;
  await seedAgent(t, orgA, { csName: "Alfa", normalizedName: "alfa", key: "shared", providerNumberId: "PHONE-SHARED", providerNumberIds: [] });
  await seedAgent(t, orgB, { csName: "Beta", normalizedName: "beta", key: "shared", providerNumberId: "PHONE-SHARED", providerNumberIds: [], berduStaffIds: [] });
  await seedAgent(t, orgB, { csName: "Legacy", normalizedName: "legacy", key: "legacy", providerNumberId: undefined, providerNumberIds: ["PHONE-LEGACY"], berduStaffIds: [] });
  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgB, { name: "CS Shared" }))?.csName).toBe("Beta");
    expect((await resolveAgent(ctx, orgB, { phoneNumberId: "PHONE-SHARED" }))?.csName).toBe("Beta");
    expect((await resolveAgent(ctx, orgB, { phoneNumberId: "PHONE-LEGACY" }))?.csName).toBe("Legacy");
  });
});

test("resolveAgent: a genuine phone miss continues to supplied staff ID and then name", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Staff Match", normalizedName: "staff match", key: "staff-match",
    providerNumberId: undefined, providerNumberIds: [], berduStaffIds: ["STAFF-MATCH"],
  });
  await seedAgent(t, orgId, {
    csName: "Name Match", normalizedName: "name match", key: "name-match",
    providerNumberId: undefined, providerNumberIds: [], berduStaffIds: [],
  });

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-MISSING", berduStaffId: "STAFF-MATCH", name: "Name Match",
    }))?.csName).toBe("Staff Match");
    expect((await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-MISSING", name: "Name Match",
    }))?.csName).toBe("Name Match");
  });
});

test("resolveAgent: same-org scalar provider ID collisions remain unresolved", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { csName: "Alfa", normalizedName: "alfa", key: "alfa", providerNumberId: "PHONE-DUPLICATE", providerNumberIds: [] });
  await seedAgent(t, orgId, { csName: "Beta", normalizedName: "beta", key: "beta", providerNumberId: "PHONE-DUPLICATE", providerNumberIds: [], berduStaffIds: [] });

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-DUPLICATE" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-DUPLICATE", berduStaffId: "B-1apQSy", name: "Aisyah",
    })).toBeNull();
  });
});

test("resolveAgent: an active scalar cannot win over another active legacy-array claimant", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Scalar", normalizedName: "scalar", key: "scalar",
    providerNumberId: "PHONE-CROSS-SHAPE", providerNumberIds: ["PHONE-CROSS-SHAPE"],
  });
  await seedAgent(t, orgId, {
    csName: "Legacy", normalizedName: "legacy", key: "legacy", berduStaffIds: [],
    providerNumberId: undefined, providerNumberIds: ["PHONE-CROSS-SHAPE"],
  });
  await runSeedKeysToCompletion(t.withIdentity(ADMIN));

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-CROSS-SHAPE" })).toBeNull();
  });
});

test("resolveAgent: a unique active scalar stays fast and resolves in an org larger than the legacy cap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "target", csName: "Target", key: "target",
      nameAliases: [], berduStaffIds: [], providerNumberId: "PHONE-FAST", providerNumberIds: [],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 1, updatedAt: 1,
    });
    for (let i = 0; i < 51; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `extra-${i}`, csName: `Extra ${i}`, key: `extra-${i}`,
        nameAliases: [], berduStaffIds: [], providerNumberIds: [],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: true, createdAt: i + 2, updatedAt: 1,
      });
    }
  });

  await runSeedKeysToCompletion(t.withIdentity(ADMIN));

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-FAST" }))?.csName).toBe("Target");
  });
});

test("resolveAgent: completed indexed claims resolve every unique alias in a large org", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Multi", normalizedName: "multi", key: "multi", berduStaffIds: [],
    providerNumberId: undefined, providerNumberIds: ["PHONE-MULTI-A", "PHONE-MULTI-B"],
  });
  for (let i = 0; i < 51; i++) {
    await seedAgent(t, orgId, {
      csName: `Extra ${i}`, normalizedName: `extra-${i}`, key: `extra-${i}`,
      providerNumberId: undefined, providerNumberIds: [], berduStaffIds: [], createdAt: i + 2,
    });
  }
  await runSeedKeysToCompletion(t.withIdentity(ADMIN));

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-MULTI-A" }))?.csName).toBe("Multi");
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-MULTI-B" }))?.csName).toBe("Multi");
  });
});

test("resolveAgent: an incomplete claim migration stays fail-closed above the legacy proof cap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Target", normalizedName: "target", key: "target",
    providerNumberId: "PHONE-INCOMPLETE", providerNumberIds: ["PHONE-INCOMPLETE"],
  });
  for (let i = 0; i < 51; i++) {
    await seedAgent(t, orgId, {
      csName: `Extra ${i}`, normalizedName: `extra-${i}`, key: `extra-${i}`,
      providerNumberId: undefined, providerNumberIds: [], berduStaffIds: [], createdAt: i + 2,
    });
  }
  await t.withIdentity(ADMIN).mutation(api.agents.seedKeys, {});

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-INCOMPLETE", berduStaffId: "B-1apQSy", name: "Target",
    })).toBeNull();
  });
});

test("resolveAgent: an inactive duplicate scalar neither blocks the active scalar nor creates ambiguity", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { csName: "Current", normalizedName: "current", key: "current", providerNumberId: "PHONE-ACTIVE", providerNumberIds: [] });
  await seedAgent(t, orgId, { csName: "Retired", normalizedName: "retired", key: "retired", providerNumberId: "PHONE-ACTIVE", providerNumberIds: [], isActive: false, berduStaffIds: [] });

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-ACTIVE" }))?.csName).toBe("Current");
  });
});

test("resolveAgent: duplicate legacy provider IDs remain unresolved", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { csName: "Alfa", normalizedName: "alfa", key: "alfa", providerNumberId: undefined, providerNumberIds: ["PHONE-DUPLICATE"] });
  await seedAgent(t, orgId, { csName: "Beta", normalizedName: "beta", key: "beta", providerNumberId: undefined, providerNumberIds: ["PHONE-DUPLICATE"], berduStaffIds: [] });

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-DUPLICATE" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-DUPLICATE", berduStaffId: "B-1apQSy", name: "Aisyah",
    })).toBeNull();
  });
});

test("resolveAgent: bounded legacy provider lookup refuses an oversized org registry", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    for (let i = 0; i < 51; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `cs-${i}`, csName: `CS ${i}`, key: `cs-${i}`,
        nameAliases: [], berduStaffIds: [], providerNumberIds: i === 0 ? ["PHONE-CAPPED"] : [],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: true, createdAt: 1, updatedAt: 1,
      });
    }
  });

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-CAPPED" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, {
      phoneNumberId: "PHONE-CAPPED", berduStaffId: "STAFF-0", name: "Agent 0",
    })).toBeNull();
  });
});

test("resolveAgent: inactive rows do not consume the active legacy fallback cap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    for (let i = 0; i < 51; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `retired-${i}`, csName: `Retired ${i}`, key: `retired-${i}`,
        nameAliases: [], berduStaffIds: [], providerNumberIds: [],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: false, createdAt: i + 1, updatedAt: 1,
      });
    }
    await ctx.db.insert("csConfigs", {
      orgId, normalizedName: "legacy", csName: "Legacy", key: "legacy",
      nameAliases: [], berduStaffIds: [], providerNumberIds: ["PHONE-LEGACY-ACTIVE"],
      orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
      isActive: true, createdAt: 100, updatedAt: 1,
    });
  });

  await t.run(async (ctx: any) => {
    expect((await resolveAgent(ctx, orgId, { phoneNumberId: "PHONE-LEGACY-ACTIVE" }))?.csName).toBe("Legacy");
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

test("seedKeys: idempotently backfills scalar provider IDs only from unambiguous legacy arrays", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, { key: undefined, nameAliases: undefined });
  await seedAgent(t, orgId, { csName: "Risma", normalizedName: "risma", key: "risma", nameAliases: [], berduStaffIds: ["B-1CxSmL"], providerNumberIds: ["433364286526515"] });
  await seedAgent(t, orgId, { csName: "Multi", normalizedName: "multi", key: "multi", nameAliases: [], berduStaffIds: [], providerNumberIds: ["PHONE-ONE", "PHONE-TWO"] });
  await seedAgent(t, orgId, { csName: "Duplicate", normalizedName: "duplicate", key: "duplicate", nameAliases: [], berduStaffIds: [], providerNumberIds: ["1197250776802755"] });
  const asAdmin = t.withIdentity(ADMIN);
  const firstRun = await runSeedKeysToCompletion(asAdmin);
  expect(firstRun.totalSeeded).toBe(2);
  const secondRun = await runSeedKeysToCompletion(asAdmin);
  expect(secondRun.totalSeeded).toBe(0);
  await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("csConfigs").collect();
    for (const row of rows) { expect(row.key).toBeDefined(); expect(row.nameAliases).toBeDefined(); }
    expect(rows.find((row: any) => row.csName === "Aisyah")?.providerNumberId).toBeUndefined();
    expect(rows.find((row: any) => row.csName === "Risma")?.providerNumberId).toBe("433364286526515");
    expect(rows.find((row: any) => row.csName === "Multi")?.providerNumberId).toBeUndefined();
    expect(rows.find((row: any) => row.csName === "Duplicate")?.providerNumberId).toBeUndefined();
    const run = await ctx.db.query("providerNumberBackfillRuns")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique();
    expect(run?.phase).toBe("complete");
    const claims = await ctx.db.query("providerNumberBackfillClaims")
      .withIndex("by_org_run", (q: any) => q.eq("orgId", orgId).eq("runId", run!._id)).collect();
    expect(claims.length).toBeGreaterThan(0);
  });
});

test("seedKeys: durable scan/apply pagination advances through more than 51 active configs", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    for (let i = 0; i < 52; i++) {
      await ctx.db.insert("csConfigs", {
        orgId, normalizedName: `agent-${i}`, csName: `Agent ${i}`, key: `agent-${i}`,
        nameAliases: [], berduStaffIds: [], providerNumberIds: [`PHONE-${i}`],
        orderAutomationEnabled: true, aiAssistantEnabled: false, reportingEnabled: true,
        isActive: true, createdAt: i + 1, updatedAt: 1,
      });
    }
  });
  const result = await runSeedKeysToCompletion(t.withIdentity(ADMIN));
  expect(result.calls).toBeGreaterThan(2);

  await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("csConfigs")
      .withIndex("by_org_active", (q: any) => q.eq("orgId", orgId).eq("isActive", true))
      .collect();
    expect(rows).toHaveLength(52);
    expect(rows.every((row: any) => row.providerNumberId === row.providerNumberIds[0])).toBe(true);
  });
});

test("seedKeysForOrg migrates the requested tenant without viewer-derived scope", async () => {
  const t = convexTest(schema);
  const orgA = await seedOrg(t);
  const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", {
    slug: "other", name: "Other", createdAt: 1, updatedAt: 1,
  })) as Id<"organizations">;
  await seedAgent(t, orgA, { key: undefined, nameAliases: undefined });
  await seedAgent(t, orgB, { key: undefined, nameAliases: undefined });

  let result: any;
  for (let call = 0; call < 8; call++) {
    result = await t.mutation(internal.agents.seedKeysForOrg, { orgId: orgB });
    if (result.done) break;
  }
  expect(result.done).toBe(true);
  await t.run(async (ctx: any) => {
    expect(await ctx.db.query("providerNumberBackfillRuns")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgA)).unique()).toBeNull();
    expect((await ctx.db.query("providerNumberBackfillRuns")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgB)).unique())?.phase).toBe("complete");
  });
});

test("provider migration driver reports completion and isolates per-org failures", async () => {
  const driveProviderMigrations = (agents as any).driveProviderMigrations;
  expect(driveProviderMigrations).toBeTypeOf("function");
  const attempted: string[] = [];
  const continued: string[] = [];
  const result = await driveProviderMigrations(
    ["org-1", "org-2", "org-3"],
    async (orgId: string) => {
      attempted.push(orgId);
      if (orgId === "org-2") throw new Error("tenant failed");
      return { done: orgId === "org-3" };
    },
    async (orgId: string) => { continued.push(orgId); },
  );
  expect(attempted).toEqual(["org-1", "org-2", "org-3"]);
  expect(continued).toEqual(["org-1"]);
  expect(result).toEqual({
    completedOrganizations: 1,
    continuingOrganizations: 1,
    failedOrganizations: ["org-2"],
  });
});

test("platform provider migration schedules resumable work for every organization", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const orgA = await seedOrg(t);
    const orgB = await t.run((ctx: any) => ctx.db.insert("organizations", {
      slug: "other", name: "Other", createdAt: 1, updatedAt: 1,
    })) as Id<"organizations">;
    await seedAgent(t, orgA, { providerNumberId: undefined, providerNumberIds: ["PHONE-A"] });
    await seedAgent(t, orgB, {
      csName: "Beta", normalizedName: "beta", key: "beta", berduStaffIds: [],
      providerNumberId: undefined, providerNumberIds: ["PHONE-B"],
    });

    const first = await t.action(internal.agents.seedKeysForAllOrganizations, {});
    expect(first).toMatchObject({
      completedOrganizations: 0,
      continuingOrganizations: 2,
      failedOrganizations: [],
      complete: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx: any) => {
      for (const orgId of [orgA, orgB]) {
        expect((await ctx.db.query("providerNumberBackfillRuns")
          .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique())?.phase).toBe("complete");
      }
    });
  } finally {
    vi.useRealTimers();
  }
});

test("resolveAgent fails closed for array-based staff and alias claims above the registry cap", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await seedAgent(t, orgId, {
    csName: "Target", normalizedName: "target", key: "target",
    nameAliases: ["Special Alias"], berduStaffIds: ["SPECIAL-STAFF"], providerNumberIds: [],
  });
  for (let i = 0; i < 50; i++) {
    await seedAgent(t, orgId, {
      csName: `Extra ${i}`, normalizedName: `extra-${i}`, key: `extra-${i}`,
      nameAliases: [], berduStaffIds: [], providerNumberIds: [], createdAt: i + 2,
    });
  }

  await t.run(async (ctx: any) => {
    expect(await resolveAgent(ctx, orgId, { berduStaffId: "SPECIAL-STAFF" })).toBeNull();
    expect(await resolveAgent(ctx, orgId, { name: "Special Alias" })).toBeNull();
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
