"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Crown, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PerformancePanel } from "@/components/panel/performance-panel";
import { PanelState } from "@/components/panel/panel-state";
import { useConvexSnapshotQuery } from "@/components/panel/use-convex-snapshot-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  inclusiveDateCount,
  resolvePerformanceRange,
  type PerformancePeriod,
  type PerformanceReport,
} from "@/lib/performance-report";
import { cn } from "@/lib/utils";

type SubmittedArgs = {
  period: PerformancePeriod;
  startDate: string;
  endDate: string;
  csName?: string;
};

function jakartaDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const inputClass = "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 sm:min-h-9";

export default function PerformancePage() {
  const today = useMemo(jakartaDate, []);
  const [period, setPeriod] = useState<PerformancePeriod>("week");
  const [anchorDate, setAnchorDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [csName, setCsName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedArgs | null>(null);
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const report = useConvexSnapshotQuery<PerformanceReport>(
    api.performanceReports.getPerformanceReport,
    submitted ?? "skip",
  );

  const submit = () => {
    try {
      const range = resolvePerformanceRange(period, { anchorDate, month, startDate, endDate });
      if (inclusiveDateCount(range) > 35) throw new Error("Maksimal 35 hari");
      setValidationError(null);
      setSubmitted({ period, ...range, csName: csName || undefined });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Periode tidak valid");
    }
  };

  const empty = report.data && report.data.summary.leads === 0 && report.data.summary.closings === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Laporan evaluasi hanya dimuat saat diminta.</p>
        </div>
        <Link href="/panel/queen" className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted sm:min-h-9 sm:min-w-0">
          <Crown className="size-4 text-gold" /> Queen Recap
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div role="group" aria-label="Filter laporan kinerja" className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1 sm:w-fit">
            {([
              ["week", "Pekanan"],
              ["month", "Bulanan"],
              ["custom", "Rentang khusus"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={cn(
                  "min-h-11 min-w-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:min-h-9 sm:min-w-0",
                  period === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            data-testid="performance-filter-grid"
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto] md:items-end"
          >
            <div className={cn("min-w-0", period === "custom" && "grid gap-3 sm:grid-cols-2")}>
              {period === "week" && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Tanggal dalam pekan
                  <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} className={inputClass} />
                </label>
              )}
              {period === "month" && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Bulan
                  <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
                </label>
              )}
              {period === "custom" && (
                <>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Mulai
                    <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Sampai
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />
                  </label>
                </>
              )}
            </div>

            <label className="grid gap-1.5 text-sm font-medium">
              CS
              <Select value={csName || "__all"} onValueChange={(value) => setCsName(value === "__all" || !value ? "" : value)}>
                <SelectTrigger className="min-h-11 w-full sm:min-h-9"><SelectValue>{csName || "Semua CS"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Semua CS</SelectItem>
                  {csList.map((cs) => <SelectItem key={cs.key} value={cs.csName}>{cs.csName.replace(/^CS\s+/i, "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>

            <div className="flex gap-2">
              <Button size="lg" className="w-full md:w-auto" onClick={submit} disabled={report.loading}>
                {report.loading ? "Menyiapkan..." : "Tampilkan laporan"}
              </Button>
              {submitted && (
                <Button size="icon-lg" variant="outline" onClick={() => report.refresh()} disabled={report.loading} aria-label="Refresh laporan">
                  <RefreshCw className={cn("size-4", report.loading && "animate-spin")} />
                </Button>
              )}
            </div>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
        </CardContent>
      </Card>

      {!submitted ? (
        <PanelState kind="empty" title="Pilih periode lalu tampilkan laporan" />
      ) : report.error ? (
        <PanelState
          kind="error"
          title="Laporan gagal dimuat"
          description={report.error}
          action={<Button size="sm" variant="outline" onClick={() => report.refresh()}>Coba lagi</Button>}
        />
      ) : empty ? (
        <PanelState kind="empty" title="Belum ada data pada periode ini" />
      ) : report.data ? (
        <PerformancePanel
          report={report.data}
          scopeLabel={submitted.csName?.replace(/^CS\s+/i, "") || "Semua CS"}
        />
      ) : null}
    </div>
  );
}
