import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

(globalThis as any).React = React;
const { snapshots, viewer } = vi.hoisted(() => ({
  snapshots: vi.fn(),
  viewer: { current: { role: "admin", name: "Owner", email: "owner@wafachat", orgName: "Pustaka Islam" } as Record<string, unknown> },
}));

vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ startAt: 1, endAt: 2, csName: undefined, jakartaDate: "2026-08-02", range: "today" }),
}));
vi.mock("@/components/panel/use-response-times", () => ({ useResponseTimes: () => null }));
vi.mock("@/components/panel/use-me", () => ({ useMe: () => viewer.current }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: unknown[]) => snapshots(...args),
}));

import DashboardPage from "./page";

beforeEach(() => {
  snapshots.mockReset();
  viewer.current = { role: "admin", name: "Owner", email: "owner@wafachat", orgName: "Pustaka Islam" };
});

test("dashboard renders the operational snapshot without a disabled trend", () => {
  snapshots
    .mockReturnValueOnce({ data: { leads: 12, closings: 8, manualClosings: 8, cancelled: 0, handovers: 0, revenue: 1_500_000 }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: [], loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: { totalClosing: 8, overallCr: 66.7, cancelled: 0, cs: [], products: [] }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() });

  const html = renderToStaticMarkup(<DashboardPage />);
  expect(html).toContain("Perlu perhatian");
  expect(html).toContain("Tidak ada perhatian mendesak");
  expect(html).toContain("Kinerja bisnis");
  expect(html).toContain("Leads");
  expect(html).toContain("Closing Rate");
  expect(html).toContain("Top CS");
  expect(html).toContain("Top Produk");
  expect(html).not.toContain("Trend Harian");
  expect(html).not.toContain("Pekerjaan berikutnya");
  expect(html).not.toContain("Order Double");
  expect(snapshots).toHaveBeenCalledTimes(3);
  expect(snapshots.mock.calls[0][1]).toMatchObject({ raw: true });
  expect(snapshots.mock.calls[1][1]).not.toBe("skip");
});

test("CS dashboard prioritizes scoped next work without owner-only figures", () => {
  viewer.current = { role: "cs", name: "Aisyah", email: "aisyah@wafachat", csName: "Aisyah", orgName: "Pustaka Islam" };
  snapshots
    .mockReturnValueOnce({ data: { leads: 12, closings: 8, manualClosings: 8, cancelled: 0, handovers: 0, revenue: 1_500_000 }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() })
    .mockReturnValueOnce({ data: { totalClosing: 8, overallCr: 66.7, cancelled: 0, cs: [], products: [] }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() });

  const html = renderToStaticMarkup(<DashboardPage />);
  expect(html).toContain("Pekerjaan berikutnya");
  expect(html).toContain("H+1");
  expect(html).toContain("H+2");
  expect(html).toContain("H+3");
  expect(html).toContain("Progress saya");
  expect(html).toContain('href="/panel/follow-up"');
  expect(html).toContain('href="/panel/laporan"');
  expect(html).not.toContain("Omzet");
  expect(html).not.toContain("Top CS");
  expect(html).not.toContain("Top Produk");
  expect(snapshots).toHaveBeenCalledTimes(3);
  expect(snapshots.mock.calls[1][1]).toBe("skip");
});
