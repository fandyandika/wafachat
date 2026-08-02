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

import {
  SettingsDashboard,
  settingsSectionsForRole,
} from "./settings-dashboard";

test("settings uses task sections and no native browser dialogs", () => {
  const html = renderToStaticMarkup(<SettingsDashboard />);
  const source = readFileSync(
    new URL("./settings-dashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(html).toContain('aria-label="Bagian pengaturan"');
  expect(html).toContain("Akun");
  expect(html).not.toContain("Organisasi");
  expect(html).not.toContain("Tim");
  expect(html).not.toContain("Konfigurasi CS");
  expect(source).not.toContain("window.prompt");
  expect(source).not.toContain("window.confirm");
  expect(source).not.toMatch(/\balert\(/);
  expect(source).toContain('htmlFor={`${cs.key}-${field}`}');
  expect(source).toContain('id={`${cs.key}-${field}`}');
  expect(source).toContain("min-h-11 cursor-pointer");
});

test("only administrators receive administrative setting sections", () => {
  expect(settingsSectionsForRole(null).map((section) => section.value)).toEqual([
    "account",
  ]);
  expect(settingsSectionsForRole("cs").map((section) => section.value)).toEqual([
    "account",
  ]);
  expect(settingsSectionsForRole("admin").map((section) => section.value)).toEqual([
    "account",
    "organization",
    "team",
    "cs",
  ]);
});
