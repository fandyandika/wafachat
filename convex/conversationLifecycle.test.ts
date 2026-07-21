import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as conversationLifecycle from "./conversationLifecycle";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 5, 26, 5, 0, 0);

const conv = (orderId: string, phone: string, over: Record<string, unknown> = {}) => ({
  orderId, customerPhone: phone, customerName: "Budi", assignedCsName: "Nabila",
  status: "active" as const, aiEnabled: false, note: "", createdAt: now - 10 * DAY, updatedAt: now - 10 * DAY, ...over,
});
const order = (orderId: string, phone: string) => ({
  orderId, customerPhone: phone, customerName: "Budi", assignedCsName: "Nabila", productName: "X",
  products: "X", productsSubtotal: "0", shippingCost: "0", total: "0", shippingAddress: "", shippingDistrict: "",
  shippingCity: "", source: "berdu" as const, aiEligible: false, createdAt: now - 10 * DAY, updatedAt: now,
});
const inbound = (conversationId: any, orderId: string, phone: string, createdAt: number) => ({
  conversationId, orderId, customerPhone: phone, role: "customer" as const, direction: "inbound" as const,
  content: "x", messageType: "text" as const, source: "n8n" as const, createdAt,
});
const outbound = (conversationId: any, orderId: string, phone: string, createdAt: number, content: string) => ({
  conversationId, orderId, customerPhone: phone, role: "cs" as const, direction: "outbound" as const,
  content, messageType: "text" as const, source: "panel" as const, createdAt,
});
const recap = (orderIdBerdu: string, phone: string) => ({
  orderIdBerdu, customerPhone: phone, customerName: "Budi", csName: "Nabila", closedAt: now - DAY,
  recipientName: "Budi", recipientPhone: phone, recipientAddress: "", recipientDistrict: "", recipientCity: "",
  packageContent: "X", paymentMethod: "cod" as const, status: "ready" as const, flags: [], sourceMessageText: "",
  version: 1, createdAt: now - DAY, updatedAt: now - DAY,
});

async function scanAndProcessStatus(
  t: any,
  orgId: Id<"organizations">,
  options: { dryRun: boolean; now: number; status?: "active" | "handover" },
) {
  const ids: Id<"conversations">[] = [];
  let cursor: string | undefined;
  let isDone = false;
  while (!isDone) {
    const page: any = await t.query(internal.conversationLifecycle.scanOpenBatch, {
      cursor, status: options.status ?? "active", orgId,
    });
    ids.push(...page.ids);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  const totals = { closedWon: 0, closedMarker: 0, closedStale: 0 };
  for (let offset = 0; offset < ids.length; offset += 25) {
    const result = await t.mutation(internal.conversationLifecycle.processConversationIds, {
      ids: ids.slice(offset, offset + 25), dryRun: options.dryRun, now: options.now, orgId,
    });
    totals.closedWon += result.closedWon;
    totals.closedMarker += result.closedMarker;
    totals.closedStale += result.closedStale;
  }
  return { considered: ids.length, ...totals };
}

test("scan/apply closes WON (recap) + STALE (>5d), keeps FRESH; counts correct", async () => {
  const t = convexTest(schema);
  let won: Id<"conversations">, stale: Id<"conversations">, fresh: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    won = await ctx.db.insert("conversations", { orgId, ...conv("O-WON", "62801") });
    await ctx.db.insert("orders", { orgId, ...order("O-WON", "62801") });
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("O-WON", "62801") });
    await ctx.db.insert("messages", { orgId, ...inbound(won, "O-WON", "62801", now - 6 * DAY) });

    stale = await ctx.db.insert("conversations", { orgId, ...conv("O-STALE", "62802") });
    await ctx.db.insert("orders", { orgId, ...order("O-STALE", "62802") });
    await ctx.db.insert("messages", { orgId, ...inbound(stale, "O-STALE", "62802", now - 6 * DAY) }); // last inbound 6d ago

    fresh = await ctx.db.insert("conversations", { orgId, ...conv("O-FRESH", "62803", { updatedAt: now - HOUR }) });
    await ctx.db.insert("orders", { orgId, ...order("O-FRESH", "62803") });
    await ctx.db.insert("messages", { orgId, ...inbound(fresh, "O-FRESH", "62803", now - 2 * HOUR) }); // recent -> in funnel
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedWon).toBe(1);
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(won))!.status).toBe("closed");
    expect((await ctx.db.get(stale))!.status).toBe("closed");
    expect((await ctx.db.get(fresh))!.status).toBe("active");
  });
});

test("scan/apply dryRun reports counts but mutates nothing", async () => {
  const t = convexTest(schema);
  let stale: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    stale = await ctx.db.insert("conversations", { orgId, ...conv("O-S", "62804") });
    await ctx.db.insert("orders", { orgId, ...order("O-S", "62804") });
    await ctx.db.insert("messages", { orgId, ...inbound(stale, "O-S", "62804", now - 6 * DAY) });
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: true, now });
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(stale))!.status).toBe("active");
  });
});

test("scan/apply keeps a brand-new conversation with no inbound yet (not stale)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-NEW", "62805", { createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR }) });
    await ctx.db.insert("orders", { orgId, ...order("O-NEW", "62805") });
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedWon + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});

test("scan/apply: a 'done' marker (shopee) in the chat -> closedMarker + closed", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-MK", "62820") });
    await ctx.db.insert("orders", { orgId, ...order("O-MK", "62820") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-MK", "62820", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("messages", { orgId, ...outbound(cId, "O-MK", "62820", now - HOUR, "Silakan checkout di shopee ya kak") });
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedMarker).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("scan/apply: order-less 'manual:' thread closed by a recap on the customer's PHONE", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("manual:62821", "62821") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "manual:62821", "62821", now - 2 * HOUR) }); // fresh
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("O-REALC", "62821") }); // recap under a real order, same phone
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedWon).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("scan/apply: real-order lead NOT closed by an OLD recap on the same phone (repeat-safe)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-NEWD", "62822") });
    await ctx.db.insert("orders", { orgId, ...order("O-NEWD", "62822") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-NEWD", "62822", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("O-OLDD", "62822") }); // OLD recap, different order, same phone
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedWon + r.closedMarker + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});

test("scan/apply: outbound 'PESANAN COD DIPROSES' -> closedMarker (COD won leaves funnel, not a closing)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-COD", "62823") });
    await ctx.db.insert("orders", { orgId, ...order("O-COD", "62823") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-COD", "62823", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("messages", { orgId, ...outbound(cId, "O-COD", "62823", now - HOUR, "*PESANAN COD DIPROSES* ya kak 🙏") });
  });
  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedMarker).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("scan/apply: long alternating history uses the latest inbound when deciding stale", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let cId: Id<"conversations">;
  const latestInboundAt = now - 6 * DAY;
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-LONG-STALE", "62824") });
    await ctx.db.insert("orders", { orgId, ...order("O-LONG-STALE", "62824") });
  });
  for (let i = 0; i < 122; i++) {
    const direction = i % 2 === 0 ? "inbound" as const : "outbound" as const;
    await t.run((ctx) => ctx.db.insert("messages", { orgId, ...(direction === "inbound"
      ? inbound(cId, "O-LONG-STALE", "62824", now - 12 * DAY + i * HOUR)
      : outbound(cId, "O-LONG-STALE", "62824", now - 12 * DAY + i * HOUR, "x")) }));
  }
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-LONG-STALE", "62824", latestInboundAt) });
    await ctx.db.insert("messages", { orgId, ...outbound(cId, "O-LONG-STALE", "62824", latestInboundAt + HOUR, "still silent") });
  });

  await t.run(async (ctx) => {
    const latestInbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", cId).eq("direction", "inbound"))
      .order("desc")
      .first();
    expect(latestInbound?.createdAt).toBe(latestInboundAt);
  });

  const r = await scanAndProcessStatus(t, orgId, { dryRun: false, now });
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))?.status).toBe("closed");
  });
});

test("runOrgSweep scans each open row once when retained rows surround closable rows", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const activeIds: Id<"conversations">[] = [];
  const retainedIds: Id<"conversations">[] = [];
  let handoverId: Id<"conversations">;
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++) {
      const id = await ctx.db.insert("conversations", {
        orgId,
        ...conv(`O-ACTIVE-${i}`, `6283${i}`, { updatedAt: now - 10 * DAY + i }),
      });
      activeIds.push(id);
      if (i === 0 || i === 12) {
        retainedIds.push(id);
        await ctx.db.insert("messages", {
          orgId, ...inbound(id, `O-ACTIVE-${i}`, `6283${i}`, Date.now() - HOUR),
        });
      }
    }
    handoverId = await ctx.db.insert("conversations", {
      orgId, ...conv("O-HANDOVER", "628399", { status: "handover" as const }),
    });
  });

  const result = await t.action(internal.conversationLifecycle.runOrgSweep, { orgId });

  expect(result).toEqual({
    considered: 31,
    closedWon: 0,
    closedMarker: 0,
    closedStale: 29,
    dryRun: false,
    pages: 3,
    complete: true,
    scheduledContinuation: false,
  });
  await t.run(async (ctx) => {
    const activeConversations = await Promise.all(activeIds.map((id) => ctx.db.get(id)));
    expect(activeConversations.slice(25).every((conversation) => conversation?.status === "closed")).toBe(true);
    expect((await ctx.db.get(retainedIds[0]))?.status).toBe("active");
    expect((await ctx.db.get(retainedIds[1]))?.status).toBe("active");
    expect(activeConversations.filter((conversation) => conversation?.status === "closed")).toHaveLength(28);
    expect((await ctx.db.get(handoverId))?.status).toBe("closed");
  });
});

test("production sweep dryRun evaluates both statuses without closing them", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx) => Promise.all([
    ctx.db.insert("conversations", { orgId, ...conv("O-ACTIVE", "628401") }),
    ctx.db.insert("conversations", { orgId, ...conv("O-HANDOVER", "628402", { status: "handover" as const }) }),
  ]));

  const result = await t.action(internal.conversationLifecycle.cronArchiveSweep, { dryRun: true });

  expect(result).toEqual({
    considered: 2, closedWon: 0, closedMarker: 0, closedStale: 2,
    dryRun: true, pages: 2, complete: true,
  });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids[0]))?.status).toBe("active");
    expect((await ctx.db.get(ids[1]))?.status).toBe("handover");
  });
});

test("two-phase apply re-reads fresh activity before deciding whether to close", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const conversationId = await t.run((ctx) => ctx.db.insert("conversations", {
    orgId, ...conv("O-RACE", "628403"),
  }));
  const scanned = await t.query(internal.conversationLifecycle.scanOpenBatch, {
    status: "active", orgId,
  });
  expect(scanned.ids).toEqual([conversationId]);
  await t.run((ctx) => ctx.db.insert("messages", {
    orgId, ...inbound(conversationId, "O-RACE", "628403", Date.now()),
  }));

  const result = await t.mutation(internal.conversationLifecycle.processConversationIds, {
    ids: scanned.ids, dryRun: false, now: Date.now(), orgId,
  });

  expect(result).toEqual({ closedWon: 0, closedMarker: 0, closedStale: 0 });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(conversationId))?.status).toBe("active");
  });
});

test("processConversationIds rejects batches larger than 25", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx) => {
    const inserted: Id<"conversations">[] = [];
    for (let i = 0; i < 26; i++) {
      inserted.push(await ctx.db.insert("conversations", { orgId, ...conv(`O-OVER-${i}`, `62870${i}`) }));
    }
    return inserted;
  });

  await expect(t.mutation(internal.conversationLifecycle.processConversationIds, {
    ids, dryRun: false, now, orgId,
  })).rejects.toThrow(/at most 25/i);
});

test("processConversationIds rejects duplicate IDs", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const id = await t.run((ctx) => ctx.db.insert("conversations", { orgId, ...conv("O-DUP", "628711") }));

  await expect(t.mutation(internal.conversationLifecycle.processConversationIds, {
    ids: [id, id], dryRun: false, now, orgId,
  })).rejects.toThrow(/duplicate/i);
});

test("processConversationIds accepts and closes a normal 25-ID batch", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx) => {
    const inserted: Id<"conversations">[] = [];
    for (let i = 0; i < 25; i++) {
      inserted.push(await ctx.db.insert("conversations", { orgId, ...conv(`O-LIMIT-${i}`, `62872${i}`) }));
    }
    return inserted;
  });

  const result = await t.mutation(internal.conversationLifecycle.processConversationIds, {
    ids, dryRun: false, now, orgId,
  });

  expect(result).toEqual({ closedWon: 0, closedMarker: 0, closedStale: 25 });
  await t.run(async (ctx) => {
    expect((await Promise.all(ids.map((id) => ctx.db.get(id)))).every((row) => row?.status === "closed")).toBe(true);
  });
});

test("scanOpenBatch manual cursor is stable when an unscanned row's updatedAt changes", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx) => {
    const inserted: Id<"conversations">[] = [];
    for (let i = 0; i < 30; i++) {
      inserted.push(await ctx.db.insert("conversations", {
        orgId, ...conv(`O-SCAN-${i}`, `62873${i}`, { updatedAt: now - 10 * DAY + i }),
      }));
    }
    return inserted;
  });
  const first = await t.query(internal.conversationLifecycle.scanOpenBatch, {
    status: "active", orgId,
  });
  expect(first.ids).toHaveLength(25);
  await t.run((ctx) => ctx.db.patch(ids[29], { updatedAt: now - 20 * DAY }));
  const second = await t.query(internal.conversationLifecycle.scanOpenBatch, {
    cursor: first.continueCursor, status: "active", orgId,
  });

  const scanned = [...first.ids, ...second.ids];
  expect(scanned).toHaveLength(30);
  expect(new Set(scanned)).toEqual(new Set(ids));
});

test("a handover-to-active transition missed between status scans is closed by the next production sweep", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let transitionedId!: Id<"conversations">;
  await t.run(async (ctx) => {
    transitionedId = await ctx.db.insert("conversations", {
      orgId, ...conv("O-TRANSITION", "628740", { status: "handover" as const }),
    });
    for (let i = 0; i < 26; i++) {
      await ctx.db.insert("conversations", { orgId, ...conv(`O-EXISTING-${i}`, `62874${i + 1}`) });
    }
  });

  const firstActive = await t.query(internal.conversationLifecycle.scanOpenBatch, {
    status: "active", orgId,
  });
  await t.run((ctx) => ctx.db.patch(transitionedId, { status: "active", updatedAt: Date.now() }));
  const handover = await t.query(internal.conversationLifecycle.scanOpenBatch, {
    status: "handover", orgId,
  });
  const scannedIds = [...firstActive.ids];
  let cursor = firstActive.continueCursor;
  let isDone = firstActive.isDone;
  while (!isDone) {
    const page = await t.query(internal.conversationLifecycle.scanOpenBatch, {
      cursor, status: "active", orgId,
    });
    scannedIds.push(...page.ids);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  expect(handover.ids).not.toContain(transitionedId);
  expect(scannedIds).not.toContain(transitionedId);
  for (let offset = 0; offset < scannedIds.length; offset += 25) {
    await t.mutation(internal.conversationLifecycle.processConversationIds, {
      ids: scannedIds.slice(offset, offset + 25), dryRun: false, now: Date.now(), orgId,
    });
  }
  await t.run(async (ctx) => {
    expect((await ctx.db.get(transitionedId))?.status).toBe("active");
  });

  const nextSweep = await t.action(internal.conversationLifecycle.runOrgSweep, { orgId });
  expect(nextSweep.considered).toBe(1);
  expect(nextSweep.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(transitionedId))?.status).toBe("closed");
  });
});

test("persisted keyset progress resumes past a retained prefix and resets after cycle completion", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  let behindCheckpointId!: Id<"conversations">;
  let trailingTransitionId!: Id<"conversations">;
  await t.run(async (ctx) => {
    behindCheckpointId = await ctx.db.insert("conversations", {
      orgId, ...conv("O-BEHIND", "628750", { status: "closed" as const }),
    });
    for (let i = 0; i < 25; i++) {
      const id = await ctx.db.insert("conversations", {
        orgId, ...conv(`O-RETAIN-${i}`, `62875${i + 1}`),
      });
      await ctx.db.insert("messages", {
        orgId, ...inbound(id, `O-RETAIN-${i}`, `62875${i + 1}`, Date.now()),
      });
    }
    trailingTransitionId = await ctx.db.insert("conversations", {
      orgId, ...conv("O-TRAILING", "628759", { status: "handover" as const }),
    });
    await ctx.db.patch(trailingTransitionId, { status: "active", updatedAt: Date.now() });
  });
  const productionCtx = {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  };

  const first = await conversationLifecycle.sweep(productionCtx, orgId, false, 1);
  const persistedAfterFirst = await t.run((ctx) => ctx.db
    .query("lifecycleSweepStates")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique());
  const activeCursor = (persistedAfterFirst as any)?.activeCursor;
  expect(activeCursor).toBeTypeOf("string");
  expect(JSON.parse(activeCursor)).toHaveLength(4); // orgId, status, _creationTime, _id
  const preview = await conversationLifecycle.sweep(productionCtx, orgId, true, 1);
  const second = await conversationLifecycle.sweep(productionCtx, orgId, false, 1);
  const third = await conversationLifecycle.sweep(productionCtx, orgId, false, 1);

  expect(first).toMatchObject({ considered: 25, closedStale: 0 });
  expect(preview).toMatchObject({ considered: 25, closedStale: 0, dryRun: true });
  expect(second).toMatchObject({ considered: 0, closedStale: 0 });
  expect(third).toMatchObject({ considered: 1, closedStale: 1 });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(trailingTransitionId))?.status).toBe("closed");
    await ctx.db.patch(behindCheckpointId, { status: "active", updatedAt: Date.now() });
  });

  const nextCycle = await conversationLifecycle.sweep(productionCtx, orgId, false, 1);
  expect(nextCycle.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(behindCheckpointId))?.status).toBe("closed");
  });
});

test("a failed page apply does not advance durable sweep progress", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 26; i++) {
      await ctx.db.insert("conversations", { orgId, ...conv(`O-FAIL-${i}`, `62876${i}`) });
    }
  });
  const failingCtx = {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => {
      if (getFunctionName(ref) === "conversationLifecycle:processConversationIds") {
        throw new Error("simulated apply failure");
      }
      return t.mutation(ref, args);
    },
  };
  await expect(conversationLifecycle.sweep(failingCtx, orgId, false, 1))
    .rejects.toThrow("simulated apply failure");

  const retry = await conversationLifecycle.sweep({
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  }, orgId, false, 1);
  expect(retry).toMatchObject({ considered: 25, closedStale: 25 });
});

test("retry is idempotent when apply succeeds but checkpoint persistence fails", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  const ids = await t.run(async (ctx) => {
    const inserted: Id<"conversations">[] = [];
    for (let i = 0; i < 26; i++) {
      inserted.push(await ctx.db.insert("conversations", { orgId, ...conv(`O-RETRY-${i}`, `62877${i}`) }));
    }
    return inserted;
  });
  const commitFailingCtx = {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => {
      if (getFunctionName(ref) === "conversationLifecycle:commitSweepState") {
        throw new Error("simulated checkpoint failure");
      }
      return t.mutation(ref, args);
    },
  };
  await expect(conversationLifecycle.sweep(commitFailingCtx, orgId, false, 1))
    .rejects.toThrow("simulated checkpoint failure");

  const retry = await conversationLifecycle.sweep({
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  }, orgId, false, 1);
  expect(retry).toMatchObject({ considered: 1, closedStale: 1 });
  await t.run(async (ctx) => {
    expect((await Promise.all(ids.map((id) => ctx.db.get(id)))).every((row) => row?.status === "closed")).toBe(true);
  });
});

test("sweep's total page cap alternates statuses and processes at most 25 rows per page", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (const status of ["active", "handover"] as const) {
      for (let i = 0; i < 26; i++) {
        await ctx.db.insert("conversations", {
          orgId, ...conv(`${status}-${i}`, `6285${status === "active" ? 1 : 2}${i}`, { status }),
        });
      }
    }
  });
  const actualSweep = (conversationLifecycle as any).sweep;
  expect(actualSweep).toBeTypeOf("function");

  const result = await actualSweep({
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  }, orgId, false, 2);

  expect(result).toEqual({
    considered: 50, closedWon: 0, closedMarker: 0, closedStale: 50,
    dryRun: false, pages: 2, complete: false,
  });
  await t.run(async (ctx) => {
    const open = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", orgId))
      .collect();
    expect(open.filter((row) => row.status === "active")).toHaveLength(1);
    expect(open.filter((row) => row.status === "handover")).toHaveLength(1);
  });
});

test("production lifecycle actions have a small total page budget", () => {
  expect(conversationLifecycle.SWEEP_MAX_PAGES).toBeLessThanOrEqual(4);
});

test("sweep checkpoints after every successfully applied page", async () => {
  const commits: any[] = [];
  const scans: Record<string, number> = { active: 0, handover: 0 };
  const ctx = {
    runQuery: (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name === "conversationLifecycle:getSweepState") return null;
      if (name === "conversationLifecycle:scanOpenBatch") {
        scans[args.status]++;
        return {
          ids: [], continueCursor: `${args.status}-${scans[args.status]}`,
          isDone: args.status === "handover",
        };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name === "conversationLifecycle:processConversationIds") {
        return { closedWon: 0, closedMarker: 0, closedStale: 0 };
      }
      if (name === "conversationLifecycle:commitSweepState") {
        commits.push(args);
        return null;
      }
      throw new Error(`unexpected mutation ${name}`);
    },
  };
  await conversationLifecycle.sweep(ctx, "org" as any, false, 2);
  expect(commits).toHaveLength(2);
});

test("organization scheduling isolates a failure and continues to later tenants", async () => {
  const scheduleOrganizationSweeps = (conversationLifecycle as any).scheduleOrganizationSweeps;
  expect(scheduleOrganizationSweeps).toBeTypeOf("function");
  const attempted: string[] = [];
  const result = await scheduleOrganizationSweeps(["org-1", "org-2", "org-3"], async (orgId: string) => {
    attempted.push(orgId);
    if (orgId === "org-2") throw new Error("tenant failed");
  });
  expect(attempted).toEqual(["org-1", "org-2", "org-3"]);
  expect(result).toEqual({ scheduledOrganizations: 2, failedOrganizations: ["org-2"] });
});

test("scheduled lifecycle continuation resumes after the page budget and closes every row", async () => {
  vi.useFakeTimers({ now });
  try {
    const t = convexTest(schema);
    const orgId = await seedOrg(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 126; index++) {
        await ctx.db.insert("conversations", { orgId, ...conv(`O-SCHEDULED-${index}`, `62888${index}`) });
      }
    });

    const first = await t.action(internal.conversationLifecycle.runOrgSweep, { orgId });
    expect(first.pages).toBe(conversationLifecycle.SWEEP_MAX_PAGES);
    expect(first.complete).toBe(false);
    expect(first.scheduledContinuation).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const remaining = await t.run((ctx) => ctx.db.query("conversations")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .collect());
    expect(remaining).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
