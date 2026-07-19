import { convexTest } from "convex-test";
import { expect, test } from "vitest";
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

test("resolveBatch closes WON (recap) + STALE (>5d), keeps FRESH; counts correct", async () => {
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
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedWon).toBe(1);
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(won))!.status).toBe("closed");
    expect((await ctx.db.get(stale))!.status).toBe("closed");
    expect((await ctx.db.get(fresh))!.status).toBe("active");
  });
});

test("resolveBatch dryRun reports counts but mutates nothing", async () => {
  const t = convexTest(schema);
  let stale: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    stale = await ctx.db.insert("conversations", { orgId, ...conv("O-S", "62804") });
    await ctx.db.insert("orders", { orgId, ...order("O-S", "62804") });
    await ctx.db.insert("messages", { orgId, ...inbound(stale, "O-S", "62804", now - 6 * DAY) });
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: true, now, orgId });
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(stale))!.status).toBe("active");
  });
});

test("resolveBatch keeps a brand-new conversation with no inbound yet (not stale)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-NEW", "62805", { createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR }) });
    await ctx.db.insert("orders", { orgId, ...order("O-NEW", "62805") });
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedWon + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});

test("resolveBatch: a 'done' marker (shopee) in the chat -> closedMarker + closed", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-MK", "62820") });
    await ctx.db.insert("orders", { orgId, ...order("O-MK", "62820") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-MK", "62820", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("messages", { orgId, ...outbound(cId, "O-MK", "62820", now - HOUR, "Silakan checkout di shopee ya kak") });
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedMarker).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("resolveBatch: order-less 'manual:' thread closed by a recap on the customer's PHONE", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("manual:62821", "62821") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "manual:62821", "62821", now - 2 * HOUR) }); // fresh
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("O-REALC", "62821") }); // recap under a real order, same phone
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedWon).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("resolveBatch: real-order lead NOT closed by an OLD recap on the same phone (repeat-safe)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-NEWD", "62822") });
    await ctx.db.insert("orders", { orgId, ...order("O-NEWD", "62822") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-NEWD", "62822", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("shippingRecaps", { orgId, ...recap("O-OLDD", "62822") }); // OLD recap, different order, same phone
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedWon + r.closedMarker + r.closedStale).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("active");
  });
});

test("resolveBatch: outbound 'PESANAN COD DIPROSES' -> closedMarker (COD won leaves funnel, not a closing)", async () => {
  const t = convexTest(schema);
  let cId: Id<"conversations">;
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    cId = await ctx.db.insert("conversations", { orgId, ...conv("O-COD", "62823") });
    await ctx.db.insert("orders", { orgId, ...order("O-COD", "62823") });
    await ctx.db.insert("messages", { orgId, ...inbound(cId, "O-COD", "62823", now - 2 * HOUR) }); // fresh -> not stale
    await ctx.db.insert("messages", { orgId, ...outbound(cId, "O-COD", "62823", now - HOUR, "*PESANAN COD DIPROSES* ya kak 🙏") });
  });
  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedMarker).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))!.status).toBe("closed");
  });
});

test("resolveBatch remains a compatible single-page mutation with a continuation cursor", async () => {
  const t = convexTest(schema);
  const orgId = await seedOrg(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 26; i++) {
      await ctx.db.insert("conversations", { orgId, ...conv(`O-PAGE-${i}`, `62860${i}`) });
    }
  });

  const result = await t.mutation(internal.conversationLifecycle.resolveBatch, {
    cursor: null, status: "active", dryRun: false, now, orgId,
  });

  expect(result.considered).toBe(25);
  expect(result.closedStale).toBe(25);
  expect(result.isDone).toBe(false);
  expect(result.continueCursor).toBeTypeOf("string");
  await t.run(async (ctx) => {
    const open = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", orgId).eq("status", "active"))
      .collect();
    expect(open).toHaveLength(1);
  });
});

test("resolveBatch: long alternating history uses the latest inbound when deciding stale", async () => {
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

  const r = await t.mutation(internal.conversationLifecycle.resolveBatch, { cursor: null, dryRun: false, now, orgId });
  expect(r.closedStale).toBe(1);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(cId))?.status).toBe("closed");
  });
});

test("cronArchiveSweep scans each open row once when retained rows surround closable rows", async () => {
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

  const result = await t.action(internal.conversationLifecycle.cronArchiveSweep, {});

  expect(result).toEqual({
    considered: 31,
    closedWon: 0,
    closedMarker: 0,
    closedStale: 29,
    dryRun: false,
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

  expect(result).toEqual({ considered: 2, closedWon: 0, closedMarker: 0, closedStale: 2, dryRun: true });
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
    cursor: null, status: "active", orgId,
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

  expect(result).toEqual({ considered: 50, closedWon: 0, closedMarker: 0, closedStale: 50, dryRun: false });
  await t.run(async (ctx) => {
    const open = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", orgId))
      .collect();
    expect(open.filter((row) => row.status === "active")).toHaveLength(1);
    expect(open.filter((row) => row.status === "handover")).toHaveLength(1);
  });
});
