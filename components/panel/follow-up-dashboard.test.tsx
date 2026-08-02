import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ cs: "all" }) }));

import {
  fetchFollowUpSnapshot,
  FollowUpDashboard,
  FollowUpSnapshotError,
  getNextFollowUpTabIndex,
  RowCheck,
} from "./follow-up-dashboard";

test("follow-up exposes queue navigation and labelled search", () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Antrean follow-up"');
  expect(html).toContain('aria-label="Cari customer"');
  expect(html).toContain('<label for="follow-up-search" class="text-xs font-medium text-muted-foreground">Cari customer</label>');
  expect(html).toContain('min-h-11');
  expect(html).toContain('transition-colors md:min-h-9');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("Semua");
  expect(html).toContain("Arsip");
});

test("snapshot failure is announced with a retry and a retry can recover", async () => {
  const retry = vi.fn();
  const errorHtml = renderToStaticMarkup(<FollowUpSnapshotError message="Snapshot gagal" retrying={false} onRetry={retry} />);
  expect(errorHtml).toContain('role="alert"');
  expect(errorHtml).toContain("Snapshot gagal");
  expect(errorHtml).toContain("Coba lagi");

  const request = vi.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: "Snapshot gagal" }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        candidates: { stage1: [], stage2: [], stage3: [] },
        kpi: { totalClosings: 0, fromFollowUp: 0, byStage: { h1: 0, h2: 0, h3: 0 } },
      }),
    });

  await expect(fetchFollowUpSnapshot("CS Alpha", request as typeof fetch)).rejects.toThrow("Snapshot gagal");
  await expect(fetchFollowUpSnapshot("CS Alpha", request as typeof fetch)).resolves.toMatchObject({
    candidates: { stage1: [], stage2: [], stage3: [] },
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenNthCalledWith(1, "/api/follow-up/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csName: "CS Alpha" }),
  });

  const offlineRequest = vi.fn().mockRejectedValue(new Error("Jaringan terputus"));
  await expect(fetchFollowUpSnapshot("CS Alpha", offlineRequest as typeof fetch)).rejects.toThrow("Jaringan terputus");
});

test("queue keyboard navigation wraps and supports Home and End", () => {
  expect(getNextFollowUpTabIndex("ArrowRight", 5, 6)).toBe(0);
  expect(getNextFollowUpTabIndex("ArrowLeft", 0, 6)).toBe(5);
  expect(getNextFollowUpTabIndex("Home", 3, 6)).toBe(0);
  expect(getNextFollowUpTabIndex("End", 1, 6)).toBe(5);
  expect(getNextFollowUpTabIndex("Enter", 1, 6)).toBeNull();
});

test("mobile follow-up controls and row selection keep 44px targets", () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  const check = renderToStaticMarkup(<RowCheck checked={false} onToggle={vi.fn()} />);
  expect(html).toMatch(/title="Urutkan[^>]+min-h-11[^>]+md:min-h-9/);
  expect(html).toMatch(/title="Muat ulang daftar"[^>]+min-h-11[^>]+min-w-11/);
  expect(html).toMatch(/title="Filter per CS"[^>]+min-h-11[^>]+md:min-h-9/);
  expect(html.match(/role="tab"[^>]+min-h-11[^>]+md:min-h-9/g)).toHaveLength(6);
  expect(check).toMatch(/h-11 w-11[^>]+md:h-9 md:w-9/);
});
