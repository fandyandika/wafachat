"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  CsPerformanceBreakdown,
  ProductPerformanceBreakdown,
  SourcePerformanceBreakdown,
} from "@/components/panel/performance-breakdowns";
import { StatusStamp } from "@/components/panel/dashboard/ledger";
import { PerformanceSummary, PerformanceSummarySkeleton } from "@/components/panel/performance-summary";
import { PanelState } from "@/components/panel/panel-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumberId, formatPercentId, formatRupiah } from "@/lib/format";
import type { DateRange, PerformancePeriod, PerformanceReport } from "@/lib/performance-report";
import type { DayBasis } from "@/lib/history-period";
import { cn } from "@/lib/utils";

const tabs = [['summary', 'Ringkasan'], ['cs', 'Per CS'], ['product', 'Per produk'], ['source', 'Per sumber']] as const;
type PerformanceTab = typeof tabs[number][0];

export type SubmittedArgs = {
  period: PerformancePeriod;
  basis: DayBasis;
  startDate: string;
  endDate: string;
  csName?: string;
};

export type PerformanceSnapshotState = {
  data: PerformanceReport | undefined;
  loading: boolean;
  error: string | null;
  refresh: () => void | Promise<void>;
};

export type DisplayedPerformanceResult = {
  data: PerformanceReport;
  submitted: SubmittedArgs;
};

export function submitPerformanceRequest({
  submitted,
  next,
  replaceSubmitted,
  refresh,
}: {
  submitted: SubmittedArgs | null;
  next: SubmittedArgs;
  replaceSubmitted: (next: SubmittedArgs) => void;
  refresh: () => void | Promise<void>;
}): "refresh" | "replace" {
  const unchanged = submitted !== null
    && submitted.period === next.period
    && submitted.basis === next.basis
    && submitted.startDate === next.startDate
    && submitted.endDate === next.endDate
    && submitted.csName === next.csName;

  if (unchanged) {
    void refresh();
    return "refresh";
  }

  replaceSubmitted(next);
  return "replace";
}

export function associatePerformanceResult(
  previous: DisplayedPerformanceResult | null,
  submitted: SubmittedArgs | null,
  data: PerformanceReport | undefined,
): DisplayedPerformanceResult | null {
  if (!data || !submitted || data === previous?.data) return previous;
  return { data, submitted };
}

export function PerformanceRefreshAction({
  displayed,
  report,
}: {
  displayed: DisplayedPerformanceResult | null;
  report: PerformanceSnapshotState;
}) {
  if (!displayed || report.error) return null;

  return (
    <Button
      size="icon-lg"
      variant="outline"
      onClick={() => report.refresh()}
      disabled={report.loading}
      aria-label="Refresh laporan"
    >
      <RefreshCw className={cn("size-4", report.loading && "animate-spin")} />
    </Button>
  );
}

export function PerformanceResultRegion({
  submitted,
  report,
  displayed,
}: {
  submitted: SubmittedArgs | null;
  report: PerformanceSnapshotState;
  displayed?: DisplayedPerformanceResult | null;
}) {
  const active = displayed === undefined
    ? report.data && submitted ? { data: report.data, submitted } : null
    : displayed;

  if (!submitted && !active) {
    return <PanelState kind="empty" title="Pilih periode lalu tampilkan laporan" />;
  }

  const errorState = report.error ? (
    <PanelState
      kind="error"
      title="Laporan gagal dimuat"
      description={report.error}
      action={<Button size="sm" variant="outline" onClick={() => report.refresh()}>Coba lagi</Button>}
    />
  ) : null;

  if (errorState && !active) return errorState;

  if (!active) {
    return (
      <div role="status" aria-live="polite">
        <PerformanceSummarySkeleton />
      </div>
    );
  }

  const scopeLabel = active.submitted.csName?.replace(/^CS\s+/i, "") || "Semua CS";
  const content = <PerformancePanel report={active.data} scopeLabel={scopeLabel} />;

  return errorState ? <>{errorState}{content}</> : content;
}

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

function PerformanceStatusBand({ report, scopeLabel }: { report: PerformanceReport; scopeLabel: string }) {
  const dayContext = report.period === "day"
    ? report.basis === "calendar"
      ? "Hari kalender · 00.00–24.00 WIB"
      : "Periode kerja CS · 16.00–16.00 WIB"
    : null;
  return (
    <section
      aria-label="Status laporan"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <div className="min-w-0">
        <p className="font-medium">Ringkasan periode</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {rangeLabel({ startDate: report.startDate, endDate: report.endDate })}
          {" · "}{scopeLabel}{dayContext ? ` · ${dayContext}` : ""}{" · Data sampai "}{dateLabel(report.effectiveEndDate)}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusStamp tone={report.status === "running" ? "positive" : "neutral"}>
          {report.status === "running" ? "Berjalan" : "Selesai"}
        </StatusStamp>
        <span>
          Dibuat {new Intl.DateTimeFormat("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(report.generatedAt)}
        </span>
      </div>
    </section>
  );
}

export function PerformanceBreakdownContent({
  tab,
  report,
}: {
  tab: PerformanceTab;
  report: PerformanceReport;
}) {
  if (tab === "cs") {
    return <CsPerformanceBreakdown rows={report.cs} responseNotice={report.responseNotice} />;
  }
  if (tab === "product") {
    return <ProductPerformanceBreakdown rows={report.products} />;
  }
  if (tab === "source") {
    return report.sources?.length
      ? <SourcePerformanceBreakdown rows={report.sources} />
      : <PanelState kind="empty" title="Breakdown sumber belum tersedia untuk periode ini" />;
  }
  return null;
}

function PerformancePanelContent({ report }: { report: PerformanceReport }) {
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
          <PerformanceSummary summary={s} />

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
                        <td className="py-2.5 text-right tabular-nums">{formatNumberId(week.metrics.leads)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatNumberId(week.metrics.closings)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatPercentId(week.metrics.cr)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatRupiah(week.metrics.revenue)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatNumberId(week.metrics.cod)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatNumberId(week.metrics.transfer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <PerformanceBreakdownContent tab={tab} report={report} />
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
  const empty = report.summary.leads === 0 && report.summary.closings === 0;

  return (
    <div className="space-y-4">
      <PerformanceStatusBand report={report} scopeLabel={scopeLabel} />
      {empty
        ? <PanelState kind="empty" title={`Belum ada data untuk ${scopeLabel} pada periode ini`} />
        : <PerformancePanelContent report={report} />}
    </div>
  );
}
