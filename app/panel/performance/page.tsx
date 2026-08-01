"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Crown, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PerformancePanel } from "@/components/panel/performance-panel";
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

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

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
          <h1 className="text-base font-semibold tracking-tight">Performance</h1>
          <p className="text-xs text-muted-foreground">Laporan evaluasi hanya dimuat saat diminta.</p>
        </div>
        <Link href="/panel/queen" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted">
          <Crown className="size-4 text-gold" /> Queen Recap
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1 sm:w-fit">
            {([
              ["week", "Pekanan"],
              ["month", "Bulanan"],
              ["custom", "Rentang khusus"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  period === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
            <div className="grid gap-3 sm:grid-cols-2">
              {period === "week" && (
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Tanggal dalam pekan
                  <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} className={inputClass} />
                </label>
              )}
              {period === "month" && (
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Bulan
                  <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
                </label>
              )}
              {period === "custom" && (
                <>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Mulai
                    <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Sampai
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />
                  </label>
                </>
              )}
            </div>

            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              CS
              <Select value={csName || "__all"} onValueChange={(value) => setCsName(value === "__all" || !value ? "" : value)}>
                <SelectTrigger className="h-9 w-full"><SelectValue>{csName || "Semua CS"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Semua CS</SelectItem>
                  {csList.map((cs) => <SelectItem key={cs.key} value={cs.csName}>{cs.csName.replace(/^CS\s+/i, "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>

            <div className="flex gap-2">
              <Button size="lg" className="flex-1" onClick={submit} disabled={report.loading}>
                {report.loading ? "Menyiapkan..." : "Tampilkan laporan"}
              </Button>
              {submitted && (
                <Button size="icon-lg" variant="outline" onClick={() => report.refresh()} disabled={report.loading} aria-label="Refresh laporan">
                  <RefreshCw className={cn("size-4", report.loading && "animate-spin")} />
                </Button>
              )}
            </div>
          </div>
          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
        </CardContent>
      </Card>

      {!submitted && (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Pilih periode lalu tampilkan laporan
        </div>
      )}
      {report.error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{report.error}</span>
          <Button size="sm" variant="outline" onClick={() => report.refresh()}>Coba lagi</Button>
        </div>
      )}
      {empty && <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Belum ada data pada periode ini</div>}
      {report.data && !empty && <PerformancePanel report={report.data} />}
    </div>
  );
}
