import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;
vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn() }));

import { FollowUpTemplateSettings } from "./follow-up-template-settings";

test("template settings explain readiness and require all three ordered stages", () => {
  const html = renderToStaticMarkup(<FollowUpTemplateSettings />);
  expect(html).toContain("Template Follow-up");
  expect(html).toContain("H+1");
  expect(html).toContain("H+2");
  expect(html).toContain("H+3");
  expect(html).toContain("Urutan variabel");
  expect(html).not.toContain("App Secret");
  expect(html).not.toContain("API key");
});
