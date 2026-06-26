// convex/followUpMath.test.ts
import { expect, test } from "vitest";
import { eligibleStage, FOLLOWUP_STAGES, type CandidacyInput } from "./followUpMath";

const HOUR = 3_600_000;
const base = (over: Partial<CandidacyInput>): CandidacyInput => ({
  lastInboundAt: 0, lastMessageOutbound: true, isClosed: false,
  followUpStage: null, followUpStageAt: null, now: 30 * HOUR, ...over,
});

test("ghosted, 30h since inbound, no prior follow-up -> stage 1 (H+1)", () => {
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

test("got H+1, 26h later, still silent -> stage 2 (H+2)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 1, followUpStageAt: 26 * HOUR, now: 52 * HOUR,
  }))).toBe(2);
});

test("got H+1 but replied after it -> null (left the funnel)", () => {
  // lastInboundAt (30h) is AFTER followUpStageAt (26h) -> customer responded; also not ghosted now
  expect(eligibleStage(base({
    lastInboundAt: 30 * HOUR, lastMessageOutbound: false, followUpStage: 1,
    followUpStageAt: 26 * HOUR, now: 52 * HOUR,
  }))).toBeNull();
});

test("got H+1, customer replied after it then went quiet again -> null (left funnel)", () => {
  // lastMessageOutbound stays true so we reach the reply-detection guard (not the earlier ghost guard);
  // lastInboundAt (30h) >= followUpStageAt (26h) means they responded after H+1 -> drop from the funnel.
  expect(eligibleStage(base({
    lastInboundAt: 30 * HOUR, lastMessageOutbound: true,
    followUpStage: 1, followUpStageAt: 26 * HOUR, now: 52 * HOUR,
  }))).toBeNull();
});

test("got H+1 but only 10h passed -> null (too soon for H+2)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 1, followUpStageAt: 40 * HOUR, now: 50 * HOUR,
  }))).toBeNull();
});

test("already at H+2 -> null (funnel done)", () => {
  expect(eligibleStage(base({
    lastInboundAt: 0, followUpStage: 2, followUpStageAt: 50 * HOUR, now: 80 * HOUR,
  }))).toBeNull();
});

test("config: two stages, H+1 then H+2", () => {
  expect(FOLLOWUP_STAGES.map((s) => s.label)).toEqual(["H+1", "H+2"]);
});
