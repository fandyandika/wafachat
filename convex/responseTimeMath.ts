// Pure, dependency-free helpers for response-time aggregation. No Convex imports so they
// run plain in vitest. `pairResponseEvents` does the turn-based walk over ONE conversation's
// messages (ascending by createdAt).

export type RtMessage = { direction: "inbound" | "outbound"; messageType: string; role: string; createdAt: number };

const JAK_MS = 7 * 60 * 60 * 1000;
export const SLA_THRESHOLD_MIN = 15;
export const BH_START_MIN = 330; // 05:30 WIB
export const BH_END_MIN = 1080; // 18:00 WIB

/** Minutes within [start,end] that fall inside the daily [05:30,18:00] WIB active window. */
export function businessMinutesBetween(startMs: number, endMs: number, startMin = BH_START_MIN, endMin = BH_END_MIN): number {
  if (endMs <= startMs) return 0;
  const DAY = 86_400_000;
  // UTC ms of the WIB midnight that contains startMs.
  const firstMidnight = Math.floor((startMs + JAK_MS) / DAY) * DAY - JAK_MS;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const dayMid = firstMidnight + i * DAY;
    if (dayMid > endMs) break;
    const winStart = dayMid + startMin * 60_000;
    const winEnd = dayMid + endMin * 60_000;
    const lo = Math.max(startMs, winStart);
    const hi = Math.min(endMs, winEnd);
    if (hi > lo) total += (hi - lo) / 60_000;
  }
  return total;
}

export function isSlaBreach(inboundAt: number, replyAt: number, thresholdMin = SLA_THRESHOLD_MIN): boolean {
  return businessMinutesBetween(inboundAt, replyAt) > thresholdMin;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(nums: number[], p: number): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const rank = Math.ceil(p * s.length);
  return s[Math.min(rank, s.length) - 1];
}

export function pairResponsePairs(msgs: RtMessage[]): Array<{ inboundAt: number; replyAt: number; gapMs: number }> {
  const pairs: Array<{ inboundAt: number; replyAt: number; gapMs: number }> = [];
  let pendingInboundAt: number | null = null;
  for (const m of msgs) {
    if (m.direction === "inbound") {
      if (pendingInboundAt === null) pendingInboundAt = m.createdAt;
      continue;
    }
    const isReply = m.messageType !== "template" && m.role !== "system";
    if (isReply && pendingInboundAt !== null) {
      const activeMs = Math.round(businessMinutesBetween(pendingInboundAt, m.createdAt) * 60_000);
      const gap = activeMs > 0 ? activeMs : m.createdAt - pendingInboundAt;
      pairs.push({ inboundAt: pendingInboundAt, replyAt: m.createdAt, gapMs: gap });
      pendingInboundAt = null;
    }
  }
  return pairs;
}

export function pairResponseEvents(msgs: RtMessage[]): { firstReplyMs: number | null; allReplyMs: number[]; firstInboundAt: number | null; firstReplyAt: number | null } {
  const pairs = pairResponsePairs(msgs);
  const allReplyMs = pairs.map((p) => p.gapMs);
  const firstReplyMs = pairs.length > 0 ? pairs[0].gapMs : null;
  const firstInboundAt = pairs.length > 0 ? pairs[0].inboundAt : null;
  const firstReplyAt = pairs.length > 0 ? pairs[0].replyAt : null;
  return { firstReplyMs, allReplyMs, firstInboundAt, firstReplyAt };
}
