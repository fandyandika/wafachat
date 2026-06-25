import { expect, test } from "vitest";
import { median, percentile, pairResponseEvents, type RtMessage } from "./responseTimeMath";

test("median: odd, even, empty", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([10, 20, 30, 40])).toBe(25);
  expect(median([])).toBe(null);
});

test("percentile: nearest-rank p90, empty", () => {
  expect(percentile([60000, 120000], 0.9)).toBe(120000); // ceil(0.9*2)=2 -> sorted[1]
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9); // ceil(9)=9 -> sorted[8]
  expect(percentile([], 0.9)).toBe(null);
});

const m = (direction: "inbound" | "outbound", createdAt: number, messageType = "text", role = "cs"): RtMessage =>
  ({ direction, messageType, role, createdAt });

test("pairResponseEvents: greeting -> reply = first; second turn = ongoing", () => {
  const r = pairResponseEvents([
    m("outbound", 0, "template", "cs"),     // auto-template BEFORE greeting -> ignored
    m("inbound", 1000, "text", "customer"), // greeting
    m("outbound", 61000),                   // CS reply 60s later -> first = 60000
    m("inbound", 100000, "button", "customer"), // COD click
    m("outbound", 130000),                  // reply 30s later -> ongoing 2nd
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000, 30000]);
});

test("pairResponseEvents: template/system outbound after inbound is skipped (no false fast)", () => {
  const r = pairResponseEvents([
    m("inbound", 1000, "text", "customer"),
    m("outbound", 1500, "template", "cs"),  // template lands during pending -> skipped, NOT a reply
    m("outbound", 2000, "text", "system"),  // system -> skipped
    m("outbound", 61000, "text", "cs"),     // real reply -> 60000 (not 500)
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000]);
});

test("pairResponseEvents: outbound with no pending inbound emits nothing", () => {
  const r = pairResponseEvents([m("outbound", 0), m("outbound", 5000)]);
  expect(r.firstReplyMs).toBe(null);
  expect(r.allReplyMs).toEqual([]);
});

test("pairResponseEvents: multiple inbounds before a reply use the FIRST", () => {
  const r = pairResponseEvents([
    m("inbound", 1000, "text", "customer"),
    m("inbound", 2000, "text", "customer"),
    m("inbound", 3000, "text", "customer"),
    m("outbound", 61000),                   // 60s from the FIRST inbound
  ]);
  expect(r.firstReplyMs).toBe(60000);
  expect(r.allReplyMs).toEqual([60000]);
});

import { businessMinutesBetween, isSlaBreach } from "./responseTimeMath";

// WIB (UTC+7) wall-clock -> UTC ms helper for tests.
const wib = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo, d, h, mi) - 7 * 60 * 60 * 1000;

test("businessMinutesBetween counts only 05:30-18:00 WIB", () => {
  // 10:00 -> 10:20 same day = 20 active min
  expect(businessMinutesBetween(wib(2026, 5, 24, 10, 0), wib(2026, 5, 24, 10, 20))).toBe(20);
  // 17:55 -> next 06:00 = 5 (17:55-18:00) + 30 (05:30-06:00) = 35
  expect(businessMinutesBetween(wib(2026, 5, 24, 17, 55), wib(2026, 5, 25, 6, 0))).toBe(35);
  // 20:00 -> 20:10 (fully off-hours) = 0
  expect(businessMinutesBetween(wib(2026, 5, 24, 20, 0), wib(2026, 5, 24, 20, 10))).toBe(0);
  // 20:00 -> next 05:40 = 10 (05:30-05:40)
  expect(businessMinutesBetween(wib(2026, 5, 24, 20, 0), wib(2026, 5, 25, 5, 40))).toBe(10);
  // end <= start
  expect(businessMinutesBetween(wib(2026, 5, 24, 10, 0), wib(2026, 5, 24, 10, 0))).toBe(0);
});

test("isSlaBreach: strictly greater than threshold", () => {
  // exactly 15 active min -> not a breach
  expect(isSlaBreach(wib(2026, 5, 24, 10, 0), wib(2026, 5, 24, 10, 15))).toBe(false);
  // 16 active min -> breach
  expect(isSlaBreach(wib(2026, 5, 24, 10, 0), wib(2026, 5, 24, 10, 16))).toBe(true);
});

test("pairResponseEvents returns first reply timestamps", () => {
  const i = wib(2026, 5, 24, 10, 0);
  const o = wib(2026, 5, 24, 10, 5);
  const r = pairResponseEvents([
    { direction: "inbound", messageType: "text", role: "customer", createdAt: i },
    { direction: "outbound", messageType: "text", role: "cs", createdAt: o },
  ]);
  expect(r.firstInboundAt).toBe(i);
  expect(r.firstReplyAt).toBe(o);
  // no reply -> nulls
  const r2 = pairResponseEvents([{ direction: "inbound", messageType: "text", role: "customer", createdAt: i }]);
  expect(r2.firstInboundAt).toBeNull();
  expect(r2.firstReplyAt).toBeNull();
});

test("pairResponseEvents: gap is ACTIVE-hours ms, not wall-clock (after-hours wait excluded)", () => {
  // inbound 17:55, reply 06:00 next day -> 5 (17:55-18:00) + 30 (05:30-06:00) = 35 active min,
  // NOT the ~12h wall-clock. Keeps the response median on the same clock as the SLA.
  const r = pairResponseEvents([
    { direction: "inbound", messageType: "text", role: "customer", createdAt: wib(2026, 5, 24, 17, 55) },
    { direction: "outbound", messageType: "text", role: "cs", createdAt: wib(2026, 5, 25, 6, 0) },
  ]);
  expect(r.firstReplyMs).toBe(35 * 60_000);
  expect(r.allReplyMs).toEqual([35 * 60_000]);
});

test("pairResponseEvents: a chat ENTIRELY off-hours falls back to wall-clock (no false 'instant')", () => {
  // inbound 20:00, reply 20:05 -> both outside 05:30-18:00 -> 0 active min -> wall-clock 5 min,
  // so an evening-shift CS isn't credited as instant (which would game the speed ranking).
  const r = pairResponseEvents([
    { direction: "inbound", messageType: "text", role: "customer", createdAt: wib(2026, 5, 24, 20, 0) },
    { direction: "outbound", messageType: "text", role: "cs", createdAt: wib(2026, 5, 24, 20, 5) },
  ]);
  expect(r.firstReplyMs).toBe(5 * 60_000);
});
