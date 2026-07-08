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
    <div className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('live')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
          mode === 'live' ? 'bg-emerald-600 text-white' : 'text-neutral-500 hover:text-neutral-800',
        )}
      >
        {mode === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
        Hari ini
      </button>
      <button
        type="button"
        onClick={() => onChange('work')}
        className={cn(
          'rounded-md px-3 py-1.5 font-medium transition-colors',
          mode === 'work' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-800',
        )}
      >
        Periode kerja (16:00)
      </button>
    </div>
  );
}
