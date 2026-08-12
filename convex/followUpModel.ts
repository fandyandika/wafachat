export type FollowUpStage = 1 | 2 | 3;

export type FollowUpState =
  | "waiting"
  | "sending"
  | "unknown"
  | "failed"
  | "complete"
  | "archived";

type DueOutboundCandidate = {
  status: "active" | "handover" | "closed";
  followUpState?: FollowUpState;
  nextStage?: FollowUpStage;
  dueAt?: number;
  cycleInboundAt?: number;
  createdAt: number;
  role: "customer" | "ai" | "cs" | "system";
  direction: "inbound" | "outbound";
  source?: string;
  externalMessageId?: string;
  isInternal: boolean;
};

export const FOLLOW_UP_DAY_MS = 24 * 60 * 60 * 1_000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;

export function nextJakartaDueAt(eventAt: number): number {
  if (!Number.isFinite(eventAt) || eventAt < 0) throw new Error("Waktu Follow-up tidak valid.");
  const local = new Date(eventAt + JAKARTA_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 8) - JAKARTA_OFFSET_MS;
}

export function resetForInbound(cycleInboundAt: number) {
  return {
    cycleInboundAt,
    nextStage: null,
    dueAt: null,
    state: null,
  } as const;
}

export function armH1AfterOutbound(cycleInboundAt: number, csKey: string, outboundAt: number) {
  return {
    csKey,
    nextStage: 1,
    dueAt: nextJakartaDueAt(outboundAt),
    state: "waiting",
  } as const;
}

export function shouldAdvanceDueOutbound(_candidate: DueOutboundCandidate): boolean {
  // Task 6 will require a detected follow-up trigger before advancing a stage.
  return false;
}

export function advanceAfterAccepted(stage: FollowUpStage, acceptedAt: number) {
  if (stage === 3) {
    return {
      state: "complete",
      nextStage: null,
      dueAt: null,
    } as const;
  }

  return {
    state: "waiting",
    nextStage: (stage + 1) as 2 | 3,
    dueAt: nextJakartaDueAt(acceptedAt),
  } as const;
}

export function terminateFollowUp(state: "complete" | "archived") {
  return {
    state,
    nextStage: null,
    dueAt: null,
  } as const;
}
