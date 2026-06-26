import { query } from "./_generated/server";
import { v } from "convex/values";
import { csKey, isInternalTestPhone } from "./lib";
import { eligibleStage } from "./followUpMath";

// nowOverride is test-only (Date.now() is unavailable in some runtimes); prod passes nothing.
export const getFollowUpCandidates = query({
  args: { csName: v.optional(v.string()), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.nowOverride ?? Date.now();
    const csKeyMemo = args.csName ? csKey(args.csName) : null;

    // Open conversations only (active + handover), never closed.
    const open = (await ctx.db.query("conversations").collect())
      .filter((c) => c.status !== "closed")
      .filter((c) => !isInternalTestPhone(c.customerPhone))
      .filter((c) => (csKeyMemo ? csKey(c.assignedCsName) === csKeyMemo : true));

    // Closed-by-recap set (one phone lookup per conversation, parallel).
    const recaps = await Promise.all(
      open.map((c) => ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", c.customerPhone)).first()),
    );
    // Latest message per conversation (for direction check: is it outbound/ghosted?).
    const lastMsgs = await Promise.all(
      open.map((c) => ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").first()),
    );
    // Latest inbound message per conversation (for lastInboundAt timestamp).
    const lastInbounds = await Promise.all(
      open.map((c) => ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").filter((q) => q.eq(q.field("direction"), "inbound")).first()),
    );
    const orders = await Promise.all(
      open.map((c) => ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", c.orderId)).first()),
    );

    type Candidate = { conversationId: typeof open[number]["_id"]; customerName: string; customerPhone: string;
      productName: string; orderId: string; csName: string; lastInboundAt: number };
    const stage1: Candidate[] = [];
    const stage2: Candidate[] = [];
    open.forEach((c, i) => {
      const lastMsg = lastMsgs[i];
      const lastInbound = lastInbounds[i];
      const stage = eligibleStage({
        lastInboundAt: lastInbound?.createdAt ?? null,
        lastMessageOutbound: lastMsg != null && lastMsg.direction === "outbound",
        isClosed: c.status === "closed" || recaps[i] != null,
        followUpStage: c.followUpStage ?? null,
        followUpStageAt: c.followUpStageAt ?? null,
        now,
      });
      if (stage == null || lastInbound == null) return;
      const card: Candidate = {
        conversationId: c._id, customerName: c.customerName, customerPhone: c.customerPhone,
        productName: orders[i]?.productName ?? "—", orderId: c.orderId,
        csName: c.assignedCsName, lastInboundAt: lastInbound.createdAt,
      };
      (stage === 1 ? stage1 : stage2).push(card);
    });
    stage1.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    stage2.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    return { stage1, stage2 };
  },
});
