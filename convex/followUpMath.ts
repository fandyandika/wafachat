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
  requiresPrevStage?: number; // stage number that must already be sent (H+2 needs H+1)
  minHoursSincePrevStage?: number;
};

// NOTE: templateName values are PLACEHOLDERS until the user supplies the approved names.
export const FOLLOWUP_STAGES: FollowUpStageConfig[] = [
  { stage: 1, label: "H+1", templateName: "followup_h1", language: "id",
    minHoursSinceLastInbound: 24, maxHoursSinceLastInbound: 120 }, // 24h .. 5-day ceiling
  { stage: 2, label: "H+2", templateName: "followup_h2", language: "id",
    requiresPrevStage: 1, minHoursSincePrevStage: 20, maxHoursSinceLastInbound: 120 },
];

const HOUR = 3_600_000;

export type CandidacyInput = {
  lastInboundAt: number | null;   // customer's most recent inbound message
  lastMessageOutbound: boolean;   // most recent message in the thread is outbound (ghosted)
  isClosed: boolean;              // shippingRecap exists OR conversation.status === "closed"
  followUpStage: number | null;   // highest stage already sent (null/0 = none)
  followUpStageAt: number | null; // when that stage was sent
  now: number;
};

/** The funnel stage this conversation qualifies for, or null. First matching stage wins. */
export function eligibleStage(input: CandidacyInput, stages: FollowUpStageConfig[] = FOLLOWUP_STAGES): number | null {
  if (input.isClosed) return null;
  if (!input.lastMessageOutbound) return null;   // customer spoke last -> not ghosted
  if (input.lastInboundAt == null) return null;  // never chatted us
  const sinceInbound = input.now - input.lastInboundAt;
  const curStage = input.followUpStage ?? 0;
  for (const s of stages) {
    if (curStage !== (s.requiresPrevStage ?? 0)) continue; // must be exactly at the prior stage
    if (s.minHoursSinceLastInbound != null && sinceInbound < s.minHoursSinceLastInbound * HOUR) continue;
    if (s.maxHoursSinceLastInbound != null && sinceInbound > s.maxHoursSinceLastInbound * HOUR) continue;
    if (s.requiresPrevStage != null) {
      if (input.followUpStageAt == null) continue;
      if (s.minHoursSincePrevStage != null && input.now - input.followUpStageAt < s.minHoursSincePrevStage * HOUR) continue;
      if (input.lastInboundAt >= input.followUpStageAt) continue; // replied after the prior follow-up
    }
    return s.stage;
  }
  return null;
}
