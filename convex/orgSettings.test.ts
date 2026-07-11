import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { DEFAULT_INTERNAL_PHONES, getInternalPhoneSet, loadOrgSettings } from "./orgSettings";

const ADMIN = { subject: "test-admin", role: "admin", name: "Test Admin", email: "test@wafachat" };

test("loadOrgSettings: empty table falls back to in-code defaults", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Pustaka Islam");
    expect(s.internalPhones).toEqual(DEFAULT_INTERNAL_PHONES);
    const set = await getInternalPhoneSet(ctx);
    expect(set.has("6281385708799")).toBe(true); // CS Aisyah line, from defaults
  });
});

test("seedDefault: inserts once, second call is a no-op", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  const first = await asAdmin.mutation(api.orgSettings.seedDefault, {});
  expect(first.seeded).toBe(true);
  const second = await asAdmin.mutation(api.orgSettings.seedDefault, {});
  expect(second.seeded).toBe(false);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("orgSettings").collect();
    expect(rows.length).toBe(1);
    expect(rows[0].internalPhones).toEqual(DEFAULT_INTERNAL_PHONES);
  });
});

test("update: normalizes phones (0/8 prefixes), dedupes, upserts when table empty", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgSettings.update, {
    orgName: "Toko Test",
    internalPhones: ["081234567890", "81234567890", "6281234567890", "6289999999999"],
  });
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Toko Test");
    // three spellings of the same number collapse to one normalized entry
    expect(s.internalPhones).toEqual(["6281234567890", "6289999999999"]);
    const set = await getInternalPhoneSet(ctx);
    expect(set.has("6281385708799")).toBe(false); // table now overrides defaults entirely
  });
});

test("update: partial patch keeps the other field", async () => {
  const t = convexTest(schema);
  const asAdmin = t.withIdentity(ADMIN);
  await asAdmin.mutation(api.orgSettings.seedDefault, {});
  await asAdmin.mutation(api.orgSettings.update, { orgName: "Renamed Org" });
  await t.run(async (ctx) => {
    const s = await loadOrgSettings(ctx);
    expect(s.orgName).toBe("Renamed Org");
    expect(s.internalPhones).toEqual(DEFAULT_INTERNAL_PHONES); // untouched
  });
});
