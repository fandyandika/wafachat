import { expect, test } from "vitest";

import { visibleProductRows } from "./product-ranking-model";

const rows = Array.from({ length: 6 }, (_, index) => ({
  product: `Produk ${index + 1}`,
  leads: 10 - index,
  closing: 6 - index,
  cr: 60,
  revenue: 0,
  discount: 0,
}));

test("keeps the Dashboard concise until the owner asks to see every product", () => {
  expect(visibleProductRows(rows, false)).toHaveLength(5);
  expect(visibleProductRows(rows, true)).toHaveLength(6);
});

test("uses source-specific rows when Berdu or Scalev is selected", () => {
  const sourceRows = [
    { ...rows[0], source: "berdu" as const },
    { ...rows[5], source: "scalev" as const },
  ];

  expect(visibleProductRows(sourceRows, true, "scalev").map((row) => row.product)).toEqual(["Produk 6"]);
});
