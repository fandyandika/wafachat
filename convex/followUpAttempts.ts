import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { FollowUpStage } from "./followUpModel";

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
