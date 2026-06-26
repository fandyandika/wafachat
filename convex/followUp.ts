import { query, action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { csKey, isInternalTestPhone, normalizeCsName } from "./lib";
import { eligibleStage, FOLLOWUP_STAGES } from "./followUpMath";
import { internal } from "./_generated/api";

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
    const recap = await ctx.db.query("shippingRecaps").withIndex("by_customerPhone", (q) => q.eq("customerPhone", c.customerPhone)).first();
    const msgs = await ctx.db.query("messages").withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", c._id)).order("desc").take(30);
    const lastInbound = msgs.find((m) => m.direction === "inbound");
    const order = await ctx.db.query("orders").withIndex("by_orderId", (q) => q.eq("orderId", c.orderId)).first();
    const normName = normalizeCsName(c.assignedCsName);
    const cfg = await ctx.db.query("csConfigs").withIndex("by_normalizedName", (q) => q.eq("normalizedName", normName)).first();
    const eligible = eligibleStage({
      lastInboundAt: lastInbound?.createdAt ?? null,
      lastMessageOutbound: msgs.length > 0 && msgs[0].direction === "outbound",
      isClosed: c.status === "closed" || recap != null,
      followUpStage: c.followUpStage ?? null, followUpStageAt: c.followUpStageAt ?? null, now,
    });
    return { eligible, phoneNumberId: cfg?.providerNumberId ?? null, customerName: c.customerName,
             customerPhone: c.customerPhone, orderId: c.orderId, productName: order?.productName ?? "—" };
  },
});

export const stampFollowUp = internalMutation({
  args: { conversationId: v.id("conversations"), stage: v.number(), at: v.number(),
          orderId: v.string(), customerPhone: v.string(), content: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.conversationId, { followUpStage: a.stage, followUpStageAt: a.at, updatedAt: a.at });
    await ctx.db.insert("messages", {
      conversationId: a.conversationId, orderId: a.orderId, customerPhone: a.customerPhone,
      role: "cs", direction: "outbound", content: a.content, messageType: "template",
      source: "panel", createdAt: a.at,
    });
  },
});

export const sendFollowUp = action({
  args: { conversationId: v.id("conversations"), stage: v.number(), authSecret: v.string(),
          nowOverride: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    if (!process.env.PANEL_AUTH_SECRET || args.authSecret !== process.env.PANEL_AUTH_SECRET) {
      return { ok: false, error: "unauthorized" };
    }
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
