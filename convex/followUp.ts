import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireScopedMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { csKey, isInternalTestPhone, normalizeCsName, normalizePhone, windowKeyFor, windowRangeForKey } from "./lib";
import { eligibleStage } from "./followUpMath";
import { getInternalPhoneSet } from "./orgSettings";
import { assertPublicAnalyticsRange, collectExactBounded } from "./analyticsBounds";
import { getBoundedActiveAgentRegistry } from "./agents";
import { advanceAfterAccepted, FOLLOW_UP_EXPIRY_MS } from "./followUpModel";
import { internal } from "./_generated/api";
import { buildTemplatePayload, sendKirimDevMessage } from "../lib/kirimdev";
import { ROLLUP_SCHEMA_VERSION } from "./rollupVersion";
import { attemptKey, finalizeAttempt, recordAcceptedAttempt, reserveAttempt } from "./followUpAttempts";

const HOUR = 3_600_000;
const WINDOW_HOURS = 24; // WhatsApp 24h window; a follow-up "touch" = an outbound sent after it closes
const MAX_FOLLOW_UP_ROWS = 100;

const followUpStageValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
const dueFollowUpValidator = v.object({
  conversationId: v.id("conversations"),
  customerName: v.string(),
  customerPhone: v.string(),
  orderId: v.string(),
  csName: v.string(),
  csKey: v.string(),
  cycleInboundAt: v.number(),
  stage: followUpStageValidator,
  dueAt: v.number(),
  productName: v.string(),
  lastMessagePreview: v.string(),
  lastMessageAt: v.number(),
  reason: v.string(),
});

const attentionFollowUpValidator = v.object({
  conversationId: v.id("conversations"),
  customerName: v.string(),
  customerPhone: v.string(),
  orderId: v.string(),
  csName: v.string(),
  stage: v.optional(followUpStageValidator),
  state: v.union(v.literal("sending"), v.literal("failed"), v.literal("unknown")),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
});
const attentionStateValidator = v.union(v.literal("sending"), v.literal("failed"), v.literal("unknown"));

export const listDueFollowUps = query({
  args: {
    stage: v.optional(followUpStageValidator),
    csName: v.optional(v.string()),
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(dueFollowUpValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("Waktu queue tidak valid.");
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUp.listDueFollowUps",
      args.csName,
    );
    const effectiveCsKey = effectiveCsName ? csKey(effectiveCsName) : undefined;
    const lowerDueAt = args.now - FOLLOW_UP_EXPIRY_MS;
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.max(1, Math.min(Math.floor(args.paginationOpts.numItems), 30)),
    };

    const result = effectiveCsKey
      ? args.stage
        ? await ctx.db
            .query("conversations")
            .withIndex("by_org_followUpCsKey_stage_state_dueAt", (q) => q
              .eq("orgId", orgId)
              .eq("followUpCsKey", effectiveCsKey)
              .eq("followUpNextStage", args.stage)
              .eq("followUpState", "waiting")
              .gte("followUpDueAt", lowerDueAt)
              .lte("followUpDueAt", args.now))
            .paginate(paginationOpts)
        : await ctx.db
            .query("conversations")
            .withIndex("by_org_followUpCsKey_state_dueAt", (q) => q
              .eq("orgId", orgId)
              .eq("followUpCsKey", effectiveCsKey)
              .eq("followUpState", "waiting")
              .gte("followUpDueAt", lowerDueAt)
              .lte("followUpDueAt", args.now))
            .paginate(paginationOpts)
      : args.stage
        ? await ctx.db
            .query("conversations")
            .withIndex("by_org_followUpStage_state_dueAt", (q) => q
              .eq("orgId", orgId)
              .eq("followUpNextStage", args.stage)
              .eq("followUpState", "waiting")
              .gte("followUpDueAt", lowerDueAt)
              .lte("followUpDueAt", args.now))
            .paginate(paginationOpts)
        : await ctx.db
            .query("conversations")
            .withIndex("by_org_followUpState_dueAt", (q) => q
              .eq("orgId", orgId)
              .eq("followUpState", "waiting")
              .gte("followUpDueAt", lowerDueAt)
              .lte("followUpDueAt", args.now))
            .paginate(paginationOpts);

    const dueRows = result.page.filter((row) => row.followUpCycleInboundAt !== undefined
      && row.followUpCycleInboundAt >= args.now - FOLLOW_UP_EXPIRY_MS);
    const page = await Promise.all(dueRows.map(async (row) => {
      const [order, lastMessage] = await Promise.all([
        ctx.db.query("orders").withIndex("by_org_orderId", (q) => q
          .eq("orgId", orgId).eq("orderId", row.orderId)).first(),
        ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q
          .eq("conversationId", row._id)).order("desc").first(),
      ]);
      return {
        conversationId: row._id,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        orderId: row.orderId,
        csName: row.assignedCsName,
        csKey: row.followUpCsKey!,
        cycleInboundAt: row.followUpCycleInboundAt!,
        stage: row.followUpNextStage!,
        dueAt: row.followUpDueAt!,
        productName: order?.productName ?? "Produk tidak tersedia",
        lastMessagePreview: (lastMessage?.content ?? "").slice(0, 180),
        lastMessageAt: lastMessage?.createdAt ?? row.followUpCycleInboundAt!,
        reason: "CS terakhir membalas, customer belum merespons",
      };
    }));
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const searchFollowUpCustomerValidator = v.object({
  conversationId: v.id("conversations"),
  customerName: v.string(),
  customerPhone: v.string(),
  orderId: v.string(),
  csName: v.string(),
  stage: v.optional(followUpStageValidator),
  state: v.optional(v.union(
    v.literal("waiting"), v.literal("sending"), v.literal("unknown"),
    v.literal("failed"), v.literal("complete"), v.literal("archived"),
  )),
  updatedAt: v.number(),
});

export const searchFollowUpCustomers = query({
  args: { query: v.string(), csName: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(searchFollowUpCustomerValidator),
  handler: async (ctx, args) => {
    const term = args.query.trim();
    if (term.length < 3) throw new Error("Pencarian minimal tiga karakter.");
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUp.searchFollowUpCustomers",
      args.csName,
    );
    const effectiveCsKey = effectiveCsName ? csKey(effectiveCsName) : undefined;
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 20));
    const digitsOnly = /^\+?[\d\s()-]+$/.test(term);
    let candidates: any[];
    if (digitsOnly) {
      const phone = normalizePhone(term);
      candidates = await ctx.db.query("conversations")
        .withIndex("by_org_customerPhone_updatedAt", (q) => q
          .eq("orgId", orgId).eq("customerPhone", phone))
        .order("desc")
        .take(limit);
    } else {
      const since = Date.now() - 90 * 24 * HOUR;
      candidates = (await Promise.all((["active", "handover"] as const).map((status) => ctx.db
        .query("conversations")
        .withIndex("by_org_status_updatedAt", (q) => q
          .eq("orgId", orgId).eq("status", status).gte("updatedAt", since))
        .order("desc")
        .take(100)))).flat();
      const lower = term.toLocaleLowerCase("id-ID");
      candidates = candidates.filter((row) => row.customerName.toLocaleLowerCase("id-ID").includes(lower));
    }
    const byPhone = new Map<string, any>();
    for (const row of candidates) {
      if (effectiveCsKey && csKey(row.assignedCsName) !== effectiveCsKey) continue;
      if (!byPhone.has(row.customerPhone)) byPhone.set(row.customerPhone, row);
      if (byPhone.size >= limit) break;
    }
    return [...byPhone.values()].map((row) => ({
      conversationId: row._id,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      orderId: row.orderId,
      csName: row.assignedCsName,
      stage: row.followUpNextStage,
      state: row.followUpState,
      updatedAt: row.updatedAt,
    }));
  },
});

export const listFollowUpAttention = query({
  args: {
    csName: v.optional(v.string()),
    state: attentionStateValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(attentionFollowUpValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUp.listFollowUpAttention",
      args.csName,
    );
    const effectiveCsKey = effectiveCsName ? csKey(effectiveCsName) : undefined;
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.max(1, Math.min(Math.floor(args.paginationOpts.numItems), 100)),
    };
    const result = await (effectiveCsKey
      ? ctx.db
          .query("conversations")
          .withIndex("by_org_followUpCsKey_state_dueAt", (q) => q
            .eq("orgId", orgId)
            .eq("followUpCsKey", effectiveCsKey)
            .eq("followUpState", args.state))
          .order("desc")
          .paginate(paginationOpts)
      : ctx.db
          .query("conversations")
          .withIndex("by_org_followUpState_dueAt", (q) => q
            .eq("orgId", orgId)
            .eq("followUpState", args.state))
          .order("desc")
          .paginate(paginationOpts));

    return {
      page: result.page.map((row) => ({
        conversationId: row._id,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        orderId: row.orderId,
        csName: row.assignedCsName,
        stage: row.followUpNextStage,
        state: row.followUpState as "sending" | "failed" | "unknown",
        lastError: row.followUpLastError,
        updatedAt: row.updatedAt,
      })).sort((a, b) => b.updatedAt - a.updatedAt),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const reservationStatusValidator = v.union(
  v.literal("sending"),
  v.literal("accepted"),
  v.literal("failed"),
  v.literal("unknown"),
);

const reservationResultValidator = v.union(
  v.object({ shouldSend: v.literal(false), status: reservationStatusValidator }),
  v.object({
    shouldSend: v.literal(true),
    status: v.literal("sending"),
    to: v.string(),
    phoneNumberId: v.string(),
    templateName: v.string(),
    language: v.string(),
    orderedValues: v.array(v.string()),
    idempotencyKey: v.string(),
  }),
);

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ReservationStatus = "sending" | "accepted" | "failed" | "unknown";
type ReservationResult =
  | { shouldSend: false; status: ReservationStatus }
  | {
      shouldSend: true;
      status: "sending";
      to: string;
      phoneNumberId: string;
      templateName: string;
      language: string;
      orderedValues: string[];
      idempotencyKey: string;
    };
type SendDueFollowUpResult = {
  ok: boolean;
  status: ReservationStatus;
  providerMessageId?: string;
  error?: string;
};

function followUpVariableValue(
  variable: "customer_name" | "product_name" | "order_id",
  values: { customerName: string; productName: string; orderId: string },
): string {
  if (variable === "customer_name") return values.customerName;
  if (variable === "product_name") return values.productName;
  return values.orderId;
}

export const reserveDueFollowUp = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    stage: followUpStageValidator,
    templateId: v.optional(v.id("followUpTemplates")),
    requestId: v.string(),
  },
  returns: reservationResultValidator,
  handler: async (ctx, args) => {
    if (!REQUEST_ID_RE.test(args.requestId)) throw new Error("Request ID Follow-up tidak valid.");
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.reserveDueFollowUp");
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || String(conversation.orgId) !== String(orgId)) {
      throw new Error("Percakapan tidak ditemukan.");
    }
    if (viewer.role === "cs" && (!effectiveCsName || csKey(conversation.assignedCsName) !== csKey(effectiveCsName))) {
      throw new Error("unauthorized: conversation scope mismatch");
    }

    if (conversation.followUpRequestId === args.requestId) {
      const status: ReservationStatus = conversation.followUpProviderMessageId
        ? "accepted"
        : conversation.followUpState === "unknown"
          ? "unknown"
          : conversation.followUpState === "failed"
            ? "failed"
            : "sending";
      return { shouldSend: false as const, status };
    }
    if (conversation.followUpState === "unknown") {
      throw new Error("Status pengiriman sebelumnya belum diketahui. Periksa riwayat KirimDev sebelum mencoba lagi.");
    }
    if (conversation.followUpState === "sending") {
      throw new Error("Pengiriman Follow-up masih diproses.");
    }

    const currentTime = Date.now();
    if (
      conversation.status === "closed" ||
      conversation.followUpState !== "waiting" ||
      conversation.followUpNextStage !== args.stage ||
      conversation.followUpDueAt === undefined ||
      conversation.followUpDueAt > currentTime ||
      conversation.followUpCycleInboundAt === undefined ||
      conversation.followUpCycleInboundAt < currentTime - FOLLOW_UP_EXPIRY_MS
    ) {
      throw new Error("Follow-up ini tidak lagi jatuh tempo.");
    }

    const recap = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", conversation.orderId))
      .first();
    if (recap) {
      throw new Error("Order sudah closing atau dibatalkan.");
    }

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_org_orderId", (q) => q.eq("orgId", orgId).eq("orderId", conversation.orderId))
      .take(2);
    if (orders.length !== 1) throw new Error("Data order Follow-up tidak tersedia atau duplikat.");

    const template = args.templateId
      ? await ctx.db.get(args.templateId)
      : await ctx.db.query("followUpTemplates")
          .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", args.stage))
          .unique();
    if (!template || String(template.orgId) !== String(orgId) || !template.isActive) {
      throw new Error("Template Follow-up tidak aktif atau tidak tersedia.");
    }

    const agentKey = conversation.followUpCsKey ?? csKey(conversation.assignedCsName);
    let agent = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_key", (q) => q.eq("orgId", orgId).eq("key", agentKey))
      .unique();
    if (!agent) {
      agent = await ctx.db
        .query("csConfigs")
        .withIndex("by_org_normalizedName", (q) => q
          .eq("orgId", orgId)
          .eq("normalizedName", normalizeCsName(conversation.assignedCsName)))
        .unique();
    }
    // A multi-number alias set does not prove which sender owns this conversation.
    // Only the canonical scalar claim is safe for outbound Follow-up.
    const phoneNumberId = agent?.providerNumberId;
    if (!agent?.isActive || !phoneNumberId) throw new Error("Nomor API CS belum dikonfigurasi.");

    const order = orders[0];
    const orderedValues = template.variables.map((variable) => followUpVariableValue(variable, {
      customerName: conversation.customerName,
      productName: order.productName,
      orderId: conversation.orderId,
    }));
    const idempotencyKey = `fu-${args.conversationId}-${conversation.followUpCycleInboundAt}-${args.stage}-${template._id}-${args.requestId}`;
    const attempt = await reserveAttempt(ctx, {
      orgId,
      conversationId: conversation._id,
      csKey: agentKey,
      cycleInboundAt: conversation.followUpCycleInboundAt,
      stage: args.stage,
      method: "provider_template",
      nonce: args.requestId,
      requestId: args.requestId,
      templateId: template._id,
      templateName: template.templateName,
      language: template.language,
      actorSubject: viewer.subject,
      actorName: viewer.name,
      createdAt: currentTime,
    });
    if (attempt.duplicate) return { shouldSend: false as const, status: attempt.status };

    await ctx.db.patch(conversation._id, {
      followUpState: "sending",
      followUpRequestId: args.requestId,
      followUpProviderMessageId: undefined,
      followUpLastError: undefined,
      updatedAt: currentTime,
    });
    await ctx.scheduler.runAfter(2 * 60_000, internal.followUp.expireSendingReservation, {
      conversationId: conversation._id,
      requestId: args.requestId,
    });
    return {
      shouldSend: true as const,
      status: "sending" as const,
      to: conversation.customerPhone,
      phoneNumberId,
      templateName: template.templateName,
      language: template.language,
      orderedValues,
      idempotencyKey,
    };
  },
});

export const finalizeDueFollowUp = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    requestId: v.string(),
    outcome: v.union(v.literal("accepted"), v.literal("failed"), v.literal("unknown")),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
  },
  returns: v.object({ ok: v.literal(true), status: reservationStatusValidator }),
  handler: async (ctx, args) => {
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.finalizeDueFollowUp");
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || String(conversation.orgId) !== String(orgId)) throw new Error("Percakapan tidak ditemukan.");
    if (viewer.role === "cs" && (!effectiveCsName || csKey(conversation.assignedCsName) !== csKey(effectiveCsName))) {
      throw new Error("unauthorized: conversation scope mismatch");
    }
    if (conversation.followUpRequestId !== args.requestId) throw new Error("Reservasi Follow-up tidak cocok.");
    if (conversation.followUpProviderMessageId) return { ok: true as const, status: "accepted" as const };
    if (conversation.followUpState !== "sending") {
      const status: ReservationStatus = conversation.followUpState === "unknown" ? "unknown" : "failed";
      return { ok: true as const, status };
    }

    if (!conversation.followUpCycleInboundAt || !conversation.followUpNextStage) {
      throw new Error("Stage Follow-up tidak tersedia.");
    }
    const key = attemptKey(
      String(conversation._id),
      conversation.followUpCycleInboundAt,
      conversation.followUpNextStage,
      "provider_template",
      args.requestId,
    );
    const attempt = await ctx.db.query("followUpAttempts")
      .withIndex("by_org_attemptKey", (q) => q.eq("orgId", orgId).eq("attemptKey", key))
      .unique();
    if (!attempt) throw new Error("Attempt Follow-up tidak ditemukan.");

    const finalizedAt = args.acceptedAt ?? Date.now();
    if (!Number.isFinite(finalizedAt) || Math.abs(Date.now() - finalizedAt) > 60_000) {
      throw new Error("Waktu finalisasi Follow-up tidak valid.");
    }
    if (args.outcome !== "accepted") {
      await finalizeAttempt(ctx, {
        attemptId: attempt._id,
        status: args.outcome,
        at: finalizedAt,
        error: args.error ?? "Pengiriman gagal tanpa detail.",
      });
      await ctx.db.patch(conversation._id, {
        followUpState: args.outcome,
        followUpLastError: (args.error ?? "Pengiriman gagal tanpa detail.").slice(0, 500),
        updatedAt: finalizedAt,
      });
      return { ok: true as const, status: args.outcome as ReservationStatus };
    }
    if (!args.providerMessageId?.trim()) throw new Error("ID pesan provider wajib untuk pengiriman diterima.");

    const duplicateMessage = await ctx.db
      .query("messages")
      .withIndex("by_org_externalMessageId", (q) => q.eq("orgId", orgId).eq("externalMessageId", args.providerMessageId))
      .first();
    if (!duplicateMessage) {
      await ctx.db.insert("messages", {
        orgId,
        conversationId: conversation._id,
        orderId: conversation.orderId,
        customerPhone: conversation.customerPhone,
        role: "cs",
        direction: "outbound",
        content: `[follow-up H+${conversation.followUpNextStage}]`,
        messageType: "template",
        source: "panel",
        externalMessageId: args.providerMessageId,
        createdAt: finalizedAt,
      });
    }

    const sentStage = conversation.followUpNextStage;
    const next = advanceAfterAccepted(sentStage, finalizedAt);
    await finalizeAttempt(ctx, {
      attemptId: attempt._id,
      status: "accepted",
      at: finalizedAt,
      providerMessageId: args.providerMessageId,
    });
    await ctx.db.patch(conversation._id, {
      followUpStage: sentStage,
      followUpStageAt: finalizedAt,
      followUpNextStage: next.nextStage ?? undefined,
      followUpDueAt: next.dueAt ?? undefined,
      followUpState: next.state,
      followUpProviderMessageId: args.providerMessageId,
      followUpLastError: undefined,
      lastMessageAt: finalizedAt,
      updatedAt: finalizedAt,
    });
    return { ok: true as const, status: "accepted" as const };
  },
});

export const expireSendingReservation = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    requestId: v.string(),
  },
  returns: v.object({ expired: v.boolean() }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation
      || conversation.followUpState !== "sending"
      || conversation.followUpRequestId !== args.requestId
    ) {
      return { expired: false };
    }
    if (conversation.followUpCycleInboundAt && conversation.followUpNextStage) {
      const key = attemptKey(
        String(conversation._id),
        conversation.followUpCycleInboundAt,
        conversation.followUpNextStage,
        "provider_template",
        args.requestId,
      );
      const attempt = await ctx.db.query("followUpAttempts")
        .withIndex("by_org_attemptKey", (q) => q.eq("orgId", conversation.orgId).eq("attemptKey", key))
        .unique();
      if (attempt) await finalizeAttempt(ctx, {
        attemptId: attempt._id,
        status: "unknown",
        at: Date.now(),
        error: "Pengiriman tidak selesai dalam batas waktu. Periksa riwayat KirimDev sebelum mencoba lagi.",
      });
    }
    await ctx.db.patch(conversation._id, {
      followUpState: "unknown",
      followUpLastError: "Pengiriman tidak selesai dalam batas waktu. Periksa riwayat KirimDev sebelum mencoba lagi.",
      updatedAt: Date.now(),
    });
    return { expired: true };
  },
});

const sendDueFollowUpResultValidator = v.object({
  ok: v.boolean(),
  status: reservationStatusValidator,
  providerMessageId: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const sendDueFollowUp = action({
  args: {
    conversationId: v.id("conversations"),
    stage: followUpStageValidator,
    templateId: v.optional(v.id("followUpTemplates")),
    requestId: v.string(),
  },
  returns: sendDueFollowUpResultValidator,
  handler: async (ctx, args): Promise<SendDueFollowUpResult> => {
    const reservation: ReservationResult = await ctx.runMutation(internal.followUp.reserveDueFollowUp, args);
    if (!reservation.shouldSend) {
      return { ok: reservation.status === "accepted", status: reservation.status };
    }

    const apiKey = process.env.KIRIMDEV_API_KEY;
    if (!apiKey) {
      const error = "KIRIMDEV_API_KEY belum dikonfigurasi.";
      await ctx.runMutation(internal.followUp.finalizeDueFollowUp, {
        conversationId: args.conversationId,
        requestId: args.requestId,
        outcome: "failed",
        error,
      });
      return { ok: false, status: "failed", error };
    }

    try {
      const result = await sendKirimDevMessage({
        apiKey,
        baseUrl: process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1",
        phoneNumberId: reservation.phoneNumberId,
        payload: buildTemplatePayload(
          reservation.to,
          reservation.templateName,
          reservation.language,
          reservation.orderedValues,
        ),
        idempotencyKey: reservation.idempotencyKey,
      });
      if (result.ok) {
        await ctx.runMutation(internal.followUp.finalizeDueFollowUp, {
          conversationId: args.conversationId,
          requestId: args.requestId,
          outcome: "accepted",
          providerMessageId: result.providerMessageId,
          acceptedAt: Date.now(),
        });
        return {
          ok: true,
          status: "accepted",
          providerMessageId: result.providerMessageId,
        };
      }

      const outcome = result.statusUnknown ? "unknown" as const : "failed" as const;
      await ctx.runMutation(internal.followUp.finalizeDueFollowUp, {
        conversationId: args.conversationId,
        requestId: args.requestId,
        outcome,
        error: result.error,
      });
      return { ok: false, status: outcome, error: result.error };
    } catch {
      const error = "Status pengiriman belum diketahui. Periksa riwayat KirimDev sebelum mencoba lagi.";
      await ctx.runMutation(internal.followUp.finalizeDueFollowUp, {
        conversationId: args.conversationId,
        requestId: args.requestId,
        outcome: "unknown",
        error,
      });
      return { ok: false, status: "unknown", error };
    }
  },
});

export const confirmManualContact = mutation({
  args: {
    conversationId: v.id("conversations"),
    stage: followUpStageValidator,
    requestId: v.string(),
  },
  returns: v.object({ ok: v.literal(true), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    if (!REQUEST_ID_RE.test(args.requestId)) throw new Error("Request ID Follow-up tidak valid.");
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(
      ctx,
      "followUp.confirmManualContact",
    );
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || String(conversation.orgId) !== String(orgId)) throw new Error("Percakapan tidak ditemukan.");
    if (viewer.role === "cs" && (!effectiveCsName || csKey(conversation.assignedCsName) !== csKey(effectiveCsName))) {
      throw new Error("unauthorized: conversation scope mismatch");
    }
    if (!conversation.followUpCycleInboundAt) throw new Error("Follow-up ini tidak lagi jatuh tempo.");
    const key = attemptKey(String(conversation._id), conversation.followUpCycleInboundAt, args.stage, "manual_confirmation", args.requestId);
    const existing = await ctx.db.query("followUpAttempts")
      .withIndex("by_org_attemptKey", (q) => q.eq("orgId", orgId).eq("attemptKey", key))
      .unique();
    if (existing?.status === "accepted") return { ok: true as const, duplicate: true };

    const confirmedAt = Date.now();
    if (conversation.status === "closed"
      || conversation.followUpState !== "waiting"
      || conversation.followUpNextStage !== args.stage
      || conversation.followUpDueAt === undefined
      || conversation.followUpDueAt > confirmedAt
      || conversation.followUpCycleInboundAt < confirmedAt - FOLLOW_UP_EXPIRY_MS) {
      throw new Error("Follow-up ini tidak lagi jatuh tempo.");
    }
    const recap = await ctx.db.query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", conversation.orderId))
      .first();
    if (recap) throw new Error("Order sudah closing atau dibatalkan.");
    const accepted = await recordAcceptedAttempt(ctx, {
      orgId,
      conversationId: conversation._id,
      csKey: conversation.followUpCsKey ?? csKey(conversation.assignedCsName),
      cycleInboundAt: conversation.followUpCycleInboundAt,
      stage: args.stage,
      method: "manual_confirmation",
      nonce: args.requestId,
      requestId: args.requestId,
      actorSubject: viewer.subject,
      actorName: viewer.name,
      acceptedAt: confirmedAt,
    });
    if (accepted.duplicate) return { ok: true as const, duplicate: true };
    const next = advanceAfterAccepted(args.stage, confirmedAt);
    await ctx.db.patch(conversation._id, {
      followUpStage: args.stage,
      followUpStageAt: confirmedAt,
      followUpNextStage: next.nextStage ?? undefined,
      followUpDueAt: next.dueAt ?? undefined,
      followUpState: next.state,
      followUpRequestId: args.requestId,
      followUpProviderMessageId: undefined,
      followUpLastError: undefined,
      updatedAt: confirmedAt,
    });
    return { ok: true as const, duplicate: false };
  },
});

// Count follow-up touches (outbound messages after the 24h window closed, relative to lastInbound).
// Manual-via-WABA follow-ups and API sends both land here, so the funnel can't double-send a lead a
// CS already touched by hand. Reads only the post-window tail, so it stays cheap.
async function touchInfo(ctx: any, conversationId: any, lastInboundAt: number | null) {
  if (lastInboundAt == null) return { count: 0, lastAt: null as number | null, ats: [] as number[] };
  const windowClose = lastInboundAt + WINDOW_HOURS * HOUR;
  const touches = await collectExactBounded(ctx.db
    .query("messages")
    .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", conversationId).eq("direction", "outbound").gt("createdAt", windowClose))
    , "followUp touch history", MAX_FOLLOW_UP_ROWS);
  const ats = (touches.map((t: any) => t.createdAt) as number[]).sort((a, b) => a - b);
  return { count: ats.length, lastAt: ats.length ? ats[ats.length - 1] : null, ats };
}

// Feature #10: count follow-up touches (post-window outbound) that occurred before a specific time.
// Used to record KPI: how many touches preceded a closing.
export async function countFollowUpTouchesBeforeTime(ctx: any, conversationId: any, lastInboundAt: number | null, beforeTime: number) {
  if (lastInboundAt == null) return 0;
  const windowClose = lastInboundAt + WINDOW_HOURS * HOUR;
  const touches = await collectExactBounded(ctx.db
    .query("messages")
    .withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", conversationId).eq("direction", "outbound").gt("createdAt", windowClose).lt("createdAt", beforeTime))
    , "followUp closing touch history", MAX_FOLLOW_UP_ROWS);
  return touches.length;
}

// nowOverride is test-only (Date.now() is unavailable in some runtimes); prod passes nothing.
// Legacy bounded derivation retained only for diagnostics and migration parity.
async function followUpCandidatesHandler(ctx: any, args: { csName?: string; nowOverride?: number; orgId: any }) {
    const internalPhones = await getInternalPhoneSet(ctx, args.orgId);
    const now = args.nowOverride ?? Date.now();
    const csKeyMemo = args.csName ? csKey(args.csName) : null;

    const DAY = 86_400_000;
    // Recency bound: every message bumps conversation.updatedAt (messages.ts), so updatedAt >= lastInboundAt.
    // A candidate's last inbound is within 5 days (followUpMath ceiling), so a 6-day window can't drop one —
    // and it keeps this derive-on-read query well under Convex's 4096-reads-per-call limit at scale.
    const since = now - 6 * DAY;
    const recent = (
      await Promise.all(
        (["active", "handover"] as const).map((s) =>
          collectExactBounded(ctx.db.query("conversations").withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", args.orgId).eq("status", s).gte("updatedAt", since)), "followUp candidates", MAX_FOLLOW_UP_ROWS),
        ),
      )
    ).flat();
    const open = recent
      .filter((c) => !isInternalTestPhone(c.customerPhone, internalPhones))
      .filter((c) => (csKeyMemo ? csKey(c.assignedCsName) === csKeyMemo : true));

    // Latest message per conversation -> keep only GHOSTED ones (last message outbound), which bounds the heavier lookups.
    const lastMsgs = await Promise.all(
      open.map((c) => ctx.db.query("messages").withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", c._id)).order("desc").first()),
    );
    const ghosted = open
      .map((c, i) => ({ c, lastMsg: lastMsgs[i] }))
      .filter((x) => x.lastMsg != null && x.lastMsg.direction === "outbound");

    // For ghosted only: closed-by-recap, the latest inbound, and the follow-up touches since.
    const recaps = await Promise.all(
      ghosted.map((x) => ctx.db.query("shippingRecaps").withIndex("by_org_orderIdBerdu", (q: any) => q.eq("orgId", args.orgId).eq("orderIdBerdu", x.c.orderId)).first()),
    );
    const lastInbounds = await Promise.all(
      ghosted.map((x) => ctx.db.query("messages").withIndex("by_conversation_direction_createdAt", (q: any) => q.eq("conversationId", x.c._id).eq("direction", "inbound")).order("desc").first()),
    );
    const touches = await Promise.all(
      ghosted.map((x, i) => touchInfo(ctx, x.c._id, lastInbounds[i]?.createdAt ?? null)),
    );

    type Row = typeof open[number];
    // touchAts = timestamps of follow-up touches already sent (index 0 = H+1, 1 = H+2, 2 = H+2B) so
    // the UI can show "✓H+1 ✓H+2 ○H+2B" + when each went out.
    type Candidate = { conversationId: Row["_id"]; customerName: string; customerPhone: string;
      productName: string; orderId: string; csName: string; lastInboundAt: number; touchAts: number[]; lastMessageText: string };
    const eligible: Array<{ c: Row; stage: number; lastInboundAt: number; touchAts: number[]; lastMessageText: string }> = [];
    ghosted.forEach((x, i) => {
      const lastInbound = lastInbounds[i];
      let stage: number | null;

      // Feature #8: if override is set and not closed, use the override; else compute eligible stage.
      if (x.c.followUpStageOverride != null && x.c.status !== "closed" && recaps[i] == null) {
        stage = x.c.followUpStageOverride;
      } else {
        stage = eligibleStage({
          lastInboundAt: lastInbound?.createdAt ?? null,
          lastMessageOutbound: true, // already filtered to ghosted
          isClosed: x.c.status === "closed" || recaps[i] != null,
          touchCount: touches[i].count,
          lastTouchAt: touches[i].lastAt,
          now,
        });
      }
      if (stage == null || lastInbound == null) return;
      eligible.push({ c: x.c, stage, lastInboundAt: lastInbound.createdAt, touchAts: touches[i].ats, lastMessageText: x.lastMsg?.content ?? "" });
    });

    // Dedupe per customer: one follow-up per phone (a customer with several ghosted orders shouldn't
    // get several templates). Keep the most recently active order as the representative.
    const byPhone = new Map<string, typeof eligible[number]>();
    for (const e of eligible) {
      const prev = byPhone.get(e.c.customerPhone);
      if (!prev || e.lastInboundAt > prev.lastInboundAt) byPhone.set(e.c.customerPhone, e);
    }
    const deduped = [...byPhone.values()];

    // Product name only for the final candidates.
    const orders = await Promise.all(
      deduped.map((e) => ctx.db.query("orders").withIndex("by_org_orderId", (q: any) => q.eq("orgId", args.orgId).eq("orderId", e.c.orderId)).first()),
    );
    const stage1: Candidate[] = [];
    const stage2: Candidate[] = [];
    const stage3: Candidate[] = [];
    deduped.forEach((e, i) => {
      const card: Candidate = {
        conversationId: e.c._id, customerName: e.c.customerName, customerPhone: e.c.customerPhone,
        productName: orders[i]?.productName ?? "—", orderId: e.c.orderId,
        csName: e.c.assignedCsName, lastInboundAt: e.lastInboundAt, touchAts: e.touchAts, lastMessageText: e.lastMessageText,
      };
      (e.stage === 1 ? stage1 : e.stage === 2 ? stage2 : stage3).push(card);
    });
    stage1.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    stage2.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    stage3.sort((a, b) => a.lastInboundAt - b.lastInboundAt);
    return { stage1, stage2, stage3 };
}

export const getFollowUpCandidatesDiagnostic = internalQuery({
  args: {
    orgId: v.id("organizations"),
    csName: v.optional(v.string()),
    nowOverride: v.optional(v.number()),
  },
  handler: followUpCandidatesHandler,
});

export const archiveFollowUp = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.archiveFollowUp");
    const c = await ctx.db.get(args.conversationId);
    if (!c || String(c.orgId) !== String(orgId)) throw new Error("Percakapan tidak ditemukan.");
    if (viewer.role === "cs" && (!effectiveCsName || csKey(c.assignedCsName) !== csKey(effectiveCsName))) {
      throw new Error("unauthorized: conversation scope mismatch");
    }
    const now = Date.now();
    await ctx.db.patch(args.conversationId, {
      status: "closed",
      followUpArchivedAt: now,
      followUpNextStage: undefined,
      followUpDueAt: undefined,
      followUpState: "archived",
      followUpRequestId: undefined,
      followUpLastError: undefined,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

// Feature #2: undo archive
export const unarchiveFollowUp = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const { viewer, orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.unarchiveFollowUp");
    const c = await ctx.db.get(args.conversationId);
    if (!c || String(c.orgId) !== String(orgId)) throw new Error("Percakapan tidak ditemukan.");
    if (viewer.role === "cs" && (!effectiveCsName || csKey(c.assignedCsName) !== csKey(effectiveCsName))) {
      throw new Error("unauthorized: conversation scope mismatch");
    }
    const now = Date.now();
    await ctx.db.patch(args.conversationId, {
      status: "active",
      followUpArchivedAt: undefined,
      followUpNextStage: undefined,
      followUpDueAt: undefined,
      followUpState: undefined,
      followUpRequestId: undefined,
      followUpLastError: undefined,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

// Legacy diagnostic used by bounded migration/parity tests. It never sends messages.
export const candidacyFor = internalQuery({
  args: { conversationId: v.id("conversations"), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    if (!c) return null;
    const now = args.nowOverride ?? Date.now();
    const recap = await ctx.db.query("shippingRecaps").withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", c.orgId).eq("orderIdBerdu", c.orderId)).first();
    const lastMsg = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").first();
    const lastInbound = await ctx.db.query("messages").withIndex("by_conversation_direction_createdAt", (q) => q.eq("conversationId", c._id).eq("direction", "inbound")).order("desc").first();
    const order = await ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", c.orgId).eq("orderId", c.orderId)).first();
    const normName = normalizeCsName(c.assignedCsName);
    let cfg = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", c.orgId).eq("normalizedName", normName)).first();
    if (!cfg || !cfg.providerNumberId) {
      const k = csKey(c.assignedCsName);
      cfg = await ctx.db.query("csConfigs").withIndex("by_org_key", (q) => q.eq("orgId", c.orgId).eq("key", k)).first() ?? cfg;
      if (!cfg?.providerNumberId) {
        const legacy = await getBoundedActiveAgentRegistry(ctx, c.orgId);
        if (legacy) cfg = legacy.find((x) => x.key == null && csKey(x.csName) === k && x.providerNumberId) ?? cfg;
      }
    }
    const touch = await touchInfo(ctx, c._id, lastInbound?.createdAt ?? null);
    const eligible = eligibleStage({
      lastInboundAt: lastInbound?.createdAt ?? null,
      lastMessageOutbound: lastMsg != null && lastMsg.direction === "outbound",
      isClosed: c.status === "closed" || recap != null,
      touchCount: touch.count,
      lastTouchAt: touch.lastAt,
      now,
    });
    return {
      eligible,
      phoneNumberId: cfg?.providerNumberId ?? null,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      orderId: c.orderId,
      productName: order?.productName ?? "—",
    };
  },
});

export const getArchivedFollowUps = query({
  args: { csName: v.optional(v.string()), nowOverride: v.optional(v.number()) },
  returns: v.array(v.object({
    conversationId: v.id("conversations"),
    customerName: v.string(),
    customerPhone: v.string(),
    orderId: v.string(),
    csName: v.string(),
    followUpArchivedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.getArchivedFollowUps", args.csName);
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const now = args.nowOverride ?? Date.now();
    const DAY = 86_400_000;
    const since = now - 14 * DAY;
    const csKeyMemo = effectiveCsName ? csKey(effectiveCsName) : null;

    // Manual archive sets status="closed" + followUpArchivedAt, so read only recently-closed
    // conversations via the index (NOT a full-table .filter().collect() scan) then keep the
    // ones that were actually archived. Bounds reads to recent closed convs.
    const archived = await collectExactBounded(ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q) => q.eq("orgId", orgId).eq("status", "closed").gte("updatedAt", since))
      , "followUp archived conversations");

    const filtered = archived
      .filter((c) => c.followUpArchivedAt != null)
      .filter((c) => !isInternalTestPhone(c.customerPhone, internalPhones))
      .filter((c) => (csKeyMemo ? csKey(c.assignedCsName) === csKeyMemo : true));

    type ArchivedRow = {
      conversationId: typeof archived[0]["_id"];
      customerName: string;
      customerPhone: string;
      orderId: string;
      csName: string;
      followUpArchivedAt: number;
    };
    const result: ArchivedRow[] = filtered.map((c) => ({
      conversationId: c._id,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      orderId: c.orderId,
      csName: c.assignedCsName,
      followUpArchivedAt: c.followUpArchivedAt!,
    }));

    result.sort((a, b) => b.followUpArchivedAt - a.followUpArchivedAt);
    return result;
  },
});

// Feature #10: KPI — follow-up effectiveness
export const getFollowUpEffectiveness = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  returns: v.object({
    totalClosings: v.number(),
    fromFollowUp: v.number(),
    byStage: v.object({ h1: v.number(), h2: v.number(), h3: v.number() }),
  }),
  handler: async (ctx, args) => {
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.getFollowUpEffectiveness", args.csName);
    return computeFollowUpEffectiveness(ctx, orgId, { ...args, csName: effectiveCsName });
  },
});

async function computeFollowUpEffectiveness(
  ctx: any,
  orgId: Id<"organizations">,
  args: { startAt: number; endAt: number; csName?: string },
) {
  assertPublicAnalyticsRange(args.startAt, args.endAt, "followUp.getFollowUpEffectiveness");
  const requestedCsKey = args.csName ? csKey(args.csName) : undefined;
  const result = { totalClosings: 0, fromFollowUp: 0, byStage: { h1: 0, h2: 0, h3: 0 } };
  let windowKey = windowKeyFor(args.startAt);
  const lastWindowKey = windowKeyFor(args.endAt - 1);

  while (windowKey <= lastWindowKey) {
    const window = windowRangeForKey(windowKey);
    const startAt = Math.max(args.startAt, window.startAt);
    const endAt = Math.min(args.endAt, window.endAt);
    const marker = await ctx.db
      .query("rollupWindows")
      .withIndex("by_org_windowKey", (q: any) => q.eq("orgId", orgId).eq("windowKey", windowKey))
      .unique();
    const canUseRollup = startAt === window.startAt
      && endAt === window.endAt
      && window.endAt <= Date.now()
      && marker?.schemaVersion === ROLLUP_SCHEMA_VERSION;

    if (canUseRollup) {
      const rows = await (requestedCsKey
        ? ctx.db.query("dailyRollups").withIndex("by_org_window_cs", (q: any) => q
          .eq("orgId", orgId).eq("windowKey", windowKey).eq("csKey", requestedCsKey))
        : ctx.db.query("dailyRollups").withIndex("by_org_windowKey", (q: any) => q
          .eq("orgId", orgId).eq("windowKey", windowKey)))
        .take(101);
      if (rows.length > 100) throw new Error("Terlalu banyak baris rollup CS untuk satu hari.");
      for (const row of rows) {
        result.totalClosings += row.closings;
        result.fromFollowUp += row.fuClosings;
        result.byStage.h1 += row.fuH1;
        result.byStage.h2 += row.fuH2;
        result.byStage.h3 += row.fuH3;
      }
    } else {
      const raw = await computeFollowUpEffectivenessRaw(ctx, orgId, { startAt, endAt, csName: args.csName });
      result.totalClosings += raw.totalClosings;
      result.fromFollowUp += raw.fromFollowUp;
      result.byStage.h1 += raw.byStage.h1;
      result.byStage.h2 += raw.byStage.h2;
      result.byStage.h3 += raw.byStage.h3;
    }

    const [year, month, day] = windowKey.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    windowKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return result;
}

export async function computeFollowUpEffectivenessRaw(
  ctx: any,
  orgId: Id<"organizations">,
  args: { startAt: number; endAt: number; csName?: string },
) {
  assertPublicAnalyticsRange(args.startAt, args.endAt, "followUp.getFollowUpEffectiveness");
  const internalPhones = await getInternalPhoneSet(ctx, orgId);
  const key = args.csName ? csKey(args.csName) : null;
  const recaps = (
    await collectExactBounded(ctx.db.query("shippingRecaps")
      .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", args.startAt).lt("closedAt", args.endAt)),
      "followUp.getFollowUpEffectiveness recaps")
  ).filter((recap: any) => recap.status !== "cancelled" && recap.status !== "cancelled_after_export"
    && !isInternalTestPhone(recap.customerPhone, internalPhones) && (!key || csKey(recap.csName) === key));
  const latestByClosing = new Map<string, any>();
  for (const recap of recaps) {
    const closingKey = recap.orderIdBerdu || normalizePhone(recap.customerPhone);
    const existing = latestByClosing.get(closingKey);
    if (!existing || recap.closedAt > existing.closedAt) latestByClosing.set(closingKey, recap);
  }
  const closings = Array.from(latestByClosing.values());
  const byStage = { h1: 0, h2: 0, h3: 0 };
  let fromFollowUp = 0;
  for (const recap of closings) {
    const touches = recap.followUpTouchesAtClose ?? 0;
    if (touches >= 1) fromFollowUp++;
    if (touches === 1) byStage.h1++;
    else if (touches === 2) byStage.h2++;
    else if (touches >= 3) byStage.h3++;
  }
  return { totalClosings: closings.length, fromFollowUp, byStage };
}

// "Closing" tab: recent closings so CS can see where a lead WENT after it dropped out of the funnel
// (PEMESANAN BERHASIL / marker → status closed → vanishes from H+1/2/3). Read-only over shippingRecaps;
// a lead that closed after ≥1 follow-up touch gets fromFollowUp=true so the funnel's effect is visible.
export const getClosedFollowUps = query({
  args: { csName: v.optional(v.string()), sinceDays: v.optional(v.number()), nowOverride: v.optional(v.number()) },
  returns: v.array(v.object({
    conversationId: v.optional(v.id("conversations")),
    customerName: v.string(),
    customerPhone: v.string(),
    csName: v.string(),
    orderId: v.string(),
    closedAt: v.number(),
    product: v.string(),
    touches: v.number(),
    fromFollowUp: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const { orgId, effectiveCsName } = await requireScopedMemberOrg(ctx, "followUp.getClosedFollowUps", args.csName);
    const internalPhones = await getInternalPhoneSet(ctx, orgId);
    const now = args.nowOverride ?? Date.now();
    const DAY = 86_400_000;
    const sinceDays = args.sinceDays ?? 7;
    if (!Number.isFinite(sinceDays) || sinceDays < 0 || sinceDays > 35) {
      throw new Error("followUp.getClosedFollowUps: range exceeds 35 days");
    }
    const since = now - sinceDays * DAY;
    const csKeyMemo = effectiveCsName ? csKey(effectiveCsName) : null;

    // This tab is an operational preview, not an export. Read newest-first and
    // cap at a small multiple of the visible 300 rows so high-volume tenants do
    // not crash the whole client before cancelled/internal rows are removed.
    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", since).lt("closedAt", now))
      .order("desc")
      .take(600);

    const filtered = recaps
      .filter((r) => r.status !== "cancelled" && r.status !== "cancelled_after_export")
      .filter((r) => !isInternalTestPhone(r.customerPhone, internalPhones))
      .filter((r) => (csKeyMemo ? csKey(r.csName) === csKeyMemo : true));

    type ClosedRow = {
      conversationId: typeof filtered[number]["conversationId"];
      customerName: string;
      customerPhone: string;
      csName: string;
      orderId: string;
      closedAt: number;
      product: string;
      touches: number;
      fromFollowUp: boolean;
    };
    const rows: ClosedRow[] = filtered.map((r) => {
      const touches = r.followUpTouchesAtClose ?? 0;
      return {
        conversationId: r.conversationId, // for "view chat history" on a closed lead
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        csName: r.csName,
        orderId: r.orderIdBerdu ?? "",
        closedAt: r.closedAt,
        product: r.packageContent ?? "",
        touches,
        fromFollowUp: touches >= 1,
      };
    });

    return rows.slice(0, 300);
  },
});
