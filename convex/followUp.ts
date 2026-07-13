import { query, action, mutation, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { requireMember, requireMemberOrg } from "./authz";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { csKey, isInternalTestPhone, normalizeCsName } from "./lib";
import { eligibleStage, FOLLOWUP_STAGES } from "./followUpMath";
import { internal } from "./_generated/api";
import { followUpEffectivenessFromRollups } from "./rollupReaders";
import { getInternalPhoneSet } from "./orgSettings";
import { requireDefaultOrgId } from "./orgs";

const HOUR = 3_600_000;
const WINDOW_HOURS = 24; // WhatsApp 24h window; a follow-up "touch" = an outbound sent after it closes

// Count follow-up touches (outbound messages after the 24h window closed, relative to lastInbound).
// Manual-via-WABA follow-ups and API sends both land here, so the funnel can't double-send a lead a
// CS already touched by hand. Reads only the post-window tail, so it stays cheap.
async function touchInfo(ctx: any, conversationId: any, lastInboundAt: number | null) {
  if (lastInboundAt == null) return { count: 0, lastAt: null as number | null, ats: [] as number[] };
  const windowClose = lastInboundAt + WINDOW_HOURS * HOUR;
  const touches = await ctx.db
    .query("messages")
    .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversationId).gt("createdAt", windowClose))
    .filter((q: any) => q.eq(q.field("direction"), "outbound"))
    .collect();
  const ats = (touches.map((t: any) => t.createdAt) as number[]).sort((a, b) => a - b);
  return { count: ats.length, lastAt: ats.length ? ats[ats.length - 1] : null, ats };
}

// Feature #10: count follow-up touches (post-window outbound) that occurred before a specific time.
// Used to record KPI: how many touches preceded a closing.
export async function countFollowUpTouchesBeforeTime(ctx: any, conversationId: any, lastInboundAt: number | null, beforeTime: number) {
  if (lastInboundAt == null) return 0;
  const windowClose = lastInboundAt + WINDOW_HOURS * HOUR;
  const touches = await ctx.db
    .query("messages")
    .withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", conversationId).gt("createdAt", windowClose).lt("createdAt", beforeTime))
    .filter((q: any) => q.eq(q.field("direction"), "outbound"))
    .collect();
  return touches.length;
}

// nowOverride is test-only (Date.now() is unavailable in some runtimes); prod passes nothing.
// Shared by the guarded panel query AND the identity-less cron sweep (autoFollowUp).
async function followUpCandidatesHandler(ctx: any, args: { csName?: string; nowOverride?: number; orgId: any }) {
    const internalPhones = await getInternalPhoneSet(ctx);
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
          ctx.db.query("conversations").withIndex("by_org_status_updatedAt", (q: any) => q.eq("orgId", args.orgId).eq("status", s).gte("updatedAt", since)).collect(),
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
      ghosted.map((x) => ctx.db.query("messages").withIndex("by_conversation_createdAt", (q: any) => q.eq("conversationId", x.c._id)).order("desc").filter((q: any) => q.eq(q.field("direction"), "inbound")).first()),
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

export const getFollowUpCandidates = query({
  args: { csName: v.optional(v.string()), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getFollowUpCandidates");
    return followUpCandidatesHandler(ctx, { ...args, orgId });
  },
});

// Cron/sweep path (autoFollowUp) — server-side, no user identity, not publicly callable.
export const getFollowUpCandidatesInternal = internalQuery({
  args: { csName: v.optional(v.string()), nowOverride: v.optional(v.number()), orgId: v.id("organizations") },
  handler: async (ctx, args) => followUpCandidatesHandler(ctx, args),
});

const KIRIM_ERR: Record<string, string> = {
  template_paused: "Template lagi dijeda Meta — cek di KirimDev.",
  template_not_found: "Template belum approved.",
  template_policy_violation: "Template melanggar kebijakan Meta.",
  account_rate_limited: "Nomor lagi dibatasi, coba lagi nanti.",
  app_rate_limited: "Lagi terlalu banyak kirim, coba lagi sebentar.",
  outside_24h_window: "Window 24 jam — harusnya pakai template (cek konfigurasi).",
  marketing_blocked_by_user: "Customer memblokir pesan marketing.",
};

// Re-derive eligibility + resolve the CS WABA number for one conversation (defends the send).
export const candidacyFor = internalQuery({
  args: { conversationId: v.id("conversations"), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    if (!c) return null;
    const now = args.nowOverride ?? Date.now();
    const recap = await ctx.db.query("shippingRecaps").withIndex("by_org_orderIdBerdu", (q) => q.eq("orgId", c.orgId).eq("orderIdBerdu", c.orderId)).first();
    const lastMsg = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").first();
    const lastInbound = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").filter((q) => q.eq(q.field("direction"), "inbound")).first();
    const order = await ctx.db.query("orders").withIndex("by_org_orderId", (q) => q.eq("orgId", c.orgId).eq("orderId", c.orderId)).first();
    const normName = normalizeCsName(c.assignedCsName);
    let cfg = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", c.orgId).eq("normalizedName", normName)).first();
    // assignedCsName is inconsistent across the data ("Aisyah" vs "CS Aisyah"), so an exact
    // normalizedName match can miss the WABA number. Fall back to a csKey match (ignores the
    // "CS " prefix) so providerNumberId resolves regardless of how the lead was named.
    if (!cfg || !cfg.providerNumberId) {
      const k = csKey(c.assignedCsName);
      const all = await ctx.db.query("csConfigs").collect().then((all) => all.filter((x) => String(x.orgId) === String(c.orgId)));
      cfg = all.find((x) => csKey(x.csName) === k && x.providerNumberId) ?? cfg;
    }
    const touch = await touchInfo(ctx, c._id, lastInbound?.createdAt ?? null);
    const eligible = eligibleStage({
      lastInboundAt: lastInbound?.createdAt ?? null,
      lastMessageOutbound: lastMsg != null && lastMsg.direction === "outbound",
      isClosed: c.status === "closed" || recap != null,
      touchCount: touch.count, lastTouchAt: touch.lastAt, now,
    });
    return { eligible, phoneNumberId: cfg?.providerNumberId ?? null, customerName: c.customerName,
             customerPhone: c.customerPhone, orderId: c.orderId, productName: order?.productName ?? "—" };
  },
});

export const stampFollowUp = internalMutation({
  args: { conversationId: v.id("conversations"), stage: v.number(), at: v.number(),
          orderId: v.string(), customerPhone: v.string(), content: v.string() },
  handler: async (ctx, a) => {
    const orgId = await requireDefaultOrgId(ctx);
    // Feature #8: clear override after send; auto-staging resumes next check.
    await ctx.db.patch(a.conversationId, { followUpStage: a.stage, followUpStageAt: a.at, followUpStageOverride: undefined, updatedAt: a.at });
    await ctx.db.insert("messages", {
      conversationId: a.conversationId, orderId: a.orderId, customerPhone: a.customerPhone,
      role: "cs", direction: "outbound", content: a.content, messageType: "template",
      source: "panel", createdAt: a.at, orgId,
    });
  },
});

export const performFollowUpSend = internalAction({
  args: { conversationId: v.id("conversations"), stage: v.number(),
          nowOverride: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const now = args.nowOverride ?? Date.now();
    const d = await ctx.runQuery(internal.followUp.candidacyFor, { conversationId: args.conversationId, nowOverride: now });
    if (!d) return { ok: false, error: "Percakapan tidak ditemukan." };
    if (d.eligible !== args.stage) {
      return { ok: false, error: "Sudah tidak eligible (mungkin sudah dibalas / closing / sudah di-follow-up)." };
    }
    if (!d.phoneNumberId) return { ok: false, error: "Nomor WABA CS belum dikonfigurasi." };
    if (!process.env.KIRIMDEV_API_KEY) return { ok: false, error: "KIRIMDEV_API_KEY belum dikonfigurasi." };
    const cfg = FOLLOWUP_STAGES.find((s) => s.stage === args.stage)!;
    const base = process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1";
    // Positional params — FINALISE order once the real template is known: {{1}}=name, {{2}}=product, {{3}}=orderId.
    const params = [d.customerName, d.productName, d.orderId];
    let resp: Response;
    try {
      resp = await fetch(`${base}/${d.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.KIRIMDEV_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `fu-${args.conversationId}-${args.stage}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: d.customerPhone, type: "template",
          template: { name: cfg.templateName, language: cfg.language,
            components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
        }),
      });
    } catch {
      return { ok: false, error: "Gagal menghubungi KirimDev." };
    }
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
      const code = body?.error?.code;
      return { ok: false, error: (code && KIRIM_ERR[code]) || `Gagal kirim${code ? ` (${code})` : ""}.` };
    }
    await ctx.runMutation(internal.followUp.stampFollowUp, {
      conversationId: args.conversationId, stage: args.stage, at: now,
      orderId: d.orderId, customerPhone: d.customerPhone,
      content: `[follow-up ${cfg.label}] ${cfg.templateName}`,
    });
    return { ok: true };
  },
});

export const sendFollowUp = action({
  args: { conversationId: v.id("conversations"), stage: v.number(), authSecret: v.string(),
          nowOverride: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    return await ctx.runAction(internal.followUp.performFollowUpSend, {
      conversationId: args.conversationId, stage: args.stage, nowOverride: args.nowOverride
    });
  },
});

export const archiveFollowUp = mutation({
  args: { conversationId: v.id("conversations"), authSecret: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    const c = await ctx.db.get(args.conversationId);
    if (!c) return { ok: false, error: "Percakapan tidak ditemukan." };
    const now = Date.now();
    await ctx.db.patch(args.conversationId, { status: "closed", followUpArchivedAt: now, updatedAt: now });
    return { ok: true };
  },
});

// Feature #8: manual stage override
export const setFollowUpStage = mutation({
  args: { conversationId: v.id("conversations"), stage: v.number(), authSecret: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    if (![1, 2, 3].includes(args.stage)) {
      return { ok: false, error: "Stage must be 1, 2, or 3." };
    }
    const c = await ctx.db.get(args.conversationId);
    if (!c) return { ok: false, error: "Percakapan tidak ditemukan." };
    const now = Date.now();
    await ctx.db.patch(args.conversationId, { followUpStageOverride: args.stage, updatedAt: now });
    return { ok: true };
  },
});

// Feature #2: undo archive
export const unarchiveFollowUp = mutation({
  args: { conversationId: v.id("conversations"), authSecret: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    const c = await ctx.db.get(args.conversationId);
    if (!c) return { ok: false, error: "Percakapan tidak ditemukan." };
    const now = Date.now();
    await ctx.db.patch(args.conversationId, { status: "active", followUpArchivedAt: undefined, updatedAt: now });
    return { ok: true };
  },
});

export const getArchivedFollowUps = query({
  args: { csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getArchivedFollowUps");
    const internalPhones = await getInternalPhoneSet(ctx);
    const now = Date.now();
    const DAY = 86_400_000;
    const since = now - 14 * DAY;
    const csKeyMemo = args.csName ? csKey(args.csName) : null;

    // Manual archive sets status="closed" + followUpArchivedAt, so read only recently-closed
    // conversations via the index (NOT a full-table .filter().collect() scan) then keep the
    // ones that were actually archived. Bounds reads to recent closed convs.
    const archived = await ctx.db
      .query("conversations")
      .withIndex("by_org_status_updatedAt", (q) => q.eq("orgId", orgId).eq("status", "closed").gte("updatedAt", since))
      .collect();

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

// Feature #5b: auto-send toggle
export const setAutoFollowUp = mutation({
  args: { csName: v.string(), enabled: v.boolean(), authSecret: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; enabled?: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
    const now = Date.now();
    const orgId = await requireDefaultOrgId(ctx);
    const normalizedName = normalizeCsName(args.csName);
    const existing = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { autoFollowUpEnabled: args.enabled, updatedAt: now });
    } else {
      // Insert minimal config if not found (mirror upsert defaults from csConfigs.ts).
      await ctx.db.insert("csConfigs", {
        normalizedName,
        csName: args.csName,
        orderAutomationEnabled: false,
        aiAssistantEnabled: false,
        reportingEnabled: true,
        autoFollowUpEnabled: args.enabled,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        orgId,
      });
    }
    return { ok: true, enabled: args.enabled };
  },
});

export const getAutoFollowUp = query({
  args: { csName: v.string() },
  handler: async (ctx, args): Promise<{ enabled: boolean }> => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getAutoFollowUp");
    const normalizedName = normalizeCsName(args.csName);
    const config = await ctx.db
      .query("csConfigs")
      .withIndex("by_org_normalizedName", (q: any) => q.eq("orgId", orgId).eq("normalizedName", normalizedName))
      .unique();
    const enabled = config?.autoFollowUpEnabled ?? false;
    return { enabled };
  },
});

// Feature #10: KPI — follow-up effectiveness
export const getFollowUpEffectivenessLegacy = internalQuery({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const internalPhones = await getInternalPhoneSet(ctx);
    const csKeyMemo = args.csName ? csKey(args.csName) : null;
    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_closedAt", (q: any) => q.gte("closedAt", args.startAt).lte("closedAt", args.endAt))
      .collect();

    // Exclude cancelled, internal-test, scope by csName.
    const filtered = recaps
      .filter((r) => r.status !== "cancelled" && r.status !== "cancelled_after_export")
      .filter((r) => !isInternalTestPhone(r.customerPhone, internalPhones))
      .filter((r) => (csKeyMemo ? csKey(r.csName) === csKeyMemo : true));

    const totalClosings = filtered.length;
    const fromFollowUp = filtered.filter((r) => (r.followUpTouchesAtClose ?? 0) >= 1).length;
    const byTouches = filtered.reduce(
      (acc, r) => {
        const touches = r.followUpTouchesAtClose ?? 0;
        if (touches === 1) acc.h1++;
        else if (touches === 2) acc.h2++;
        else if (touches >= 3) acc.h3++;
        return acc;
      },
      { h1: 0, h2: 0, h3: 0 }
    );

    return { totalClosings, fromFollowUp, byStage: byTouches };
  },
});

export const getFollowUpEffectiveness = query({
  args: { startAt: v.number(), endAt: v.number(), csName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getFollowUpEffectiveness");
    return followUpEffectivenessFromRollups(ctx, orgId, args);
  },
});

// "Closing" tab: recent closings so CS can see where a lead WENT after it dropped out of the funnel
// (PEMESANAN BERHASIL / marker → status closed → vanishes from H+1/2/3). Read-only over shippingRecaps;
// a lead that closed after ≥1 follow-up touch gets fromFollowUp=true so the funnel's effect is visible.
export const getClosedFollowUps = query({
  args: { csName: v.optional(v.string()), sinceDays: v.optional(v.number()), nowOverride: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireMemberOrg(ctx, "followUp.getClosedFollowUps");
    const internalPhones = await getInternalPhoneSet(ctx);
    const now = args.nowOverride ?? Date.now();
    const DAY = 86_400_000;
    const since = now - (args.sinceDays ?? 7) * DAY;
    const csKeyMemo = args.csName ? csKey(args.csName) : null;

    const recaps = await ctx.db
      .query("shippingRecaps")
      .withIndex("by_org_closedAt", (q: any) => q.eq("orgId", orgId).gte("closedAt", since).lte("closedAt", now))
      .collect();

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

    rows.sort((a, b) => b.closedAt - a.closedAt);
    return rows.slice(0, 300);
  },
});
