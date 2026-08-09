"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { DayBasis } from "@/lib/history-period";
import { cn } from "@/lib/utils";

export type DashboardDayDraft = { date: string; basis: DayBasis };
export type DashboardDayRange = DashboardDayDraft & {
  startAt: number;
  endAt: number;
  running: boolean;
};

export function dashboardPerformanceHref(selection: DashboardDayDraft): string {
  const params = new URLSearchParams({
    period: "day",
    date: selection.date,
    basis: selection.basis,
  });
  return `/panel/performance?${params.toString()}`;
}

export function isHistoricalDashboardRange(range: Pick<DashboardDayRange, "running">): boolean {
  return !range.running;
}

const boundaryFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function boundaryPart(value: number): string {
  const parts = Object.fromEntries(boundaryFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month.replace(".", "")} ${parts.hour}.${parts.minute}`;
}

export function formatDashboardBoundary(range: DashboardDayRange): string {
  const start = boundaryPart(range.startAt);
  const end = boundaryPart(range.endAt);
  return `${start}–${end} WIB`;
}

export function DashboardHistoryFilter({
  today,
  currentWorkDate,
  applied,
  onApply,
}: {
  today: string;
  currentWorkDate: string;
  applied: DashboardDayDraft;
  onApply: (selection: DashboardDayDraft) => void;
}) {
  const [draftDate, setDraftDate] = useState(applied.date);
  const [draftBasis, setDraftBasis] = useState<DayBasis>(applied.basis);
  const dirty = draftDate !== applied.date || draftBasis !== applied.basis;

  const selectBasis = (basis: DayBasis) => {
    if (basis === "work" && draftBasis === "calendar" && draftDate === today) {
      setDraftDate(currentWorkDate);
    } else if (basis === "calendar" && draftBasis === "work" && draftDate === currentWorkDate) {
      setDraftDate(today);
    }
    setDraftBasis(basis);
  };

  return (
    <form
      aria-label="Pilih tanggal Dashboard"
      className="grid w-full gap-3 sm:grid-cols-[minmax(11rem,14rem)_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({ date: draftDate, basis: draftBasis });
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium text-ledger-ink">
        Tanggal
        <input
          type="date"
          max={today}
          required
          value={draftDate}
          onChange={(event) => setDraftDate(event.target.value)}
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 sm:min-h-9"
        />
      </label>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-sm font-medium text-ledger-ink">Basis hari</legend>
        <div className="inline-flex w-full rounded-lg border border-ledger-rule bg-card p-0.5 text-sm sm:w-auto">
          {([['calendar', 'Hari kalender'], ['work', 'Cutoff CS · 16.00']] as const).map(([basis, label]) => (
            <button
              key={basis}
              type="button"
              aria-pressed={draftBasis === basis}
              onClick={() => selectBasis(basis)}
              className={cn(
                "min-h-11 rounded-md px-3 py-1.5 font-medium transition-colors sm:min-h-9",
                draftBasis === basis
                  ? "bg-ledger-ink text-card"
                  : "text-muted-foreground hover:text-ledger-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <Button type="submit" size="sm" className="min-h-11 sm:min-h-9" disabled={!dirty || !draftDate}>
        {dirty ? 'Terapkan' : 'Sudah diterapkan'}
      </Button>
    </form>
  );
}
