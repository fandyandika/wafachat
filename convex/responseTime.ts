import { query } from "./_generated/server";
import { v } from "convex/values";
import { isInternalTestPhone } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile, pairResponseEvents, type RtMessage } from "./responseTimeMath";

export const getResponseTimes = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const msgs = (
      await ctx.db
        .query("messages")
        .withIndex("by_createdAt", (q: any) => q.gte("createdAt", args.startAt).lte("createdAt", args.endAt))
        .collect()
    ).filter((m: any) => !isInternalTestPhone(m.customerPhone));

    // Group by conversation, preserving ascending createdAt order (index already ascending).
    const byConv = new Map<string, RtMessage[]>();
    const convOrder: string[] = [];
    const convIdByKey = new Map<string, any>();
    for (const m of msgs) {
      const key = String(m.conversationId);
      let arr = byConv.get(key);
      if (!arr) { arr = []; byConv.set(key, arr); convOrder.push(key); convIdByKey.set(key, m.conversationId); }
      arr.push({ direction: m.direction, messageType: m.messageType, role: m.role, createdAt: m.createdAt });
    }

    // Join conversation -> raw assignedCsName.
    const csByKey = new Map<string, string>();
    for (const key of convOrder) {
      const conv = await ctx.db.get(convIdByKey.get(key));
      csByKey.set(key, (conv as any)?.assignedCsName || "Unknown");
    }

    const agg = new Map<string, { first: number[]; all: number[] }>();
    const overallFirst: number[] = [];
    for (const key of convOrder) {
      const { firstReplyMs, allReplyMs } = pairResponseEvents(byConv.get(key)!);
      if (firstReplyMs === null && allReplyMs.length === 0) continue;
      const raw = csByKey.get(key) || "Unknown";
      let a = agg.get(raw);
      if (!a) { a = { first: [], all: [] }; agg.set(raw, a); }
      if (firstReplyMs !== null) { a.first.push(firstReplyMs); overallFirst.push(firstReplyMs); }
      a.all.push(...allReplyMs);
    }

    let cs = Array.from(agg.entries()).map(([raw, a]) => ({
      csName: normalizeCsName(raw),
      csNameRaw: raw,
      firstReplyMedianMs: median(a.first),
      firstReplyP90Ms: percentile(a.first, 0.9),
      firstReplyCount: a.first.length,
      ongoingMedianMs: median(a.all),
      ongoingCount: a.all.length,
    }));
    if (args.csName) cs = cs.filter((c) => c.csName === args.csName || c.csNameRaw === args.csName);
    cs.sort((x, y) => y.firstReplyCount - x.firstReplyCount);

    return {
      windowStart: args.startAt,
      windowEnd: args.endAt,
      overall: { firstReplyMedianMs: median(overallFirst), firstReplyCount: overallFirst.length },
      cs,
    };
  },
});
