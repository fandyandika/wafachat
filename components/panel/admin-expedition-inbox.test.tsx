import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => ({
    channel: { id: "channel-1", name: "Admin Ekspedisi", provider: "kirimdev", providerNumberId: "pn-admin", isActive: true },
    templates: [{ id: "template-1", channelId: "channel-1", label: "Status paket", templateName: "status_paket", language: "id", category: "expedition", variables: [], isActive: true }],
    ready: true,
    missing: [],
  })),
  usePaginatedQuery: vi.fn(() => ({ results: [], status: "Exhausted", loadMore: vi.fn() })),
  useMutation: vi.fn(() => vi.fn()),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement("button", props, children),
}));

import { AdminExpeditionInbox } from "./admin-expedition-inbox";

test("admin expedition inbox exposes a lean two-pane workflow and labelled actions", () => {
  const html = renderToStaticMarkup(<AdminExpeditionInbox />);
  expect(html).toContain("Inbox Ekspedisi");
  expect(html).toContain("Hubungi customer");
  expect(html).toContain('aria-label="Daftar percakapan ekspedisi"');
  expect(html).toContain("Pilih percakapan");
  expect(html).toContain("Tidak ada query berulang");
});
