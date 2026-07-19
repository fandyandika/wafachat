import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { csKey as csKeyOf, isInternalTestPhone, normalizePhone, windowKeyFor, windowRangeForKey, windowKeyToday } from "./lib";
import { canonicalizeProduct } from "./shippingRecaps";
import { pairResponsePairs, isSlaBreach, type RtMessage } from "./responseTimeMath";
import { getInternalPhoneSet } from "./orgSettings";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";

const PRODUCT_CAP = 50;
// Production showed 40 windows exceeded Convex mutation limits.
// Reduced to 10 for reliable performance; heavy-message windows may need 1.
const BACKFILL_WINDOW_CAP = 10;

export type RollupValues = {
  windowKey: string;
  csKey: string;
  csName: string;
  leadOrders: number;
  leadsCust: number;
  closings: number;
  closedCust: number;
  cancelled: number;
  manualClosings: number;
  delivered: number;
  revenue: number;
  discount: number;
  fuClosings: number;
  fuH1: number;
  fuH2: number;
  fuH3: number;
  cod: number;
  transfer: number;
  byProduct: Array<{ product: string; leads: number; closings: number; leadOrders: number; revenue: number; discount: number; cod: number; transfer: number }>;
  updatedAt: number;
};

export async function computeRollupValues(ctx: any, orgId: Id<"organizations">, csKeyArg: string, windowKey: string): Promise<RollupValues | null> {
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const { startAt, endAt } = windowRangeForKey(windowKey);

  // Fetch THIS CS's orders in the window via the org-scoped csKey index — a per-CS slice, not the
  // whole window (kills the O(window^2) write-amplification). Exclude internal test phones.
  const orders = (
    await ctx.db.query("orders")
      .withIndex("by_org_csKey_createdAt", (q: any) => q.eq("orgId", orgId).eq("csKey", csKeyArg).gte("createdAt", startAt).lt("createdAt", endAt))
      .collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones));

  // Fetch THIS CS's recaps in the window in ONE read; split active vs cancelled in memory.
  const recapsAll = (
    await ctx.db.query("shippingRecaps")
      .withIndex("by_org_csKey_closedAt", (q: any) => q.eq("orgId", orgId).eq("csKey", csKeyArg).gte("closedAt", startAt).lt("closedAt", endAt))
      .collect()
  ).filter((r: any) => !isInternalTestPhone(r.customerPhone, internalPhones));
  const recaps = recapsAll.filter((r: any) => r.status !== "cancelled" && r.status !== "cancelled_after_export");
  const allCancelled = recapsAll.filter((r: any) => r.status === "cancelled" || r.status === "cancelled_after_export");

  // Resolve a closing's product to the matched in-window order's name, falling back to the recap's packageContent
  const latestOrderByPhone = new Map<string, any>();
  for (const o of orders) {
    const p = normalizePhone(o.customerPhone);
    const ex = latestOrderByPhone.get(p);
    if (!ex || o.createdAt > ex.createdAt) latestOrderByPhone.set(p, o);
  }

  // Orphan-recap fallback: fetch orders for recaps whose leads aren't in THIS window
  const fbNeeded: Array<{ phone: string; orderIdBerdu?: string }> = [];
  const fbSeen = new Set<string>();
  for (const r of recaps) {
    const phone = normalizePhone(r.customerPhone);
    if (latestOrderByPhone.has(phone) || fbSeen.has(phone)) continue;
    fbSeen.add(phone);
    fbNeeded.push({ phone, orderIdBerdu: r.orderIdBerdu });
  }
  const fbResults = await Promise.all(
    fbNeeded.map(async ({ phone, orderIdBerdu }) => {
      let order: any = null;
      if (orderIdBerdu) {
        order = await ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", orgId).eq("orderId", orderIdBerdu)).unique();
      }
      if (!order) {
        const all = await ctx.db.query("orders").withIndex("by_org_customerPhone", (q: any) => q.eq("orgId", orgId).eq("customerPhone", phone)).collect();
        order = all.sort((a: any, b: any) => b.createdAt - a.createdAt)[0] ?? null;
      }
      return { phone, order };
    }),
  );
  const fallbackOrderByPhone = new Map<string, any>();
  for (const { phone, order } of fbResults) if (order) fallbackOrderByPhone.set(phone, order);

  // Aggregate counts
  const leads = new Set<string>(); // distinct customer phones
  const rawLeads = orders.length; // raw order count
  for (const o of orders) {
    leads.add(normalizePhone(o.customerPhone));
  }

  // Dedup closings by orderIdBerdu || phone, keeping latest
  const byKey = new Map<string, any>();
  for (const r of recaps) {
    const kk = r.orderIdBerdu || normalizePhone(r.customerPhone);
    const ex = byKey.get(kk);
    if (!ex || r.closedAt > ex.closedAt) byKey.set(kk, r);
  }
  const closingsList = Array.from(byKey.values());

  const closedCust = new Set<string>();
  let revenue = 0;
  let discount = 0;
  const cod = recapsAll.filter((r: any) => r.paymentMethod === "cod").length;
  const transfer = recapsAll.filter((r: any) => r.paymentMethod === "transfer").length;
  let manualClosings = 0;
  let delivered = 0;
  let fuClosings = 0;
  let fuH1 = 0;
  let fuH2 = 0;
  let fuH3 = 0;

  for (const r of closingsList) {
    closedCust.add(normalizePhone(r.customerPhone));
    revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
    discount += r.discount ?? 0;
    if (!r.sourceMessageId) manualClosings += 1;
    if (r.status === "delivered") delivered += 1;
    const touchCount = r.followUpTouchesAtClose ?? 0;
    if (touchCount >= 1) fuClosings += 1;
    if (touchCount === 1) fuH1 += 1;
    if (touchCount === 2) fuH2 += 1;
    if (touchCount >= 3) fuH3 += 1;
  }

  // Per-product aggregation (leads = distinct customers to match getDailyReport)
  const productMap = new Map<string, { leads: Set<string>; closings: Set<string>; leadOrders: number; revenue: number; discount: number; cod: number; transfer: number }>();
  for (const o of orders) {
    const p = canonicalizeProduct(o.productName || o.products);
    let prod = productMap.get(p);
    if (!prod) {
      prod = { leads: new Set(), closings: new Set(), leadOrders: 0, revenue: 0, discount: 0, cod: 0, transfer: 0 };
      productMap.set(p, prod);
    }
    prod.leads.add(normalizePhone(o.customerPhone));
    prod.leadOrders += 1;
  }

  for (const r of closingsList) {
    const cphone = normalizePhone(r.customerPhone);
    const matched = latestOrderByPhone.get(cphone) ?? fallbackOrderByPhone.get(cphone);
    const p = canonicalizeProduct(matched?.productName || matched?.products || r.packageContent);
    let prod = productMap.get(p);
    if (!prod) {
      prod = { leads: new Set(), closings: new Set(), leadOrders: 0, revenue: 0, discount: 0, cod: 0, transfer: 0 };
      productMap.set(p, prod);
    }
    prod.closings.add(r.orderIdBerdu || cphone);
    prod.revenue += r.total ?? r.codValue ?? r.nonCodItemPrice ?? 0;
    prod.discount += r.discount ?? 0;
    if (r.paymentMethod === "cod") prod.cod += 1;
    if (r.paymentMethod === "transfer") prod.transfer += 1;
  }

  // Build byProduct array, cap at 50 + overflow bucket
  const productsEntries = Array.from(productMap.entries())
    .map(([product, p]) => ({ product, leads: p.leads.size, closings: p.closings.size, leadOrders: p.leadOrders, revenue: p.revenue, discount: p.discount, cod: p.cod, transfer: p.transfer }))
    .filter((p) => p.leads > 0 || p.closings > 0)
    .sort((x, y) => y.leads - x.leads || x.product.localeCompare(y.product));

  const byProduct: Array<{ product: string; leads: number; closings: number; leadOrders: number; revenue: number; discount: number; cod: number; transfer: number }> = [];
  let overflowLeads = 0;
  let overflowClosings = 0;
  let overflowLeadOrders = 0;
  let overflowRevenue = 0;
  let overflowDiscount = 0;
  let overflowCod = 0;
  let overflowTransfer = 0;

  for (let i = 0; i < productsEntries.length; i++) {
    if (i < PRODUCT_CAP) {
      byProduct.push(productsEntries[i]);
    } else {
      overflowLeads += productsEntries[i].leads;
      overflowClosings += productsEntries[i].closings;
      overflowLeadOrders += productsEntries[i].leadOrders;
      overflowRevenue += productsEntries[i].revenue;
      overflowDiscount += productsEntries[i].discount;
      overflowCod += productsEntries[i].cod;
      overflowTransfer += productsEntries[i].transfer;
    }
  }

  if (overflowLeads > 0 || overflowClosings > 0) {
    byProduct.push({ product: "lainnya", leads: overflowLeads, closings: overflowClosings, leadOrders: overflowLeadOrders, revenue: overflowRevenue, discount: overflowDiscount, cod: overflowCod, transfer: overflowTransfer });
  }

  // Get most frequent csName
  const rawCounts = new Map<string, number>();
  for (const r of recaps) {
    rawCounts.set(r.csName, (rawCounts.get(r.csName) ?? 0) + 1);
  }
  for (const o of orders) {
    rawCounts.set(o.assignedCsName, (rawCounts.get(o.assignedCsName) ?? 0) + 1);
  }
  const csName = Array.from(rawCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";

  // Delete if all counters are zero
  const isEmpty = leads.size === 0 && closingsList.length === 0 && allCancelled.length === 0;

  if (isEmpty) {
    // Return null for empty windows (caller will delete)
    return null;
  }

  // Return computed values
  return {
    windowKey,
    csKey: csKeyArg,
    csName,
    leadOrders: rawLeads,
    leadsCust: leads.size,
    closings: closingsList.length,
    closedCust: closedCust.size,
    cancelled: allCancelled.length,
    manualClosings,
    delivered,
    revenue,
    discount,
    cod,
    transfer,
    fuClosings,
    fuH1,
    fuH2,
    fuH3,
    byProduct,
    updatedAt: Date.now(),
  };
}

export async function computeRollupRow(ctx: any, orgId: Id<"organizations">, csKeyArg: string, windowKey: string): Promise<void> {
  const values = await computeRollupValues(ctx, orgId, csKeyArg, windowKey);

  if (values === null) {
    // Delete existing row
    const existing = await ctx.db
      .query("dailyRollups")
      .withIndex("by_org_window_cs", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey).eq("csKey", csKeyArg))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  } else {
    // Upsert via by_org_window_cs
    const existing = await ctx.db
      .query("dailyRollups")
      .withIndex("by_org_window_cs", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey).eq("csKey", csKeyArg))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, values);
    } else {
      await ctx.db.insert("dailyRollups", { ...values, orgId });
    }
  }
}

export async function bumpForOrderDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { orgId: Id<"organizations">; k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.createdAt) continue;
    const k = csKeyOf(doc.assignedCsName);
    const w = windowKeyFor(doc.createdAt);
    const orgId = doc.orgId;
    pairs.set(`${orgId}|${k}|${w}`, { orgId, k, w });
  }
  for (const { orgId, k, w } of pairs.values()) await computeRollupRow(ctx, orgId, k, w);
}

export async function bumpForRecapDoc(ctx: any, before: any | null, after: any | null): Promise<void> {
  const pairs = new Map<string, { orgId: Id<"organizations">; k: string; w: string }>();
  for (const doc of [before, after]) {
    if (!doc?.closedAt) continue;
    const k = csKeyOf(doc.csName);
    const w = windowKeyFor(doc.closedAt);
    const orgId = doc.orgId;
    pairs.set(`${orgId}|${k}|${w}`, { orgId, k, w });
  }
  for (const { orgId, k, w } of pairs.values()) await computeRollupRow(ctx, orgId, k, w);
}

export async function recomputeWindowImpl(ctx: any, orgId: Id<"organizations">, windowKey: string): Promise<number> {
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const { startAt, endAt } = windowRangeForKey(windowKey);
  const keys = new Set<string>();

  // Collect csKeys from orders in the window
  const orders = (
    await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lt("createdAt", endAt)).collect()
  ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones));
  for (const o of orders) {
    // Self-heal: stamp csKey if a doc predates the field or a write site missed it.
    // No-op in prod (backfill + write-path guarantee csKey); keeps the by_org_csKey_* reads
    // in computeRollupValues correct even for stragglers. Runs only in trueUp/backfill.
    if (o.csKey === undefined) await ctx.db.patch(o._id, { csKey: csKeyOf(o.assignedCsName) });
    keys.add(csKeyOf(o.assignedCsName));
  }

  // Collect csKeys from recaps in the window (including orphan attribution)
  const recaps = (
    await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lt("closedAt", endAt)).collect()
  ).filter((r: any) => !isInternalTestPhone(r.customerPhone, internalPhones));
  for (const r of recaps) {
    if (r.csKey === undefined) await ctx.db.patch(r._id, { csKey: csKeyOf(r.csName) });
    keys.add(csKeyOf(r.csName));
  }

  // Collect csKeys from existing dailyRollups rows in the window (so stale rows get zeroed/deleted)
  const existingRollups = (
    await ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey)).collect()
  );
  for (const row of existingRollups) {
    keys.add(row.csKey);
  }

  // Recompute all csKeys in the window
  for (const k of keys) {
    await computeRollupRow(ctx, orgId, k, windowKey);
  }

  const marker = await ctx.db.query("rollupWindows")
    .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey))
    .unique();
  const markerValue = { schemaVersion: ROLLUP_SCHEMA_VERSION, completedAt: Date.now() };
  if (marker) await ctx.db.patch(marker._id, markerValue);
  else await ctx.db.insert("rollupWindows", { orgId, windowKey, ...markerValue });

  return keys.size;
}

export const recomputeWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: async (ctx, args) => {
    const csKeys = await recomputeWindowImpl(ctx, args.orgId as Id<"organizations">, args.windowKey);
    return { windowKey: args.windowKey, csKeys };
  },
});

export async function rebuildSamplesForWindowImpl(ctx: any, orgId: Id<"organizations">, windowKey: string): Promise<number> {
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const { startAt, endAt } = windowRangeForKey(windowKey);

  // Delete all responseSamples in this window for this org
  const existingSamples = (
    await ctx.db.query("responseSamples").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lt("createdAt", endAt)).collect()
  );
  for (const sample of existingSamples) {
    await ctx.db.delete(sample._id);
  }

  // Fetch messages in window, grouped by conversation (exactly like responseTime.getResponseTimes)
  const msgs = (
    await ctx.db
      .query("messages")
      .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lt("createdAt", endAt))
      .collect()
  ).filter((m: any) => !isInternalTestPhone(m.customerPhone, internalPhones));

  // Group by conversation, preserving ascending createdAt order
  const byConv = new Map<string, RtMessage[]>();
  const convOrder: string[] = [];
  const convIdByKey = new Map<string, any>();
  for (const m of msgs) {
    const key = String(m.conversationId);
    let arr = byConv.get(key);
    if (!arr) {
      arr = [];
      byConv.set(key, arr);
      convOrder.push(key);
      convIdByKey.set(key, m.conversationId);
    }
    arr.push({ direction: m.direction, messageType: m.messageType, role: m.role, createdAt: m.createdAt });
  }

  // Fetch conversation docs to get assignedCsName (exactly like responseTime.getResponseTimes)
  const convDocs = await Promise.all(convOrder.map((key) => ctx.db.get(convIdByKey.get(key))));
  const csByKey = new Map<string, string>();
  convOrder.forEach((key, i) => csByKey.set(key, (convDocs[i] as any)?.assignedCsName || "Unknown"));

  // For each conversation, pair messages and insert samples
  let sampleCount = 0;
  for (const key of convOrder) {
    const pairs = pairResponsePairs(byConv.get(key)!);
    const raw = csByKey.get(key) || "Unknown";
    const ck = csKeyOf(raw);
    const convId = convIdByKey.get(key);

    for (const pair of pairs) {
      await ctx.db.insert("responseSamples", {
        csKey: ck,
        csName: raw,
        conversationId: convId,
        deltaMs: pair.gapMs,
        inboundAt: pair.inboundAt,
        slaBreach: isSlaBreach(pair.inboundAt, pair.replyAt),
        createdAt: pair.replyAt,
        orgId,
      });
      sampleCount++;
    }
  }

  return sampleCount;
}

export const rebuildSamplesForWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: async (ctx, args) => {
    const sampleCount = await rebuildSamplesForWindowImpl(ctx, args.orgId as Id<"organizations">, args.windowKey);
    return { windowKey: args.windowKey, samplesRebuilt: sampleCount };
  },
});

export const trueUp = internalAction({
  args: {},
  handler: async (ctx) => {
    // Derive "yesterday" and "today" windows
    const today = windowKeyToday();
    const todayRange = windowRangeForKey(today);
    const yesterday = windowKeyFor(todayRange.startAt - 1);

    // Process each org separately
    const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {});
    for (const org of orgs) {
      // Rebuild samples for both windows
      for (const windowKey of [yesterday, today]) {
        await ctx.runMutation(internal.rollups.rebuildSamplesForWindow, { orgId: String(org._id), windowKey });
        await ctx.runMutation(internal.rollups.recomputeWindow, { orgId: String(org._id), windowKey });
      }
    }

    return { yesterday, today, status: "ok" };
  },
});

export const oldestWindowKey = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.oldestWindowKey");

    // Get the first order by createdAt asc for this org
    const order = await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", 0)).first();

    if (!order) {
      return null;
    }

    return windowKeyFor(order.createdAt);
  },
});

export const backfillRange = mutation({
  args: { fromKey: v.string(), toKey: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.backfillRange");

    const processed: string[] = [];
    let currentKey = args.fromKey;
    let nextFromKey: string | null = null;

    // Iterate up to BACKFILL_WINDOW_CAP windows per call
    for (let i = 0; i < BACKFILL_WINDOW_CAP; i++) {
      if (currentKey > args.toKey) {
        break;
      }

      // Execute both rebuild and recompute for this window
      await rebuildSamplesForWindowImpl(ctx, orgId, currentKey);
      await recomputeWindowImpl(ctx, orgId, currentKey);

      processed.push(currentKey);

      // Derive next key
      const { endAt } = windowRangeForKey(currentKey);
      currentKey = windowKeyFor(endAt);

      // Check if we'd exceed the range
      if (currentKey > args.toKey && i < BACKFILL_WINDOW_CAP - 1) {
        break;
      }
    }

    // If currentKey is still <= toKey, set nextFromKey for caller to continue
    if (currentKey <= args.toKey) {
      nextFromKey = currentKey;
    }

    return { processed, nextFromKey };
  },
});

// One-time backfill: populate csKey on existing orders/recaps that predate the field.
// Patches csKey ONLY (no rollup bump — the derived aggregates are unchanged since csKey
// comes from the same name the rollups already grouped by). Idempotent: re-runnable.
// Controller loops per table until { done: true }.
export const backfillCsKey = mutation({
  args: {
    table: v.union(v.literal("orders"), v.literal("shippingRecaps")),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.backfillCsKey");
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 500), 500));
    const indexed = args.table === "orders"
      ? ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId))
      : ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId));
    const page = await (indexed as any).paginate({ cursor: args.cursor ?? null, numItems: limit });
    const rows = page.page.filter((row: any) => row.csKey === undefined);
    for (const r of rows) {
      const raw = args.table === "orders" ? (r as any).assignedCsName : (r as any).csName;
      await ctx.db.patch(r._id, { csKey: csKeyOf(raw ?? "") });
    }
    return {
      table: args.table,
      scanned: page.page.length,
      patched: rows.length,
      done: page.isDone,
      continueCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

export const csKeyCoverage = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.csKeyCoverage");
    const ordersMissing = (
      await ctx.db.query("orders").filter((q: any) => q.and(q.eq(q.field("orgId"), orgId), q.eq(q.field("csKey"), undefined))).collect()
    ).length;
    const recapsMissing = (
      await ctx.db.query("shippingRecaps").filter((q: any) => q.and(q.eq(q.field("orgId"), orgId), q.eq(q.field("csKey"), undefined))).collect()
    ).length;
    return { ordersMissing, recapsMissing };
  },
});

export const debugRollupParity = query({
  args: { windowKey: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.debugRollupParity");
    const internalPhones = await getInternalPhoneSet(ctx, orgId);

    const { startAt, endAt } = windowRangeForKey(args.windowKey);
    const mismatches: Array<{ csKey: string; field: string; stored: any; fresh: any }> = [];
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", args.windowKey))
      .unique();
    if (marker?.schemaVersion !== ROLLUP_SCHEMA_VERSION) {
      mismatches.push({
        csKey: "(window)",
        field: "completenessMarker",
        stored: marker?.schemaVersion ?? null,
        fresh: ROLLUP_SCHEMA_VERSION,
      });
    }

    // Fetch all csKeys in the window for this org
    const keys = new Set<string>();

    // From orders
    const orders = (
      await ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", startAt).lt("createdAt", endAt)).collect()
    ).filter((o: any) => !isInternalTestPhone(o.customerPhone, internalPhones));
    for (const o of orders) {
      keys.add(csKeyOf(o.assignedCsName));
    }

    // From recaps
    const recaps = (
      await ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", startAt).lt("closedAt", endAt)).collect()
    ).filter((r: any) => !isInternalTestPhone(r.customerPhone, internalPhones));
    for (const r of recaps) {
      keys.add(csKeyOf(r.csName));
    }

    // From existing rollups (scoped to this org)
    const storedRollups = await ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", args.windowKey)).collect();
    const storedMap = new Map<string, any>();
    for (const row of storedRollups) {
      keys.add(row.csKey);
      storedMap.set(row.csKey, row);
    }

    let freshRowCount = 0;
    // Compute fresh for each csKey
    for (const csKey of keys) {
      const fresh = await computeRollupValues(ctx, orgId, csKey, args.windowKey);
      const stored = storedMap.get(csKey);
      if (fresh) freshRowCount++;

      // Compare
      if (!fresh && !stored) {
        // Both empty, no mismatch
        continue;
      }

      if (!fresh && stored) {
        // Fresh is empty but stored exists - mismatch
        mismatches.push({
          csKey,
          field: "(entire row)",
          stored: stored,
          fresh: null,
        });
        continue;
      }

      if (fresh && !stored) {
        // Fresh exists but stored doesn't - mismatch
        mismatches.push({
          csKey,
          field: "(entire row)",
          stored: null,
          fresh: fresh,
        });
        continue;
      }

      // Neither exists -> nothing to compare (also narrows types for below).
      if (!fresh || !stored) continue;

      // Both exist, compare field by field (excluding updatedAt which always changes)
      const fieldsToCheck = [
        "csName", "leadOrders", "leadsCust", "closings", "closedCust", "cancelled",
        "manualClosings", "delivered", "revenue", "discount", "cod", "transfer",
        "fuClosings", "fuH1", "fuH2", "fuH3",
      ];

      for (const field of fieldsToCheck) {
        const storedVal = stored[field];
        const freshVal = fresh[field as keyof RollupValues];
        if (freshVal !== storedVal) {
          mismatches.push({
            csKey,
            field,
            stored: storedVal,
            fresh: freshVal,
          });
        }
      }

      // Compare every v2 product fact, key-order independent. Missing optional
      // migration fields are mismatches against the exact fresh number.
      const sortByProduct = (a: any, b: any) => a.product.localeCompare(b.product);
      const toTuples = (arr: any[]) => [...(arr ?? [])].sort(sortByProduct).map((p) => [
        p.product, p.leads, p.closings, p.leadOrders, p.revenue, p.discount, p.cod, p.transfer,
      ]);
      const storedProductsJson = JSON.stringify(toTuples(stored.byProduct));
      const freshProductsJson = JSON.stringify(toTuples(fresh.byProduct));
      if (storedProductsJson !== freshProductsJson) {
        mismatches.push({
          csKey,
          field: "byProduct",
          stored: stored.byProduct,
          fresh: fresh.byProduct,
        });
      }
    }

    return {
      windowKey: args.windowKey,
      mismatches,
      storedRows: storedRollups.length,
      freshRows: freshRowCount,
      markerVersion: marker?.schemaVersion ?? null,
    };
  },
});
