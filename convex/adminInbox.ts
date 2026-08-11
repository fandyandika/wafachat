import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireAdminOrg } from "./authz";
import {
  adminWindowExpiresAt,
  isAdminWindowOpen,
  normalizeAdminRecipient,
  normalizeOptionalAdminTotal,
  validateTemplateValues,
} from "./adminInboxModel";
import { cancelRecapByExactOrderCore, undoExactOrderCancellationCore } from "./shippingRecaps";
import { buildTemplatePayload, buildTextPayload, sendKirimDevMessage } from "../lib/kirimdev";
import type { Id } from "./_generated/dataModel";
import { canAssignProviderNumberId } from "./agents";

type SendActionResult = { ok: boolean; duplicate?: boolean; messageId?: Id<"adminThreadMessages">; error?: string; statusUnknown?: boolean };

const variableValidator = v.object({
  key: v.string(),
  label: v.string(),
  required: v.boolean(),
});

const channelResultValidator = v.object({
  id: v.id("adminChannels"),
  name: v.string(),
  provider: v.literal("kirimdev"),
  displayPhone: v.optional(v.string()),
  providerNumberId: v.optional(v.string()),
  isActive: v.boolean(),
});

const templateResultValidator = v.object({
  id: v.id("adminTemplates"),
  channelId: v.id("adminChannels"),
  label: v.string(),
  templateName: v.string(),
  language: v.string(),
  category: v.literal("expedition"),
  variables: v.array(variableValidator),
  isActive: v.boolean(),
});

const setupResultValidator = v.object({
  channel: v.union(v.null(), channelResultValidator),
  templates: v.array(templateResultValidator),
  ready: v.boolean(),
  missing: v.array(v.string()),
});

const threadResultValidator = v.object({
  id: v.id("adminThreads"),
  channelId: v.id("adminChannels"),
  customerPhone: v.string(),
  customerName: v.optional(v.string()),
  productName: v.optional(v.string()),
  totalAmount: v.optional(v.number()),
  orderId: v.optional(v.string()),
  lastInboundAt: v.optional(v.number()),
  lastOutboundAt: v.optional(v.number()),
  archived: v.boolean(),
  archivedAt: v.optional(v.number()),
  windowExpiresAt: v.optional(v.number()),
  windowOpen: v.boolean(),
  updatedAt: v.number(),
});

const messageResultValidator = v.object({
  id: v.id("adminThreadMessages"),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  messageType: v.union(v.literal("template"), v.literal("text")),
  content: v.string(),
  templateName: v.optional(v.string()),
  providerMessageId: v.optional(v.string()),
  status: v.union(
    v.literal("queued"),
    v.literal("accepted"),
    v.literal("delivered"),
    v.literal("read"),
    v.literal("unknown"),
    v.literal("failed"),
  ),
  failureReason: v.optional(v.string()),
  actorName: v.optional(v.string()),
  createdAt: v.number(),
});

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} wajib diisi.`);
  return cleaned;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function validateTemplateName(value: string): string {
  const cleaned = cleanRequired(value, "Template name");
  if (!/^[a-z0-9_]+$/.test(cleaned)) {
    throw new Error("Template name hanya boleh berisi huruf kecil, angka, dan underscore.");
  }
  return cleaned;
}

function validateVariables(variables: Array<{ key: string; label: string; required: boolean }>) {
  const seen = new Set<string>();
  return variables.map((variable) => {
    const key = cleanRequired(variable.key, "Key variabel");
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error("Key variabel harus diawali huruf dan hanya berisi huruf, angka, atau underscore.");
    }
    if (seen.has(key)) throw new Error(`Key variabel duplikat: ${key}.`);
    seen.add(key);
    return { key, label: cleanRequired(variable.label, "Label variabel"), required: variable.required };
  });
}

function requireServerSecret(authSecret: string) {
  if (!process.env.PANEL_AUTH_SECRET || authSecret !== process.env.PANEL_AUTH_SECRET) {
    throw new Error("unauthorized");
  }
}

function cleanRequestId(value: string): string {
  const cleaned = cleanRequired(value, "Request ID");
  if (cleaned.length > 160) throw new Error("Request ID terlalu panjang.");
  return cleaned;
}

const preparedTemplateValidator = v.object({
  shouldSend: v.boolean(),
  status: v.union(v.literal("queued"), v.literal("accepted"), v.literal("delivered"), v.literal("read"), v.literal("unknown"), v.literal("failed")),
  messageId: v.id("adminThreadMessages"),
  customerPhone: v.string(),
  providerNumberId: v.string(),
  templateName: v.string(),
  language: v.string(),
  orderedValues: v.array(v.string()),
  idempotencyKey: v.string(),
});

const preparedTextValidator = v.object({
  shouldSend: v.boolean(),
  status: v.union(v.literal("queued"), v.literal("accepted"), v.literal("delivered"), v.literal("read"), v.literal("unknown"), v.literal("failed")),
  messageId: v.id("adminThreadMessages"),
  customerPhone: v.string(),
  providerNumberId: v.string(),
  text: v.string(),
  idempotencyKey: v.string(),
});

const sendResultValidator = v.object({
  ok: v.boolean(),
  duplicate: v.optional(v.boolean()),
  messageId: v.optional(v.id("adminThreadMessages")),
  error: v.optional(v.string()),
  statusUnknown: v.optional(v.boolean()),
});

const linkedOrderStatusValidator = v.union(
  v.literal("ready"),
  v.literal("needs_review"),
  v.literal("exported"),
  v.literal("delivered"),
  v.literal("cancelled"),
  v.literal("cancelled_after_export"),
);

function normalizeLinkedOrderId(value: string): string {
  const cleaned = value.trim();
  return cleaned.startsWith("O-") ? cleaned : `O-${cleaned}`;
}

export const getSetup = query({
  args: {},
  returns: setupResultValidator,
  handler: async (ctx) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.getSetup");
    const channels = await ctx.db
      .query("adminChannels")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(2);
    if (channels.length > 1) throw new Error("Phase one supports one admin channel per organization.");
    const channel = channels[0] ?? null;
    const templateRows = channel
      ? await ctx.db
          .query("adminTemplates")
          .withIndex("by_org_channel", (q) => q.eq("orgId", orgId).eq("channelId", channel._id))
          .take(51)
      : [];
    if (templateRows.length > 50) throw new Error("Admin template limit exceeded.");

    const templates = templateRows
      .sort((a, b) => a.label.localeCompare(b.label, "id"))
      .map((row) => ({
        id: row._id,
        channelId: row.channelId,
        label: row.label,
        templateName: row.templateName,
        language: row.language,
        category: row.category,
        variables: row.variables,
        isActive: row.isActive,
      }));
    const missing: string[] = [];
    if (!channel) missing.push("Channel admin");
    else {
      if (!channel.isActive) missing.push("Channel aktif");
      if (!channel.providerNumberId) missing.push("Nomor API KirimDev");
    }
    if (!templates.some((template) => template.isActive)) missing.push("Template ekspedisi aktif");
    if (!process.env.KIRIMDEV_API_KEY) missing.push("KIRIMDEV_API_KEY");

    return {
      channel: channel
        ? {
            id: channel._id,
            name: channel.name,
            provider: channel.provider,
            displayPhone: channel.displayPhone,
            providerNumberId: channel.providerNumberId,
            isActive: channel.isActive,
          }
        : null,
      templates,
      ready: missing.length === 0,
      missing,
    };
  },
});

export const upsertChannel = mutation({
  args: {
    name: v.string(),
    displayPhone: v.optional(v.string()),
    providerNumberId: v.optional(v.string()),
    isActive: v.boolean(),
  },
  returns: v.object({ success: v.literal(true), channelId: v.id("adminChannels") }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.upsertChannel");
    const rows = await ctx.db
      .query("adminChannels")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(2);
    if (rows.length > 1) throw new Error("Phase one supports one admin channel per organization.");
    const existing = rows[0];

    const providerNumberId = cleanOptional(args.providerNumberId);
    if (providerNumberId && existing?.providerNumberId !== providerNumberId) {
      if (!await canAssignProviderNumberId(ctx, orgId, providerNumberId)) {
        throw new Error("providerNumberId is already assigned or cannot be proven unique.");
      }
    }

    const now = Date.now();
    const patch = {
      name: cleanRequired(args.name, "Nama channel"),
      provider: "kirimdev" as const,
      displayPhone: cleanOptional(args.displayPhone),
      providerNumberId,
      isActive: args.isActive,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { success: true as const, channelId: existing._id };
    }
    const channelId = await ctx.db.insert("adminChannels", { ...patch, orgId, createdAt: now });
    return { success: true as const, channelId };
  },
});

export const upsertTemplate = mutation({
  args: {
    channelId: v.id("adminChannels"),
    templateId: v.optional(v.id("adminTemplates")),
    label: v.string(),
    templateName: v.string(),
    language: v.string(),
    variables: v.array(variableValidator),
    isActive: v.boolean(),
  },
  returns: v.object({ success: v.literal(true), templateId: v.id("adminTemplates") }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.upsertTemplate");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || String(channel.orgId) !== String(orgId)) throw new Error("Admin channel not found.");
    const now = Date.now();
    const patch = {
      channelId: channel._id,
      label: cleanRequired(args.label, "Label template"),
      templateName: validateTemplateName(args.templateName),
      language: cleanRequired(args.language, "Bahasa template"),
      category: "expedition" as const,
      variables: validateVariables(args.variables),
      isActive: args.isActive,
      updatedAt: now,
    };

    if (args.templateId) {
      const existing = await ctx.db.get(args.templateId);
      if (!existing || String(existing.orgId) !== String(orgId) || String(existing.channelId) !== String(channel._id)) {
        throw new Error("Admin template not found.");
      }
      await ctx.db.patch(existing._id, patch);
      return { success: true as const, templateId: existing._id };
    }

    const templateId = await ctx.db.insert("adminTemplates", { ...patch, orgId, createdAt: now });
    return { success: true as const, templateId };
  },
});

export const removeTemplate = mutation({
  args: { templateId: v.id("adminTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.removeTemplate");
    const template = await ctx.db.get(args.templateId);
    if (!template || String(template.orgId) !== String(orgId)) throw new Error("Admin template not found.");
    await ctx.db.delete(template._id);
    return null;
  },
});

export const listThreads = query({
  args: {
    channelId: v.id("adminChannels"),
    paginationOpts: paginationOptsValidator,
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.object({
    page: v.array(threadResultValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.listThreads");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || String(channel.orgId) !== String(orgId)) throw new Error("Admin channel not found.");
    const numItems = Math.max(1, Math.min(args.paginationOpts.numItems, 50));
    const paginationOpts = { cursor: args.paginationOpts.cursor, numItems };
    const result = args.includeArchived
      ? await ctx.db
          .query("adminThreads")
          .withIndex("by_org_channel_updatedAt", (q) => q.eq("orgId", orgId).eq("channelId", channel._id))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("adminThreads")
          .withIndex("by_org_channel_archived_updatedAt", (q) => q.eq("orgId", orgId).eq("channelId", channel._id).eq("archived", false))
          .order("desc")
          .paginate(paginationOpts);
    const now = Date.now();
    return {
      page: result.page.map((row) => ({
        id: row._id,
        channelId: row.channelId,
        customerPhone: row.customerPhone,
        customerName: row.customerName,
        productName: row.productName,
        totalAmount: row.totalAmount,
        orderId: row.orderId,
        lastInboundAt: row.lastInboundAt,
        lastOutboundAt: row.lastOutboundAt,
        archived: row.archived,
        archivedAt: row.archivedAt,
        windowExpiresAt: adminWindowExpiresAt(row.lastInboundAt),
        windowOpen: isAdminWindowOpen(row.lastInboundAt, now),
        updatedAt: row.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listMessages = query({
  args: { threadId: v.id("adminThreads"), limit: v.optional(v.number()) },
  returns: v.array(messageResultValidator),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.listMessages");
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(orgId)) throw new Error("Admin thread not found.");
    const requested = args.limit ?? 50;
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 100)) : 50;
    const rows = await ctx.db
      .query("adminThreadMessages")
      .withIndex("by_org_thread_createdAt", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
      .order("desc")
      .take(limit);
    return rows.reverse().map((row) => ({
      id: row._id,
      direction: row.direction,
      messageType: row.messageType,
      content: row.content,
      templateName: row.templateName,
      providerMessageId: row.providerMessageId,
      status: row.status,
      failureReason: row.failureReason,
      actorName: row.actorName,
      createdAt: row.createdAt,
    }));
  },
});

export const archiveThread = mutation({
  args: { threadId: v.id("adminThreads"), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.archiveThread");
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(orgId)) throw new Error("Admin thread not found.");
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      archived: args.archived,
      archivedAt: args.archived ? now : undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const getLinkedOrderState = query({
  args: { threadId: v.id("adminThreads") },
  returns: v.union(v.null(), v.object({
    recapId: v.id("shippingRecaps"),
    orderId: v.string(),
    status: linkedOrderStatusValidator,
    cancelReason: v.optional(v.string()),
    canUndo: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "adminInbox.getLinkedOrderState");
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(orgId) || !thread.orderId) return null;
    const rows = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", orgId).eq("orderIdBerdu", normalizeLinkedOrderId(thread.orderId!)))
      .take(2);
    if (rows.length !== 1) return null;
    return { recapId: rows[0]._id, orderId: rows[0].orderIdBerdu ?? normalizeLinkedOrderId(thread.orderId), status: rows[0].status, cancelReason: rows[0].cancelReason, canUndo: rows[0].cancelPreviousStatus !== undefined };
  },
});

export const cancelLinkedOrder = mutation({
  args: { threadId: v.id("adminThreads"), reason: v.string() },
  returns: v.object({ success: v.literal(true), recapId: v.id("shippingRecaps"), orderId: v.string(), status: linkedOrderStatusValidator }),
  handler: async (ctx, args) => {
    const { viewer, orgId } = await requireAdminOrg(ctx, "adminInbox.cancelLinkedOrder");
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(orgId)) throw new Error("Admin thread not found.");
    if (!thread.orderId) throw new Error("Percakapan belum memiliki ID order.");
    const result = await cancelRecapByExactOrderCore(ctx, {
      orgId,
      orderIdBerdu: thread.orderId,
      reason: args.reason,
      actor: { userId: viewer.subject, name: viewer.name },
    });
    return { success: true as const, recapId: result.recapId, orderId: result.orderIdBerdu, status: result.status };
  },
});

export const undoLinkedOrderCancellation = mutation({
  args: { threadId: v.id("adminThreads") },
  returns: v.object({ success: v.literal(true), recapId: v.id("shippingRecaps"), orderId: v.string(), status: linkedOrderStatusValidator }),
  handler: async (ctx, args) => {
    const { viewer, orgId } = await requireAdminOrg(ctx, "adminInbox.undoLinkedOrderCancellation");
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(orgId)) throw new Error("Admin thread not found.");
    if (!thread.orderId) throw new Error("Percakapan belum memiliki ID order.");
    const result = await undoExactOrderCancellationCore(ctx, {
      orgId,
      orderIdBerdu: thread.orderId,
      actor: { userId: viewer.subject, name: viewer.name },
    });
    return { success: true as const, recapId: result.recapId, orderId: result.orderIdBerdu, status: result.status };
  },
});

export const prepareTemplateSend = mutation({
  args: {
    authSecret: v.string(),
    orgId: v.id("organizations"),
    actorUserId: v.string(),
    actorName: v.string(),
    channelId: v.id("adminChannels"),
    customerPhone: v.string(),
    customerName: v.optional(v.string()),
    productName: v.optional(v.string()),
    totalAmount: v.optional(v.number()),
    orderId: v.optional(v.string()),
    templateId: v.id("adminTemplates"),
    values: v.array(v.object({ key: v.string(), value: v.string() })),
    clientRequestId: v.string(),
  },
  returns: preparedTemplateValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.authSecret);
    const requestId = cleanRequestId(args.clientRequestId);
    const existing = await ctx.db
      .query("adminThreadMessages")
      .withIndex("by_org_clientRequestId", (q) => q.eq("orgId", args.orgId).eq("clientRequestId", requestId))
      .first();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      const channel = thread ? await ctx.db.get(thread.channelId) : null;
      const template = existing.templateName
        ? await ctx.db
            .query("adminTemplates")
            .withIndex("by_org_channel", (q) => q.eq("orgId", args.orgId).eq("channelId", args.channelId))
            .filter((q) => q.eq(q.field("templateName"), existing.templateName))
            .first()
        : null;
      if (!thread || !channel?.providerNumberId || !template) throw new Error("Riwayat pengiriman tidak lengkap.");
      return {
        shouldSend: false,
        status: existing.status,
        messageId: existing._id,
        customerPhone: thread.customerPhone,
        providerNumberId: channel.providerNumberId,
        templateName: template.templateName,
        language: template.language,
        orderedValues: [],
        idempotencyKey: `admin-template-${args.orgId}-${requestId}`,
      };
    }

    const channel = await ctx.db.get(args.channelId);
    if (!channel || String(channel.orgId) !== String(args.orgId)) throw new Error("Admin channel not found.");
    if (!channel.isActive) throw new Error("Admin channel belum aktif.");
    if (!channel.providerNumberId) throw new Error("Nomor API KirimDev belum dikonfigurasi.");
    const template = await ctx.db.get(args.templateId);
    if (!template || String(template.orgId) !== String(args.orgId) || String(template.channelId) !== String(channel._id)) {
      throw new Error("Admin template not found.");
    }
    if (!template.isActive) throw new Error("Admin template belum aktif.");

    const valueMap: Record<string, string> = {};
    for (const entry of args.values) {
      if (Object.prototype.hasOwnProperty.call(valueMap, entry.key)) throw new Error(`Nilai template duplikat: ${entry.key}.`);
      valueMap[entry.key] = entry.value;
    }
    const validated = validateTemplateValues(template.variables, valueMap);
    if (!validated.ok) throw new Error(validated.error);
    const customerPhone = normalizeAdminRecipient(args.customerPhone);
    const customerName = cleanOptional(args.customerName);
    const productName = cleanOptional(args.productName);
    const totalAmount = normalizeOptionalAdminTotal(args.totalAmount);
    const now = Date.now();
    let thread = await ctx.db
      .query("adminThreads")
      .withIndex("by_org_channel_customerPhone", (q) => q.eq("orgId", args.orgId).eq("channelId", channel._id).eq("customerPhone", customerPhone))
      .unique();
    if (!thread) {
      const threadId = await ctx.db.insert("adminThreads", {
        orgId: args.orgId,
        channelId: channel._id,
        customerPhone,
        customerName,
        productName,
        totalAmount,
        orderId: cleanOptional(args.orderId),
        lastOutboundAt: now,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
    } else {
      await ctx.db.patch(thread._id, {
        customerName: customerName ?? thread.customerName,
        productName: productName ?? thread.productName,
        totalAmount: totalAmount ?? thread.totalAmount,
        orderId: cleanOptional(args.orderId) ?? thread.orderId,
        lastOutboundAt: now,
        archived: false,
        archivedAt: undefined,
        updatedAt: now,
      });
    }
    if (!thread) throw new Error("Admin thread insert failed.");
    const messageId = await ctx.db.insert("adminThreadMessages", {
      orgId: args.orgId,
      threadId: thread._id,
      direction: "outbound",
      messageType: "template",
      content: `[Template] ${template.label}`,
      templateName: template.templateName,
      clientRequestId: requestId,
      status: "queued",
      actorUserId: cleanRequired(args.actorUserId, "Actor user ID"),
      actorName: cleanRequired(args.actorName, "Nama admin"),
      createdAt: now,
      updatedAt: now,
    });
    return {
      shouldSend: true,
      status: "queued" as const,
      messageId,
      customerPhone,
      providerNumberId: channel.providerNumberId,
      templateName: template.templateName,
      language: template.language,
      orderedValues: validated.ordered,
      idempotencyKey: `admin-template-${args.orgId}-${requestId}`,
    };
  },
});

export const prepareTextSend = mutation({
  args: {
    authSecret: v.string(),
    orgId: v.id("organizations"),
    actorUserId: v.string(),
    actorName: v.string(),
    threadId: v.id("adminThreads"),
    text: v.string(),
    clientRequestId: v.string(),
  },
  returns: preparedTextValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.authSecret);
    const requestId = cleanRequestId(args.clientRequestId);
    const text = cleanRequired(args.text, "Pesan");
    if (text.length > 4096) throw new Error("Pesan terlalu panjang.");
    const existing = await ctx.db
      .query("adminThreadMessages")
      .withIndex("by_org_clientRequestId", (q) => q.eq("orgId", args.orgId).eq("clientRequestId", requestId))
      .first();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      const channel = thread ? await ctx.db.get(thread.channelId) : null;
      if (!thread || !channel?.providerNumberId) throw new Error("Riwayat pengiriman tidak lengkap.");
      return {
        shouldSend: false,
        status: existing.status,
        messageId: existing._id,
        customerPhone: thread.customerPhone,
        providerNumberId: channel.providerNumberId,
        text: existing.content,
        idempotencyKey: `admin-text-${args.orgId}-${requestId}`,
      };
    }
    const thread = await ctx.db.get(args.threadId);
    if (!thread || String(thread.orgId) !== String(args.orgId)) throw new Error("Admin thread not found.");
    const channel = await ctx.db.get(thread.channelId);
    if (!channel || String(channel.orgId) !== String(args.orgId) || !channel.isActive) throw new Error("Admin channel belum aktif.");
    if (!channel.providerNumberId) throw new Error("Nomor API KirimDev belum dikonfigurasi.");
    const now = Date.now();
    if (!isAdminWindowOpen(thread.lastInboundAt, now)) throw new Error("Jendela balasan 24 jam sudah tertutup. Gunakan template.");
    await ctx.db.patch(thread._id, { lastOutboundAt: now, archived: false, archivedAt: undefined, updatedAt: now });
    const messageId = await ctx.db.insert("adminThreadMessages", {
      orgId: args.orgId,
      threadId: thread._id,
      direction: "outbound",
      messageType: "text",
      content: text,
      clientRequestId: requestId,
      status: "queued",
      actorUserId: cleanRequired(args.actorUserId, "Actor user ID"),
      actorName: cleanRequired(args.actorName, "Nama admin"),
      createdAt: now,
      updatedAt: now,
    });
    return {
      shouldSend: true,
      status: "queued" as const,
      messageId,
      customerPhone: thread.customerPhone,
      providerNumberId: channel.providerNumberId,
      text,
      idempotencyKey: `admin-text-${args.orgId}-${requestId}`,
    };
  },
});

export const finalizeOutbound = mutation({
  args: {
    authSecret: v.string(),
    orgId: v.id("organizations"),
    messageId: v.id("adminThreadMessages"),
    status: v.union(v.literal("accepted"), v.literal("failed"), v.literal("unknown")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.authSecret);
    const message = await ctx.db.get(args.messageId);
    if (!message || String(message.orgId) !== String(args.orgId) || message.direction !== "outbound") {
      throw new Error("Admin message not found.");
    }
    await ctx.db.patch(message._id, {
      status: args.status,
      providerMessageId: cleanOptional(args.providerMessageId),
      failureReason: cleanOptional(args.failureReason),
      updatedAt: Date.now(),
    });
    return { success: true as const };
  },
});

export const sendTemplate = action({
  args: {
    authSecret: v.string(),
    orgId: v.id("organizations"),
    actorUserId: v.string(),
    actorName: v.string(),
    channelId: v.id("adminChannels"),
    customerPhone: v.string(),
    customerName: v.optional(v.string()),
    productName: v.optional(v.string()),
    totalAmount: v.optional(v.number()),
    orderId: v.optional(v.string()),
    templateId: v.id("adminTemplates"),
    values: v.array(v.object({ key: v.string(), value: v.string() })),
    clientRequestId: v.string(),
  },
  returns: sendResultValidator,
  handler: async (ctx, args): Promise<SendActionResult> => {
    requireServerSecret(args.authSecret);
    if (!process.env.KIRIMDEV_API_KEY) return { ok: false, error: "KIRIMDEV_API_KEY belum dikonfigurasi." };
    const prepared = await ctx.runMutation(api.adminInbox.prepareTemplateSend, args);
    if (!prepared.shouldSend) {
      if (prepared.status === "unknown" || prepared.status === "queued") {
        return { ok: false, error: "Status pengiriman sebelumnya belum diketahui. Periksa riwayat sebelum mencoba lagi.", statusUnknown: true, messageId: prepared.messageId };
      }
      if (prepared.status === "failed") {
        return { ok: false, error: "Percobaan ini sebelumnya ditolak. Perbaiki data lalu kirim sebagai percobaan baru.", statusUnknown: false, messageId: prepared.messageId };
      }
      return { ok: true, duplicate: true, messageId: prepared.messageId };
    }
    const result = await sendKirimDevMessage({
      apiKey: process.env.KIRIMDEV_API_KEY,
      baseUrl: process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1",
      phoneNumberId: prepared.providerNumberId,
      payload: buildTemplatePayload(prepared.customerPhone, prepared.templateName, prepared.language, prepared.orderedValues),
      idempotencyKey: prepared.idempotencyKey,
    });
    await ctx.runMutation(api.adminInbox.finalizeOutbound, {
      authSecret: args.authSecret,
      orgId: args.orgId,
      messageId: prepared.messageId,
      status: result.ok ? "accepted" : result.statusUnknown ? "unknown" : "failed",
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      failureReason: result.ok ? undefined : result.error,
    });
    return result.ok
      ? { ok: true, duplicate: false, messageId: prepared.messageId }
      : { ok: false, error: result.error, statusUnknown: result.statusUnknown, messageId: prepared.messageId };
  },
});

export const sendText = action({
  args: {
    authSecret: v.string(),
    orgId: v.id("organizations"),
    actorUserId: v.string(),
    actorName: v.string(),
    threadId: v.id("adminThreads"),
    text: v.string(),
    clientRequestId: v.string(),
  },
  returns: sendResultValidator,
  handler: async (ctx, args): Promise<SendActionResult> => {
    requireServerSecret(args.authSecret);
    if (!process.env.KIRIMDEV_API_KEY) return { ok: false, error: "KIRIMDEV_API_KEY belum dikonfigurasi." };
    const prepared = await ctx.runMutation(api.adminInbox.prepareTextSend, args);
    if (!prepared.shouldSend) {
      if (prepared.status === "unknown" || prepared.status === "queued") {
        return { ok: false, error: "Status pengiriman sebelumnya belum diketahui. Periksa riwayat sebelum mencoba lagi.", statusUnknown: true, messageId: prepared.messageId };
      }
      if (prepared.status === "failed") {
        return { ok: false, error: "Percobaan ini sebelumnya ditolak. Perbaiki pesan lalu kirim sebagai percobaan baru.", statusUnknown: false, messageId: prepared.messageId };
      }
      return { ok: true, duplicate: true, messageId: prepared.messageId };
    }
    const result = await sendKirimDevMessage({
      apiKey: process.env.KIRIMDEV_API_KEY,
      baseUrl: process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1",
      phoneNumberId: prepared.providerNumberId,
      payload: buildTextPayload(prepared.customerPhone, prepared.text),
      idempotencyKey: prepared.idempotencyKey,
    });
    await ctx.runMutation(api.adminInbox.finalizeOutbound, {
      authSecret: args.authSecret,
      orgId: args.orgId,
      messageId: prepared.messageId,
      status: result.ok ? "accepted" : result.statusUnknown ? "unknown" : "failed",
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      failureReason: result.ok ? undefined : result.error,
    });
    return result.ok
      ? { ok: true, duplicate: false, messageId: prepared.messageId }
      : { ok: false, error: result.error, statusUnknown: result.statusUnknown, messageId: prepared.messageId };
  },
});

export async function upsertAdminInboundCore(ctx: any, args: {
  orgId: any;
  channelId: any;
  customerPhone: string;
  customerName?: string;
  orderId?: string;
  content: string;
  providerMessageId: string;
  providerEventId?: string;
  createdAt: number;
}) {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || String(channel.orgId) !== String(args.orgId)) throw new Error("Admin channel not found.");
    if (!Number.isFinite(args.createdAt) || args.createdAt < 0) throw new Error("Invalid message timestamp.");
    const phone = normalizeAdminRecipient(args.customerPhone);
    const duplicate = await ctx.db
      .query("adminThreadMessages")
      .withIndex("by_org_providerMessageId", (q: any) => q.eq("orgId", args.orgId).eq("providerMessageId", args.providerMessageId))
      .first();
    if (duplicate) return { threadId: duplicate.threadId, messageId: duplicate._id, deduped: true };

    let thread = await ctx.db
      .query("adminThreads")
      .withIndex("by_org_channel_customerPhone", (q: any) => q.eq("orgId", args.orgId).eq("channelId", channel._id).eq("customerPhone", phone))
      .unique();
    if (!thread) {
      const threadId = await ctx.db.insert("adminThreads", {
        orgId: args.orgId,
        channelId: channel._id,
        customerPhone: phone,
        customerName: cleanOptional(args.customerName),
        orderId: cleanOptional(args.orderId),
        lastInboundAt: args.createdAt,
        archived: false,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      });
      thread = await ctx.db.get(threadId);
    } else {
      await ctx.db.patch(thread._id, {
        customerName: cleanOptional(args.customerName) ?? thread.customerName,
        orderId: cleanOptional(args.orderId) ?? thread.orderId,
        lastInboundAt: Math.max(thread.lastInboundAt ?? 0, args.createdAt),
        archived: false,
        archivedAt: undefined,
        updatedAt: Math.max(thread.updatedAt, args.createdAt),
      });
    }
    if (!thread) throw new Error("Admin thread insert failed.");
    const messageId = await ctx.db.insert("adminThreadMessages", {
      orgId: args.orgId,
      threadId: thread._id,
      direction: "inbound",
      messageType: "text",
      content: args.content.trim(),
      providerMessageId: args.providerMessageId,
      providerEventId: cleanOptional(args.providerEventId),
      status: "delivered",
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
    return { threadId: thread._id, messageId, deduped: false };
}

export async function applyAdminStatusCore(ctx: any, args: {
  orgId: any;
  providerMessageId: string;
  status: "accepted" | "delivered" | "read" | "failed";
  failureReason?: string;
  updatedAt: number;
}) {
  const message = await ctx.db
    .query("adminThreadMessages")
    .withIndex("by_org_providerMessageId", (q: any) => q.eq("orgId", args.orgId).eq("providerMessageId", args.providerMessageId))
    .first();
  if (!message) return { updated: false };
  await ctx.db.patch(message._id, {
    status: args.status,
    failureReason: cleanOptional(args.failureReason),
    updatedAt: args.updatedAt,
  });
  return { updated: true };
}

export const upsertInboundMessage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    channelId: v.id("adminChannels"),
    customerPhone: v.string(),
    customerName: v.optional(v.string()),
    orderId: v.optional(v.string()),
    content: v.string(),
    providerMessageId: v.string(),
    providerEventId: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.object({
    threadId: v.id("adminThreads"),
    messageId: v.id("adminThreadMessages"),
    deduped: v.boolean(),
  }),
  handler: async (ctx, args) => await upsertAdminInboundCore(ctx, args),
});
