import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdminOrg, requireMemberOrg } from "./authz";
import { normalizeFollowUpText } from "./followUpTriggers";

const stageValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
const variableValidator = v.union(
  v.literal("customer_name"),
  v.literal("product_name"),
  v.literal("order_id"),
);

const templateResultValidator = v.object({
  id: v.id("followUpTemplates"),
  stage: stageValidator,
  label: v.string(),
  templateName: v.string(),
  language: v.string(),
  variables: v.array(variableValidator),
  matchPatterns: v.array(v.string()),
  isActive: v.boolean(),
});

const setupResultValidator = v.object({
  templates: v.array(templateResultValidator),
  ready: v.boolean(),
  missingStages: v.array(stageValidator),
});

type FollowUpVariable = "customer_name" | "product_name" | "order_id";

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} wajib diisi.`);
  return cleaned;
}

function cleanTemplateName(value: string): string {
  const cleaned = cleanRequired(value, "Template name");
  if (!/^[a-z0-9_]+$/.test(cleaned)) {
    throw new Error("Template name hanya boleh berisi huruf kecil, angka, dan underscore.");
  }
  return cleaned;
}

function validateVariables(variables: FollowUpVariable[]): FollowUpVariable[] {
  if (variables.length > 3) throw new Error("Maksimal tiga variabel template.");
  if (new Set(variables).size !== variables.length) {
    throw new Error("Variabel template duplikat tidak diperbolehkan.");
  }
  return variables;
}

function validatePatterns(values: string[]): string[] {
  if (values.length > 10) throw new Error("Maksimal 10 pola pesan per tahap.");
  const normalized = [...new Set(values.map(normalizeFollowUpText).filter(Boolean))];
  if (normalized.some((value) => value.length < 8 || value.length > 200)) {
    throw new Error("Pola pesan harus 8–200 karakter.");
  }
  return normalized;
}

export const getFollowUpTemplateSetup = query({
  args: {},
  returns: setupResultValidator,
  handler: async (ctx) => {
    const { orgId } = await requireMemberOrg(ctx, "followUpTemplates.getFollowUpTemplateSetup");
    const rows = await ctx.db
      .query("followUpTemplates")
      .withIndex("by_org_stage", (q) => q.eq("orgId", orgId))
      .take(4);
    if (rows.length > 3) throw new Error("Konfigurasi template Follow-up tidak valid.");

    const templates = rows
      .sort((a, b) => a.stage - b.stage)
      .map((row) => ({
        id: row._id,
        stage: row.stage,
        label: row.label,
        templateName: row.templateName,
        language: row.language,
        variables: row.variables,
        matchPatterns: row.matchPatterns ?? [],
        isActive: row.isActive,
      }));
    const activeStages = new Set(templates.filter((row) => row.isActive).map((row) => row.stage));
    const missingStages = ([1, 2, 3] as const).filter((stage) => !activeStages.has(stage));
    return { templates, ready: missingStages.length === 0, missingStages };
  },
});

export const upsertFollowUpTemplate = mutation({
  args: {
    stage: stageValidator,
    label: v.string(),
    templateName: v.string(),
    language: v.string(),
    variables: v.array(variableValidator),
    matchPatterns: v.optional(v.array(v.string())),
    isActive: v.boolean(),
  },
  returns: v.object({ success: v.literal(true), templateId: v.id("followUpTemplates") }),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpTemplates.upsertFollowUpTemplate");
    const matches = await ctx.db
      .query("followUpTemplates")
      .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", args.stage))
      .take(2);
    if (matches.length > 1) throw new Error(`Template H+${args.stage} duplikat.`);

    const now = Date.now();
    const patch = {
      label: cleanRequired(args.label, "Label"),
      templateName: cleanTemplateName(args.templateName),
      language: cleanRequired(args.language, "Bahasa"),
      variables: validateVariables(args.variables),
      matchPatterns: validatePatterns(args.matchPatterns ?? []),
      isActive: args.isActive,
      updatedAt: now,
    };
    const existing = matches[0];
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { success: true as const, templateId: existing._id };
    }
    const templateId = await ctx.db.insert("followUpTemplates", {
      ...patch,
      orgId,
      stage: args.stage,
      createdAt: now,
    });
    return { success: true as const, templateId };
  },
});

export const removeFollowUpTemplate = mutation({
  args: { templateId: v.id("followUpTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireAdminOrg(ctx, "followUpTemplates.removeFollowUpTemplate");
    const template = await ctx.db.get(args.templateId);
    if (!template || String(template.orgId) !== String(orgId)) {
      throw new Error("Template Follow-up tidak ditemukan.");
    }
    await ctx.db.delete(template._id);
    return null;
  },
});
