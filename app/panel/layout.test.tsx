import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/panel/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("range=30d&cs=Aisyah"),
}));
vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-panel-filters", () => ({
  usePanelFilters: () => ({ range: "30d", cs: "Aisyah" }),
}));
vi.mock("@/components/panel/use-me", () => ({
  useMe: () => ({ name: "Admin", role: "admin", email: "admin@wafachat", orgName: "Pustaka Islam" }),
}));
vi.mock("@/components/panel/pwa-install", () => ({ PwaInstallButton: () => null }));

import PanelLayout, { navItemsForRole } from "./layout";

test("panel navigation exposes only routes allowed for each role", () => {
  expect(navItemsForRole("admin").map((item) => item.href)).toEqual([
    "/panel",
    "/panel/performance",
    "/panel/laporan",
    "/panel/follow-up",
    "/panel/settings",
  ]);
  expect(navItemsForRole("cs").map((item) => item.href)).toEqual([
    "/panel",
    "/panel/laporan",
    "/panel/follow-up",
  ]);
});

test("panel shell exposes one accessible content target without legacy global filters", () => {
  const html = renderToStaticMarkup(<PanelLayout><div>Settings content</div></PanelLayout>);
  expect(html).toContain('href="#panel-main"');
  expect(html).toContain('id="panel-main"');
  expect(html).toContain("Lewati navigasi");
  expect(html).not.toContain("30 hari");
  expect(html).not.toContain("Semua CS");
  expect((html.match(/wafachat-wordmark\.png/g) ?? [])).toHaveLength(1);
  expect(html).toContain('href="/panel/performance"');
  expect(html).not.toContain("range=");
  expect(html).not.toContain("cs=");
  expect(html).toContain("Pustaka Islam");
  expect(html).toContain("Owner");
});
