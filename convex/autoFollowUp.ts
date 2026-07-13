import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal, api } from "./_generated/api";
import { normalizeCsName } from "./lib";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WIB_OFFSET = 7 * HOUR;
const START_HOUR = 8;   // 08:00 WIB
const END_HOUR = 14;    // 14:00 WIB (exclusive)
export const AUTO_DAILY_CAP = 80; // per CS per day (user wants 50–100; tune here)

const wibDay = (now: number) => Math.floor((now + WIB_OFFSET) / DAY);
const wibHour = (now: number) => Math.floor(((now + WIB_OFFSET) % DAY) / HOUR);

export const enabledCs = internalQuery({
  args: { now: v.number(), orgId: v.id("organizations") },
  handler: async (ctx, { now, orgId }) => {
    const day = wibDay(now);
    const all = await ctx.db.query("csConfigs").collect();
    return all
      .filter((c) => String(c.orgId) === String(orgId))
      .filter((c) => c.autoFollowUpEnabled && c.isActive)
      .map((c) => ({ csName: c.csName, sentToday: c.autoSentDay === day ? (c.autoSentCount ?? 0) : 0 }));
  },
});

export const bumpSent = internalMutation({
  args: { csName: v.string(), now: v.number(), orgId: v.id("organizations") },
  handler: async (ctx, { csName, now, orgId }) => {
    const normalizedName = normalizeCsName(csName);
    const cfg = await ctx.db.query("csConfigs").withIndex("by_org_normalizedName", (q) => q.eq("orgId", orgId).eq("normalizedName", normalizedName)).unique();
    if (!cfg) return;
    const day = wibDay(now);
    const count = cfg.autoSentDay === day ? (cfg.autoSentCount ?? 0) + 1 : 1;
    await ctx.db.patch(cfg._id, { autoSentDay: day, autoSentCount: count, updatedAt: now });
  },
});

// Runs hourly (see crons.ts) but only acts 08:00–14:00 WIB, capped per CS per day. Reuses the
// touch-detection + dedupe in getFollowUpCandidates, so it never double-sends a manually-touched lead.
// Per-org loop: iterate every org, thread orgId through the queries/mutations.
export const autoFollowUpSweep = internalAction({
  args: { nowOverride: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ sent: number; skipped?: string }> => {
    const now = args.nowOverride ?? Date.now();
    const h = wibHour(now);
    if (h < START_HOUR || h >= END_HOUR) return { sent: 0, skipped: "outside-hours" };
    const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {});
    let totalSent = 0;
    for (const org of orgs) {
      const enabled = await ctx.runQuery(internal.autoFollowUp.enabledCs, { now, orgId: org._id });
      for (const cs of enabled) {
        const remaining = AUTO_DAILY_CAP - cs.sentToday;
        if (remaining <= 0) continue;
        const cands = await ctx.runQuery(internal.followUp.getFollowUpCandidatesInternal, { csName: cs.csName, nowOverride: now, orgId: org._id });
        const queue = [
          ...cands.stage1.map((c) => ({ id: c.conversationId, stage: 1 })),
          ...cands.stage2.map((c) => ({ id: c.conversationId, stage: 2 })),
          ...cands.stage3.map((c) => ({ id: c.conversationId, stage: 3 })),
        ].slice(0, remaining);
        for (const item of queue) {
          const r = await ctx.runAction(internal.followUp.performFollowUpSend, { conversationId: item.id, stage: item.stage, nowOverride: now });
          if (r.ok) { totalSent++; await ctx.runMutation(internal.autoFollowUp.bumpSent, { csName: cs.csName, now, orgId: org._id }); }
        }
      }
    }
    return { sent: totalSent };
  },
});
