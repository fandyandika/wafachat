import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

test("provisionDefaultScalevSource creates one enabled env-backed source idempotently", async () => {
  const t = convexTest(schema);
  const orgId = await t.run((ctx) => ctx.db.insert("organizations", {
    slug: "pustakaislam",
    name: "Pustaka Islam",
    createdAt: 1,
    updatedAt: 1,
  }));

  await expect(t.mutation(internal.ingest.sources.provisionDefaultScalevSource, {}))
    .resolves.toMatchObject({ created: true, sourceKey: "scalev-pustakaislam", orgId });
  await expect(t.mutation(internal.ingest.sources.provisionDefaultScalevSource, {}))
    .resolves.toMatchObject({ created: false, sourceKey: "scalev-pustakaislam", orgId });

  await t.run(async (ctx) => {
    expect(await ctx.db.query("ingestSources").collect()).toEqual([
      expect.objectContaining({
        orgId,
        sourceKey: "scalev-pustakaislam",
        kind: "scalev",
        secret: "env:SCALEV_WEBHOOK_SIGNING_SECRET",
        enabled: true,
        enforceSignature: true,
      }),
    ]);
  });
});
