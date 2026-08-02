import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
const { snapshotMock } = vi.hoisted(() => ({ snapshotMock: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: () => [{ key: "aisyah", csName: "Aisyah", avatarUrl: null }],
}));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: any[]) => {
    snapshotMock(...args);
    return { data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() };
  },
}));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ startAt: 1, endAt: 2, csName: undefined }),
}));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/performance-panel", () => ({
  PerformancePanel: () => <div>Report loaded</div>,
}));

import PerformancePage from "./page";
import { api } from "@/convex/_generated/api";

test("performance stays idle until the owner submits a period", () => {
  const html = renderToStaticMarkup(<PerformancePage />);

  expect(snapshotMock).toHaveBeenCalledTimes(1);
  expect(snapshotMock).toHaveBeenLastCalledWith(api.performanceReports.getPerformanceReport, "skip");
  expect(html).toContain('aria-label="Filter laporan kinerja"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("min-h-11");
  expect(html).not.toContain("<h1");
  expect(html).toContain("Pilih periode lalu tampilkan laporan");
  expect(html).toContain("Semua CS");
  expect(html).not.toContain(">all<");
});
