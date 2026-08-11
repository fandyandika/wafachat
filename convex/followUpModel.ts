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
export const FOLLOW_UP_EXPIRY_MS = 7 * FOLLOW_UP_DAY_MS;

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
    dueAt: outboundAt + FOLLOW_UP_DAY_MS,
    state: "waiting",
  } as const;
}

export function shouldAdvanceDueOutbound(candidate: DueOutboundCandidate): boolean {
  return candidate.status !== "closed"
    && candidate.followUpState === "waiting"
    && candidate.nextStage !== undefined
    && candidate.dueAt !== undefined
    && candidate.cycleInboundAt !== undefined
    && candidate.createdAt >= candidate.dueAt
    && candidate.role === "cs"
    && candidate.direction === "outbound"
    && candidate.source === "ingest"
    && Boolean(candidate.externalMessageId?.trim())
    && !candidate.isInternal;
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
    dueAt: acceptedAt + FOLLOW_UP_DAY_MS,
  } as const;
}

export function terminateFollowUp(state: "complete" | "archived") {
  return {
    state,
    nextStage: null,
    dueAt: null,
  } as const;
}
