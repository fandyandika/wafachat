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
  PerformancePeriodPicker,
  type PerformancePeriodDraft,
} from "@/components/panel/performance-period-picker";
import {
  type PerformanceReport,
} from "@/lib/performance-report";
import {
  parsePerformanceDeepLink,
  resolvePerformanceSelection,
} from "@/lib/history-period";

function jakartaDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function PerformancePage() {
  const today = useMemo(jakartaDate, []);
  const searchParams = useSearchParams();
  const initialSelection = useMemo(
    () => parsePerformanceDeepLink(searchParams, today),
    [searchParams, today],
  );
  const [period, setPeriod] = useState<PerformancePeriodDraft>(() => ({
    preset: initialSelection.preset,
    basis: initialSelection.basis,
    date: initialSelection.date ?? today,
    anchorDate: initialSelection.anchorDate ?? today,
    month: initialSelection.month ?? today.slice(0, 7),
    startDate: initialSelection.startDate ?? today,
    endDate: initialSelection.endDate ?? today,
  }));
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
      const resolved = resolvePerformanceSelection(period, today);
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
            className="grid gap-4 lg:grid-cols-[minmax(20rem,1fr)_minmax(12rem,16rem)_auto] lg:items-end"
          >
            <div className="grid gap-1.5 text-sm font-medium">
              <span>Periode laporan</span>
              <PerformancePeriodPicker today={today} value={period} onChange={setPeriod} />
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
