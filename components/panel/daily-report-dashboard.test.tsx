import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/panel/laporan",
}));
vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-me", () => ({ useMe: () => ({ name: "Admin", role: "admin" }) }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ csName: undefined }) }));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: () => ({ data: undefined, loading: true, error: null, lastUpdatedAt: null, refresh: vi.fn() }),
}));

import { DailyReportDashboard } from "./daily-report-dashboard";

test("daily report exposes one labelled toolbar while loading", () => {
  const html = renderToStaticMarkup(<DailyReportDashboard />);
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Kontrol laporan"');
  expect(html).toContain("Periode kerja 16:00");
  expect(html).not.toContain("Snapshot analytics");
});
