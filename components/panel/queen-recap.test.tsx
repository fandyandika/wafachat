import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QueenRecapView } from "./queen-recap";

(globalThis as any).React = React;

const recap = {
  awards: [{ windowKey: "2026-07-20", status: "won" as const, winnerCsName: "Azelia", score: 82.5, leads: 10, closings: 8, cr: 80, respMedianMs: 60_000 }],
  monthly: { winners: ["Azelia"], winCount: 3, standings: [{ csKey: "azelia", csName: "Azelia", wins: 3 }] },
  weekly: [{ weekStart: "2026-07-20", winners: ["Azelia", "Nabila"], winCount: 1, standings: [] }],
  setupNeeded: true,
};

test("shows monthly Queen, weekly tie, and the dated daily winner", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Queen Bulan Ini");
  expect(html).toContain("Azelia");
  expect(html).toContain("Seri");
  expect(html).toContain("20 Jul 2026");
});

test("shows setup action only while a completed day is missing", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Siapkan rekap bulan ini");
});
