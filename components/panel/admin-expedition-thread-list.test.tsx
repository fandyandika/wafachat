import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AdminExpeditionThreadList } from "./admin-expedition-thread-list";
import type { AdminInboxThreadView } from "./admin-expedition-inbox-model";

const rows: AdminInboxThreadView[] = [
  {
    id: "thread-1",
    customerPhone: "6285715682110",
    customerName: "Fandi",
    productName: "Quran Mapping",
    lastInboundAt: Date.UTC(2026, 7, 12, 4),
    lastOutboundAt: Date.UTC(2026, 7, 12, 3),
    windowOpen: true,
    updatedAt: Date.UTC(2026, 7, 12, 4),
  },
];

function renderList(overrides: Partial<React.ComponentProps<typeof AdminExpeditionThreadList>> = {}) {
  return renderToStaticMarkup(
    <AdminExpeditionThreadList
      threads={rows}
      totalLoaded={1}
      selectedId="thread-1"
      search=""
      view="all"
      loadingFirstPage={false}
      canLoadMore={false}
      loadingMore={false}
      onSearchChange={vi.fn()}
      onViewChange={vi.fn()}
      onSelect={vi.fn()}
      onLoadMore={vi.fn()}
      {...overrides}
    />,
  );
}

describe("AdminExpeditionThreadList", () => {
  test("makes selected and reply-needed state explicit in each scannable row", () => {
    const html = renderList();
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Fandi");
    expect(html).toContain("Quran Mapping");
    expect(html).toContain("Menunggu balasan");
    expect(html).toContain("Balasan aktif");
  });

  test("distinguishes a local filter miss from a genuinely empty inbox", () => {
    const filtered = renderList({ threads: [], totalLoaded: 4, search: "Hasna" });
    expect(filtered).toContain("Tidak ada hasil");
    expect(filtered).toContain("Ubah pencarian atau filter");

    const empty = renderList({ threads: [], totalLoaded: 0, search: "" });
    expect(empty).toContain("Belum ada percakapan");
    expect(empty).toContain("Hubungi customer dengan template approved");
  });

  test("labels loaded-result search and cursor pagination honestly", () => {
    const html = renderList({ canLoadMore: true, loadingMore: true });
    expect(html).toContain("Cari customer atau order");
    expect(html).toContain("1 customer dimuat");
    expect(html).toContain("Pencarian hanya mencakup percakapan yang sudah dimuat");
    expect(html).toContain("Memuat…");
  });
});
