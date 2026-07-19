import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

const SILENCE_MIN = 45;
const SPIKE_THRESHOLD = 5;
const SPIKE_WINDOW_MS = 15 * 60_000;
const COOLDOWN_MS = 60 * 60_000;
const WORK_START_WIB = 8;
const WORK_END_WIB = 21;

export type HealthSnapshot = { lastProcessedMessageAt: number | null; failedLast15m: number };

export function shouldAlert(snap: HealthSnapshot, nowMs: number) {
  const wibHour = new Date(nowMs + 7 * 3_600_000).getUTCHours();
  const inWorkHours = wibHour >= WORK_START_WIB && wibHour < WORK_END_WIB;
  const silentFor = snap.lastProcessedMessageAt === null
    ? Number.POSITIVE_INFINITY
    : nowMs - snap.lastProcessedMessageAt;
  return {
    silence: inWorkHours && silentFor >= SILENCE_MIN * 60_000,
    failureSpike: snap.failedLast15m >= SPIKE_THRESHOLD,
  };
}

export const getHealthSnapshot = internalQuery({
  args: { orgId: v.id("organizations"), nowMs: v.number() },
  handler: async (ctx, args): Promise<HealthSnapshot> => {
    const lastMsg = await ctx.db
      .query("ingestEvents")
      .withIndex("by_org_kind_status_receivedAt", (q) =>
        q.eq("orgId", args.orgId).eq("kind", "message.event").eq("status", "processed"))
      .order("desc")
      .first();
    const failed = await ctx.db
      .query("ingestEvents")
      .withIndex("by_org_status_receivedAt", (q) =>
        q.eq("orgId", args.orgId).eq("status", "failed").gte("receivedAt", args.nowMs - SPIKE_WINDOW_MS))
      .collect();
    return {
      lastProcessedMessageAt: lastMsg?.processedAt ?? lastMsg?.receivedAt ?? null,
      failedLast15m: failed.length,
    };
  },
});

export const stampAlertIfCool = internalMutation({
  args: { orgId: v.id("organizations"), alertKey: v.string(), nowMs: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertState")
      .withIndex("by_org_alertKey", (q) => q.eq("orgId", args.orgId).eq("alertKey", args.alertKey))
      .unique();
    if (existing && args.nowMs - existing.lastSentAt < COOLDOWN_MS) return { sent: false };
    if (existing) await ctx.db.patch(existing._id, { lastSentAt: args.nowMs });
    else await ctx.db.insert("alertState", { orgId: args.orgId, alertKey: args.alertKey, lastSentAt: args.nowMs });
    return { sent: true };
  },
});

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[ingest-monitor] TELEGRAM env not set; alert suppressed:", text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("[ingest-monitor] telegram send failed:", res.status, await res.text());
}

export const checkHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const nowMs = Date.now();
    const orgs = await ctx.runQuery(internal.orgs.listOrgsInternal, {});
    for (const org of orgs) {
      const snap = await ctx.runQuery(internal.ingest.monitor.getHealthSnapshot, { orgId: org._id, nowMs });
      const alerts = shouldAlert(snap, nowMs);
      const orgLabel = `${org.name} (${org.slug})`;
      if (alerts.silence) {
        const gate = await ctx.runMutation(internal.ingest.monitor.stampAlertIfCool, {
          orgId: org._id, alertKey: "silence", nowMs,
        });
        if (gate.sent) {
          const mins = snap.lastProcessedMessageAt
            ? Math.round((nowMs - snap.lastProcessedMessageAt) / 60_000) : -1;
          await sendTelegram(
            `WaFaChat ${orgLabel}: tidak ada pesan masuk ${mins >= 0 ? `${mins} menit` : "sama sekali"} di jam kerja. ` +
            "Cek KirimDev subscription (Disabled?) & endpoint Convex.",
          );
        }
      }
      if (alerts.failureSpike) {
        const gate = await ctx.runMutation(internal.ingest.monitor.stampAlertIfCool, {
          orgId: org._id, alertKey: "failure-spike", nowMs,
        });
        if (gate.sent) {
          await sendTelegram(
            `WaFaChat ${orgLabel}: ${snap.failedLast15m} ingest event GAGAL dalam 15 menit. ` +
            "Jalankan replayAllFailed setelah perbaikan.",
          );
        }
      }
    }
  },
});
