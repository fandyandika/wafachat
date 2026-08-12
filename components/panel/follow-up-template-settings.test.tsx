import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;
vi.mock("convex/react", () => ({
  useQuery: () => ({
    templates: [{
      stage: 1,
      label: "Follow-up H+1",
      templateName: "follow_up_h1",
      language: "id",
      variables: ["customer_name", "product_name", "order_id"],
      matchPatterns: ["masih berminat kak"],
      isActive: true,
    }],
    ready: false,
    missingStages: [2, 3],
  }),
  useMutation: () => vi.fn(),
}));

import { FollowUpTemplateSettings } from "./follow-up-template-settings";

test("template settings explain readiness and require all three ordered stages", () => {
  const html = renderToStaticMarkup(<FollowUpTemplateSettings />);
  expect(html).toContain("Template Follow-up");
  expect(html).toContain("H+1");
  expect(html).toContain("H+2");
  expect(html).toContain("H+3");
  expect(html).toContain("Urutan variabel");
  expect(html).toContain('for="follow-up-patterns-1"');
  expect(html).toContain("Pola pesan manual H+1");
  expect(html).toContain("masih berminat kak");
  expect(html).not.toContain("App Secret");
  expect(html).not.toContain("API key");
});
