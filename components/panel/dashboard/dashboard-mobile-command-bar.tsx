"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, RefreshCw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  dashboardPerformanceHref,
  DashboardHistoryFilter,
  formatDashboardBoundary,
  type DashboardDayDraft,
  type DashboardDayRange,
} from "./dashboard-history-filter";

export type DashboardMobileCommandBarProps = {
  today: string;
  currentWorkDate: string;
  applied: DashboardDayDraft;
  range: DashboardDayRange;
  periodLabel: string;
  updatedAt: string;
  loading: boolean;
  onApply(selection: DashboardDayDraft): void;
  onRefresh(): void;
};

const shortDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function shortDate(value: string): string {
  return shortDateFormatter
    .format(new Date(`${value}T00:00:00.000Z`))
    .replaceAll(".", "");
}

export function DashboardMobileCommandBar({
  today,
  currentWorkDate,
  applied,
  range,
  periodLabel,
  updatedAt,
  loading,
  onApply,
  onRefresh,
}: DashboardMobileCommandBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const basisLabel = applied.basis === "calendar" ? "Hari kalender" : "Cutoff CS · 16.00";

  return (
    <>
      <section
        data-dashboard-mobile-command-bar="true"
        aria-label="Kendali Dashboard"
        className="overflow-hidden rounded-xl border border-ledger-rule bg-card md:hidden"
      >
        <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-ledger-ink" aria-hidden="true">
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tabular-nums text-ledger-ink">
              {shortDate(applied.date)} · {basisLabel}
            </p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">
              {range.running ? periodLabel : "Mode histori"} · Diperbarui {updatedAt}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh Dashboard"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 px-3"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="size-4" />
            Atur
          </Button>
        </div>
      </section>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[min(42rem,calc(100dvh-0.75rem))] gap-0 overflow-y-auto rounded-t-2xl border-ledger-rule pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetHeader className="border-b border-ledger-rule pr-14">
            <SheetTitle>Atur periode Dashboard</SheetTitle>
            <SheetDescription className="tabular-nums">
              {formatDashboardBoundary(range)}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <DashboardHistoryFilter
              today={today}
              currentWorkDate={currentWorkDate}
              applied={applied}
              onApply={(selection) => {
                onApply(selection);
                setFilterOpen(false);
              }}
            />
            <Link
              href={dashboardPerformanceHref(applied)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-ledger-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Buka Performance
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
