"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaPill } from "@/components/ui/metric-card";
import { formatDuration, formatNumberId, formatPercentId, formatRupiah } from "@/lib/format";
import type { CsMetricRow, ProductMetricRow } from "@/lib/performance-report";

export type ProductSort = "closing" | "cr";

export function sortProductRows(rows: ProductMetricRow[], sort: ProductSort): ProductMetricRow[] {
  return [...rows].sort((a, b) => sort === "cr"
    ? a.cr - b.cr || b.closings - a.closings
    : b.closings - a.closings || a.product.localeCompare(b.product));
}

function PaymentSplit({ codPct, transferPct }: { codPct: number; transferPct: number }) {
  return <span>{formatPercentId(codPct)} / {formatPercentId(transferPct)}</span>;
}

export function CsPerformanceBreakdown({
  rows,
  responseNotice,
}: {
  rows: CsMetricRow[];
  responseNotice?: string;
}) {
  const response = (row: CsMetricRow) => responseNotice
    ? "Rentang terlalu panjang"
    : formatDuration(row.responseMedianMs);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performa per CS</CardTitle>
        <CardDescription>Bandingkan closing, conversion rate, dan kecepatan respons.</CardDescription>
      </CardHeader>
      <CardContent>
        <div data-layout="desktop-table" className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <caption className="sr-only">Perbandingan kinerja per CS</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">CS</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Closing</th>
                <th className="pb-2 text-right font-medium">CR</th>
                <th className="pb-2 text-right font-medium">Balas pertama</th>
                <th className="pb-2 text-right font-medium">Omzet</th>
                <th className="pb-2 text-right font-medium">COD</th>
                <th className="pb-2 text-right font-medium">Transfer</th>
                <th className="pb-2 text-right font-medium">Rasio</th>
              </tr>
            </thead>
            <tbody>{rows.map((row) => (
              <tr key={row.csKey} className="border-t border-border">
                <th scope="row" className="py-3 text-left font-medium">{row.csName}</th>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.leads)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.closings)}</td>
                <td className="py-3 text-right tabular-nums">{formatPercentId(row.cr)} <DeltaPill value={row.deltaCr} suffix=" poin" /></td>
                <td className="py-3 text-right tabular-nums">{response(row)}</td>
                <td className="py-3 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.cod)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.transfer)}</td>
                <td className="py-3 text-right tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div data-layout="mobile-ledger" className="divide-y divide-border md:hidden">
          {rows.map((row) => (
            <article key={row.csKey} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <h3 className="font-semibold">{row.csName}</h3>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong>{formatNumberId(row.closings)} closing</strong>
                <span className="tabular-nums">CR {formatPercentId(row.cr)}</span>
                <DeltaPill value={row.deltaCr} suffix=" poin" />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Leads</dt><dd>{formatNumberId(row.leads)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Balas pertama</dt><dd>{response(row)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Omzet</dt><dd>{formatRupiah(row.revenue)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">COD</dt><dd className="tabular-nums">{formatNumberId(row.cod)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Transfer</dt><dd className="tabular-nums">{formatNumberId(row.transfer)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Rasio pembayaran</dt><dd className="tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></dd></div>
              </dl>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductPerformanceBreakdown({ rows }: { rows: ProductMetricRow[] }) {
  const [sort, setSort] = useState<ProductSort>("closing");
  const products = useMemo(() => sortProductRows(rows, sort), [rows, sort]);

  return (
    <Card>
      <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <CardTitle>Performa per produk</CardTitle>
          <CardDescription>Bandingkan closing, conversion rate, dan omzet produk.</CardDescription>
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Urutkan produk
          <select
            aria-label="Urutkan produk"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProductSort)}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground sm:min-h-9"
          >
            <option value="closing">Closing terbanyak</option>
            <option value="cr">CR terendah</option>
          </select>
        </label>
      </CardHeader>
      <CardContent>
        <div data-layout="desktop-table" className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <caption className="sr-only">Perbandingan kinerja per produk</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Produk</th>
                <th className="pb-2 text-right font-medium">Closing</th>
                <th className="pb-2 text-right font-medium">CR</th>
                <th className="pb-2 text-right font-medium">Omzet</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">COD</th>
                <th className="pb-2 text-right font-medium">Transfer</th>
                <th className="pb-2 text-right font-medium">Rasio</th>
              </tr>
            </thead>
            <tbody>{products.map((row) => (
              <tr key={row.product} className="border-t border-border">
                <th scope="row" className="max-w-72 py-3 text-left font-medium"><span title={row.product} className="line-clamp-2">{row.product}</span></th>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.closings)}</td>
                <td className="py-3 text-right tabular-nums">{formatPercentId(row.cr)}</td>
                <td className="py-3 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.leads)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.cod)}</td>
                <td className="py-3 text-right tabular-nums">{formatNumberId(row.transfer)}</td>
                <td className="py-3 text-right tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div data-layout="mobile-ledger" className="divide-y divide-border md:hidden">
          {products.map((row) => (
            <article key={row.product} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <h3 title={row.product} className="line-clamp-2 font-semibold">{row.product}</h3>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong>{formatNumberId(row.closings)} closing</strong>
                <span className="tabular-nums">CR {formatPercentId(row.cr)}</span>
                <span className="font-medium tabular-nums">{formatRupiah(row.revenue)}</span>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-muted-foreground">Leads</dt><dd>{formatNumberId(row.leads)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">COD</dt><dd className="tabular-nums">{formatNumberId(row.cod)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Transfer</dt><dd className="tabular-nums">{formatNumberId(row.transfer)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Rasio pembayaran</dt><dd className="tabular-nums"><PaymentSplit codPct={row.codPct} transferPct={row.transferPct} /></dd></div>
              </dl>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
