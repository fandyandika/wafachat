import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { FollowUpStage } from "./followUpModel";
import { requireScopedMemberOrg } from "./authz";
import { csKey } from "./lib";

export type FollowUpAttemptMethod =
  | "provider_template"
  | "provider_webhook"
  | "manual_confirmation";

export type AcceptedAttemptInput = {
  orgId: Id<"organizations">;
  conversationId: Id<"conversations">;
  csKey: string;
  cycleInboundAt: number;
  stage: FollowUpStage;
  method: FollowUpAttemptMethod;
  nonce: string;
  requestId?: string;
  templateId?: Id<"followUpTemplates">;
  templateName?: string;
  language?: string;
  providerMessageId?: string;
  actorUserId?: Id<"users">;
  actorName?: string;
  acceptedAt: number;
};

export function attemptKey(
  conversationId: string,
  cycleInboundAt: number,
  stage: FollowUpStage,
  method: FollowUpAttemptMethod,
  nonce: string,
): string {
  return `${conversationId}:${cycleInboundAt}:${stage}:${method}:${nonce}`;
}

export async function recordAcceptedAttempt(
  ctx: Pick<MutationCtx, "db">,
  input: AcceptedAttemptInput,
): Promise<{ attemptId: Id<"followUpAttempts">; duplicate: boolean }> {
  const key = attemptKey(
    String(input.conversationId),
    input.cycleInboundAt,
    input.stage,
    input.method,
    input.nonce,
  );
  const existing = await ctx.db
    .query("followUpAttempts")
    .withIndex("by_org_attemptKey", (q) => q.eq("orgId", input.orgId).eq("attemptKey", key))
    .unique();
  if (existing) return { attemptId: existing._id, duplicate: true };

  const attemptId = await ctx.db.insert("followUpAttempts", {
    orgId: input.orgId,
    conversationId: input.conversationId,
    csKey: input.csKey,
    cycleInboundAt: input.cycleInboundAt,
    stage: input.stage,
    method: input.method,
    status: "accepted",
    bucket: "sent",
    attemptKey: key,
    requestId: input.requestId,
    templateId: input.templateId,
    templateName: input.templateName,
    language: input.language,
    providerMessageId: input.providerMessageId,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    acceptedAt: input.acceptedAt,
    createdAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  });
  return { attemptId, duplicate: false };
}

const historyViewValidator = v.union(v.literal("sent"), v.literal("review"), v.literal("completed"));
const historyStatusValidator = v.union(
  v.literal("sending"),
  v.literal("accepted"),
  v.literal("failed"),
  v.literal("unknown"),
  v.literal("completed"),
);
const historyMethodValidator = v.union(
  v.literal("provider_template"),
  v.literal("provider_webhook"),
  v.literal("manual_confirmation"),
);
const historyRowValidator = v.object({
  id: v.string(),
  conversationId: v.optional(v.id("conversations")),
  customerName: v.string(),
  customerPhone: v.string(),
  orderId: v.string(),
  csName: v.string(),
  stage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  method: v.optional(historyMethodValidator),
  status: historyStatusValidator,
  error: v.optional(v.string()),
  at: v.number(),
});

export const listFollowUpHistory = query({
  args: {
    view: historyViewValidator,
    csName: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(historyRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUpAttempts.listFollowUpHistory",
      args.csName,
    );
    const effectiveCsKey = effectiveCsName ? csKey(effectiveCsName) : undefined;
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.max(1, Math.min(Math.floor(args.paginationOpts.numItems), 50)),
    };

    if (args.view === "completed") {
      const completed = await (effectiveCsKey
        ? ctx.db.query("shippingRecaps").withIndex("by_org_csKey_closedAt", (q) => q
            .eq("orgId", orgId).eq("csKey", effectiveCsKey))
        : ctx.db.query("shippingRecaps").withIndex("by_org_closedAt", (q) => q.eq("orgId", orgId)))
        .order("desc")
        .paginate(paginationOpts);
      return {
        page: completed.page.map((row) => ({
          id: String(row._id),
          conversationId: row.conversationId,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          orderId: row.orderIdBerdu ?? "",
          csName: row.csName,
          status: "completed" as const,
          at: row.closedAt,
        })),
        isDone: completed.isDone,
        continueCursor: completed.continueCursor,
      };
    }

    const bucket = args.view;
    const attempts = await (effectiveCsKey
      ? ctx.db.query("followUpAttempts").withIndex("by_org_csKey_bucket_createdAt", (q) => q
          .eq("orgId", orgId).eq("csKey", effectiveCsKey).eq("bucket", bucket))
      : ctx.db.query("followUpAttempts").withIndex("by_org_bucket_createdAt", (q) => q
          .eq("orgId", orgId).eq("bucket", bucket)))
      .order("desc")
      .paginate(paginationOpts);
    const conversations = await Promise.all(attempts.page.map((row) => ctx.db.get(row.conversationId)));
    return {
      page: attempts.page.flatMap((row, index) => {
        const conversation = conversations[index];
        if (!conversation || String(conversation.orgId) !== String(orgId)) return [];
        return [{
          id: String(row._id),
          conversationId: row.conversationId,
          customerName: conversation.customerName,
          customerPhone: conversation.customerPhone,
          orderId: conversation.orderId,
          csName: conversation.assignedCsName,
          stage: row.stage,
          method: row.method,
          status: row.status,
          error: row.lastError,
          at: row.acceptedAt ?? row.updatedAt,
        }];
      }),
      isDone: attempts.isDone,
      continueCursor: attempts.continueCursor,
    };
  },
});
