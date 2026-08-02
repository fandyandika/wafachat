import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as any).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import LoginPage from "./page";

test("login presents a labelled Wafachat sign-in form", () => {
  const html = renderToStaticMarkup(<LoginPage />);

  expect(html).toContain("Masuk ke Wafachat");
  expect(html).toContain('for="email"');
  expect(html).toContain('for="password"');
  expect(html).toContain('autoComplete="email"');
  expect(html).toContain('autoComplete="current-password"');
});
