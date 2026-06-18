import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

test("getActivePhrases: empty table falls back to default", async () => {
  const t = convexTest(schema);
  const phrases = await t.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["PEMESANAN BERHASIL"]);
});

test("getActivePhrases: returns active rows uppercased, ignores inactive", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("closingRules", { phrase: "deal ya kak", active: true, createdAt: 1 });
    await ctx.db.insert("closingRules", { phrase: "draft", active: false, createdAt: 1 });
  });
  const phrases = await t.query(api.closingRules.getActivePhrases, {});
  expect(phrases).toEqual(["DEAL YA KAK"]);
});
