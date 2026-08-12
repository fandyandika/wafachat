import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberOrg } from "./authz";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

const UNKNOWN_PROVIDER_ERROR = "Nomor provider belum dipetakan";

export type ProviderChannelHealthTouch = {
  orgId: Id<"organizations">;
  providerNumberId: string;
  channelType: "cs" | "admin" | "unknown";
  csKey?: string;
  direction: "inbound" | "outbound";
  touchedAt: number;
  diagnostic?: string;
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
  const isLatest = args.touchedAt >= (existing?.updatedAt ?? 0);
  const diagnostic = args.channelType === "unknown" ? UNKNOWN_PROVIDER_ERROR : args.diagnostic;
  const diagnosticPatch = !isLatest
    ? {}
    : diagnostic
      ? {
          csKey: args.channelType === "unknown" ? undefined : args.csKey,
          lastError: diagnostic,
          errorAt: Math.max(existing?.errorAt ?? 0, args.touchedAt),
        }
      : { csKey: args.csKey, lastError: undefined, errorAt: undefined };
  const value = {
    channelType: isLatest || !existing ? args.channelType : existing.channelType,
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
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      _id: v.id("providerChannelHealth"),
      providerNumberId: v.string(),
      csKey: v.optional(v.string()),
      channelType: v.union(v.literal("cs"), v.literal("admin"), v.literal("unknown")),
      lastInboundAt: v.optional(v.number()),
      lastOutboundAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      errorAt: v.optional(v.number()),
      updatedAt: v.number(),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "providerChannelHealth.listProviderChannelHealth");
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 50)),
    };
    const result = await ctx.db
      .query("providerChannelHealth")
      .withIndex("by_org_updatedAt", (q) => q.eq("orgId", orgId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      page: result.page.map((row) => ({
        _id: row._id,
        providerNumberId: row.providerNumberId,
        csKey: row.csKey,
        channelType: row.channelType,
        lastInboundAt: row.lastInboundAt,
        lastOutboundAt: row.lastOutboundAt,
        lastError: row.lastError,
        errorAt: row.errorAt,
        updatedAt: row.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
