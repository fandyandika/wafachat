import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QueenRecapView } from "./queen-recap";

(globalThis as any).React = React;

const recap = {
  awards: [{ windowKey: "2026-07-20", status: "won" as const, winnerCsName: "Azelia", score: 82.5, leads: 10, closings: 8, cr: 80, respMedianMs: 60_000 }],
  monthly: { winners: ["Azelia"], winCount: 3, standings: [{ csKey: "azelia", csName: "Azelia", wins: 3 }] },
  weekly: [
    { week: 1, startKey: "2026-07-01", endKey: "2026-07-07", status: "complete" as const, winners: ["Azelia"], winCount: 2, standings: [] },
    { week: 2, startKey: "2026-07-08", endKey: "2026-07-14", status: "complete" as const, winners: ["Azelia", "Nabila"], winCount: 1, standings: [] },
    { week: 3, startKey: "2026-07-15", endKey: "2026-07-21", status: "running" as const, winners: [], winCount: 0, standings: [] },
    { week: 4, startKey: "2026-07-22", endKey: "2026-07-31", status: "upcoming" as const, winners: [], winCount: 0, standings: [] },
  ],
  setupNeeded: true,
};

test("shows a selected-month Queen with daily recap and an ongoing week", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} month="2026-07" currentMonth="2026-07" onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Queen Bulan Terpilih");
  expect(html).toContain("Azelia");
  expect(html).toContain("Seri");
  expect(html).toContain("20 Jul 2026");
  expect(html).toContain("Berjalan");
  expect(html).toContain("Selesai");
  expect(html).toContain("Akan datang");
  expect(html).toContain("22 Jul 2026 – 31 Jul 2026");
  expect(html).toContain("Menunggu penutupan 16:00");
  expect((html.match(/Pekan /g) ?? [])).toHaveLength(4);
});

test("marks historical weekly recap as complete", () => {
  const html = renderToStaticMarkup(<QueenRecapView recap={recap} month="2026-07" currentMonth="2026-08" onBackfill={() => undefined} busy={false} />);
  expect(html).toContain("Selesai");
});
