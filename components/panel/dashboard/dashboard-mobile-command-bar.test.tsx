import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { DashboardMobileCommandBar } from "./dashboard-mobile-command-bar";

(globalThis as any).React = React;

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <>{children}</>,
  SheetContent: ({ children, className, side }: any) => <div className={className} data-side={side}>{children}</div>,
  SheetHeader: ({ children, className }: any) => <header className={className}>{children}</header>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
  SheetTrigger: ({ children }: any) => <>{children}</>,
}));

const runningRange = {
  date: "2026-08-10",
  basis: "calendar" as const,
  startAt: Date.parse("2026-08-10T00:00:00+07:00"),
  endAt: Date.parse("2026-08-11T00:00:00+07:00"),
  running: true,
};

test("compresses active Dashboard context into touch-safe mobile controls", () => {
  const html = renderToStaticMarkup(
    <DashboardMobileCommandBar
      today="2026-08-10"
      currentWorkDate="2026-08-09"
      applied={{ date: "2026-08-10", basis: "calendar" }}
      range={runningRange}
      periodLabel="Hari kalender"
      updatedAt="14.01.10"
      loading={false}
      onApply={() => undefined}
      onRefresh={() => undefined}
    />,
  );

  expect(html).toContain('data-dashboard-mobile-command-bar="true"');
  expect(html).toContain("10 Agu");
  expect(html).toContain("Hari kalender");
  expect(html).toContain("Diperbarui 14.01.10");
  expect(html).toContain("Atur");
  expect(html).toContain('aria-label="Refresh Dashboard"');
  expect(html).toContain("min-h-11");
  expect(html).toContain('data-side="bottom"');
  expect(html).toContain("Atur periode Dashboard");
  expect(html).toContain("10 Agu 00.00");
  expect(html).toContain("11 Agu 00.00 WIB");
  expect(html).toContain("Buka Performance");
  expect(html).toContain("/panel/performance?period=day&amp;date=2026-08-10&amp;basis=calendar");
});

test("marks historical context and disables refresh feedback while loading", () => {
  const html = renderToStaticMarkup(
    <DashboardMobileCommandBar
      today="2026-08-10"
      currentWorkDate="2026-08-09"
      applied={{ date: "2026-08-07", basis: "work" }}
      range={{
        date: "2026-08-07",
        basis: "work",
        startAt: Date.parse("2026-08-07T16:00:00+07:00"),
        endAt: Date.parse("2026-08-08T16:00:00+07:00"),
        running: false,
      }}
      periodLabel="Periode kerja"
      updatedAt="14.02.00"
      loading
      onApply={() => undefined}
      onRefresh={() => undefined}
    />,
  );

  expect(html).toContain("7 Agu");
  expect(html).toContain("Cutoff CS");
  expect(html).toContain("16.00");
  expect(html).toContain("Mode histori");
  expect(html).toContain("7 Agu 16.00");
  expect(html).toContain("8 Agu 16.00 WIB");
  expect(html).toContain('aria-label="Refresh Dashboard"');
  expect(html).toContain("disabled");
  expect(html).toContain("animate-spin");
});
