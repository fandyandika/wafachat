import { expect, test } from "vitest";
import { computeQueenCs } from "./queen";

const row = (csName: string, closings: number, cr: number, leads: number, respMedianMs: number | null, respCount: number) =>
  ({ csName, closings, cr, leads, respMedianMs, respCount });

test("crowns the CS dominating closings + CR", () => {
  const q = computeQueenCs([row("Risma", 10, 50, 20, 60000, 10), row("Aisyah", 3, 20, 15, 30000, 10)]);
  expect(q?.csName).toBe("Risma");
});

test("a much faster CS with weak closings/CR does not overtake (speed only 20%)", () => {
  const q = computeQueenCs([
    row("Risma", 10, 50, 20, 120000, 10), // dominates closings+CR, slow
    row("Aisyah", 2, 10, 15, 10000, 10),  // fastest by far, weak results
  ]);
  expect(q?.csName).toBe("Risma");
});

test("returns null when fewer than 2 CS qualify", () => {
  expect(computeQueenCs([row("Risma", 5, 40, 10, 60000, 5)])).toBeNull();
  expect(computeQueenCs([row("Risma", 5, 40, 10, 60000, 5), row("Aisyah", 1, 50, 2, 30000, 5)])).toBeNull();
});

test("excludes CS with leads < 3 from qualification", () => {
  const q = computeQueenCs([
    row("Risma", 5, 40, 10, 60000, 5),
    row("Aisyah", 8, 90, 12, 30000, 5),
    row("Lila", 99, 99, 2, 1000, 5), // leads<3 -> excluded despite huge numbers
  ]);
  expect(q?.csName).toBe("Aisyah");
});

test("deterministic on a tie (identical stats) -> a valid winner, not null", () => {
  const q = computeQueenCs([row("A", 5, 50, 10, 60000, 5), row("B", 5, 50, 10, 60000, 5)]);
  expect(q).not.toBeNull();
  expect(["A", "B"]).toContain(q!.csName);
});

test("no speed data (all respCount<3) -> still crowns by closings + CR", () => {
  const q = computeQueenCs([row("Risma", 10, 50, 20, null, 0), row("Aisyah", 3, 20, 15, null, 0)]);
  expect(q?.csName).toBe("Risma");
});
