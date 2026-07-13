import { query, internalQuery } from "./_generated/server";
import { requireMember, requireMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isInternalTestPhone, csKey } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile, pairResponseEvents, isSlaBreach, type RtMessage } from "./responseTimeMath";
import { responseTimesFromSamples } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";
import { requireDefaultOrgId } from "./orgs";

export const getResponseTimes = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "responseTime.getResponseTimes");
    return responseTimesFromSamples(ctx, orgId, args);
  },
});
