// convex/followUpMath.test.ts
import { expect, test } from "vitest";
import { eligibleStage, FOLLOWUP_STAGES, type CandidacyInput } from "./followUpMath";

const HOUR = 3_600_000;
const base = (over: Partial<CandidacyInput>): CandidacyInput => ({
  lastInboundAt: 0, lastMessageOutbound: true, isClosed: false,
  touchCount: 0, lastTouchAt: null, now: 30 * HOUR, ...over,
});

test("ghosted, 30h since inbound, 0 touches -> stage 1 (H+1)", () => {
  expect(eligibleStage(base({ now: 30 * HOUR }))).toBe(1);
});

test("customer spoke last (not ghosted) -> null", () => {
  expect(eligibleStage(base({ lastMessageOutbound: false }))).toBeNull();
});

test("closed (recap/conversation) -> null", () => {
  expect(eligibleStage(base({ isClosed: true }))).toBeNull();
});

test("within 24h of last inbound -> null (window not yet closed)", () => {
  expect(eligibleStage(base({ now: 10 * HOUR }))).toBeNull();
});

test("1 touch, 50h old, 25h since touch -> stage 2 (H+2)", () => {
  expect(eligibleStage(base({ touchCount: 1, lastTouchAt: 25 * HOUR, now: 50 * HOUR }))).toBe(2);
});

test("1 touch but only 40h old -> null (H+2 needs >=48h)", () => {
  expect(eligibleStage(base({ touchCount: 1, lastTouchAt: 25 * HOUR, now: 40 * HOUR }))).toBeNull();
});

test("1 touch, 50h old, but only 8h since the touch -> null (needs >=12h gap)", () => {
  expect(eligibleStage(base({ touchCount: 1, lastTouchAt: 42 * HOUR, now: 50 * HOUR }))).toBeNull();
});

test("2 touches, 70h old, 20h since touch -> stage 3 (H+2B, goodbye)", () => {
  expect(eligibleStage(base({ touchCount: 2, lastTouchAt: 50 * HOUR, now: 70 * HOUR }))).toBe(3);
});

test("2 touches but only 50h old -> null (H+2B needs >=60h)", () => {
  expect(eligibleStage(base({ touchCount: 2, lastTouchAt: 35 * HOUR, now: 50 * HOUR }))).toBeNull();
});

test("3 touches -> null (funnel done, all sent)", () => {
  expect(eligibleStage(base({ touchCount: 3, lastTouchAt: 70 * HOUR, now: 90 * HOUR }))).toBeNull();
});

test("ANTI-DOUBLE: 1 touch keeps it out of H+1, and too early for H+2 -> null", () => {
  expect(eligibleStage(base({ touchCount: 1, lastTouchAt: 25 * HOUR, now: 30 * HOUR }))).toBeNull();
});

test("config: three stages, H+1 -> H+2 -> H+2B", () => {
  expect(FOLLOWUP_STAGES.map((s) => s.label)).toEqual(["H+1", "H+2", "H+2B"]);
});
