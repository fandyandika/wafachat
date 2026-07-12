import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

test("getActivePhrases: empty table falls back to default", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const phrases = await asAdmin.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["PEMESANAN BERHASIL"]);
});

test("getActivePhrases: returns active rows uppercased, ignores inactive", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity({ subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" });
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("closingRules", { orgId, phrase: "deal ya kak", active: true, createdAt: 1 });
    await ctx.db.insert("closingRules", { orgId, phrase: "draft", active: false, createdAt: 1 });
  });
  const phrases = await asAdmin.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["DEAL YA KAK"]);
});
