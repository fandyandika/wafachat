import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const ADMIN = {
  subject: "follow-up-admin",
  role: "admin" as const,
  name: "Follow-up Admin",
  email: "followup-admin@wafachat.test",
};

const CS = {
  subject: "follow-up-cs",
  role: "cs" as const,
  name: "Aisyah",
  email: "followup-cs@wafachat.test",
  csName: "Aisyah",
};

async function createHarness() {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgs.seedDefaultOrg, {});
  return { t, asAdmin, asCs: t.withIdentity(CS) };
}

describe("follow-up template configuration", () => {
  test("admin configures one active template for each stage", async () => {
    const { asAdmin } = await createHarness();

    await asAdmin.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
      stage: 1,
      label: "Follow-up H+1",
      templateName: "approved_followup_h1",
      language: "id",
      variables: ["customer_name", "product_name", "order_id"],
      isActive: true,
    });

    const setup = await asAdmin.query(api.followUpTemplates.getFollowUpTemplateSetup, {});
    expect(setup.ready).toBe(false);
    expect(setup.missingStages).toEqual([2, 3]);
    expect(setup.templates).toEqual([
      expect.objectContaining({
        stage: 1,
        templateName: "approved_followup_h1",
        variables: ["customer_name", "product_name", "order_id"],
        isActive: true,
      }),
    ]);
  });

  test("CS cannot change follow-up templates", async () => {
    const { asCs } = await createHarness();

    await expect(asCs.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
      stage: 1,
      label: "Follow-up H+1",
      templateName: "approved_followup_h1",
      language: "id",
      variables: ["customer_name"],
      isActive: true,
    })).rejects.toThrow(/requires admin/);
  });

  test("duplicate variables are rejected instead of changing provider positions", async () => {
    const { asAdmin } = await createHarness();

    await expect(asAdmin.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
      stage: 2,
      label: "Follow-up H+2",
      templateName: "approved_followup_h2",
      language: "id",
      variables: ["customer_name", "customer_name"],
      isActive: true,
    })).rejects.toThrow(/duplikat/i);
  });

  test("template setup is isolated by the admin organization", async () => {
    const t = convexTest(schema);
    const now = 1_000;
    const { orgA, orgB } = await t.run(async (ctx) => {
      const orgA = await ctx.db.insert("organizations", {
        slug: "follow-up-a",
        name: "Follow-up A",
        createdAt: now,
        updatedAt: now,
      });
      const orgB = await ctx.db.insert("organizations", {
        slug: "follow-up-b",
        name: "Follow-up B",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("users", {
        orgId: orgA,
        email: "admin-a@wafachat.test",
        name: "Admin A",
        passwordHash: "test",
        role: "admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("users", {
        orgId: orgB,
        email: "admin-b@wafachat.test",
        name: "Admin B",
        passwordHash: "test",
        role: "admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return { orgA, orgB };
    });
    expect(String(orgA)).not.toBe(String(orgB));

    const asAdminA = t.withIdentity({ ...ADMIN, subject: "admin-a", email: "admin-a@wafachat.test" });
    const asAdminB = t.withIdentity({ ...ADMIN, subject: "admin-b", email: "admin-b@wafachat.test" });
    await asAdminA.mutation(api.followUpTemplates.upsertFollowUpTemplate, {
      stage: 1,
      label: "Tenant A H+1",
      templateName: "tenant_a_h1",
      language: "id",
      variables: [],
      isActive: true,
    });

    expect((await asAdminA.query(api.followUpTemplates.getFollowUpTemplateSetup, {})).templates).toHaveLength(1);
    expect((await asAdminB.query(api.followUpTemplates.getFollowUpTemplateSetup, {})).templates).toHaveLength(0);
  });
});
