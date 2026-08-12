import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireScopedMemberOrg } from "./authz";
import { csKey } from "./lib";

const stageValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
const transitionRowValidator = v.object({
  transitionId: v.id("followUpTransitions"),
  cycleId: v.string(),
  kind: v.union(
    v.literal("cycle_armed"),
    v.literal("stage_completed"),
    v.literal("customer_replied"),
    v.literal("stage_corrected"),
    v.literal("closing"),
    v.literal("cancelled"),
    v.literal("archived"),
  ),
  source: v.union(
    v.literal("provider_template"),
    v.literal("provider_webhook"),
    v.literal("manual"),
    v.literal("system"),
  ),
  fromStage: v.optional(stageValidator),
  toStage: v.optional(stageValidator),
  providerMessageId: v.optional(v.string()),
  templateName: v.optional(v.string()),
  actorUserId: v.optional(v.id("users")),
  actorName: v.optional(v.string()),
  createdAt: v.number(),
});

export const listConversationTransitions = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(transitionRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUpTransitions.listConversationTransitions",
    );
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || String(conversation.orgId) !== String(orgId)) {
      throw new Error("Percakapan tidak ditemukan.");
    }
    if (viewer.role === "cs" && (
      !effectiveCsName || csKey(conversation.assignedCsName) !== csKey(effectiveCsName)
    )) {
      throw new Error("unauthorized: conversation scope mismatch");
    }

    const requestedItems = Number.isFinite(args.paginationOpts.numItems)
      ? Math.floor(args.paginationOpts.numItems)
      : 1;
    const result = await ctx.db.query("followUpTransitions")
      .withIndex("by_org_conversation_createdAt", (q) => q
        .eq("orgId", orgId)
        .eq("conversationId", conversation._id))
      .order("desc")
      .paginate({
        cursor: args.paginationOpts.cursor,
        numItems: Math.max(1, Math.min(requestedItems, 50)),
      });

    return {
      page: result.page.map((row) => ({
        transitionId: row._id,
        cycleId: row.cycleId,
        kind: row.kind,
        source: row.source,
        fromStage: row.fromStage,
        toStage: row.toStage,
        providerMessageId: row.providerMessageId,
        templateName: row.templateName,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        createdAt: row.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
