import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

async function seedOrg(t: any) {
  return t.run((ctx: any) => ctx.db.insert("organizations", { slug: "pustakaislam", name: "Test Org", createdAt: 1, updatedAt: 1 }));
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 5, 26, 5, 0, 0); // 2026-06-26 05:00 UTC (12:00 WIB)

const conv = (orderId: string, phone: string, over: Record<string, unknown> = {}) => ({
  orderId,
  customerPhone: phone,
  customerName: "Budi",
  assignedCsName: "CS Nabila",
  status: "active" as const,
  aiEnabled: false,
  note: "",
  createdAt: now - 10 * DAY,
  updatedAt: now - 10 * DAY,
  ...over,
});

test("(a) inbound→outbound overnight timestamps → 1 sample with wall-clock delta", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  // inboundAt = 2026-06-25 21:00 UTC = 04:00 WIB (outside BH 05:30-18:00)
  const inboundAt = Date.UTC(2026, 5, 25, 21, 0, 0);
  // outboundAt = 2026-06-26 02:00 UTC = 09:00 WIB (inside BH)
  // Gap: 21:00 UTC to 02:00 UTC next day = 5 hours wall-clock
  // But only 1.5 hours inside BH (05:30 to 07:00)
  // Actually, let's use a gap with ZERO business minutes: 21:00 to 04:00 next day
  // = 21:00 to 23:59 (outside BH) + 00:00 to 04:59 (outside BH) = 7 hours, 0 business min
  const outboundAt = Date.UTC(2026, 5, 26, 4, 0, 0); // 04:00 UTC = 11:00 WIB (inside BH)
  // Hmm, 04:00 UTC is 11:00 WIB which is inside business hours.
  // Let me recalculate: 21:00 UTC = 04:00 WIB next day (outside BH), 04:00 UTC = 11:00 WIB (inside BH)
  // We need both times outside BH. Let me use 21:00 UTC (04:00 WIB) to 02:00 UTC next day (09:00 WIB)
  // That's inside BH. Let me think differently.
  // 23:30 UTC = 06:30 WIB + 4.5 hours = 04:00 UTC next day = 11:00 WIB = inside BH
  // Let me use: 18:00 UTC (01:00 WIB) to 22:00 UTC (05:00 WIB) = 4 hours, outside BH completely
  const inboundAtFixed = Date.UTC(2026, 5, 25, 18, 0, 0); // 01:00 WIB
  const outboundAtFixed = Date.UTC(2026, 5, 25, 22, 0, 0); // 05:00 WIB
  // 01:00 to 05:00 = 4 hours, outside BH (BH is 05:30-18:00), so activeMs should be 0
  // and we should use wall-clock fallback: 4 * HOUR

  // Inbound via appendMessageFromN8n (sets pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62801",
    order_id: "O-A",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi",
    messageType: "text" as const,
    createdAt: inboundAtFixed,
  });

  // Append outbound message (outside business hours gap, should use wall-clock)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62801",
    order_id: "O-A",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Hello!",
    messageType: "text" as const,
    createdAt: outboundAtFixed,
  });

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(1);
    const s = samples[0];
    expect(s.csKey).toBe("nabila"); // normalized: "CS Nabila" → "csnabila" → "nabila"
    expect(s.csName).toBe("CS Nabila");
    expect(s.inboundAt).toBe(inboundAtFixed);
    expect(s.createdAt).toBe(outboundAtFixed);
    // Wall-clock delta: 4 hours (since businessMinutesBetween will be 0)
    expect(s.deltaMs).toBe(4 * HOUR);

    // Check conversation was patched to clear pending
    const convs = await ctx.db.query("conversations").collect();
    const conv = convs.find(c => c.orderId === "O-A");
    expect(conv!.rtPendingInboundAt).toBeUndefined();
  });
});

test("(b) inbound,inbound,outbound → 1 sample paired to FIRST inbound", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const inbound1At = now;
  const inbound2At = now + 1 * HOUR;

  // First inbound (sets pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62802",
    order_id: "O-B",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi",
    messageType: "text" as const,
    createdAt: inbound1At,
  });

  // Second inbound (should not update pending, still paired to first)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62802",
    order_id: "O-B",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Still here",
    messageType: "text" as const,
    createdAt: inbound2At,
  });

  // Append outbound within business hours
  const outboundAt = now + 2 * HOUR;
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62802",
    order_id: "O-B",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Hello!",
    messageType: "text" as const,
    createdAt: outboundAt,
  });

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(1);
    const s = samples[0];
    // Should pair to FIRST inbound
    expect(s.inboundAt).toBe(inbound1At);
    expect(s.createdAt).toBe(outboundAt);
    // 2 hours, all in business hours: 2*60 min * 60*1000 ms/min = 7_200_000 ms
    expect(s.deltaMs).toBe(2 * HOUR);
  });
});

test("(c) outbound template → no sample, pending preserved", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const inboundAt = now;

  // Inbound (sets pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62803",
    order_id: "O-C",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi",
    messageType: "text" as const,
    createdAt: inboundAt,
  });

  // Append template outbound
  const templateAt = now + 1 * HOUR;
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62803",
    order_id: "O-C",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Template message",
    messageType: "template" as const,
    createdAt: templateAt,
  });

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(0); // No sample created for template
    // But pending should still be set from first inbound
    const convs = await ctx.db.query("conversations").collect();
    const conv = convs.find(c => c.orderId === "O-C");
    expect(conv!.rtPendingInboundAt).toBe(inboundAt);
  });
});

test("(d) outbound with no pending → no sample", async () => {
  const t = convexTest(schema);
  let convId: Id<"conversations">;
  const orgId = await seedOrg(t);

  await t.run(async (ctx) => {
    convId = await ctx.db.insert("conversations", { orgId, ...conv("O-D", "62804") });
  });

  // Append outbound (no prior inbound, so no pending)
  const outboundAt = now;
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62804",
    order_id: "O-D",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Hello!",
    messageType: "text" as const,
    createdAt: outboundAt,
  });

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(0); // No sample (no pending inbound)
    const conv = await ctx.db.get(convId);
    expect(conv!.rtPendingInboundAt).toBeUndefined(); // Still no pending
  });
});

test("(e) replay same externalMessageId → no duplicate sample", async () => {
  const t = convexTest(schema);
  await seedOrg(t);
  const inboundAt = now;
  const extId = "ext-123";

  // First inbound via appendMessageFromN8n (sets pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62805",
    order_id: "O-E",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi",
    messageType: "text" as const,
    externalMessageId: extId,
    createdAt: inboundAt,
  });

  const outboundAt = now + 1 * HOUR;
  // Outbound (creates sample, clears pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62805",
    order_id: "O-E",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Hello!",
    messageType: "text" as const,
    externalMessageId: "out-1",
    createdAt: outboundAt,
  });

  // Replay the same inbound (by externalMessageId) — should be deduped
  const sameExtIdResult = await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62805",
    order_id: "O-E",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi (dup)",
    messageType: "text" as const,
    externalMessageId: extId, // Same external ID
    createdAt: inboundAt + 100, // Slightly later but same logical message
  });

  expect(sameExtIdResult.deduped).toBe(true);

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(1); // Only one sample (not duplicated)
  });
});

test("(f) 20-min gap inside business hours → slaBreach: true", async () => {
  const t = convexTest(schema);
  await seedOrg(t);

  // Date.UTC(2026,6,8,3,0) = 2026-07-08 03:00 UTC = 10:00 WIB (inside business hours 05:30-18:00 WIB)
  const inboundAt = Date.UTC(2026, 6, 8, 3, 0, 0);
  const outboundAt = inboundAt + 20 * 60 * 1000; // +20 minutes

  // Inbound (sets pending)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62806",
    order_id: "O-F",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "customer" as const,
    direction: "inbound" as const,
    content: "Hi",
    messageType: "text" as const,
    createdAt: inboundAt,
  });

  // Outbound (creates sample with slaBreach check)
  await t.mutation(internal.messages.appendMessageFromN8n, {
    phone: "62806",
    order_id: "O-F",
    customerName: "Budi",
    csName: "CS Nabila",
    role: "cs" as const,
    direction: "outbound" as const,
    content: "Hello!",
    messageType: "text" as const,
    createdAt: outboundAt,
  });

  await t.run(async (ctx) => {
    const samples = await ctx.db.query("responseSamples").collect();
    expect(samples).toHaveLength(1);
    const s = samples[0];
    // 20 minutes is > 15 minute SLA threshold
    expect(s.slaBreach).toBe(true);
    expect(s.deltaMs).toBe(20 * 60 * 1000);
  });
});
