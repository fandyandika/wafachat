import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hmacBase64 } from "./signature";

export function wibDatePrefix(nowMs: number): string {
  const wib = new Date(nowMs + 7 * 3_600_000);
  const yy = String(wib.getUTCFullYear()).slice(2);
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function computeGaps(counters: number[], min: number | null, max: number | null): number[] {
  if (min === null || max === null) return [];
  const present = new Set(counters);
  const gaps: number[] = [];
  for (let c = min; c <= max; c++) if (!present.has(c)) gaps.push(c);
  return gaps;
}

export async function buildBerduAuth(appId: string, appSecret: string, hmacKey: string, nowSec: number) {
  const signature = await hmacBase64(hmacKey, `${appId}:${nowSec}:${appSecret}`);
  return { authHeader: `${appId}.${nowSec}.${signature}` };
}

export async function fetchBerduOrderDetail(orderId: string): Promise<any | null> {
  const appId = process.env.BERDU_APP_ID;
  const userId = process.env.BERDU_USER_ID;
  const appSecret = process.env.BERDU_APP_SECRET;
  const hmacKey = process.env.BERDU_HMAC_KEY;
  if (!appId || !userId || !appSecret || !hmacKey) {
    console.warn("[reconciler] BERDU_* env not set; skipping fetch");
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const { authHeader } = await buildBerduAuth(appId, appSecret, hmacKey, nowSec);
  const url = `https://api.berdu.id/v0.0/order/detail?user_id=${encodeURIComponent(userId)}&order_id=${encodeURIComponent(orderId)}`;
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    console.warn(`[reconciler] detail fetch ${orderId} -> ${res.status}`);
    return null;
  }
  return res.json();
}

export const runReconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const datePrefix = wibDatePrefix(Date.now());
    const counters = await ctx.runQuery(internal.state.listOrderCountersByPrefix, { datePrefix });
    const gaps = computeGaps(counters.counters, counters.min, counters.max);
    let healed = 0;
    for (const c of gaps.slice(0, 50)) { // bound one run
      const orderId = `O-${datePrefix}${String(c).padStart(6, "0")}`;
      const detail = await fetchBerduOrderDetail(orderId);
      if (!detail) continue;
      const eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
        sourceKey: "berdu-reconciler", kind: "lead.created",
        rawHeaders: "{}", rawBody: JSON.stringify({ order: detail }), signatureOk: true,
      });
      try {
        await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
        healed++;
      } catch (e) {
        await ctx.runMutation(internal.ingest.events.markFailed, { eventId, error: (e as Error).message });
      }
    }
    if (gaps.length > 0) console.log(`[reconciler] ${datePrefix}: ${gaps.length} gaps, ${healed} healed`);
  },
});
