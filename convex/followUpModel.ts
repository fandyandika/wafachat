export type FollowUpStage = 1 | 2 | 3;

export type FollowUpState =
  | "waiting"
  | "sending"
  | "unknown"
  | "failed"
  | "complete"
  | "archived";

export const FOLLOW_UP_DAY_MS = 24 * 60 * 60 * 1_000;
export const FOLLOW_UP_EXPIRY_MS = 5 * FOLLOW_UP_DAY_MS;

export function resetForInbound(cycleInboundAt: number) {
  return {
    cycleInboundAt,
    nextStage: null,
    dueAt: null,
    state: null,
  } as const;
}

export function armH1AfterOutbound(cycleInboundAt: number, csKey: string) {
  return {
    csKey,
    nextStage: 1,
    dueAt: cycleInboundAt + FOLLOW_UP_DAY_MS,
    state: "waiting",
  } as const;
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
