import { describe, expect, test } from "vitest";
import {
  advanceAfterAccepted,
  armH1AfterOutbound,
  nextJakartaDueAt,
  resetForInbound,
  shouldAdvanceDueOutbound,
  terminateFollowUp,
} from "./followUpModel";

describe("manual follow-up state transitions", () => {
  test("accepted stages advance at 08:00 WIB on the next calendar day", () => {
    expect(advanceAfterAccepted(1, 1_000)).toEqual({
      state: "waiting",
      nextStage: 2,
      dueAt: Date.UTC(1970, 0, 2, 1),
    });
    expect(advanceAfterAccepted(2, 2_000)).toEqual({
      state: "waiting",
      nextStage: 3,
      dueAt: Date.UTC(1970, 0, 2, 1),
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

  test("real CS outbound arms H+1 for the next Jakarta calendar day", () => {
    expect(armH1AfterOutbound(5_000, "aisyah", 7_000)).toEqual({
      csKey: "aisyah",
      nextStage: 1,
      dueAt: Date.UTC(1970, 0, 2, 1),
      state: "waiting",
    });
  });

  test("next due is 08:00 WIB on the next calendar day", () => {
    const sentAt = Date.UTC(2026, 7, 12, 13, 30); // 12 Aug 20:30 WIB
    expect(nextJakartaDueAt(sentAt)).toBe(Date.UTC(2026, 7, 13, 1, 0));
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

  test("external provider outbound may advance a waiting cycle before its due time", () => {
    const valid = {
      status: "active" as const,
      followUpState: "waiting" as const,
      nextStage: 1 as const,
      dueAt: 10_000,
      cycleInboundAt: 5_000,
      createdAt: 10_000,
      role: "cs" as const,
      direction: "outbound" as const,
      source: "ingest",
      externalMessageId: "wamid.phone.1",
      isInternal: false,
    };
    expect(shouldAdvanceDueOutbound(valid)).toBe(true);
    expect(shouldAdvanceDueOutbound({ ...valid, status: "closed" })).toBe(false);
    expect(shouldAdvanceDueOutbound({ ...valid, isInternal: true })).toBe(false);
    expect(shouldAdvanceDueOutbound({ ...valid, source: "n8n" })).toBe(false);
    expect(shouldAdvanceDueOutbound({ ...valid, createdAt: 9_999 })).toBe(true);
  });
});
