"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaPill } from "@/components/ui/metric-card";
import { formatDuration, formatRupiah } from "@/lib/format";
import type { DateRange, PerformanceReport } from "@/lib/performance-report";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const pct = (value: number) => `${number.format(value)}%`;
const tabs = [['summary', 'Ringkasan'], ['cs', 'Per CS'], ['product', 'Per produk']] as const;
type PerformanceTab = typeof tabs[number][0];

export function nextPerformanceTab(current: PerformanceTab, key: string): PerformanceTab | null {
  const index = tabs.findIndex(([value]) => value === current);
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length][0];
  if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length][0];
  if (key === "Home") return tabs[0][0];
  if (key === "End") return tabs[tabs.length - 1][0];
  return null;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`))
    .replace(".", "");
}

function rangeLabel(range: DateRange): string {
  if (range.startDate === range.endDate) return dateLabel(range.startDate);
  const start = dateLabel(range.startDate);
  const end = dateLabel(range.endDate);
  const [, startMonth] = start.split(" ");
  const [endDay, endMonth] = end.split(" ");
  return startMonth === endMonth ? `${start.split(" ")[0]}–${endDay} ${endMonth}` : `${start}–${end}`;
}

function MetricCard({ label, value, delta, deltaFormat }: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  deltaFormat?: (value: number) => string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-xl font-semibold tabular-nums">
        <span>{value}</span>
        {delta !== undefined && <DeltaPill value={delta} format={deltaFormat} />}
      </div>
    </div>
  );
}

export function PerformancePanel({ report }: { report: PerformanceReport }) {
  const [tab, setTab] = useState<PerformanceTab>("summary");
  const [productSort, setProductSort] = useState<"closing" | "cr">("closing");
  const products = useMemo(() => [...report.products].sort((a, b) => productSort === "cr"
    ? a.cr - b.cr || b.closings - a.closings
    : b.closings - a.closings || a.product.localeCompare(b.product)), [productSort, report.products]);
  const s = report.summary;
  const activePanelId = `performance-panel-${tab}`;

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: PerformanceTab) => {
    const next = nextPerformanceTab(current, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    event.currentTarget.ownerDocument.getElementById(`performance-tab-${next}`)?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="font-medium">Ringkasan periode</p>
          <p className="text-xs text-muted-foreground">
            {rangeLabel({ startDate: report.startDate, endDate: report.endDate })} · Data sampai {dateLabel(report.effectiveEndDate)} · dibuat {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(report.generatedAt)} · {report.status === "running" ? "Berjalan" : "Selesai"}
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Tampilan laporan kinerja" className="flex w-fit gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            id={`performance-tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`performance-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => handleTabKeyDown(event, value)}
            className={cn(
              "min-h-11 min-w-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:min-h-9 sm:min-w-0",
              tab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {report.responseNotice && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {report.responseNotice}
        </div>
      )}

      <div id={activePanelId} role="tabpanel" aria-labelledby={`performance-tab-${tab}`}>
      {tab === "summary" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard label="Leads" value={number.format(s.leads)} delta={s.deltaLeads} />
            <MetricCard label="Closing" value={number.format(s.closings)} delta={s.deltaClosings} />
            <MetricCard label="Conversion rate" value={pct(s.cr)} delta={s.deltaCr} deltaFormat={pct} />
            <MetricCard label="Omzet" value={formatRupiah(s.revenue)} delta={s.deltaRevenue} deltaFormat={formatRupiah} />
            <MetricCard label="Diskon" value={formatRupiah(s.discount)} />
            <MetricCard label="COD" value={number.format(s.cod)} />
            <MetricCard label="Transfer" value={number.format(s.transfer)} />
            <MetricCard label="Rasio pembayaran" value={<span className="text-sm">COD {pct(s.codPct)} · Transfer {pct(s.transferPct)}</span>} />
            <MetricCard label="Terkirim" value={number.format(s.delivered)} />
            <MetricCard label="Dibatalkan" value={number.format(s.cancelled)} />
          </div>

          {report.period === "month" && (
            <Card>
              <CardHeader>
                <CardTitle>Rincian pekanan</CardTitle>
                <CardDescription>Senin sampai Ahad, dipotong di batas bulan agar total tetap sama.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Rincian kinerja per pekan</caption>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Pekan</th><th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">Leads</th><th className="pb-2 text-right font-medium">Closing</th>
                      <th className="pb-2 text-right font-medium">CR</th><th className="pb-2 text-right font-medium">Omzet</th>
                      <th className="pb-2 text-right font-medium">COD</th><th className="pb-2 text-right font-medium">Transfer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.weeks.map((week) => (
                      <tr key={week.startDate} className="border-t border-border">
                        <td className="py-2.5 font-medium">{rangeLabel(week)}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {week.partial && "Pekan parsial · "}
                          {week.status === "upcoming" ? "Belum berjalan" : week.status === "running" ? "Berjalan" : "Selesai"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{number.format(week.metrics.leads)}</td>
                        <td className="py-2.5 text-right tabular-nums">{number.format(week.metrics.closings)}</td>
                        <td className="py-2.5 text-right tabular-nums">{pct(week.metrics.cr)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatRupiah(week.metrics.revenue)}</td>
                        <td className="py-2.5 text-right tabular-nums">{number.format(week.metrics.cod)}</td>
                        <td className="py-2.5 text-right tabular-nums">{number.format(week.metrics.transfer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "cs" && (
        <Card>
          <CardHeader>
            <CardTitle>Performa per CS</CardTitle>
            <CardDescription>Semua metrik mengikuti periode dan filter CS yang sama.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Perbandingan kinerja per CS</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">CS</th><th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Closing</th><th className="pb-2 text-right font-medium">CR</th>
                  <th className="pb-2 text-right font-medium">Omzet</th><th className="pb-2 text-right font-medium">COD / Transfer</th>
                  <th className="pb-2 text-right font-medium">Balas pertama</th>
                </tr>
              </thead>
              <tbody>
                {report.cs.map((row) => (
                  <tr key={row.csKey} className="border-t border-border">
                    <td className="py-2.5 font-medium">{row.csName}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.leads)}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.closings)}</td>
                    <td className="py-2.5 text-right tabular-nums">{pct(row.cr)} <DeltaPill value={row.deltaCr} suffix="%" /></td>
                    <td className="py-2.5 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                    <td className="py-2.5 text-right tabular-nums">{pct(row.codPct)} / {pct(row.transferPct)}</td>
                    <td className="py-2.5 text-right tabular-nums">{report.responseNotice ? "Rentang terlalu panjang" : formatDuration(row.responseMedianMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "product" && (
        <Card>
          <CardHeader className="sm:grid-cols-[1fr_auto]">
            <div>
              <CardTitle>Performa per produk</CardTitle>
              <CardDescription>Ringkas, tanpa grafik; urutkan sesuai kebutuhan evaluasi.</CardDescription>
            </div>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>Urutkan produk</span>
              <select aria-label="Urutkan produk" value={productSort} onChange={(event) => setProductSort(event.target.value as "closing" | "cr")} className="block min-h-11 rounded-lg border border-input bg-background px-2 text-sm text-foreground sm:min-h-8">
                <option value="closing">Closing terbanyak</option>
                <option value="cr">CR terendah</option>
              </select>
            </label>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Perbandingan kinerja per produk</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Produk</th><th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Closing</th><th className="pb-2 text-right font-medium">CR</th>
                  <th className="pb-2 text-right font-medium">Omzet</th><th className="pb-2 text-right font-medium">COD</th>
                  <th className="pb-2 text-right font-medium">Transfer</th><th className="pb-2 text-right font-medium">Rasio</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.product} className="border-t border-border">
                    <td className="py-2.5 font-medium">{row.product}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.leads)}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.closings)}</td>
                    <td className="py-2.5 text-right tabular-nums">{pct(row.cr)}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatRupiah(row.revenue)}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.cod)}</td>
                    <td className="py-2.5 text-right tabular-nums">{number.format(row.transfer)}</td>
                    <td className="py-2.5 text-right tabular-nums">{pct(row.codPct)} / {pct(row.transferPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
