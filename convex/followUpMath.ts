// Pure funnel-eligibility helpers — no Convex imports so they run plain in vitest.
// A conversation is scored against fixed stage configs; eligibleStage returns the stage
// it qualifies for (1 = H+1, 2 = H+2) or null. Mirrors the responseTimeMath.ts pattern.

export type FollowUpStageConfig = {
  stage: number;
  label: string;
  templateName: string;
  language: string;
  minHoursSinceLastInbound?: number;
  maxHoursSinceLastInbound?: number;
  requiresPrevStage?: number; // number of prior follow-up touches required (H+2 needs 1; H+1 omits = 0)
  minHoursSincePrevStage?: number;
};

// Timing = hours since the customer's LAST inbound; requiresPrevStage = follow-up touches already
// sent (manual-via-WABA or API). No upper ceiling here — leads that never get touched are bounded by
// the conversationLifecycle stale-archive (5 days). H+2B is the final goodbye, after which the
// conversation is archived.
// NOTE: templateName values are PLACEHOLDERS until the user supplies the approved names. H+2B's
// approved template is the goodbye copy ("Kak, kalau memang belum ingin lanjut sekarang...").
export const FOLLOWUP_STAGES: FollowUpStageConfig[] = [
  { stage: 1, label: "H+1", templateName: "followup_h1", language: "id",
    minHoursSinceLastInbound: 24 },                                                    // >=24h, 0 touches
  { stage: 2, label: "H+2", templateName: "followup_h2", language: "id",
    requiresPrevStage: 1, minHoursSinceLastInbound: 48, minHoursSincePrevStage: 12 }, // >=48h, 1 touch, >=12h since it
  { stage: 3, label: "H+3", templateName: "followup_h3", language: "id",
    requiresPrevStage: 2, minHoursSinceLastInbound: 72, minHoursSincePrevStage: 12 }, // >=72h (day 3), 2 touches -> goodbye -> archive
];

const HOUR = 3_600_000;

export type CandidacyInput = {
  lastInboundAt: number | null;   // customer's most recent inbound message
  lastMessageOutbound: boolean;   // most recent message in the thread is outbound (ghosted)
  isClosed: boolean;              // shippingRecap exists OR conversation.status === "closed"
  // Follow-up "touches" = our outbound messages sent AFTER the 24h window closed (relative to the
  // current lastInbound). Both manual-via-WABA follow-ups and API sends land here, so the funnel
  // counts them identically — a conversation a CS already followed up by hand drops out on its own.
  // A new customer reply resets lastInbound, which reopens the window and zeroes the touch count.
  touchCount: number;             // number of follow-up touches since the window closed (0 = none yet)
  lastTouchAt: number | null;     // timestamp of the most recent touch (null when touchCount === 0)
  now: number;
};

/** The funnel stage this conversation qualifies for, or null. First matching stage wins. */
export function eligibleStage(input: CandidacyInput, stages: FollowUpStageConfig[] = FOLLOWUP_STAGES): number | null {
  if (input.isClosed) return null;
  if (!input.lastMessageOutbound) return null;   // customer spoke last -> not ghosted
  if (input.lastInboundAt == null) return null;  // never chatted us
  const sinceInbound = input.now - input.lastInboundAt;
  for (const s of stages) {
    const requiredTouches = s.requiresPrevStage ?? 0; // H+1 needs 0 prior touches, H+2 needs 1
    if (input.touchCount !== requiredTouches) continue; // exactly N prior touches (manual or API)
    // Time windows are inclusive: at exactly the min/max boundary the gate passes.
    if (s.minHoursSinceLastInbound != null && sinceInbound < s.minHoursSinceLastInbound * HOUR) continue;
    if (s.maxHoursSinceLastInbound != null && sinceInbound > s.maxHoursSinceLastInbound * HOUR) continue;
    if (requiredTouches > 0) {
      if (input.lastTouchAt == null) continue; // defensive: touchCount>0 implies a timestamp
      if (s.minHoursSincePrevStage != null && input.now - input.lastTouchAt < s.minHoursSincePrevStage * HOUR) continue;
    }
    return s.stage;
  }
  return null;
}
