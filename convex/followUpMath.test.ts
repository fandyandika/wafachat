// convex/followUpMath.test.ts
import { expect, test } from "vitest";
import { eligibleStage, FOLLOWUP_STAGES, type CandidacyInput } from "./followUpMath";

const HOUR = 3_600_000;
const base = (over: Partial<CandidacyInput>): CandidacyInput => ({
  lastInboundAt: 0, lastMessageOutbound: true, isClosed: false,
  touchCount: 0, lastTouchAt: null, now: 30 * HOUR, ...over,
});

test("ghosted, 30h since inbound, 0 touches -> stage 1 (H+1)", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 30 * HOUR }))).toBe(1);
});

test("customer spoke last (not ghosted) -> null", () => {
  expect(eligibleStage(base({ lastMessageOutbound: false }))).toBeNull();
});

test("closed (recap/conversation) -> null", () => {
  expect(eligibleStage(base({ isClosed: true }))).toBeNull();
});

test("within 24h of last inbound -> null (window not yet closed)", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 10 * HOUR }))).toBeNull();
});

test("older than 5-day ceiling -> null", () => {
  expect(eligibleStage(base({ lastInboundAt: 0, now: 130 * HOUR }))).toBeNull();
});

test("1 touch (H+1 done — manual-via-WABA OR API), 25h since touch, still silent -> stage 2", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, touchCount: 1, lastTouchAt: 25 * HOUR, now: 50 * HOUR,
  }))).toBe(2);
});

test("1 touch but only 10h since it -> null (too soon for H+2)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, touchCount: 1, lastTouchAt: 40 * HOUR, now: 50 * HOUR,
  }))).toBeNull();
});

test("ANTI-DOUBLE: 1 touch already sent keeps it OUT of H+1 even in the H+1 window", () => {
  // touchCount 1 (a CS already followed up by hand or via API). Timing still matches the H+1 window,
  // but touchCount !== 0 so H+1 is skipped, and <20h since the touch so H+2 isn't due yet -> neither.
  expect(eligibleStage(base({
    lastInboundAt: 0, touchCount: 1, lastTouchAt: 25 * HOUR, now: 30 * HOUR,
  }))).toBeNull();
});

test("2 touches -> null (funnel done)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, touchCount: 2, lastTouchAt: 50 * HOUR, now: 80 * HOUR,
  }))).toBeNull();
});

test("config: two stages, H+1 then H+2", () => {
  expect(FOLLOWUP_STAGES.map((s) => s.label)).toEqual(["H+1", "H+2"]);
});
