import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (import.meta as any).glob("./**/*.{ts,js}");
const now = Date.UTC(2026, 7, 12, 12);
const anchor = Date.UTC(2026, 7, 10, 10, 30);
const calendarDueAt = Date.UTC(2026, 7, 11, 1);

async function seedOrg(t: any, slug = "pustakaislam") {
  return t.run((ctx: any) => ctx.db.insert("organizations", {
    slug,
    name: "Org",
    createdAt: 1,
    updatedAt: 1,
  }));
}

function conversation(orgId: Id<"organizations">, orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    orgId,
    orderId,
    customerPhone: `6281${orderId.replace(/\D/g, "").padStart(8, "0")}`,
    customerName: orderId,
    assignedCsName: "Aisyah",
    status: "active" as const,
    aiEnabled: false,
    note: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function order(orgId: Id<"organizations">, orderId: string, productName: string) {
  return {
    orgId,
    orderId,
    customerPhone: `6282${orderId.replace(/\D/g, "").padStart(8, "0")}`,
    customerName: orderId,
    assignedCsName: "Aisyah",
    productName,
    products: productName,
    productsSubtotal: "",
    shippingCost: "",
    total: "",
    shippingAddress: "",
    shippingDistrict: "",
    shippingCity: "",
    source: "berdu" as const,
    aiEligible: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function recap(
  orgId: Id<"organizations">,
  status: "ready" | "needs_review" | "exported" | "delivered" | "cancelled" | "cancelled_after_export",
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    orgId,
    orderIdBerdu: `RECAP-${suffix}`,
    customerPhone: `6283${suffix.padStart(8, "0")}`,
    customerName: suffix,
    csName: "Aisyah",
    closedAt: 100,
    recipientName: suffix,
    recipientPhone: `6283${suffix.padStart(8, "0")}`,
    recipientAddress: "Jalan Test",
    recipientDistrict: "Coblong",
    recipientCity: "Bandung",
    packageContent: "Quran Mapping",
    paymentMethod: "cod" as const,
    status,
    flags: [],
    sourceMessageText: "closing",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function startCutover(t: any, mode: "dry_run" | "apply", orgSlug = "pustakaislam") {
  return t.mutation(internal.followUpMigration.startCutoverBySlug, { orgSlug, mode });
}

async function createRun(t: any, orgId: Id<"organizations">, mode: "dry_run" | "apply") {
  return t.run((ctx: any) => ctx.db.insert("followUpPreparationRuns", {
    orgId,
    mode,
    status: "running",
    phase: "products_orders",
    nextConversationStatus: "active",
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    startedAt: now,
    updatedAt: now,
  }));
}

async function finishCutover(t: any, runId: Id<"followUpPreparationRuns">) {
  for (let page = 0; page < 100; page += 1) {
    const run = await t.run((ctx: any) => ctx.db.get(runId));
    if (run?.status === "complete") return run;
    await t.mutation(internal.followUpMigration.preparePage, { runId, scheduleNext: false });
  }
  throw new Error("Cutover did not finish within the bounded test budget.");
}

async function businessSnapshot(t: any) {
  return t.run(async (ctx: any) => ({
    conversations: await ctx.db.query("conversations").collect(),
    recaps: await ctx.db.query("shippingRecaps").collect(),
    counters: await ctx.db.query("followUpCounters").collect(),
  }));
}

test("normalizes legacy waiting snapshots from calendar anchors and sends ambiguous rows to review", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx: any) => ({
    valid: await ctx.db.insert("conversations", conversation(orgId, "VALID-1", {
      followUpStage: 1,
      followUpStageAt: anchor,
      lastMessageAt: anchor + 5_000,
      followUpDueAt: anchor + 24 * 60 * 60 * 1_000,
    })),
    terminal: await ctx.db.insert("conversations", conversation(orgId, "TERMINAL-2", {
      followUpState: "complete",
      followUpOutcome: "closing",
      followUpCycleId: "cycle:terminal",
    })),
    missingStage: await ctx.db.insert("conversations", conversation(orgId, "MISSING-STAGE-3", {
      followUpState: "waiting",
      lastMessageAt: anchor,
    })),
    missingCs: await ctx.db.insert("conversations", conversation(orgId, "MISSING-CS-4", {
      assignedCsName: "",
      followUpState: "waiting",
      followUpNextStage: 1,
      lastMessageAt: anchor,
    })),
    missingAnchor: await ctx.db.insert("conversations", conversation(orgId, "MISSING-ANCHOR-5", {
      followUpState: "waiting",
      followUpNextStage: 1,
    })),
    idle: await ctx.db.insert("conversations", conversation(orgId, "IDLE-6")),
    incompleteUnknown: await ctx.db.insert("conversations", conversation(orgId, "UNKNOWN-7", {
      followUpState: "unknown",
      followUpNextStage: 1,
      lastMessageAt: anchor,
      followUpRequestId: "550e8400-e29b-41d4-a716-446655440000",
    })),
  }));

  const runId = await createRun(t, orgId, "apply");
  await finishCutover(t, runId);

  const rows = await t.run(async (ctx: any) => ({
    valid: await ctx.db.get(ids.valid),
    terminal: await ctx.db.get(ids.terminal),
    missingStage: await ctx.db.get(ids.missingStage),
    missingCs: await ctx.db.get(ids.missingCs),
    missingAnchor: await ctx.db.get(ids.missingAnchor),
    idle: await ctx.db.get(ids.idle),
    incompleteUnknown: await ctx.db.get(ids.incompleteUnknown),
  }));
  expect(rows.valid).toMatchObject({
    followUpCsKey: "aisyah",
    followUpCycleId: `cycle:${String(ids.valid)}:${anchor}`,
    followUpCycleStartedAt: anchor,
    followUpNextStage: 2,
    followUpDueAt: calendarDueAt,
    followUpState: "waiting",
  });
  expect(rows.terminal).toMatchObject({
    followUpState: "complete",
    followUpOutcome: "closing",
    followUpCycleId: "cycle:terminal",
  });
  expect(rows.missingStage).toMatchObject({ followUpState: "review", followUpCsKey: "aisyah" });
  expect(rows.missingStage?.followUpReviewReason).toMatch(/tahap/i);
  expect(rows.missingCs).toMatchObject({ followUpState: "review", followUpCsKey: "unassigned" });
  expect(rows.missingCs?.followUpReviewReason).toMatch(/CS/i);
  expect(rows.missingAnchor).toMatchObject({ followUpState: "review", followUpCsKey: "aisyah" });
  expect(rows.missingAnchor?.followUpReviewReason).toMatch(/waktu acuan/i);
  expect(rows.idle?.followUpState).toBeUndefined();
  expect(rows.idle?.followUpCsKey).toBeUndefined();
  expect(rows.incompleteUnknown).toMatchObject({ followUpState: "review", followUpCsKey: "aisyah" });
  expect(rows.incompleteUnknown?.followUpReviewReason).toMatch(/siklus/i);
});

test("uses resumable 25-row phases and schedules only the internal page worker", async () => {
  vi.useFakeTimers({ now });
  try {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    await t.run(async (ctx: any) => {
      for (let index = 0; index < 30; index += 1) {
        const orderId = `PAGE-${index}`;
        await ctx.db.insert("orders", order(orgId, orderId, `Produk ${index}`));
        await ctx.db.insert("conversations", conversation(orgId, orderId, {
          followUpState: "waiting",
          followUpNextStage: 1,
          lastMessageAt: anchor,
        }));
      }
    });

    const { runId } = await startCutover(t, "apply");
    const scheduled = await t.run((ctx: any) => ctx.db.system.query("_scheduled_functions").collect()) as Array<{
      name: string;
    }>;
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ name: "followUpMigration:runPreparationStep" });

    const first = await t.mutation(internal.followUpMigration.preparePage, {
      runId,
      scheduleNext: false,
    });
    expect(first).toMatchObject({ phase: "products_orders", processed: 25, done: false });
    expect(await t.run((ctx: any) => ctx.db.get(runId))).toMatchObject({
      phase: "products_orders",
      status: "running",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const migrated = await t.run((ctx: any) => ctx.db.query("conversations").collect()) as Array<{
      followUpCycleId?: string;
      followUpState?: string;
    }>;
    expect(migrated).toHaveLength(30);
    expect(migrated.every((row: any) => row.followUpCycleId && row.followUpState === "waiting"))
      .toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("backfills product snapshots and every legacy recap closing classification without external CRM reads", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx: any) => {
    const fromOrder = await ctx.db.insert("conversations", conversation(orgId, "ORDER-PRODUCT-1", {
      followUpState: "waiting",
      followUpNextStage: 1,
      lastMessageAt: anchor,
    }));
    await ctx.db.insert("orders", order(orgId, "ORDER-PRODUCT-1", "quran mapping"));
    const fromRecap = await ctx.db.insert("conversations", conversation(orgId, "RECAP-PRODUCT-2", {
      followUpState: "waiting",
      followUpNextStage: 1,
      lastMessageAt: anchor,
    }));
    await ctx.db.insert("shippingRecaps", recap(orgId, "ready", "2", {
      orderIdBerdu: "RECAP-PRODUCT-2",
      conversationId: fromRecap,
      packageContent: "Sound Book Learning Shalat",
    }));
    const statuses = ["ready", "needs_review", "exported", "delivered", "cancelled", "cancelled_after_export"] as const;
    const recaps: Array<Id<"shippingRecaps">> = [];
    for (const [index, status] of statuses.entries()) {
      recaps.push(await ctx.db.insert("shippingRecaps", recap(orgId, status, String(index + 10), {
        closingBucket: status.startsWith("cancelled") ? "counted" : undefined,
      })));
    }
    return { fromOrder, fromRecap, recaps };
  });

  const runId = await createRun(t, orgId, "apply");
  await finishCutover(t, runId);

  expect(await t.run((ctx: any) => ctx.db.get(ids.fromOrder)))
    .toMatchObject({ followUpProductName: "Quran Mapping" });
  expect(await t.run((ctx: any) => ctx.db.get(ids.fromRecap)))
    .toMatchObject({ followUpProductName: "Sound Book: Learning How To Do Shalat" });
  const migrated = await t.run(async (ctx: any) => Promise.all(ids.recaps.map((id) => ctx.db.get(id))));
  expect(migrated.slice(0, 4).map((row: any) => row?.closingBucket)).toEqual([
    "counted", "counted", "counted", "counted",
  ]);
  expect(migrated.slice(4).map((row: any) => row?.closingBucket)).toEqual([undefined, undefined]);
});

test("rebuilds exact organization counters from normalized active lifecycle rows", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const otherOrgId = await t.run(async (ctx: any) => {
    const activeRows = [
      { orderId: "H1-1", cs: "aisyah", state: "waiting", stage: 1 },
      { orderId: "H2-2", cs: "aisyah", state: "waiting", stage: 2 },
      { orderId: "REVIEW-3", cs: "aisyah", state: "review", stage: undefined },
      { orderId: "SENDING-4", cs: "aisyah", state: "sending", stage: 2 },
      { orderId: "H3-5", cs: "budi", state: "waiting", stage: 3 },
      { orderId: "UNASSIGNED-6", cs: "", state: "review", stage: undefined },
      { orderId: "UNKNOWN-7", cs: "aisyah", state: "unknown", stage: 2 },
      { orderId: "FAILED-8", cs: "aisyah", state: "failed", stage: 3 },
    ] as const;
    for (const row of activeRows) {
      await ctx.db.insert("conversations", conversation(orgId, row.orderId, {
        assignedCsName: row.cs,
        followUpCsKey: row.cs,
        followUpCycleId: `cycle:${row.orderId}`,
        followUpCycleStartedAt: anchor,
        lastMessageAt: row.state === "unknown" || row.state === "failed" ? anchor : undefined,
        followUpState: row.state,
        followUpNextStage: row.stage,
        followUpDueAt: row.state === "waiting" ? calendarDueAt : undefined,
      }));
    }
    for (let index = 0; index < 26; index += 1) {
      await ctx.db.insert("conversations", conversation(orgId, `UNKNOWN-BULK-${String(index).padStart(2, "0")}`, {
        assignedCsName: "Bulk", followUpCsKey: "bulk", followUpCycleId: `cycle:unknown-bulk:${index}`,
        followUpCycleStartedAt: anchor, lastMessageAt: anchor, followUpState: "unknown", followUpNextStage: 2,
      }));
    }
    await ctx.db.insert("conversations", conversation(orgId, "TERMINAL-7", {
      followUpCsKey: "aisyah",
      followUpState: "archived",
      followUpCycleId: "cycle:terminal-7",
    }));
    for (let index = 0; index < 30; index += 1) {
      await ctx.db.insert("followUpCounters", {
        orgId,
        csKey: `stale-${String(index).padStart(2, "0")}`,
        h1: 99,
        h2: 99,
        h3: 99,
        review: 99,
        updatedAt: 1,
      });
    }
    const otherOrgId = await ctx.db.insert("organizations", {
      slug: "counter-other", name: "Other", createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("followUpCounters", {
      orgId: otherOrgId, csKey: "foreign", h1: 8, h2: 7, h3: 6, review: 5, updatedAt: 1,
    });
    return otherOrgId;
  });

  const runId = await createRun(t, orgId, "apply");
  let firstUnknownPage: any;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await t.mutation(internal.followUpMigration.preparePage, { runId, scheduleNext: false });
    if (page.phase === "counters_unknown") {
      firstUnknownPage = page;
      break;
    }
  }
  expect(firstUnknownPage).toMatchObject({ phase: "counters_unknown", processed: 25, done: false });
  await finishCutover(t, runId);

  const counters = await t.run((ctx: any) => ctx.db.query("followUpCounters")
    .withIndex("by_org_csKey", (q: any) => q.eq("orgId", orgId))
    .collect()) as Array<{ csKey: string; h1: number; h2: number; h3: number; review: number }>;
  expect(counters.map(({ csKey, h1, h2, h3, review }: any) => ({ csKey, h1, h2, h3, review })))
    .toEqual([
      { csKey: "aisyah", h1: 1, h2: 1, h3: 0, review: 4 },
      { csKey: "budi", h1: 0, h2: 0, h3: 1, review: 0 },
      { csKey: "bulk", h1: 0, h2: 0, h3: 0, review: 26 },
      { csKey: "unassigned", h1: 0, h2: 0, h3: 0, review: 1 },
    ]);
  expect(counters.reduce((total: number, row: any) => total + row.h1 + row.h2 + row.h3 + row.review, 0))
    .toBe(34);
  expect(await t.run((ctx: any) => ctx.db.query("followUpCounters")
    .withIndex("by_org_csKey", (q: any) => q.eq("orgId", otherOrgId).eq("csKey", "foreign")).unique()))
    .toMatchObject({ h1: 8, h2: 7, h3: 6, review: 5 });
});

test("dry-run leaves business snapshots and counters unchanged", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("conversations", conversation(orgId, "DRY-1", {
      followUpStage: 1,
      followUpStageAt: anchor,
    }));
    await ctx.db.insert("orders", order(orgId, "DRY-1", "Quran Mapping"));
    await ctx.db.insert("shippingRecaps", recap(orgId, "cancelled", "30", { closingBucket: "counted" }));
    await ctx.db.insert("followUpCounters", {
      orgId,
      csKey: "stale",
      h1: 7,
      h2: 6,
      h3: 5,
      review: 4,
      updatedAt: 1,
    });
  });
  const before = await businessSnapshot(t);

  const runId = await createRun(t, orgId, "dry_run");
  await finishCutover(t, runId);

  expect(await businessSnapshot(t)).toEqual(before);
});

test("a second apply is idempotent and both public and CLI starts reject overlapping runs", async () => {
  vi.useFakeTimers({ now });
  try {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    await t.run(async (ctx: any) => {
      await ctx.db.insert("conversations", conversation(orgId, "IDEMPOTENT-1", {
        followUpStage: 1,
        followUpStageAt: anchor,
      }));
      await ctx.db.insert("orders", order(orgId, "IDEMPOTENT-1", "Quran Mapping"));
    });

    await startCutover(t, "apply");
    await expect(startCutover(t, "dry_run")).rejects.toThrow(/masih berjalan/i);
    const asAdmin = t.withIdentity({ subject: "prep-admin", role: "admin", name: "Admin", email: "prep@test" });
    await expect(asAdmin.mutation(api.followUpMigration.startRecentFollowUpPreparation, { mode: "apply" }))
      .rejects.toThrow(/masih berjalan/i);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterFirst = await businessSnapshot(t);

    await startCutover(t, "apply");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterSecond = await businessSnapshot(t);
    expect(afterSecond.conversations).toEqual(afterFirst.conversations);
    expect(afterSecond.recaps).toEqual(afterFirst.recaps);
    expect(afterSecond.counters.map(({ updatedAt: _updatedAt, _id: _id, _creationTime: _creationTime, ...row }: any) => row))
      .toEqual(afterFirst.counters.map(({ updatedAt: _updatedAt, _id: _id, _creationTime: _creationTime, ...row }: any) => row));
  } finally {
    vi.useRealTimers();
  }
});

test("every active delivery state without a valid anchor enters review", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx: any) => {
    const result: Array<Id<"conversations">> = [];
    for (const state of ["waiting", "sending", "unknown", "failed", "review"] as const) {
      result.push(await ctx.db.insert("conversations", conversation(orgId, `NO-ANCHOR-${state}`, {
        followUpCsKey: "aisyah",
        followUpCycleId: `cycle:${state}`,
        followUpNextStage: 2,
        followUpState: state,
        followUpReviewReason: undefined,
      })));
    }
    return result;
  });
  const runId = await createRun(t, orgId, "apply");
  await finishCutover(t, runId);
  const rows = await t.run(async (ctx: any) => Promise.all(ids.map((id) => ctx.db.get(id))));
  expect(rows.map((row: any) => row.followUpState)).toEqual([
    "review", "review", "review", "review", "review",
  ]);
  for (const row of rows) expect(row?.followUpReviewReason).toMatch(/waktu acuan/i);
});

test("product fallback ignores ambiguous and foreign-tenant mappings", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const otherOrgId = await seedOrg(t, "other-products");
  const { ambiguous, foreign } = await t.run(async (ctx: any) => {
    const ambiguous = await ctx.db.insert("conversations", conversation(orgId, "AMBIGUOUS-1"));
    await ctx.db.insert("conversations", conversation(orgId, "AMBIGUOUS-1", { customerPhone: "628199999991" }));
    await ctx.db.insert("orders", order(orgId, "AMBIGUOUS-1", "Quran Mapping"));
    const foreign = await ctx.db.insert("conversations", conversation(orgId, "FOREIGN-2"));
    const foreignConversation = await ctx.db.insert("conversations", conversation(otherOrgId, "FOREIGN-OTHER-2"));
    await ctx.db.insert("shippingRecaps", recap(orgId, "ready", "72", {
      orderIdBerdu: "FOREIGN-2",
      conversationId: foreignConversation,
      packageContent: "Quran Mapping",
    }));
    return { ambiguous, foreign };
  });
  const runId = await createRun(t, orgId, "apply");
  await finishCutover(t, runId);
  expect(((await t.run((ctx: any) => ctx.db.get(ambiguous))) as any)?.followUpProductName).toBeUndefined();
  expect(((await t.run((ctx: any) => ctx.db.get(foreign))) as any)?.followUpProductName).toBeUndefined();
});

test("later recap phase resumes after 25 rows", async () => {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  await t.run(async (ctx: any) => {
    for (let index = 0; index < 30; index += 1) {
      await ctx.db.insert("shippingRecaps", recap(orgId, "ready", String(index + 100)));
    }
  });
  const runId = await t.run((ctx: any) => ctx.db.insert("followUpPreparationRuns", {
    orgId, mode: "apply", status: "running", phase: "recap_closing_buckets",
    nextConversationStatus: "active", scanned: 0, eligible: 0, updated: 0,
    skipped: 0, failed: 0, startedAt: now, updatedAt: now,
  })) as Id<"followUpPreparationRuns">;
  const first = await t.mutation(internal.followUpMigration.preparePage, { runId, scheduleNext: false });
  expect(first).toMatchObject({ phase: "recap_closing_buckets", processed: 25, done: false });
  await finishCutover(t, runId);
  const rows = await t.run((ctx: any) => ctx.db.query("shippingRecaps")
    .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId)).collect()) as Array<{
      closingBucket?: "counted";
    }>;
  expect(rows.every((row: any) => row.closingBucket === "counted")).toBe(true);
});

test("failed scheduled page marks the run failed, unlocks, and internal resume completes", async () => {
  vi.useFakeTimers({ now });
  try {
  const t = convexTest(schema, modules);
  const orgId = await seedOrg(t);
  const runId = await t.run(async (ctx: any) => {
    const runId = await ctx.db.insert("followUpPreparationRuns", {
      orgId, mode: "apply", status: "running", phase: "counters_waiting",
      nextConversationStatus: "handover", scanned: 0, eligible: 0, updated: 0,
      skipped: 0, failed: 0, startedAt: now, updatedAt: now,
    });
    await ctx.db.insert("followUpCutoverLocks", { orgId, runId: String(runId), lockedAt: now });
    await ctx.db.insert("conversations", conversation(orgId, "FAIL-PAGE-1", {
      followUpCsKey: "aisyah", followUpCycleId: "cycle:fail", followUpCycleStartedAt: anchor,
      followUpNextStage: 1, followUpDueAt: calendarDueAt, followUpState: "waiting",
    }));
    for (let index = 0; index < 2; index += 1) {
      await ctx.db.insert("followUpCounters", {
        orgId, csKey: "aisyah", h1: 0, h2: 0, h3: 0, review: 0, updatedAt: index,
      });
    }
    return runId;
  });
  const failed = await t.action(internal.followUpMigration.runPreparationStep, { runId });
  expect(failed).toMatchObject({ failed: true });
  expect(await t.run((ctx: any) => ctx.db.get(runId))).toMatchObject({ status: "failed", failed: 1 });
  expect(await t.run((ctx: any) => ctx.db.query("followUpCutoverLocks")
    .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique())).toBeNull();

  await t.mutation(internal.followUpMigration.resumeCutoverBySlug, { orgSlug: "pustakaislam" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx: any) => ctx.db.get(runId))).toMatchObject({ status: "complete" });
  expect(await t.run((ctx: any) => ctx.db.query("followUpCutoverLocks")
    .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique())).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("resume rejects fresh overlap, including when an older failed run exists", async () => {
  vi.useFakeTimers({ now });
  try {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    await t.run(async (ctx: any) => {
      await ctx.db.insert("followUpPreparationRuns", {
        orgId, mode: "apply", status: "failed", phase: "products_orders",
        nextConversationStatus: "active", scanned: 0, eligible: 0, updated: 0, skipped: 0,
        failed: 1, startedAt: now - 20_000, updatedAt: now - 10_000,
      });
      await ctx.db.insert("followUpPreparationRuns", {
        orgId, mode: "apply", status: "running", phase: "normalize_active",
        nextConversationStatus: "active", scanned: 0, eligible: 0, updated: 0, skipped: 0,
        failed: 0, startedAt: now - 15 * 60 * 1_000, updatedAt: now - 15 * 60 * 1_000,
      });
    });
    await expect(t.mutation(internal.followUpMigration.resumeCutoverBySlug, {
      orgSlug: "pustakaislam",
    })).rejects.toThrow(/masih berjalan|aktif/i);
  } finally {
    vi.useRealTimers();
  }
});

test("resume recovers a stale running counter run from deletion, refreshes lock, and completes", async () => {
  vi.useFakeTimers({ now });
  try {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const staleAt = now - 24 * 60 * 60 * 1_000;
    const runId = await t.run(async (ctx: any) => {
      const runId = await ctx.db.insert("followUpPreparationRuns", {
        orgId, mode: "apply", status: "running", phase: "counters_failed", cursor: "stale-cursor",
        nextConversationStatus: "handover", scanned: 0, eligible: 0, updated: 0, skipped: 0,
        failed: 0, startedAt: staleAt, updatedAt: staleAt,
      });
      await ctx.db.insert("followUpCutoverLocks", { orgId, runId, lockedAt: staleAt });
      await ctx.db.insert("followUpCounters", {
        orgId, csKey: "stale", h1: 99, h2: 99, h3: 99, review: 99, updatedAt: staleAt,
      });
      await ctx.db.insert("conversations", conversation(orgId, "STALE-UNKNOWN", {
        followUpCsKey: "aisyah", followUpCycleId: "cycle:stale-unknown", followUpCycleStartedAt: anchor,
        lastMessageAt: anchor, followUpNextStage: 2, followUpState: "unknown",
      }));
      return runId;
    });

    expect(await t.mutation(internal.followUpMigration.resumeCutoverBySlug, {
      orgSlug: "pustakaislam",
    })).toEqual({ runId });
    const resumed: any = await t.run((ctx: any) => ctx.db.get(runId));
    expect(resumed).toMatchObject({ status: "running", phase: "counters_delete", updatedAt: now });
    expect(resumed?.cursor).toBeUndefined();
    expect(await t.run((ctx: any) => ctx.db.query("followUpCutoverLocks")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique())).toMatchObject({ lockedAt: now });

    vi.advanceTimersByTime(60_000);
    await t.mutation(internal.followUpMigration.preparePage, { runId, scheduleNext: false });
    expect(await t.run((ctx: any) => ctx.db.query("followUpCutoverLocks")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique()))
      .toMatchObject({ lockedAt: now + 60_000 });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx: any) => ctx.db.get(runId))).toMatchObject({ status: "complete" });
    expect(await t.run((ctx: any) => ctx.db.query("followUpCounters")
      .withIndex("by_org_csKey", (q: any) => q.eq("orgId", orgId).eq("csKey", "aisyah")).unique()))
      .toMatchObject({ h1: 0, h2: 0, h3: 0, review: 1 });
    expect(await t.run((ctx: any) => ctx.db.query("followUpCutoverLocks")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId)).unique())).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
