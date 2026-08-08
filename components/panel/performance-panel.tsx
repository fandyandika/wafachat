"use client";

import { useState } from "react";
import {
  CsPerformanceBreakdown,
  ProductPerformanceBreakdown,
} from "@/components/panel/performance-breakdowns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaPill } from "@/components/ui/metric-card";
import { formatRupiah } from "@/lib/format";
import type { DateRange, PerformanceReport } from "@/lib/performance-report";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const pct = (value: number) => `${number.format(value)}%`;
const points = (value: number) => `${number.format(value)} poin`;
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

function SummaryMetricCard({ label, value, delta, deltaFormat, density }: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  deltaFormat?: (value: number) => string;
  density: "primary" | "secondary";
}) {
  return (
    <div className={cn(
      "rounded-xl border border-border bg-card shadow-sm",
      density === "primary" ? "p-4" : "p-3.5",
    )}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 flex flex-wrap items-center gap-2 font-semibold tabular-nums",
        density === "primary" ? "text-xl sm:text-2xl" : "text-lg",
      )}>
        <span>{value}</span>
        {delta !== undefined ? <DeltaPill value={delta} format={deltaFormat} /> : null}
      </div>
    </div>
  );
}

export function PerformancePanel({
  report,
  scopeLabel,
}: {
  report: PerformanceReport;
  scopeLabel: string;
}) {
  const [tab, setTab] = useState<PerformanceTab>("summary");
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
      <section
        aria-label="Status laporan"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
      >
        <div className="min-w-0">
          <p className="font-medium">Ringkasan periode</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rangeLabel({ startDate: report.startDate, endDate: report.endDate })}
            {" · "}{scopeLabel}{" · Data sampai "}{dateLabel(report.effectiveEndDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1 font-medium text-foreground">
            {report.status === "running" ? "Berjalan" : "Selesai"}
          </span>
          <span>
            Dibuat {new Intl.DateTimeFormat("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(report.generatedAt)}
          </span>
        </div>
      </section>

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
          <section aria-label="Metrik utama" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryMetricCard density="primary" label="Leads" value={number.format(s.leads)} delta={s.deltaLeads} />
            <SummaryMetricCard density="primary" label="Closing" value={number.format(s.closings)} delta={s.deltaClosings} />
            <SummaryMetricCard density="primary" label="Conversion rate" value={pct(s.cr)} delta={s.deltaCr} deltaFormat={points} />
            <SummaryMetricCard density="primary" label="Omzet" value={formatRupiah(s.revenue)} delta={s.deltaRevenue} deltaFormat={formatRupiah} />
          </section>

          <section aria-label="Metrik pendukung" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryMetricCard density="secondary" label="Diskon" value={formatRupiah(s.discount)} />
            <SummaryMetricCard density="secondary" label="COD" value={number.format(s.cod)} />
            <SummaryMetricCard density="secondary" label="Transfer" value={number.format(s.transfer)} />
            <SummaryMetricCard density="secondary" label="Rasio pembayaran" value={<span className="text-sm">COD {pct(s.codPct)} · Transfer {pct(s.transferPct)}</span>} />
            <SummaryMetricCard density="secondary" label="Terkirim" value={number.format(s.delivered)} />
            <SummaryMetricCard density="secondary" label="Dibatalkan" value={number.format(s.cancelled)} />
          </section>

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

      {tab === "cs" ? (
        <CsPerformanceBreakdown rows={report.cs} responseNotice={report.responseNotice} />
      ) : null}

      {tab === "product" ? (
        <ProductPerformanceBreakdown rows={report.products} />
      ) : null}
      </div>
    </div>
  );
}
