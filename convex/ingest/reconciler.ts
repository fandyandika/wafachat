import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hmacBase64 } from "./signature";

export function wibDatePrefix(nowMs: number): string {
  const wib = new Date(nowMs + 7 * 3_600_000);
  const yy = String(wib.getUTCFullYear()).slice(2);
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function latestCounterForDate(rows: Array<{ id?: unknown }>, datePrefix: string): number | null {
  const prefix = `O-${datePrefix}`;
  let latest: number | null = null;
  for (const row of rows) {
    const orderId = String(row.id ?? "");
    if (!orderId.startsWith(prefix)) continue;
    const suffix = orderId.slice(prefix.length);
    if (!/^\d{6}$/.test(suffix)) continue;
    const counter = Number(suffix);
    if (counter >= 1 && (latest === null || counter > latest)) latest = counter;
  }
  return latest;
}

export function computeGaps(counters: number[], min: number | null, max: number | null): number[] {
  if (min === null || max === null) return [];
  const present = new Set(counters);
  const gaps: number[] = [];
  for (let c = min; c <= max; c++) if (!present.has(c)) gaps.push(c);
  return gaps;
}

type PreparedReconcileRun = { gaps: number[]; nextCounter: number };
type ReconcileCommit = { nextCounter: number; unresolvedCounters: number[]; probeCursor?: number };

// Processing can return `{ status: "skipped" }` without throwing. Keep every
// requested counter through the commit; only its exact DB lookup may clear it.
export async function reconcilePreparedGaps(
  run: PreparedReconcileRun,
  deps: {
    fetchDetail: (counter: number) => Promise<unknown | null>;
    processDetail: (counter: number, detail: unknown) => Promise<unknown>;
    commit: (args: { nextCounter: number; unresolvedCounters: number[]; probeCursor: number }) => Promise<ReconcileCommit>;
    onFailure: (counter: number, error: unknown) => Promise<void>;
  },
) {
  const requestedCounters = [...new Set(run.gaps)];
  const attemptedCounters = requestedCounters.slice(0, 50);
  for (const counter of attemptedCounters) {
    try {
      const detail = await deps.fetchDetail(counter);
      if (detail) await deps.processDetail(counter, detail);
    } catch (error) {
      await deps.onFailure(counter, error);
    }
  }
  const committed = await deps.commit({
    nextCounter: run.nextCounter,
    unresolvedCounters: requestedCounters,
    probeCursor: attemptedCounters.length > 0
      ? attemptedCounters[attemptedCounters.length - 1] + 1
      : 1,
  });
  return {
    ...committed,
    healed: requestedCounters.filter((counter) => !committed.unresolvedCounters.includes(counter)).length,
  };
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

export async function fetchBerduLatestCounter(datePrefix: string): Promise<number | null> {
  const appId = process.env.BERDU_APP_ID;
  const userId = process.env.BERDU_USER_ID;
  const appSecret = process.env.BERDU_APP_SECRET;
  const hmacKey = process.env.BERDU_HMAC_KEY;
  if (!appId || !userId || !appSecret || !hmacKey) return null;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const { authHeader } = await buildBerduAuth(appId, appSecret, hmacKey, nowSec);
    const url = `https://api.berdu.id/v0.0/order/list?user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      console.warn(`[reconciler] order list -> ${res.status}`);
      return null;
    }
    const body = await res.json() as { list?: Array<{ id?: unknown }> };
    return latestCounterForDate(Array.isArray(body.list) ? body.list : [], datePrefix);
  } catch (error) {
    console.warn(`[reconciler] order list failed: ${(error as Error).message}`);
    return null;
  }
}

export const runReconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    // Inert until Berdu creds are configured (M3). Skip BEFORE reading order counters so
    // this 15-min cron does not poll while the primary webhook path is healthy.
    if (!process.env.BERDU_APP_ID || !process.env.BERDU_USER_ID || !process.env.BERDU_APP_SECRET || !process.env.BERDU_HMAC_KEY) return;
    // B3 decision (spec §1.3): BERDU_* env creds belong to tenant #1 only, so the
    // reconciler is default-org-only BY DESIGN until tenantIntegrations exists.
    // Provisioning a second kind="berdu" source does NOT enroll it here.
    const orgId = await ctx.runQuery(internal.orgs.defaultOrgIdInternal, {});
    if (!orgId) return;
    const datePrefix = wibDatePrefix(Date.now());
    const observedMaxCounter = await fetchBerduLatestCounter(datePrefix);
    const run = await ctx.runQuery(internal.ingest.reconcileState.prepareReconcileRun, {
      datePrefix,
      orgId,
      ...(observedMaxCounter === null ? {} : { observedMaxCounter }),
    });
    const result = await reconcilePreparedGaps(run, {
      fetchDetail: (counter) => fetchBerduOrderDetail(`O-${datePrefix}${String(counter).padStart(6, "0")}`),
      processDetail: async (_counter, detail) => {
        let eventId: Id<"ingestEvents"> | undefined;
        try {
          eventId = await ctx.runMutation(internal.ingest.events.captureEvent, {
            sourceKey: "berdu-reconciler", kind: "lead.created",
            rawHeaders: "{}", rawBody: JSON.stringify({ order: detail }), signatureOk: true,
            orgId,
          });
          return await ctx.runMutation(internal.ingest.core.processEvent, { eventId });
        } catch (error) {
          // Preserve capture-first replay semantics when processing fails.
          if (eventId) {
            await ctx.runMutation(internal.ingest.events.markFailed, {
              eventId,
              error: (error as Error).message,
            });
          }
          throw error;
        }
      },
      commit: (args) => ctx.runMutation(internal.ingest.reconcileState.commitReconcileRun, { orgId, datePrefix, ...args }),
      onFailure: async (counter, error) => {
        console.warn(`[reconciler] ${datePrefix}/${counter} failed: ${(error as Error).message}`);
      },
    });
    if (run.gaps.length > 0) console.log(`[reconciler] ${datePrefix}: ${run.gaps.length} gaps, ${result.healed} healed`);
  },
});
