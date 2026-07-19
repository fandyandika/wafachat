import { query, internalQuery } from "./_generated/server";
import { requireMember, requireMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isInternalTestPhone, csKey } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile, pairResponseEvents, isSlaBreach, type RtMessage } from "./responseTimeMath";
import { responseTimesFromSamples } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";

type ResponseTimeAccess = {
  orgId: string;
  role: "admin" | "cs";
  effectiveCsName?: string;
};

async function resolveResponseTimeAccess(
  ctx: any,
  requestedCsName?: string,
): Promise<ResponseTimeAccess> {
  const { viewer, orgId } = await requireMemberOrg(ctx, "responseTime.getResponseTimes");
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", viewer.email))
    .unique();

  if (user) {
    if (!user.isActive || String(user._id) !== viewer.subject || user.role !== viewer.role) {
      throw new Error("unauthorized: response-time session is stale");
    }
    if (user.role === "cs") {
      if (!user.csName?.trim()) throw new Error("unauthorized: CS user has no assigned CS scope");
      return { orgId: String(orgId), role: "cs", effectiveCsName: user.csName };
    }
    return {
      orgId: String(orgId),
      role: "admin",
      effectiveCsName: requestedCsName?.trim() || undefined,
    };
  }

  // Internal platform-operator admin tokens intentionally have no users row and no
  // org claim. requireMemberOrg has already restricted that identity to the default org.
  if (viewer.role !== "admin" || viewer.orgIdClaim) {
    throw new Error("unauthorized: response-time user record is missing");
  }
  return {
    orgId: String(orgId),
    role: "admin",
    effectiveCsName: requestedCsName?.trim() || undefined,
  };
}

export const getResponseTimeAccess = query({
  args: { requestedCsName: v.optional(v.string()) },
  handler: (ctx, args) => resolveResponseTimeAccess(ctx, args.requestedCsName),
});

export const getResponseTimes = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await resolveResponseTimeAccess(ctx, args.csName);
    return responseTimesFromSamples(ctx, access.orgId as Id<"organizations">, {
      ...args,
      csName: access.effectiveCsName,
    });
  },
});
