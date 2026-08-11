import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
}));

import {
  loadTeamUsers,
  postTeamUser,
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
  for (const [control] of source.matchAll(
    /<(?:input|select|button)\b[\s\S]*?\n\s*>/g,
  )) {
    expect(control).toMatch(/(?:min-h-11|size-11)/);
  }
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
    "expedition",
    "follow-up",
  ]);
});

test("team loading reports response and JSON failures", async () => {
  const denied = vi.fn().mockResolvedValue({
    ok: false,
    json: vi.fn().mockResolvedValue({ error: "Tidak diizinkan" }),
  }) as unknown as typeof fetch;
  await expect(loadTeamUsers(denied)).rejects.toThrow("Tidak diizinkan");

  const malformed = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ users: null }),
  }) as unknown as typeof fetch;
  await expect(loadTeamUsers(malformed)).rejects.toThrow(
    "Respons data tim tidak valid",
  );
});

test("team posting reports request and reload failures", async () => {
  const payload = { action: "delete", email: "cs@example.com" };
  const rejected = vi.fn().mockResolvedValue({
    ok: false,
    json: vi.fn().mockRejectedValue(new Error("invalid JSON")),
  }) as unknown as typeof fetch;
  await expect(postTeamUser(payload, rejected)).rejects.toThrow(
    "Gagal menyimpan user",
  );

  const reloadFailed = vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(new Error("Jaringan terputus")) as unknown as typeof fetch;
  await expect(postTeamUser(payload, reloadFailed)).rejects.toThrow(
    "Jaringan terputus",
  );
  expect(reloadFailed).toHaveBeenNthCalledWith(1, "/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(reloadFailed).toHaveBeenNthCalledWith(2, "/api/admin/users");
});
