import type { Id } from "./_generated/dataModel";
import { csKey as csKeyOf, isInternalTestPhone, normalizePhone, windowRangeForKey } from "./lib";
import { canonicalizeProduct } from "./shippingRecaps";
import { businessMinutesBetween, isSlaBreach } from "./responseTimeMath";
import { getInternalPhoneSet } from "./orgSettings";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";

export const ROLLUP_MIGRATION_DOCUMENT_BUDGET = 64;
const SOURCE_PAGE = 16;
const PRODUCT_PAGE = 25;
const PUBLISH_PAGE = 8;
const PRODUCT_CAP = 50;

type Run = any;
type Agent = any;
type ProductFact = {
  product: string;
  leads: number;
  closings: number;
  leadOrders: number;
  revenue: number;
  discount: number;
  cod: number;
  transfer: number;
};

const claimKey = (...parts: string[]) => JSON.stringify(parts);

async function latestRun(ctx: any, orgId: Id<"organizations">, windowKey: string): Promise<Run | null> {
  return ctx.db.query("rollupMigrationRuns")
    .withIndex("by_org_window", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey))
    .order("desc")
    .first();
}

async function createRun(ctx: any, orgId: Id<"organizations">, windowKey: string): Promise<Run> {
  const now = Date.now();
  const runId = await ctx.db.insert("rollupMigrationRuns", {
    orgId,
    windowKey,
    phase: "existing",
    dirty: false,
    documentsProcessed: 0,
    sampleCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("rollup migration run creation failed");
  return run;
}

async function getOrCreateAgent(
  ctx: any,
  run: Run,
  csKey: string,
  initialName: string,
): Promise<Agent> {
  const existing = await ctx.db.query("rollupMigrationAgents")
    .withIndex("by_run_cs", (q: any) => q.eq("runId", run._id).eq("csKey", csKey))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("rollupMigrationAgents", {
    runId: run._id,
    orgId: run.orgId,
    windowKey: run.windowKey,
    csKey,
    csName: initialName,
    csNameCount: 0,
    leadOrders: 0, leadsCust: 0, closings: 0, closedCust: 0,
    cancelled: 0, manualClosings: 0, delivered: 0,
    revenue: 0, discount: 0, fuClosings: 0, fuH1: 0, fuH2: 0, fuH3: 0,
    cod: 0, transfer: 0,
    productLeads: 0, productClosings: 0, productLeadOrders: 0,
    productRevenue: 0, productDiscount: 0, productCod: 0, productTransfer: 0,
    productsFinalized: false,
    updatedAt: Date.now(),
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("rollup migration agent creation failed");
  return created;
}

async function touchName(ctx: any, run: Run, csKey: string, rawName: string): Promise<void> {
  const agent = await getOrCreateAgent(ctx, run, csKey, rawName);
  const countRow = await ctx.db.query("rollupMigrationNameCounts")
    .withIndex("by_run_cs_name", (q: any) => q
      .eq("runId", run._id).eq("csKey", csKey).eq("rawName", rawName))
    .unique();
  const nextCount = (countRow?.count ?? 0) + 1;
  if (countRow) await ctx.db.patch(countRow._id, { count: nextCount });
  else await ctx.db.insert("rollupMigrationNameCounts", { runId: run._id, csKey, rawName, count: 1 });
  if (nextCount > agent.csNameCount) {
    await ctx.db.patch(agent._id, { csName: rawName, csNameCount: nextCount, updatedAt: Date.now() });
  }
}

async function ensureDistinct(ctx: any, runId: any, key: string): Promise<boolean> {
  const existing = await ctx.db.query("rollupMigrationDistinctClaims")
    .withIndex("by_run_claim", (q: any) => q.eq("runId", runId).eq("claimKey", key)).unique();
  if (existing) return false;
  await ctx.db.insert("rollupMigrationDistinctClaims", { runId, claimKey: key, count: 1 });
  return true;
}

async function adjustRefCount(ctx: any, runId: any, key: string, delta: 1 | -1): Promise<"added" | "removed" | "unchanged"> {
  const existing = await ctx.db.query("rollupMigrationDistinctClaims")
    .withIndex("by_run_claim", (q: any) => q.eq("runId", runId).eq("claimKey", key)).unique();
  const before = existing?.count ?? 0;
  const after = before + delta;
  if (after < 0) throw new Error(`negative rollup claim refcount: ${key}`);
  if (!existing && after > 0) {
    await ctx.db.insert("rollupMigrationDistinctClaims", { runId, claimKey: key, count: after });
  } else if (existing && after === 0) {
    await ctx.db.delete(existing._id);
  } else if (existing) {
    await ctx.db.patch(existing._id, { count: after });
  }
  if (before === 0 && after > 0) return "added";
  if (before > 0 && after === 0) return "removed";
  return "unchanged";
}

async function getOrCreateProduct(ctx: any, runId: any, csKey: string, product: string): Promise<any> {
  const existing = await ctx.db.query("rollupMigrationProducts")
    .withIndex("by_run_cs_product", (q: any) => q
      .eq("runId", runId).eq("csKey", csKey).eq("product", product))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("rollupMigrationProducts", {
    runId, csKey, product,
    leads: 0, closings: 0, leadOrders: 0, revenue: 0, discount: 0, cod: 0, transfer: 0,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("rollup migration product creation failed");
  return created;
}

async function processOrder(ctx: any, run: Run, order: any, internalPhones: ReadonlySet<string>): Promise<void> {
  if (isInternalTestPhone(order.customerPhone, internalPhones)) return;
  const csKey = csKeyOf(order.assignedCsName);
  const phone = normalizePhone(order.customerPhone);
  const productName = canonicalizeProduct(order.productName || order.products);
  if (order.csKey === undefined) await ctx.db.patch(order._id, { csKey });
  await touchName(ctx, run, csKey, order.assignedCsName);
  const agent = await getOrCreateAgent(ctx, run, csKey, order.assignedCsName);
  const newLead = await ensureDistinct(ctx, run._id, claimKey("lead", csKey, phone));
  const newProductLead = await ensureDistinct(
    ctx, run._id, claimKey("product-lead", csKey, productName, phone),
  );
  await ctx.db.patch(agent._id, {
    leadOrders: agent.leadOrders + 1,
    leadsCust: agent.leadsCust + (newLead ? 1 : 0),
    productLeadOrders: agent.productLeadOrders + 1,
    productLeads: agent.productLeads + (newProductLead ? 1 : 0),
    updatedAt: Date.now(),
  });
  const product = await getOrCreateProduct(ctx, run._id, csKey, productName);
  await ctx.db.patch(product._id, {
    leadOrders: product.leadOrders + 1,
    leads: product.leads + (newProductLead ? 1 : 0),
  });
  const latest = await ctx.db.query("rollupMigrationLatestOrders")
    .withIndex("by_run_cs_phone", (q: any) => q
      .eq("runId", run._id).eq("csKey", csKey).eq("phone", phone))
    .unique();
  if (!latest) {
    await ctx.db.insert("rollupMigrationLatestOrders", {
      runId: run._id, csKey, phone, createdAt: order.createdAt, product: productName,
    });
  } else if (order.createdAt > latest.createdAt) {
    await ctx.db.patch(latest._id, { createdAt: order.createdAt, product: productName });
  }
}

async function productForRecap(ctx: any, run: Run, csKey: string, recap: any): Promise<string> {
  const phone = normalizePhone(recap.customerPhone);
  const latest = await ctx.db.query("rollupMigrationLatestOrders")
    .withIndex("by_run_cs_phone", (q: any) => q
      .eq("runId", run._id).eq("csKey", csKey).eq("phone", phone))
    .unique();
  if (latest) return latest.product;
  let order: any = null;
  if (recap.orderIdBerdu) {
    order = await ctx.db.query("orders")
      .withIndex("by_org_orderId", (q: any) => q.eq("orgId", run.orgId).eq("orderId", recap.orderIdBerdu))
      .unique();
  }
  if (!order) {
    order = await ctx.db.query("orders")
      .withIndex("by_org_customerPhone_createdAt", (q: any) => q
        .eq("orgId", run.orgId).eq("customerPhone", recap.customerPhone))
      .order("desc").first();
  }
  if (!order && recap.customerPhone !== phone) {
    order = await ctx.db.query("orders")
      .withIndex("by_org_customerPhone_createdAt", (q: any) => q
        .eq("orgId", run.orgId).eq("customerPhone", phone))
      .order("desc").first();
  }
  return canonicalizeProduct(order?.productName || order?.products || recap.packageContent);
}

function closingDeltas(claim: any, sign: 1 | -1) {
  const touch = claim.touchCount ?? 0;
  return {
    closings: sign,
    revenue: sign * claim.revenue,
    discount: sign * claim.discount,
    manualClosings: sign * (claim.manual ? 1 : 0),
    delivered: sign * (claim.delivered ? 1 : 0),
    fuClosings: sign * (touch >= 1 ? 1 : 0),
    fuH1: sign * (touch === 1 ? 1 : 0),
    fuH2: sign * (touch === 2 ? 1 : 0),
    fuH3: sign * (touch >= 3 ? 1 : 0),
    productClosings: sign,
    productRevenue: sign * claim.revenue,
    productDiscount: sign * claim.discount,
    productCod: sign * (claim.paymentMethod === "cod" ? 1 : 0),
    productTransfer: sign * (claim.paymentMethod === "transfer" ? 1 : 0),
  };
}

async function applyClosing(ctx: any, run: Run, agent: Agent, claim: any, sign: 1 | -1): Promise<void> {
  const refChange = await adjustRefCount(
    ctx, run._id, claimKey("closed", agent.csKey, claim.phone), sign,
  );
  const closedCustDelta = refChange === "added" ? 1 : refChange === "removed" ? -1 : 0;
  const deltas = closingDeltas(claim, sign);
  const currentAgent = await ctx.db.get(agent._id);
  if (!currentAgent) throw new Error("rollup migration agent disappeared");
  await ctx.db.patch(agent._id, {
    closings: currentAgent.closings + deltas.closings,
    closedCust: currentAgent.closedCust + closedCustDelta,
    revenue: currentAgent.revenue + deltas.revenue,
    discount: currentAgent.discount + deltas.discount,
    manualClosings: currentAgent.manualClosings + deltas.manualClosings,
    delivered: currentAgent.delivered + deltas.delivered,
    fuClosings: currentAgent.fuClosings + deltas.fuClosings,
    fuH1: currentAgent.fuH1 + deltas.fuH1,
    fuH2: currentAgent.fuH2 + deltas.fuH2,
    fuH3: currentAgent.fuH3 + deltas.fuH3,
    productClosings: currentAgent.productClosings + deltas.productClosings,
    productRevenue: currentAgent.productRevenue + deltas.productRevenue,
    productDiscount: currentAgent.productDiscount + deltas.productDiscount,
    productCod: currentAgent.productCod + deltas.productCod,
    productTransfer: currentAgent.productTransfer + deltas.productTransfer,
    updatedAt: Date.now(),
  });
  const product = await getOrCreateProduct(ctx, run._id, agent.csKey, claim.product);
  await ctx.db.patch(product._id, {
    closings: product.closings + sign,
    revenue: product.revenue + sign * claim.revenue,
    discount: product.discount + sign * claim.discount,
    cod: product.cod + sign * (claim.paymentMethod === "cod" ? 1 : 0),
    transfer: product.transfer + sign * (claim.paymentMethod === "transfer" ? 1 : 0),
  });
}

async function processRecap(ctx: any, run: Run, recap: any, internalPhones: ReadonlySet<string>): Promise<void> {
  if (isInternalTestPhone(recap.customerPhone, internalPhones)) return;
  const csKey = csKeyOf(recap.csName);
  if (recap.csKey === undefined) await ctx.db.patch(recap._id, { csKey });
  const cancelled = recap.status === "cancelled" || recap.status === "cancelled_after_export";
  const agent = await getOrCreateAgent(ctx, run, csKey, cancelled ? "" : recap.csName);
  const current = await ctx.db.get(agent._id);
  if (!current) throw new Error("rollup migration agent disappeared");
  await ctx.db.patch(agent._id, {
    cancelled: current.cancelled + (cancelled ? 1 : 0),
    cod: current.cod + (recap.paymentMethod === "cod" ? 1 : 0),
    transfer: current.transfer + (recap.paymentMethod === "transfer" ? 1 : 0),
    updatedAt: Date.now(),
  });
  if (cancelled) return;
  await touchName(ctx, run, csKey, recap.csName);
  const phone = normalizePhone(recap.customerPhone);
  const identity = recap.orderIdBerdu || phone;
  const existing = await ctx.db.query("rollupMigrationClosingClaims")
    .withIndex("by_run_cs_identity", (q: any) => q
      .eq("runId", run._id).eq("csKey", csKey).eq("identity", identity))
    .unique();
  if (existing && existing.closedAt >= recap.closedAt) return;
  const refreshedAgent = await getOrCreateAgent(ctx, run, csKey, recap.csName);
  if (existing) await applyClosing(ctx, run, refreshedAgent, existing, -1);
  const contribution = {
    runId: run._id,
    csKey,
    identity,
    closedAt: recap.closedAt,
    phone,
    product: await productForRecap(ctx, run, csKey, recap),
    revenue: recap.total ?? recap.codValue ?? recap.nonCodItemPrice ?? 0,
    discount: recap.discount ?? 0,
    manual: !recap.sourceMessageId,
    delivered: recap.status === "delivered",
    touchCount: recap.followUpTouchesAtClose ?? 0,
    paymentMethod: recap.paymentMethod ?? "unknown",
  };
  if (existing) await ctx.db.patch(existing._id, contribution);
  else await ctx.db.insert("rollupMigrationClosingClaims", contribution);
  await applyClosing(ctx, run, refreshedAgent, contribution, 1);
}

async function processMessage(ctx: any, run: Run, message: any, internalPhones: ReadonlySet<string>): Promise<void> {
  if (isInternalTestPhone(message.customerPhone, internalPhones)) return;
  let state = await ctx.db.query("rollupMigrationConversationStates")
    .withIndex("by_run_conversation", (q: any) => q
      .eq("runId", run._id).eq("conversationId", message.conversationId))
    .unique();
  if (!state) {
    const conversation = await ctx.db.get(message.conversationId);
    const csName = conversation?.assignedCsName || "Unknown";
    const stateId = await ctx.db.insert("rollupMigrationConversationStates", {
      runId: run._id,
      conversationId: message.conversationId,
      csKey: csKeyOf(csName),
      csName,
    });
    state = await ctx.db.get(stateId);
  }
  if (!state) throw new Error("rollup migration conversation state creation failed");
  if (message.direction === "inbound") {
    if (state.pendingInboundAt === undefined) {
      await ctx.db.patch(state._id, { pendingInboundAt: message.createdAt });
    }
    return;
  }
  if (message.messageType === "template" || message.role === "system" || state.pendingInboundAt === undefined) return;
  const activeMs = Math.round(businessMinutesBetween(state.pendingInboundAt, message.createdAt) * 60_000);
  const gapMs = activeMs > 0 ? activeMs : message.createdAt - state.pendingInboundAt;
  const existingSample = await ctx.db.query("rollupMigrationSamples")
    .withIndex("by_run_sourceMessage", (q: any) => q
      .eq("runId", run._id).eq("sourceMessageId", message._id))
    .unique();
  if (!existingSample) {
    await ctx.db.insert("rollupMigrationSamples", {
      runId: run._id,
      orgId: run.orgId,
      csKey: state.csKey,
      csName: state.csName,
      conversationId: message.conversationId,
      sourceMessageId: message._id,
      deltaMs: gapMs,
      inboundAt: state.pendingInboundAt,
      slaBreach: isSlaBreach(state.pendingInboundAt, message.createdAt),
      createdAt: message.createdAt,
    });
  }
  await ctx.db.patch(state._id, { pendingInboundAt: undefined });
  if (!existingSample) {
    const currentRun = await ctx.db.get(run._id);
    if (currentRun) await ctx.db.patch(run._id, { sampleCount: currentRun.sampleCount + 1 });
  }
}

function toProductFact(row: any): ProductFact {
  return {
    product: row.product,
    leads: row.leads,
    closings: row.closings,
    leadOrders: row.leadOrders,
    revenue: row.revenue,
    discount: row.discount,
    cod: row.cod,
    transfer: row.transfer,
  };
}

async function advanceProducts(ctx: any, run: Run, budget: number): Promise<number> {
  const agent = await ctx.db.query("rollupMigrationAgents")
    .withIndex("by_run_productsFinalized", (q: any) => q
      .eq("runId", run._id).eq("productsFinalized", false))
    .first();
  if (!agent) {
    await ctx.db.patch(run._id, { phase: "publish", cursor: undefined, updatedAt: Date.now() });
    return 0;
  }
  const page = await ctx.db.query("rollupMigrationProducts")
    .withIndex("by_run_cs", (q: any) => q.eq("runId", run._id).eq("csKey", agent.csKey))
    .paginate({ cursor: agent.productCursor ?? null, numItems: Math.max(1, Math.min(PRODUCT_PAGE, budget)) });
  const candidates = [...(agent.topProducts ?? []), ...page.page.map(toProductFact)]
    .filter((row: ProductFact) => row.leads > 0 || row.closings > 0)
    .sort((a: ProductFact, b: ProductFact) => b.leads - a.leads || a.product.localeCompare(b.product))
    .slice(0, PRODUCT_CAP);
  if (!page.isDone) {
    await ctx.db.patch(agent._id, { topProducts: candidates, productCursor: page.continueCursor, updatedAt: Date.now() });
    return page.page.length;
  }
  const sum = (field: keyof Omit<ProductFact, "product">) => candidates.reduce((total, row) => total + row[field], 0);
  const overflow: ProductFact = {
    product: "lainnya",
    leads: agent.productLeads - sum("leads"),
    closings: agent.productClosings - sum("closings"),
    leadOrders: agent.productLeadOrders - sum("leadOrders"),
    revenue: agent.productRevenue - sum("revenue"),
    discount: agent.productDiscount - sum("discount"),
    cod: agent.productCod - sum("cod"),
    transfer: agent.productTransfer - sum("transfer"),
  };
  const topProducts = overflow.leads > 0 || overflow.closings > 0 ? [...candidates, overflow] : candidates;
  await ctx.db.patch(agent._id, {
    topProducts,
    productCursor: undefined,
    productsFinalized: true,
    updatedAt: Date.now(),
  });
  return page.page.length;
}

async function publishAgent(ctx: any, agent: Agent): Promise<void> {
  const existing = await ctx.db.query("dailyRollups")
    .withIndex("by_org_window_cs", (q: any) => q
      .eq("orgId", agent.orgId).eq("windowKey", agent.windowKey).eq("csKey", agent.csKey))
    .unique();
  const empty = agent.leadsCust === 0 && agent.closings === 0 && agent.cancelled === 0;
  if (empty) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const values = {
    windowKey: agent.windowKey,
    csKey: agent.csKey,
    csName: agent.csName,
    leadOrders: agent.leadOrders,
    leadsCust: agent.leadsCust,
    closings: agent.closings,
    closedCust: agent.closedCust,
    cancelled: agent.cancelled,
    manualClosings: agent.manualClosings,
    delivered: agent.delivered,
    revenue: agent.revenue,
    discount: agent.discount,
    cod: agent.cod,
    transfer: agent.transfer,
    fuClosings: agent.fuClosings,
    fuH1: agent.fuH1,
    fuH2: agent.fuH2,
    fuH3: agent.fuH3,
    byProduct: agent.topProducts ?? [],
    updatedAt: Date.now(),
  };
  if (existing) await ctx.db.patch(existing._id, values);
  else await ctx.db.insert("dailyRollups", { orgId: agent.orgId, ...values });
}

async function advanceSourcePhase(
  ctx: any,
  run: Run,
  internalPhones: ReadonlySet<string>,
  budget: number,
): Promise<number> {
  const { startAt, endAt } = windowRangeForKey(run.windowKey);
  const numItems = Math.max(1, Math.min(SOURCE_PAGE, budget));
  let page: any;
  let nextPhase: Run["phase"];
  if (run.phase === "existing") {
    page = await ctx.db.query("dailyRollups")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", run.orgId).eq("windowKey", run.windowKey))
      .paginate({ cursor: run.cursor ?? null, numItems });
    for (const row of page.page) await getOrCreateAgent(ctx, run, row.csKey, row.csName);
    nextPhase = "orders";
  } else if (run.phase === "orders") {
    page = await ctx.db.query("orders")
      .withIndex("by_org_createdAt", (q: any) => q
        .eq("orgId", run.orgId).gte("createdAt", startAt).lt("createdAt", endAt))
      .paginate({ cursor: run.cursor ?? null, numItems });
    for (const row of page.page) await processOrder(ctx, run, row, internalPhones);
    nextPhase = "recaps";
  } else if (run.phase === "recaps") {
    page = await ctx.db.query("shippingRecaps")
      .withIndex("by_org_closedAt", (q: any) => q
        .eq("orgId", run.orgId).gte("closedAt", startAt).lt("closedAt", endAt))
      .paginate({ cursor: run.cursor ?? null, numItems });
    for (const row of page.page) await processRecap(ctx, run, row, internalPhones);
    nextPhase = "messages";
  } else {
    page = await ctx.db.query("messages")
      .withIndex("by_org_createdAt", (q: any) => q
        .eq("orgId", run.orgId).gte("createdAt", startAt).lt("createdAt", endAt))
      .paginate({ cursor: run.cursor ?? null, numItems });
    for (const row of page.page) await processMessage(ctx, run, row, internalPhones);
    nextPhase = "products";
  }
  await ctx.db.patch(run._id, page.isDone
    ? { phase: nextPhase, cursor: undefined, updatedAt: Date.now() }
    : { cursor: page.continueCursor, updatedAt: Date.now() });
  return page.page.length;
}

async function advancePublish(ctx: any, run: Run, budget: number): Promise<number> {
  const page = await ctx.db.query("rollupMigrationAgents")
    .withIndex("by_run", (q: any) => q.eq("runId", run._id))
    .paginate({ cursor: run.cursor ?? null, numItems: Math.max(1, Math.min(PUBLISH_PAGE, budget)) });
  for (const agent of page.page) await publishAgent(ctx, agent);
  if (!page.isDone) {
    await ctx.db.patch(run._id, { cursor: page.continueCursor, updatedAt: Date.now() });
    return page.page.length;
  }
  const marker = await ctx.db.query("rollupWindows")
    .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", run.orgId).eq("windowKey", run.windowKey))
    .unique();
  const markerValue = {
    schemaVersion: ROLLUP_SCHEMA_VERSION,
    sampleRunId: run._id,
    completedAt: Date.now(),
  };
  if (marker) await ctx.db.patch(marker._id, markerValue);
  else await ctx.db.insert("rollupWindows", { orgId: run.orgId, windowKey: run.windowKey, ...markerValue });
  await ctx.db.patch(run._id, { phase: "complete", cursor: undefined, updatedAt: Date.now() });
  return page.page.length;
}

export async function advanceRollupMigration(
  ctx: any,
  orgId: Id<"organizations">,
  windowKey: string,
  options: { startNewWhenComplete: boolean },
) {
  let run = await latestRun(ctx, orgId, windowKey);
  if (run?.dirty && run.phase !== "complete") {
    run = await createRun(ctx, orgId, windowKey);
  }
  if (!run || (run.phase === "complete" && options.startNewWhenComplete)) {
    run = await createRun(ctx, orgId, windowKey);
  }
  if (run.phase === "complete") {
    return {
      runId: String(run._id), windowKey, phase: "complete", done: true,
      documentsProcessed: 0, totalDocumentsProcessed: run.documentsProcessed,
      samplesRebuilt: run.sampleCount,
    };
  }
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  let processed = 0;
  let guard = 0;
  while (processed < ROLLUP_MIGRATION_DOCUMENT_BUDGET && guard++ < 32) {
    run = await ctx.db.get(run._id);
    if (!run || run.phase === "complete") break;
    const remaining = ROLLUP_MIGRATION_DOCUMENT_BUDGET - processed;
    let step = 0;
    if (["existing", "orders", "recaps", "messages"].includes(run.phase)) {
      step = await advanceSourcePhase(ctx, run, internalPhones, remaining);
    } else if (run.phase === "products") {
      step = await advanceProducts(ctx, run, remaining);
    } else if (run.phase === "publish") {
      step = await advancePublish(ctx, run, remaining);
    }
    processed += step;
    if (step === 0) continue;
  }
  run = await ctx.db.get(run._id);
  if (!run) throw new Error("rollup migration run disappeared");
  if (processed > 0) {
    await ctx.db.patch(run._id, {
      documentsProcessed: run.documentsProcessed + processed,
      updatedAt: Date.now(),
    });
    run = await ctx.db.get(run._id);
  }
  return {
    runId: String(run._id),
    windowKey,
    phase: run.phase,
    done: run.phase === "complete",
    documentsProcessed: processed,
    totalDocumentsProcessed: run.documentsProcessed,
    samplesRebuilt: run.sampleCount,
  };
}

export async function currentRollupMigration(ctx: any, orgId: Id<"organizations">, windowKey: string) {
  return latestRun(ctx, orgId, windowKey);
}
