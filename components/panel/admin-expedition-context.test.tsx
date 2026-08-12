import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AdminExpeditionContext } from "./admin-expedition-context";
import type { AdminInboxThreadView } from "./admin-expedition-inbox-model";

const thread: AdminInboxThreadView = {
  id: "thread-1",
  customerPhone: "6285715682110",
  customerName: "Fandi",
  productName: "Quran Mapping",
  totalAmount: 189_000,
  orderId: "O-260812000001",
  windowOpen: true,
  updatedAt: 1,
};

function renderContext(
  linkedOrder: React.ComponentProps<typeof AdminExpeditionContext>["linkedOrder"],
  row: AdminInboxThreadView = thread,
) {
  return renderToStaticMarkup(
    <AdminExpeditionContext
      thread={row}
      linkedOrder={linkedOrder}
      busy={false}
      onCancel={vi.fn()}
      onUndoCancellation={vi.fn()}
    />,
  );
}

describe("AdminExpeditionContext", () => {
  test("shows known customer and verified order facts beside the conversation", () => {
    const html = renderContext({ orderId: "O-260812000001", status: "ready", canUndo: false });
    expect(html).toContain("Detail customer");
    expect(html).toContain("6285715682110");
    expect(html).toContain("Quran Mapping");
    expect(html).toContain("Rp");
    expect(html).toContain("189.000");
    expect(html).toContain("O-260812000001");
    expect(html).toContain("Siap diproses");
    expect(html).toContain("Batalkan order");
  });

  test("uses quiet missing states and does not infer an order from a phone", () => {
    const html = renderContext(null, {
      id: "thread-2",
      customerPhone: "6281287497002",
      windowOpen: false,
      updatedAt: 1,
    });
    expect(html).toContain("Belum terhubung ke order");
    expect(html).not.toContain("Batalkan order");
    expect(html).toContain("—");
  });

  test("distinguishes linked-order loading, reversible cancellation, and final cancellation", () => {
    expect(renderContext(undefined)).toContain("Memeriksa status order…");

    const reversible = renderContext({ orderId: "O-1", status: "cancelled", cancelReason: "Alamat salah", canUndo: true });
    expect(reversible).toContain("Dibatalkan");
    expect(reversible).toContain("Alamat salah");
    expect(reversible).toContain("Pulihkan order");

    const final = renderContext({ orderId: "O-1", status: "cancelled_after_export", canUndo: false });
    expect(final).toContain("Pembatalan tidak dapat dipulihkan");
    expect(final).not.toContain("Pulihkan order");
  });
});
