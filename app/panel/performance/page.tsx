"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Crown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  associatePerformanceResult,
  PerformanceRefreshAction,
  PerformanceResultRegion,
  submitPerformanceRequest,
  type DisplayedPerformanceResult,
  type SubmittedArgs,
} from "@/components/panel/performance-panel";
import { useConvexSnapshotQuery } from "@/components/panel/use-convex-snapshot-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type PerformanceReport,
} from "@/lib/performance-report";
import {
  parsePerformanceDeepLink,
  resolvePerformanceSelection,
  type DayBasis,
  type PerformancePreset,
} from "@/lib/history-period";
import { cn } from "@/lib/utils";

function jakartaDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const inputClass = "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 sm:min-h-9";
const presetLabels: Record<PerformancePreset, string> = {
  today: "Hari ini",
  yesterday: "Kemarin",
  date: "Pilih tanggal",
  this_week: "Pekan ini",
  last_week: "Pekan lalu",
  week: "Pilih pekan",
  this_month: "Bulan ini",
  last_month: "Bulan lalu",
  month: "Pilih bulan",
  custom: "Rentang khusus",
};

export default function PerformancePage() {
  const today = useMemo(jakartaDate, []);
  const searchParams = useSearchParams();
  const initialSelection = useMemo(
    () => parsePerformanceDeepLink(searchParams, today),
    [searchParams, today],
  );
  const [preset, setPreset] = useState<PerformancePreset>(initialSelection.preset);
  const [basis, setBasis] = useState<DayBasis>(initialSelection.basis);
  const [date, setDate] = useState(initialSelection.date ?? today);
  const [anchorDate, setAnchorDate] = useState(initialSelection.anchorDate ?? today);
  const [month, setMonth] = useState(initialSelection.month ?? today.slice(0, 7));
  const [startDate, setStartDate] = useState(initialSelection.startDate ?? today);
  const [endDate, setEndDate] = useState(initialSelection.endDate ?? today);
  const [csName, setCsName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedArgs | null>(null);
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const report = useConvexSnapshotQuery<PerformanceReport>(
    api.performanceReports.getPerformanceReport,
    submitted ?? "skip",
  );
  const [displayed, setDisplayed] = useState<DisplayedPerformanceResult | null>(null);
  useEffect(() => {
    setDisplayed((previous) => associatePerformanceResult(previous, submitted, report.data));
  }, [submitted, report.data]);

  const submit = () => {
    try {
      const resolved = resolvePerformanceSelection({
        preset, basis, date, anchorDate, month, startDate, endDate,
      }, today);
      setValidationError(null);
      submitPerformanceRequest({
        submitted,
        next: { ...resolved, csName: csName || undefined },
        replaceSubmitted: setSubmitted,
        refresh: report.refresh,
      });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Periode tidak valid");
    }
  };

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
          <div
            role="group"
            aria-label="Filter laporan kinerja"
            data-testid="performance-filter-grid"
            className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,1.35fr)_minmax(12rem,16rem)_auto] lg:items-end"
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Periode laporan
              <Select value={preset} onValueChange={(value) => setPreset(value as PerformancePreset)}>
                <SelectTrigger className="min-h-11 w-full sm:min-h-9"><SelectValue>{presetLabels[preset]}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hari ini</SelectItem>
                  <SelectItem value="yesterday">Kemarin</SelectItem>
                  <SelectItem value="date">Pilih tanggal</SelectItem>
                  <SelectItem value="this_week">Pekan ini</SelectItem>
                  <SelectItem value="last_week">Pekan lalu</SelectItem>
                  <SelectItem value="week">Pilih pekan</SelectItem>
                  <SelectItem value="this_month">Bulan ini</SelectItem>
                  <SelectItem value="last_month">Bulan lalu</SelectItem>
                  <SelectItem value="month">Pilih bulan</SelectItem>
                  <SelectItem value="custom">Rentang khusus</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <div className={cn("min-w-0", preset === "custom" && "grid gap-3 sm:grid-cols-2")}>
              {(preset === "today" || preset === "yesterday" || preset === "date") && (
                <div className={cn("grid gap-3", preset === "date" && "sm:grid-cols-2")}>
                  {preset === "date" && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      Tanggal
                      <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
                    </label>
                  )}
                  <label className="grid gap-1.5 text-sm font-medium">
                    Basis hari
                    <Select value={basis} onValueChange={(value) => setBasis(value as DayBasis)}>
                      <SelectTrigger className="min-h-11 w-full sm:min-h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="calendar">Hari kalender (00.00–24.00)</SelectItem>
                        <SelectItem value="work">Cutoff kerja (16.00–16.00)</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              )}
              {preset === "week" && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Tanggal dalam pekan
                  <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} className={inputClass} />
                </label>
              )}
              {preset === "month" && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Bulan
                  <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
                </label>
              )}
              {preset === "custom" && (
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
              {(["this_week", "last_week", "this_month", "last_month"] as PerformancePreset[]).includes(preset) && (
                <div className="flex min-h-11 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground sm:min-h-9">
                  Rentang dihitung otomatis saat laporan ditampilkan.
                </div>
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
              <PerformanceRefreshAction displayed={displayed} report={report} />
            </div>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
        </CardContent>
      </Card>

      <PerformanceResultRegion submitted={submitted} report={report} displayed={displayed} />
    </div>
  );
}
