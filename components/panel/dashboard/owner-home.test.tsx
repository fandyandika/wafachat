import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { DuplicateSheet, OwnerHome } from "./owner-home";

(globalThis as any).React = React;
const { snapshots } = vi.hoisted(() => ({ snapshots: vi.fn() }));

vi.mock("convex/react", () => ({ useQuery: () => [] }));
vi.mock("@/components/panel/use-convex-snapshot-query", () => ({
  useConvexSnapshotQuery: (...args: unknown[]) => snapshots(...args),
}));
vi.mock("@/components/panel/use-response-times", () => ({
  useResponseTimesState: () => ({ data: undefined, loading: false, error: null }),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <>{children}</>,
  SheetContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  SheetHeader: ({ children, className }: any) => <header className={className}>{children}</header>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}));

beforeEach(() => {
  snapshots.mockReset();
  snapshots
    .mockReturnValueOnce({ data: { leads: 12, closings: 8, manualClosings: 8, cancelled: 0, handovers: 0, revenue: 1_500_000 }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: undefined, loading: false, error: null, lastUpdatedAt: null, refresh: vi.fn() })
    .mockReturnValueOnce({ data: {
      totalClosing: 8,
      overallCr: 66.7,
      cancelled: 0,
      cs: [],
      products: [{ product: "Quran Mapping", leads: 12, closing: 8, cr: 66.7, revenue: 1_500_000, discount: 0 }],
    }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() });
});

test("renders a past date as read-only history without current operational alerts", () => {
  const html = renderToStaticMarkup(
    <OwnerHome
      now={Date.parse("2026-08-08T11:00:00+07:00")}
      initialSelection={{ date: "2026-08-06", basis: "work" }}
    />,
  );

  expect(html).toContain("Mode histori");
  expect(html).toContain("6 Agu 16.00–7 Agu 16.00 WIB");
  expect(html).not.toContain("Perlu perhatian");
  expect(html).not.toContain("Order ganda");
  expect(html).toContain("/panel/performance?period=day&amp;date=2026-08-06&amp;basis=work");
  expect(html).toContain('data-dashboard-mobile-controls="true"');
  expect(html).toContain('data-dashboard-desktop-controls="true"');
});

test("puts business metrics before operational attention on the mobile reading path", () => {
  const html = renderToStaticMarkup(
    <OwnerHome now={Date.parse("2026-08-08T11:00:00+07:00")} />,
  );

  const metricsIndex = html.indexOf('data-dashboard-section="metrics"');
  const attentionIndex = html.indexOf('data-dashboard-section="attention"');

  expect(metricsIndex).toBeGreaterThan(-1);
  expect(attentionIndex).toBeGreaterThan(-1);
  expect(metricsIndex).toBeLessThan(attentionIndex);
  expect(html).toContain("md:hidden");
  expect(html).toContain("md:block");
  expect(html).toContain("xl:grid-cols-3 grid-cols-2");
  expect(html).toContain("12 leads");
  expect(html).toContain("8 closing");
  expect(html).toContain("66,7% CR");
});

test("makes Berdu and Scalev traffic discoverable from Top Produk", () => {
  snapshots.mockReset();
  snapshots
    .mockReturnValueOnce({ data: { leads: 12, closings: 8, manualClosings: 8, cancelled: 0, handovers: 0, revenue: 1_500_000 }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: [], loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() })
    .mockReturnValueOnce({ data: {
      totalClosing: 8, overallCr: 66.7, cancelled: 0, cs: [],
      products: Array.from({ length: 6 }, (_, index) => ({ product: `Produk ${index + 1}`, leads: 12 - index, closing: 8 - index, cr: 60, revenue: 0, discount: 0 })),
      productSources: [
        { product: "Produk Berdu", source: "berdu", leads: 7, closing: 5, cr: 71.4, revenue: 0, discount: 0 },
        { product: "Produk Scalev", source: "scalev", leads: 5, closing: 3, cr: 60, revenue: 0, discount: 0 },
      ],
      sources: [
        { source: "berdu", label: "Berdu", leads: 7, closings: 5, cr: 71.4 },
        { source: "scalev", label: "Scalev", leads: 5, closings: 3, cr: 60 },
      ],
    }, loading: false, error: null, lastUpdatedAt: 1, refresh: vi.fn() });

  const html = renderToStaticMarkup(<OwnerHome now={Date.parse("2026-08-08T11:00:00+07:00")} />);

  expect(html).toContain("Semua sumber");
  expect(html).toContain("Berdu");
  expect(html).toContain("7 leads · 5 closing");
  expect(html).toContain("Scalev");
  expect(html).toContain("5 leads · 3 closing");
  expect(html).toContain("Lihat semua 6 produk");
});

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
