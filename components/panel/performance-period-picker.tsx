"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  resolvePerformanceSelection,
  type DayBasis,
  type PerformancePreset,
} from "@/lib/history-period";
import { cn } from "@/lib/utils";

export type PerformancePeriodDraft = {
  preset: PerformancePreset;
  basis: DayBasis;
  date: string;
  anchorDate: string;
  month: string;
  startDate: string;
  endDate: string;
};

type CalendarDay = { date: string; day: number; inMonth: boolean };

const DAY_MS = 86_400_000;
const weekdayLabels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const presetGroups: Array<{ label: string; items: Array<[PerformancePreset, string]> }> = [
  { label: "Cepat", items: [["today", "Hari ini"], ["yesterday", "Kemarin"], ["last_7", "7 hari terakhir"]] },
  { label: "Periode tetap", items: [["this_week", "Pekan ini"], ["last_week", "Pekan lalu"], ["this_month", "Bulan ini"], ["last_month", "Bulan lalu"]] },
  { label: "Pilih sendiri", items: [["date", "Pilih tanggal"], ["week", "Pilih pekan"], ["month", "Pilih bulan"], ["custom", "Rentang khusus"]] },
];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDate(new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS));
}

function addMonths(value: string, months: number): string {
  const [year, month] = value.split("-").map(Number);
  return isoDate(new Date(Date.UTC(year, month - 1 + months, 1))).slice(0, 7);
}

export function buildCalendarMonth(month: string): CalendarDay[] {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first.getTime() - mondayOffset * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    const value = isoDate(date);
    return { date: value, day: date.getUTCDate(), inMonth: value.slice(0, 7) === month };
  });
}

function formatDate(value: string, includeYear = true): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).format(new Date(`${value}T00:00:00.000Z`)).replaceAll(".", "");
}

function formatRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDate(startDate);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  if (sameMonth) {
    return `${Number(startDate.slice(8))}–${formatDate(endDate)}`;
  }
  if (sameYear) {
    return `${formatDate(startDate, false)}–${formatDate(endDate)}`;
  }
  return `${formatDate(startDate)}–${formatDate(endDate)}`;
}

function selectionRange(value: PerformancePeriodDraft, today: string, now = Date.now()) {
  try {
    return resolvePerformanceSelection(value, today, now);
  } catch {
    return { startDate: value.startDate, endDate: value.endDate };
  }
}

export function formatPerformancePeriodLabel(value: PerformancePeriodDraft, today: string, now = Date.now()): string {
  const range = selectionRange(value, today, now);
  const prefix: Partial<Record<PerformancePreset, string>> = {
    today: "Hari ini",
    yesterday: "Kemarin",
    last_7: "7 hari terakhir",
    this_week: "Pekan ini",
    last_week: "Pekan lalu",
    this_month: "Bulan ini",
    last_month: "Bulan lalu",
    week: "Pekan terpilih",
    month: "Bulan terpilih",
  };
  const label = formatRange(range.startDate, range.endDate);
  return prefix[value.preset] ? `${prefix[value.preset]} · ${label}` : label;
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00.000Z`)).replaceAll(".", "");
}

function CalendarMonth({
  month,
  today,
  range,
  onSelect,
}: {
  month: string;
  today: string;
  range: { startDate: string; endDate: string };
  onSelect: (date: string) => void;
}) {
  return (
    <div className="min-w-0" data-calendar-month={month}>
      <p className="mb-3 text-center text-sm font-semibold text-ledger-ink">{monthLabel(month)}</p>
      <div className="grid grid-cols-7 text-center" aria-hidden="true">
        {weekdayLabels.map((day) => <span key={day} className="pb-1.5 text-xs font-medium text-muted-foreground">{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" role="grid" aria-label={monthLabel(month)}>
        {buildCalendarMonth(month).map((day) => {
          if (!day.inMonth) {
            return <span key={day.date} aria-hidden="true" className="min-h-9" />;
          }
          const selected = day.date === range.startDate || day.date === range.endDate;
          const withinRange = day.date >= range.startDate && day.date <= range.endDate;
          const disabled = day.date > today;
          return (
            <button
              key={day.date}
              type="button"
              role="gridcell"
              aria-label={formatDate(day.date)}
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onSelect(day.date)}
              className={cn(
                "relative min-h-9 rounded-md text-xs tabular-nums outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                "text-foreground hover:bg-muted",
                withinRange && !selected && "rounded-none bg-accent text-accent-foreground",
                selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                day.date === today && !selected && "font-semibold ring-1 ring-inset ring-ledger-rule",
                disabled && "cursor-not-allowed text-muted-foreground/25 hover:bg-transparent",
              )}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PerformancePeriodPicker({
  today,
  value,
  onChange,
}: {
  today: string;
  value: PerformancePeriodDraft;
  onChange: (value: PerformancePeriodDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [visibleMonth, setVisibleMonth] = useState(value.endDate.slice(0, 7) || today.slice(0, 7));
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      setVisibleMonth(selectionRange(value, today).endDate.slice(0, 7));
      setRangeAnchor(null);
    }
  }, [open, today, value]);

  const range = useMemo(() => selectionRange(draft, today), [draft, today]);
  const previousMonth = addMonths(visibleMonth, -1);
  const daily = draft.preset === "today" || draft.preset === "yesterday" || draft.preset === "date";

  const selectPreset = (preset: PerformancePreset) => {
    setRangeAnchor(null);
    setDraft((current) => ({ ...current, preset }));
  };

  const selectDate = (selectedDate: string) => {
    setDraft((current) => {
      if (current.preset === "custom") {
        if (!rangeAnchor) {
          setRangeAnchor(selectedDate);
          return { ...current, startDate: selectedDate, endDate: selectedDate };
        }
        setRangeAnchor(null);
        return {
          ...current,
          startDate: selectedDate < rangeAnchor ? selectedDate : rangeAnchor,
          endDate: selectedDate < rangeAnchor ? rangeAnchor : selectedDate,
        };
      }
      if (current.preset === "week") return { ...current, anchorDate: selectedDate };
      if (current.preset === "month") return { ...current, month: selectedDate.slice(0, 7) };
      return { ...current, preset: "date", date: selectedDate };
    });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Pilih periode laporan"
        className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate tabular-nums">{formatPerformancePeriodLabel(value, today)}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
        <span className="sr-only">Buka kalender</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-50 max-w-[calc(100vw-2rem)]">
          <Popover.Popup className="w-[54rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="grid max-h-[min(42rem,calc(100vh-6rem))] overflow-y-auto md:grid-cols-[12rem_minmax(0,1fr)]">
              <nav className="border-b border-ledger-rule p-3 md:border-r md:border-b-0" aria-label="Preset periode">
                {presetGroups.map((group) => (
                  <div key={group.label} className="mb-3 last:mb-0">
                    <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
                    <div className="grid grid-cols-2 gap-0.5 md:grid-cols-1">
                      {group.items.map(([preset, label]) => (
                        <button
                          key={preset}
                          type="button"
                          aria-pressed={draft.preset === preset}
                          onClick={() => selectPreset(preset)}
                          className={cn(
                            "flex min-h-10 items-center justify-between rounded-lg px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                            draft.preset === preset && "bg-accent font-medium text-accent-foreground",
                          )}
                        >
                          {label}
                          {draft.preset === preset && <Check className="size-4" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>

              <div className="min-w-0 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Bulan sebelumnya" onClick={() => setVisibleMonth(previousMonth)}>
                    <ChevronLeft />
                  </Button>
                  <p className="text-sm font-medium text-ledger-ink">Pilih rentang laporan</p>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Bulan berikutnya" disabled={visibleMonth >= today.slice(0, 7)} onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}>
                    <ChevronRight />
                  </Button>
                </div>

                <div className="grid gap-8 md:grid-cols-2">
                  <div className="hidden md:block">
                    <CalendarMonth month={previousMonth} today={today} range={range} onSelect={selectDate} />
                  </div>
                  <CalendarMonth month={visibleMonth} today={today} range={range} onSelect={selectDate} />
                </div>

                {daily && (
                  <fieldset className="mt-5 border-t border-ledger-rule pt-4">
                    <legend className="mb-2 text-xs font-semibold text-ledger-ink">Basis hari</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(["calendar", "work"] as DayBasis[]).map((basis) => (
                        <button
                          key={basis}
                          type="button"
                          aria-pressed={draft.basis === basis}
                          onClick={() => setDraft((current) => ({ ...current, basis }))}
                          className={cn(
                            "min-h-11 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            draft.basis === basis ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
                          )}
                        >
                          <span className="block font-medium">{basis === "calendar" ? "Hari kalender" : "Cutoff CS · 16.00"}</span>
                          <span className="block text-xs text-muted-foreground">{basis === "calendar" ? "00.00–24.00 WIB" : "16.00–16.00 WIB"}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}

                <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-col gap-3 border-t border-ledger-rule bg-popover px-4 pt-4 pb-1 sm:flex-row sm:items-center sm:justify-between md:static md:mx-0 md:px-0 md:pb-0">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Periode terpilih</p>
                    <p className="truncate text-sm font-semibold tabular-nums text-ledger-ink">{formatPerformancePeriodLabel(draft, today)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Popover.Close className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:flex-none">
                      Batal
                    </Popover.Close>
                    <Button
                      type="button"
                      className="flex-1 sm:flex-none"
                      onClick={() => {
                        onChange(draft);
                        setOpen(false);
                      }}
                    >
                      Gunakan periode
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
