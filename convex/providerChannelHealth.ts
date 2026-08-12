import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberOrg } from "./authz";

const UNKNOWN_PROVIDER_ERROR = "Nomor provider belum dipetakan";

export type ProviderChannelHealthTouch = {
  orgId: Id<"organizations">;
  providerNumberId: string;
  channelType: "cs" | "admin" | "unknown";
  csKey?: string;
  direction: "inbound" | "outbound";
  touchedAt: number;
};

export async function touchProviderChannelHealth(ctx: { db: any }, args: ProviderChannelHealthTouch) {
  const existing = await ctx.db
    .query("providerChannelHealth")
    .withIndex("by_org_providerNumberId", (q: any) => q
      .eq("orgId", args.orgId)
      .eq("providerNumberId", args.providerNumberId))
    .unique();
  const directionPatch = args.direction === "inbound"
    ? { lastInboundAt: Math.max(existing?.lastInboundAt ?? 0, args.touchedAt) }
    : { lastOutboundAt: Math.max(existing?.lastOutboundAt ?? 0, args.touchedAt) };
  const diagnosticPatch = args.channelType === "unknown"
    ? { csKey: undefined, lastError: UNKNOWN_PROVIDER_ERROR, errorAt: args.touchedAt }
    : { csKey: args.csKey, lastError: undefined, errorAt: undefined };
  const value = {
    channelType: args.channelType,
    ...directionPatch,
    ...diagnosticPatch,
    updatedAt: Math.max(existing?.updatedAt ?? 0, args.touchedAt),
  };

  if (existing) {
    await ctx.db.patch(existing._id, value);
    return existing._id;
  }
  return ctx.db.insert("providerChannelHealth", {
    orgId: args.orgId,
    providerNumberId: args.providerNumberId,
    ...value,
  });
}

export const listProviderChannelHealth = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireMemberOrg(ctx, "providerChannelHealth.listProviderChannelHealth");
    const rows = await ctx.db
      .query("providerChannelHealth")
      .withIndex("by_org_providerNumberId", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .map((row) => ({
        _id: row._id,
        providerNumberId: row.providerNumberId,
        csKey: row.csKey,
        channelType: row.channelType,
        lastInboundAt: row.lastInboundAt,
        lastOutboundAt: row.lastOutboundAt,
        lastError: row.lastError,
        errorAt: row.errorAt,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
