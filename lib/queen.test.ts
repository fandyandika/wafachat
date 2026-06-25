import { expect, test } from "vitest";
import { computeQueenCs, QUEEN_TARGETS } from "./queen";

const row = (csName: string, closings: number, cr: number, leads: number, respMedianMs: number | null, respCount: number) =>
  ({ csName, closings, cr, leads, respMedianMs, respCount });

test("absolute scorecard: the best all-rounder wins", () => {
  const q = computeQueenCs([
    row("Alpha", 30, 70, 20, 120_000, 10), // balanced: CR 70, 30 closings, 2min
    row("Beta", 35, 55, 20, 180_000, 10),  // most closings but lower CR
    row("Gamma", 20, 78, 20, 600_000, 10), // best CR but low volume + slow
  ]);
  expect(q?.csName).toBe("Alpha");
});

test("absolute: lowest-CR CS is NOT crushed to zero — strong volume+speed still competes", () => {
  // Alpha has the LOWEST CR (56%) but most closings + fastest. Under rank/min-max its CR would
  // be 0; under the absolute scorecard 56% earns real points (40/100), so Alpha can still win.
  const q = computeQueenCs([
    row("Alpha", 40, 56, 30, 60_000, 10),
    row("Beta", 20, 58, 30, 1_200_000, 10),
  ]);
  expect(q?.csName).toBe("Alpha");
});

test("CR is clamped to the target band: above ceiling caps at 100, below floor at 0", () => {
  const q = computeQueenCs([
    row("Alpha", 10, 95, 20, 600_000, 10), // CR 95 (>ceil) must not score >100
    row("Beta", 10, 30, 20, 600_000, 10),  // CR 30 (<floor) scores 0 CR
  ]);
  expect(q?.csName).toBe("Alpha");
  expect(QUEEN_TARGETS.crCeil).toBe(80);
});

test("eligibility: a CS with leads < 10 is excluded even with huge numbers", () => {
  const q = computeQueenCs([
    row("Mega", 99, 99, 5, 1_000, 10), // leads < 10 -> excluded
    row("Beta", 12, 60, 20, 200_000, 10),
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

test("no speed data (respCount < 5) -> 0 speed points but still scored on CR + closings", () => {
  const q = computeQueenCs([
    row("Alpha", 30, 70, 20, null, 0),    // dominates results, no speed sample
    row("Beta", 20, 50, 20, 60_000, 10),  // only the speed lead
  ]);
  expect(q?.csName).toBe("Alpha");
});
