import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/components/panel/use-panel-filters", () => ({ usePanelFilters: () => ({ cs: "all" }) }));

import { FollowUpDashboard } from "./follow-up-dashboard";

test("follow-up exposes queue navigation and labelled search", () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Antrean follow-up"');
  expect(html).toContain('aria-label="Cari customer"');
  expect(html).toContain('<label for="follow-up-search" class="text-xs font-medium text-muted-foreground">Cari customer</label>');
  expect(html).toContain('min-h-11');
  expect(html).toContain('transition-colors md:min-h-9');
  expect(html).toContain("Semua");
  expect(html).toContain("Arsip");
});
