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
  useMe: () => ({ name: "Admin", role: "admin", email: "admin@wafachat" }),
}));
vi.mock("@/components/panel/pwa-install", () => ({ PwaInstallButton: () => null }));

import PanelLayout from "./layout";

test("shared panel layout has no analytics filters or propagated query state", () => {
  const html = renderToStaticMarkup(<PanelLayout><div>Settings content</div></PanelLayout>);
  expect(html).not.toContain("30 hari");
  expect(html).not.toContain("Bulan ini");
  expect(html).not.toContain("Semua CS");
  expect(html).toContain('href="/panel/performance"');
  expect(html).not.toContain("range=");
  expect(html).not.toContain("cs=");
});
