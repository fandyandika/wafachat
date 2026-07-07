import { query } from "./_generated/server";
import { requireMember } from "./authz";
import { v } from "convex/values";
import { isInternalTestPhone, csKey } from "./lib";
import { normalizeCsName } from "./shippingRecaps";
import { median, percentile, pairResponseEvents, isSlaBreach, type RtMessage } from "./responseTimeMath";

export const getResponseTimes = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, "responseTime.getResponseTimes");
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
    const lastReplyByConv = new Map<string, number>(); // max human-CS outbound (a real "CS online" signal) per conv
    for (const m of msgs) {
      const key = String(m.conversationId);
      let arr = byConv.get(key);
      if (!arr) { arr = []; byConv.set(key, arr); convOrder.push(key); convIdByKey.set(key, m.conversationId); }
      arr.push({ direction: m.direction, messageType: m.messageType, role: m.role, createdAt: m.createdAt });
      // A "reply" = outbound that isn't an automated template (order-notif/follow-up) or a
      // system message — same definition as pairResponseEvents. role may be "cs" (sent from the
      // dashboard) OR "ai" (CS replied from their own WhatsApp), so do NOT filter on role.
      if (m.direction === "outbound" && m.messageType !== "template" && m.role !== "system") {
        const prev = lastReplyByConv.get(key) ?? 0;
        if (m.createdAt > prev) lastReplyByConv.set(key, m.createdAt);
      }
    }

    // Join conversation -> raw assignedCsName. Fetch ALL conversations in parallel
    // (Promise.all) — a sequential await-loop here is an N+1 that made this query ~20s.
    const convDocs = await Promise.all(convOrder.map((key) => ctx.db.get(convIdByKey.get(key))));
    const csByKey = new Map<string, string>();
    convOrder.forEach((key, i) => csByKey.set(key, (convDocs[i] as any)?.assignedCsName || "Unknown"));

    // Last time each CS replied to a customer (max human-CS outbound), aggregated by csKey.
    const lastReplyByCs = new Map<string, number>();
    for (const [convKey, ts] of lastReplyByConv) {
      const ck = csKey(csByKey.get(convKey) || "Unknown");
      const prev = lastReplyByCs.get(ck) ?? 0;
      if (ts > prev) lastReplyByCs.set(ck, ts);
    }

    // Aggregate by csKey so name-forms ("Risma" / "CS Risma") merge into one CS.
    const agg = new Map<string, { rawCounts: Map<string, number>; first: number[]; all: number[]; slaBreaches: number }>();
    const overallFirst: number[] = [];
    let overallSlaBreaches = 0;
    for (const key of convOrder) {
      const { firstReplyMs, allReplyMs, firstInboundAt, firstReplyAt } = pairResponseEvents(byConv.get(key)!);
      if (firstReplyMs === null && allReplyMs.length === 0) continue;
      const raw = csByKey.get(key) || "Unknown";
      const ck = csKey(raw);
      let a = agg.get(ck);
      if (!a) { a = { rawCounts: new Map(), first: [], all: [], slaBreaches: 0 }; agg.set(ck, a); }
      a.rawCounts.set(raw, (a.rawCounts.get(raw) ?? 0) + 1);
      if (firstReplyMs !== null) {
        a.first.push(firstReplyMs);
        overallFirst.push(firstReplyMs);
        if (firstInboundAt !== null && firstReplyAt !== null && isSlaBreach(firstInboundAt, firstReplyAt)) {
          a.slaBreaches++;
          overallSlaBreaches++;
        }
      }
      a.all.push(...allReplyMs);
    }

    let cs = Array.from(agg.entries()).map(([ck, a]) => {
      // Display under the dominant raw name-form for this CS.
      const raw = Array.from(a.rawCounts.entries()).sort((x, y) => y[1] - x[1])[0][0];
      return {
        csName: normalizeCsName(raw),
        csNameRaw: raw,
        firstReplyMedianMs: median(a.first),
        firstReplyP90Ms: percentile(a.first, 0.9),
        firstReplyCount: a.first.length,
        ongoingMedianMs: median(a.all),
        ongoingCount: a.all.length,
        slaBreaches: a.slaBreaches,
        lastReplyAt: lastReplyByCs.get(ck) ?? null,
      };
    });
    if (args.csName) {
      const key = csKey(args.csName);
      cs = cs.filter((c) => csKey(c.csNameRaw) === key);
    }
    cs.sort((x, y) => y.firstReplyCount - x.firstReplyCount);

    return {
      windowStart: args.startAt,
      windowEnd: args.endAt,
      overall: { firstReplyMedianMs: median(overallFirst), firstReplyCount: overallFirst.length, slaBreaches: overallSlaBreaches },
      cs,
    };
  },
});
