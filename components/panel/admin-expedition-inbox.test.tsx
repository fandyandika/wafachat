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

import {
  AdminExpeditionInbox,
  AdminExpeditionNewChatDialog,
  adminThreadListSubtitle,
  adminThreadMeta,
  parseOptionalRupiah,
} from "./admin-expedition-inbox";

test("admin expedition inbox exposes a lean two-pane workflow and labelled actions", () => {
  const html = renderToStaticMarkup(<AdminExpeditionInbox />);
  expect(html).toContain("Inbox Ekspedisi");
  expect(html).toContain("Hubungi customer");
  expect(html).toContain('aria-label="Daftar percakapan ekspedisi"');
  expect(html).toContain("Pilih percakapan");
  expect(html).toContain("Tidak ada query berulang");
});

test("new admin chat uses lean optional context and supports a template without variables", () => {
  const template = {
    id: "template-1",
    label: "Kurir tidak merespons",
    variables: [],
  };
  const html = renderToStaticMarkup(
    <AdminExpeditionNewChatDialog
      templates={[template]}
      selectedTemplate={template}
      templateId="template-1"
      templateValues={{}}
      customerPhone="085715682110"
      customerName=""
      productName=""
      totalAmount=""
      busy={false}
      onCustomerPhoneChange={vi.fn()}
      onCustomerNameChange={vi.fn()}
      onProductNameChange={vi.fn()}
      onTotalAmountChange={vi.fn()}
      onTemplateChange={vi.fn()}
      onTemplateValueChange={vi.fn()}
      onClose={vi.fn()}
      onSend={vi.fn()}
    />,
  );

  expect(html).toContain("Nomor WhatsApp");
  expect(html).toContain("Nama customer");
  expect(html).toContain("Produk");
  expect(html).toContain("Harga total");
  expect(html).toContain("Template tanpa variabel");
  expect(html).not.toContain("ID order");
});

test("optional rupiah parser accepts Indonesian grouping and rejects ambiguous values", () => {
  expect(parseOptionalRupiah("")).toBeUndefined();
  expect(parseOptionalRupiah("189.000")).toBe(189_000);
  expect(parseOptionalRupiah(" 189 000 ")).toBe(189_000);
  expect(() => parseOptionalRupiah("1,5")).toThrow("Harga total");
  expect(() => parseOptionalRupiah("Rp189.000")).toThrow("Harga total");
});

test("verified order context remains visible without guessing from a phone", () => {
  expect(adminThreadListSubtitle({ customerPhone: "6285715682110", orderId: "ORD-1" }))
    .toBe("Order ORD-1");
  expect(adminThreadListSubtitle({ customerPhone: "6285715682110", productName: "Quran Mapping", orderId: "ORD-1" }))
    .toBe("Quran Mapping");
  expect(adminThreadMeta({
    customerPhone: "6285715682110",
    productName: "Quran Mapping",
    totalAmount: 189_000,
    orderId: "ORD-1",
  })).toContain("Order ORD-1");
});
