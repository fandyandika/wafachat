import type { PerformanceData } from "@/components/panel/types";

export type ProductSourceFilter = "all" | "berdu" | "scalev";
export type ProductRow = PerformanceData["products"][number] & { source?: "berdu" | "scalev" };

export function visibleProductRows(
  rows: ProductRow[],
  expanded: boolean,
  source: ProductSourceFilter = "all",
) {
  const filtered = source === "all" ? rows : rows.filter((row) => row.source === source);
  const sorted = [...filtered].sort((a, b) => b.closing - a.closing || b.leads - a.leads || a.product.localeCompare(b.product));
  return expanded ? sorted : sorted.slice(0, 5);
}
