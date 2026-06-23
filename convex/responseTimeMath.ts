// Pure, dependency-free helpers for response-time aggregation. No Convex imports so they
// run plain in vitest. `pairResponseEvents` does the turn-based walk over ONE conversation's
// messages (ascending by createdAt).

export type RtMessage = { direction: "inbound" | "outbound"; messageType: string; role: string; createdAt: number };

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

export function pairResponseEvents(msgs: RtMessage[]): { firstReplyMs: number | null; allReplyMs: number[] } {
  const allReplyMs: number[] = [];
  let firstReplyMs: number | null = null;
  let pendingInboundAt: number | null = null;
  for (const m of msgs) {
    if (m.direction === "inbound") {
      if (pendingInboundAt === null) pendingInboundAt = m.createdAt;
      continue;
    }
    // outbound
    const isReply = m.messageType !== "template" && m.role !== "system";
    if (isReply && pendingInboundAt !== null) {
      const gap = m.createdAt - pendingInboundAt;
      allReplyMs.push(gap);
      if (firstReplyMs === null) firstReplyMs = gap;
      pendingInboundAt = null;
    }
    // non-reply outbound (template/system): ignore, do NOT reset pending
  }
  return { firstReplyMs, allReplyMs };
}
