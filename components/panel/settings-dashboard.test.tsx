import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("convex/react", () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
}));

import { SettingsDashboard } from "./settings-dashboard";

test("settings uses task sections and no native browser dialogs", () => {
  const html = renderToStaticMarkup(<SettingsDashboard />);
  const source = readFileSync(
    new URL("./settings-dashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(html).toContain('aria-label="Bagian pengaturan"');
  expect(html).toContain("Akun");
  expect(html).toContain("Organisasi");
  expect(html).toContain("Tim");
  expect(html).toContain("Konfigurasi CS");
  expect(source).not.toContain("window.prompt");
  expect(source).not.toContain("window.confirm");
  expect(source).not.toMatch(/\balert\(/);
});
