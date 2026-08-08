import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import { api } from "@/convex/_generated/api";

(globalThis as any).React = React;
const { snapshotMock, responseMock } = vi.hoisted(() => ({
  snapshotMock: vi.fn(),
  responseMock: vi.fn(),
}));

vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: unknown[]) => {
    snapshotMock(...args);
    return { data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() };
  },
}));
vi.mock("@/components/panel/use-response-times", () => ({
  useResponseTimesState: (args: unknown) => {
    responseMock(args);
    return { data: undefined, loading: false, error: null };
  },
}));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ startAt: 1, endAt: 2, jakartaDate: "2026-08-08", range: "today" }),
  resolveRange: () => ({ startAt: 1, endAt: 2 }),
}));

import { useDashboardData } from "./use-dashboard-data";

function Probe() {
  useDashboardData({
    range: {
      date: "2026-08-07",
      basis: "calendar",
      startAt: 100,
      endAt: 200,
      running: false,
    },
    includeDuplicates: false,
  });
  return <div>probe</div>;
}

beforeEach(() => {
  snapshotMock.mockClear();
  responseMock.mockClear();
});

test("uses only the explicitly applied Dashboard bounds", () => {
  renderToStaticMarkup(<Probe />);

  expect(snapshotMock).toHaveBeenCalledWith(api.metrics.getDashboardSummary, {
    startAt: 100,
    endAt: 200,
    csName: undefined,
    raw: true,
  });
  expect(snapshotMock).toHaveBeenCalledWith(api.metrics.getDuplicateOrders, "skip");
  expect(snapshotMock).toHaveBeenCalledWith(api.shippingRecaps.getPerformance, {
    startAt: 100,
    endAt: 200,
    csName: undefined,
    includeInferredDiscount: false,
  });
  expect(responseMock).toHaveBeenCalledWith({ startAt: 100, endAt: 200, csName: undefined, refreshKey: 0 });
});
