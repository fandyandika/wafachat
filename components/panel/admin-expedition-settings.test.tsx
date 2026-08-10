import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("convex/react", () => ({
  useQuery: () => ({
    channel: {
      id: "channel-1",
      name: "Admin Ekspedisi",
      provider: "kirimdev",
      displayPhone: "",
      providerNumberId: undefined,
      isActive: true,
    },
    templates: [],
    ready: false,
    missing: ["Nomor API KirimDev", "Template ekspedisi aktif"],
  }),
  useMutation: () => vi.fn(),
}));

import { AdminExpeditionSettings } from "./admin-expedition-settings";

test("shows exact readiness gaps and configuration controls", () => {
  const html = renderToStaticMarkup(<AdminExpeditionSettings />);

  expect(html).toContain("WhatsApp Admin Ekspedisi");
  expect(html).toContain("Pengiriman belum aktif");
  expect(html).toContain("Nomor API KirimDev");
  expect(html).toContain("Template ekspedisi aktif");
  expect(html).toContain('for="admin-provider-number-id"');
  expect(html).toContain('for="admin-template-name"');
  expect(html).toContain("Tambah variabel");
  expect(html).toContain("Simpan channel");
});
