import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DuplicateSheet } from "./owner-home";

(globalThis as any).React = React;

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <>{children}</>,
  SheetContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  SheetHeader: ({ children, className }: any) => <header className={className}>{children}</header>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}));

test("presents duplicate orders as a readable structured list", () => {
  const html = renderToStaticMarkup(
    <DuplicateSheet
      open
      onOpenChange={() => undefined}
      rows={[{
        phone: "6285715682110",
        customerName: "Fandi",
        csName: "Aisyah",
        count: 2,
        likelyAccidental: true,
        orders: [{
          orderId: "260802000001",
          productName: "Quran Mapping",
          total: "189000",
          createdAt: Date.parse("2026-08-02T13:11:00+07:00"),
        }],
      }]}
    />,
  );

  expect(html).toContain("sm:max-w-xl");
  expect(html).toContain('aria-label="Daftar order ganda"');
  expect(html).toContain("Rp189.000");
});
