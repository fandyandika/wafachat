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

test("shows a selected-month Queen with daily recap and an ongoing week", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} month="2026-07" currentMonth="2026-07" onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Queen Bulan Terpilih");
  expect(html).toContain("Azelia");
  expect(html).toContain("Seri");
  expect(html).toContain("20 Jul 2026");
  expect(html).toContain("Berjalan");
});

test("marks historical weekly recap as complete", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} month="2026-07" currentMonth="2026-08" onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Selesai");
});
