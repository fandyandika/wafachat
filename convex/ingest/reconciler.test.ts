import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { buildBerduAuth, computeGaps, reconcilePreparedGaps, wibDatePrefix } from "./reconciler";
import { hmacBase64 } from "./signature";

describe("computeGaps", () => {
  test("finds holes between min and max", () => {
    expect(computeGaps([1, 2, 5, 6], 1, 6)).toEqual([3, 4]);
  });
  test("no gaps / empty -> empty", () => {
    expect(computeGaps([1, 2, 3], 1, 3)).toEqual([]);
    expect(computeGaps([], null, null)).toEqual([]);
  });
});

describe("wibDatePrefix", () => {
  test("formats YYMMDD in WIB", () => {
    // 2026-07-07 18:00 UTC == 2026-07-08 01:00 WIB
    expect(wibDatePrefix(Date.UTC(2026, 6, 7, 18, 0, 0))).toBe("260708");
  });
});

describe("buildBerduAuth", () => {
  test("header = appId.ts.base64hmac(appId:ts:appSecret, key)", async () => {
    const { authHeader } = await buildBerduAuth("app1", "sec1", "key1", 1783442989);
    const expectedSig = await hmacBase64("key1", "app1:1783442989:sec1");
    expect(authHeader).toBe(`app1.1783442989.${expectedSig}`);
  });
});

describe("reconcilePreparedGaps", () => {
  test("commits a non-throwing skipped detail as unresolved until the exact order exists", async () => {
    const t = convexTest(schema);
    const orgId: any = await t.run((ctx: any) =>
      ctx.db.insert("organizations", { slug: "orchestration", name: "Orchestration", createdAt: 1, updatedAt: 1 }),
    );
    const processed: unknown[] = [];

    const result = await reconcilePreparedGaps(
      { gaps: [3], nextCounter: 4 },
      {
        fetchDetail: async () => ({ order_id: "O-260719000999" }), // mismatched detail
        processDetail: async (_counter, detail) => {
          processed.push(detail);
          return { status: "skipped", reason: "unparseable order detail" };
        },
        commit: (args) => t.mutation(internal.ingest.reconcileState.commitReconcileRun, {
          orgId,
          datePrefix: "260719",
          ...args,
        }),
        onFailure: async () => {},
      },
    );

    expect(processed).toHaveLength(1);
    expect(result.healed).toBe(0);
    expect(result.unresolvedCounters).toEqual([3]);
    const retry = await t.query(internal.ingest.reconcileState.prepareReconcileRun, { orgId, datePrefix: "260719" });
    expect(retry).toEqual({ gaps: [3], nextCounter: 4 });
  });

  test("advances the durable probe cursor after only the attempted page", async () => {
    const fetched: number[] = [];
    let committed: any;
    await reconcilePreparedGaps(
      { gaps: Array.from({ length: 120 }, (_, index) => index + 1), nextCounter: 121 },
      {
        fetchDetail: async (counter) => { fetched.push(counter); return null; },
        processDetail: async () => null,
        commit: async (args) => {
          committed = args;
          return { nextCounter: args.nextCounter, unresolvedCounters: args.unresolvedCounters };
        },
        onFailure: async () => {},
      },
    );
    expect(fetched).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(committed.probeCursor).toBe(51);
    expect(committed.unresolvedCounters).toHaveLength(120);
  });
});
