import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
const state = vi.hoisted(() => ({
  viewer: { name: "Admin", role: "admin" as "admin" | "cs", email: "admin@wafachat", csName: undefined as string | undefined },
  response: null as any,
  snapshots: [] as any[],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/panel/laporan",
}));
vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-me", () => ({ useMe: () => state.viewer }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ csName: undefined }) }));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => state.response }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: () => state.snapshots.shift() ?? ({ data: undefined, loading: true, error: null, lastUpdatedAt: null, refresh: vi.fn() }),
}));

import { DailyReportDashboard } from "./daily-report-dashboard";

test("daily report exposes one labelled toolbar while loading", () => {
  state.snapshots = [];
  const html = renderToStaticMarkup(<DailyReportDashboard />);
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Kontrol laporan"');
  expect(html).toContain("Periode kerja 16:00");
  expect(html).toContain('for="report-day"');
  expect(html).toContain('for="report-cs"');
  expect(html).not.toContain("Snapshot analytics");
});

test("CS Arena uses the canonical team Queen instead of crowning the signed-in CS", () => {
  state.viewer = { name: "Aisyah", role: "cs", email: "aisyah@wafachat", csName: "Aisyah" };
  state.response = {
    overall: { firstReplyMedianMs: 60_000, firstReplyCount: 5, slaBreaches: 0 },
    cs: [{ csName: "Aisyah", firstReplyMedianMs: 60_000, firstReplyP90Ms: 60_000, firstReplyCount: 5, slaBreaches: 0 }],
  };
  const report = {
    totals: { leads: 20, closings: 14, cr: 70, revenue: 0, discount: 0, cpDiscount: 0 },
    cs: [
      { csName: "Aisyah", leads: 10, closings: 7, cr: 70, revenue: 0, discount: 0, cpDiscount: 0, duplicates: 0, products: [] },
      { csName: "Azelia", leads: 10, closings: 7, cr: 70, revenue: 0, discount: 0, cpDiscount: 0, duplicates: 0, products: [] },
    ],
  };
  const score = (csName: string, value: number) => ({
    csName, score: value, eligible: true, cr: 70, closings: 7,
    respMedianMs: csName === "Azelia" ? 60_000 : 20 * 60_000,
    crWpts: 37.5, closeWpts: 35, speedWpts: csName === "Azelia" ? 15 : 0,
  });
  state.snapshots = [
    { data: report, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() },
    { data: { winnerCsName: "Azelia", scores: [score("Azelia", 87.5), score("Aisyah", 72.5)], sealed: false }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() },
    { data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() },
  ];

  const html = renderToStaticMarkup(<DailyReportDashboard />);

  expect(html).toContain("Azelia");
  expect(html).not.toContain("Takhta masih milikmu, Aisyah");
});

test("excluded reward days keep the report but do not crown a daily Queen", () => {
  state.viewer = { name: "Admin", role: "admin", email: "admin@wafachat", csName: undefined };
  state.response = { overall: { firstReplyMedianMs: null, firstReplyCount: 0, slaBreaches: 0 }, cs: [] };
  const report = {
    totals: { leads: 10, closings: 7, cr: 70, revenue: 0, discount: 0, cpDiscount: 0 },
    cs: [{ csName: "Aisyah", leads: 10, closings: 7, cr: 70, revenue: 0, discount: 0, cpDiscount: 0, duplicates: 0, products: [] }],
  };
  state.snapshots = [
    { data: report, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() },
    { data: { winnerCsName: null, scores: [], sealed: true, excludedReason: "Ahad" }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() },
    { data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() },
  ];

  const html = renderToStaticMarkup(<DailyReportDashboard />);

  expect(html).toContain("Queen tidak dihitung · Ahad");
  expect(html).not.toContain("Queen CS · juara umum");
  expect(html).toContain("Aisyah");
});
