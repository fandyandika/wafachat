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
