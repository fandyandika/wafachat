import { expect, test } from "vitest";
import { computeQueenCs } from "./queen";

const row = (csName: string, closings: number, cr: number, leads: number, respMedianMs: number | null, respCount: number) =>
  ({ csName, closings, cr, leads, respMedianMs, respCount });

test("crowns the best all-rounder (placing-weighted)", () => {
  // Alpha: #1 closing, #2 CR, #1 speed -> strongest overall.
  const q = computeQueenCs([
    row("Alpha", 30, 60, 20, 120_000, 10),
    row("Beta", 20, 70, 20, 300_000, 10),
    row("Gamma", 25, 50, 20, 600_000, 10),
  ]);
  expect(q?.csName).toBe("Alpha");
});

test("outlier-proof: the fastest CS with weak closing+CR does NOT win (speed is rank-based, 15%)", () => {
  const q = computeQueenCs([
    row("Alpha", 30, 60, 20, 600_000, 10), // best results, slow
    row("Beta", 10, 30, 20, 1_000, 10),    // fastest by a mile, worst results
    row("Gamma", 20, 50, 20, 300_000, 10),
  ]);
  expect(q?.csName).toBe("Alpha"); // a 1000x speed edge can't buy the crown
});

test("eligibility: a CS with leads < 10 is excluded even with huge numbers", () => {
  const q = computeQueenCs([
    row("Mega", 99, 99, 5, 1_000, 10), // leads < 10 -> excluded
    row("Beta", 12, 55, 20, 200_000, 10),
    row("Gamma", 8, 45, 15, 300_000, 10),
  ]);
  expect(q?.csName).toBe("Beta");
});

test("returns null when fewer than 2 CS qualify (>=10 leads)", () => {
  expect(computeQueenCs([row("Beta", 10, 50, 20, 60_000, 10), row("Gamma", 5, 40, 5, 30_000, 10)])).toBeNull();
});

test("deterministic on a tie (identical stats) -> a valid winner, not null", () => {
  const q = computeQueenCs([row("A", 10, 50, 20, 60_000, 10), row("B", 10, 50, 20, 60_000, 10)]);
  expect(q).not.toBeNull();
  expect(["A", "B"]).toContain(q!.csName);
});

test("no speed data (respCount < 5) is ranked slowest but still scored on closing + CR", () => {
  const q = computeQueenCs([
    row("Alpha", 20, 60, 20, null, 0),    // dominates results, no speed sample
    row("Beta", 10, 40, 20, 60_000, 10),  // only the speed lead
  ]);
  expect(q?.csName).toBe("Alpha");
});
