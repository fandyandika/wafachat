import { describe, expect, test } from "vitest";
import {
  FOLLOW_UP_DAY_MS,
  FOLLOW_UP_EXPIRY_MS,
  advanceAfterAccepted,
  armH1AfterOutbound,
  resetForInbound,
  terminateFollowUp,
} from "./followUpModel";

describe("manual follow-up state transitions", () => {
  test("accepted stages advance only after a fresh 24-hour delay", () => {
    expect(advanceAfterAccepted(1, 1_000)).toEqual({
      state: "waiting",
      nextStage: 2,
      dueAt: 1_000 + FOLLOW_UP_DAY_MS,
    });
    expect(advanceAfterAccepted(2, 2_000)).toEqual({
      state: "waiting",
      nextStage: 3,
      dueAt: 2_000 + FOLLOW_UP_DAY_MS,
    });
    expect(advanceAfterAccepted(3, 3_000)).toEqual({
      state: "complete",
      nextStage: null,
      dueAt: null,
    });
  });

  test("new inbound resets the prior cycle", () => {
    expect(resetForInbound(5_000)).toEqual({
      cycleInboundAt: 5_000,
      nextStage: null,
      dueAt: null,
      state: null,
    });
  });

  test("real CS outbound arms H+1 from the CS reply timestamp", () => {
    expect(armH1AfterOutbound(5_000, "aisyah", 7_000)).toEqual({
      csKey: "aisyah",
      nextStage: 1,
      dueAt: 7_000 + FOLLOW_UP_DAY_MS,
      state: "waiting",
    });
  });

  test("the actionable horizon is exactly seven days", () => {
    expect(FOLLOW_UP_EXPIRY_MS).toBe(7 * FOLLOW_UP_DAY_MS);
  });

  test("terminal events clear the actionable stage", () => {
    expect(terminateFollowUp("archived")).toEqual({
      state: "archived",
      nextStage: null,
      dueAt: null,
    });
    expect(terminateFollowUp("complete")).toEqual({
      state: "complete",
      nextStage: null,
      dueAt: null,
    });
  });
});
