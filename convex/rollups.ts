import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { csKey as csKeyOf, isInternalTestPhone, normalizePhone, windowKeyFor, windowRangeForKey, windowKeyToday } from "./lib";
import { canonicalizeProduct } from "./shippingRecaps";
import { getInternalPhoneSet } from "./orgSettings";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";
import { advanceRollupMigration, currentRollupMigration } from "./rollupMigration";

const PRODUCT_CAP = 50;

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
        order = await ctx.db.query("orders")
          .withIndex("by_org_customerPhone_createdAt", (q: any) => q
            .eq("orgId", orgId).eq("customerPhone", phone))
          .order("desc").first();
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
  for (const { orgId, k, w } of pairs.values()) {
    const migration = await ctx.db.query("rollupMigrationRuns")
      .withIndex("by_org_window", (q: any) => q.eq("orgId", orgId).eq("windowKey", w))
      .order("desc").first();
    if (migration && migration.phase !== "complete") {
      await ctx.db.patch(migration._id, { dirty: true, updatedAt: Date.now() });
    }
    await computeRollupRow(ctx, orgId, k, w);
  }
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
  for (const { orgId, k, w } of pairs.values()) {
    const migration = await ctx.db.query("rollupMigrationRuns")
      .withIndex("by_org_window", (q: any) => q.eq("orgId", orgId).eq("windowKey", w))
      .order("desc").first();
    if (migration && migration.phase !== "complete") {
      await ctx.db.patch(migration._id, { dirty: true, updatedAt: Date.now() });
    }
    await computeRollupRow(ctx, orgId, k, w);
  }
}

export const recomputeWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: (ctx, args) => advanceRollupMigration(
    ctx, args.orgId as Id<"organizations">, args.windowKey, { startNewWhenComplete: true },
  ),
});

export const rebuildSamplesForWindow = internalMutation({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: (ctx, args) => advanceRollupMigration(
    ctx, args.orgId as Id<"organizations">, args.windowKey, { startNewWhenComplete: false },
  ),
});

export const trueUp = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const today = windowKeyToday();
    const todayRange = windowRangeForKey(today);
    const yesterday = windowKeyFor(todayRange.startAt - 1);
    const page: {
      page: Array<{ _id: Id<"organizations"> }>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.orgs.listOrgPageInternal, { cursor: args.cursor });
    for (const org of page.page) {
      for (const windowKey of [yesterday, today]) {
        await ctx.scheduler.runAfter(0, internal.rollups.runRollupWindow, {
          orgId: String(org._id), windowKey,
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.rollups.trueUp, { cursor: page.continueCursor });
    }
    return {
      yesterday, today, organizationsScheduled: page.page.length,
      organizationEnumerationComplete: page.isDone,
      scheduledDriverContinuation: !page.isDone,
    };
  },
});

export const runRollupWindow = internalAction({
  args: { orgId: v.string(), windowKey: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const result: any = await ctx.runMutation(internal.rollups.recomputeWindow, args);
    if (!result.done) {
      await ctx.scheduler.runAfter(0, internal.rollups.runRollupWindow, args);
    }
    return { ...result, scheduledContinuation: !result.done };
  },
});

export const oldestWindowKey = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.oldestWindowKey");

    const [order, recap] = await Promise.all([
      ctx.db.query("orders")
        .withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId).gte("createdAt", 0)).first(),
      ctx.db.query("shippingRecaps")
        .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", 0)).first(),
    ]);
    const oldest = Math.min(order?.createdAt ?? Number.POSITIVE_INFINITY, recap?.closedAt ?? Number.POSITIVE_INFINITY);
    return Number.isFinite(oldest) ? windowKeyFor(oldest) : null;
  },
});

export const backfillRange = mutation({
  args: { fromKey: v.string(), toKey: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.backfillRange");

    if (args.fromKey > args.toKey) return { processed: [], nextFromKey: null, done: true };
    const result = await advanceRollupMigration(ctx, orgId, args.fromKey, {
      startNewWhenComplete: false,
    });
    if (!result.done) {
      return { ...result, processed: [], nextFromKey: args.fromKey, done: false };
    }
    const nextKey = windowKeyFor(windowRangeForKey(args.fromKey).endAt);
    return {
      ...result,
      processed: [args.fromKey],
      nextFromKey: nextKey <= args.toKey ? nextKey : null,
      done: nextKey > args.toKey,
    };
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
  args: {
    ordersCursor: v.optional(v.string()),
    recapsCursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.csKeyCoverage");
    const pageSize = Math.max(1, Math.min(Math.floor(args.pageSize ?? 500), 500));
    const [orders, recaps] = await Promise.all([
      ctx.db.query("orders").withIndex("by_org_createdAt", (q: any) => q.eq("orgId", orgId))
        .paginate({ cursor: args.ordersCursor ?? null, numItems: pageSize }),
      ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId))
        .paginate({ cursor: args.recapsCursor ?? null, numItems: pageSize }),
    ]);
    return {
      ordersMissing: orders.page.filter((row: any) => row.csKey === undefined).length,
      recapsMissing: recaps.page.filter((row: any) => row.csKey === undefined).length,
      ordersScanned: orders.page.length,
      recapsScanned: recaps.page.length,
      ordersCursor: orders.isDone ? undefined : orders.continueCursor,
      recapsCursor: recaps.isDone ? undefined : recaps.continueCursor,
      done: orders.isDone && recaps.isDone,
    };
  },
});

// Exact, resumable parity audit. The expected phase proves every staged result
// has a matching published row; the stored phase proves there are no extra
// published rows. Each call reads at most 25 rows plus point lookups.
export const debugRollupParity = query({
  args: {
    windowKey: v.string(),
    cursor: v.optional(v.string()),
    source: v.optional(v.union(v.literal("expected"), v.literal("stored"))),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "rollups.debugRollupParity");
    const source = args.source ?? "expected";
    const marker = await ctx.db.query("rollupWindows")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", args.windowKey))
      .unique();
    const publishedRun = marker?.sampleRunId ? await ctx.db.get(marker.sampleRunId) : null;
    const run = publishedRun ?? await currentRollupMigration(ctx, orgId, args.windowKey);
    const mismatches: Array<{ csKey: string; field: string; stored: any; fresh: any }> = [];
    if (source === "expected" && marker?.schemaVersion !== ROLLUP_SCHEMA_VERSION) {
      mismatches.push({
        csKey: "(window)", field: "completenessMarker",
        stored: marker?.schemaVersion ?? null, fresh: ROLLUP_SCHEMA_VERSION,
      });
    }

    const expectedValues = (agent: any) => agent && (
      agent.leadsCust > 0 || agent.closings > 0 || agent.cancelled > 0
    ) ? {
      csName: agent.csName,
      leadOrders: agent.leadOrders, leadsCust: agent.leadsCust,
      closings: agent.closings, closedCust: agent.closedCust,
      cancelled: agent.cancelled, manualClosings: agent.manualClosings,
      delivered: agent.delivered, revenue: agent.revenue, discount: agent.discount,
      cod: agent.cod, transfer: agent.transfer,
      fuClosings: agent.fuClosings, fuH1: agent.fuH1, fuH2: agent.fuH2, fuH3: agent.fuH3,
      byProduct: agent.topProducts ?? [],
    } : null;
    const compare = (csKey: string, stored: any, expected: any) => {
      if (!stored && !expected) return;
      if (!stored || !expected) {
        mismatches.push({ csKey, field: "(entire row)", stored: stored ?? null, fresh: expected });
        return;
      }
      for (const field of [
        "csName", "leadOrders", "leadsCust", "closings", "closedCust", "cancelled",
        "manualClosings", "delivered", "revenue", "discount", "cod", "transfer",
        "fuClosings", "fuH1", "fuH2", "fuH3",
      ]) {
        if (stored[field] !== expected[field]) {
          mismatches.push({ csKey, field, stored: stored[field], fresh: expected[field] });
        }
      }
      const tuples = (products: any[]) => [...(products ?? [])]
        .sort((a, b) => a.product.localeCompare(b.product))
        .map((product) => [
          product.product, product.leads, product.closings, product.leadOrders,
          product.revenue, product.discount, product.cod, product.transfer,
        ]);
      if (JSON.stringify(tuples(stored.byProduct)) !== JSON.stringify(tuples(expected.byProduct))) {
        mismatches.push({ csKey, field: "byProduct", stored: stored.byProduct, fresh: expected.byProduct });
      }
    };

    if (!run) {
      return {
        windowKey: args.windowKey, source, mismatches,
        storedRows: 0, freshRows: 0, markerVersion: marker?.schemaVersion ?? null,
        nextCursor: undefined, nextSource: undefined, done: true,
      };
    }

    if (source === "expected") {
      const page = await ctx.db.query("rollupMigrationAgents")
        .withIndex("by_run", (q: any) => q.eq("runId", run._id))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      let storedRows = 0;
      let freshRows = 0;
      for (const agent of page.page) {
        const expected = expectedValues(agent);
        const stored = await ctx.db.query("dailyRollups")
          .withIndex("by_org_window_cs", (q: any) => q
            .eq("orgId", orgId).eq("windowKey", args.windowKey).eq("csKey", agent.csKey))
          .unique();
        if (expected) freshRows++;
        if (stored) storedRows++;
        compare(agent.csKey, stored, expected);
      }
      return {
        windowKey: args.windowKey, source, mismatches, storedRows, freshRows,
        markerVersion: marker?.schemaVersion ?? null,
        nextCursor: page.isDone ? undefined : page.continueCursor,
        nextSource: page.isDone ? "stored" as const : "expected" as const,
        done: false,
      };
    }

    const page = await ctx.db.query("dailyRollups")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", args.windowKey))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    let freshRows = 0;
    for (const stored of page.page) {
      const agent = await ctx.db.query("rollupMigrationAgents")
        .withIndex("by_run_cs", (q: any) => q.eq("runId", run._id).eq("csKey", stored.csKey))
        .unique();
      const expected = expectedValues(agent);
      if (expected) freshRows++;
      compare(stored.csKey, stored, expected);
    }
    return {
      windowKey: args.windowKey, source, mismatches,
      storedRows: page.page.length, freshRows, markerVersion: marker?.schemaVersion ?? null,
      nextCursor: page.isDone ? undefined : page.continueCursor,
      nextSource: page.isDone ? undefined : "stored" as const,
      done: page.isDone,
    };
  },
});
