'use client';

// Window-mode toggle for Dashboard + Performance. DEFAULT = "live" (owner's calendar-day
// today, midnight→now), rendered by LiveTodayDashboard on ONE cheap raw read of today's small
// slice. "work" = the 16:00→16:00 CS-report window (rollup-backed, heavier: multiple queries
// incl. response-time) — only mounted when the owner toggles to it, so the heavy queries never
// run on the default view. Laporan keeps the 16:00 CS report.
// TODO(SaaS §14): default mode + cutoff + timezone become per-org settings.
import { cn } from '@/lib/utils';

export type WindowMode = 'live' | 'work';

export function WindowModeToggle({ mode, onChange }: { mode: WindowMode; onChange: (m: WindowMode) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-ledger-rule bg-card p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('live')}
        className={cn(
          'flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
          mode === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-ledger-ink',
        )}
      >
        Hari kalender
      </button>
      <button
        type="button"
        onClick={() => onChange('work')}
        className={cn(
          'min-h-9 rounded-md px-3 py-1.5 font-medium transition-colors',
          mode === 'work' ? 'bg-ledger-ink text-card' : 'text-muted-foreground hover:text-ledger-ink',
        )}
      >
        Periode kerja 16:00
      </button>
    </div>
  );
}
