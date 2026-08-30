import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { parseScalevOrderHandler } from "./scalevAdapter";

type EnrichmentResult = {
  status: "updated" | "missing" | "unassigned" | "unmapped";
  handlerId?: string;
  csName?: string;
};

const enrichmentResultValidator = v.object({
  status: v.union(v.literal("updated"), v.literal("missing"), v.literal("unassigned"), v.literal("unmapped")),
  handlerId: v.optional(v.string()),
  csName: v.optional(v.string()),
});

async function fetchScalevOrder(providerRecordId: string): Promise<unknown> {
  const apiKey = process.env.SCALEV_API_KEY;
  if (!apiKey) throw new Error("SCALEV_API_KEY is not configured");
  const baseUrl = (process.env.SCALEV_API_BASE_URL ?? "https://api.scalev.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v3/orders/${encodeURIComponent(providerRecordId)}`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Scalev order enrichment failed (${response.status})`);
  return response.json();
}

async function enrich(
  ctx: any,
  args: { orgId: Id<"organizations">; orderId: string; providerRecordId: string },
): Promise<EnrichmentResult> {
  const detail = await fetchScalevOrder(args.providerRecordId);
  const handler = parseScalevOrderHandler(detail);
  if (!handler) return { status: "unassigned" };
  return ctx.runMutation(internal.ingest.scalevEnrichment.applyEnrichedHandler, {
    orgId: args.orgId,
    orderId: args.orderId,
    handlerId: handler.handlerId,
  });
}

export const enrichOrder = internalAction({
  args: { orgId: v.id("organizations"), orderId: v.string(), providerRecordId: v.string() },
  returns: enrichmentResultValidator,
  handler: enrich,
});

export const backfillUnassigned = internalAction({
  args: { orgId: v.optional(v.id("organizations")), limit: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), updated: v.number(), unassigned: v.number(), unmapped: v.number(), missing: v.number() }),
  handler: async (ctx, args): Promise<{ scanned: number; updated: number; unassigned: number; unmapped: number; missing: number }> => {
    const limit = args.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer between 1 and 100");
    const orgId = args.orgId ?? await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
    if (!orgId) throw new Error("Default organization is not configured");
    const rows: Array<{ orderId: string; providerRecordId: string }> = await ctx.runQuery(
      internal.ingest.scalevEnrichment.listUnassignedOrders,
      { orgId, limit },
    );
    const counts = { scanned: rows.length, updated: 0, unassigned: 0, unmapped: 0, missing: 0 };
    for (const row of rows) {
      const result = await enrich(ctx, { orgId, ...row });
      counts[result.status] += 1;
    }
    return counts;
  },
});
