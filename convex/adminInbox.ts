import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdminOrg } from "./authz";

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

    const providerNumberId = cleanOptional(args.providerNumberId);
    if (providerNumberId) {
      const csClaim = await ctx.db
        .query("csConfigs")
        .withIndex("by_org_providerNumberId", (q) => q.eq("orgId", orgId).eq("providerNumberId", providerNumberId))
        .first();
      if (csClaim) throw new Error("providerNumberId is already assigned to a CS.");
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
    const existing = rows[0];
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
