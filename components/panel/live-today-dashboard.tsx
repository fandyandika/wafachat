'use client';

// Owner "Live Hari Ini" — calendar-day (midnight WIB → now), on-demand. Reads api.analytics
// .getLiveToday (bounded read of today's slice; NOT the 16:00 CS-report window). Kept simple
// and dependency-light on purpose: this is a glance view opened when the owner wants "now".
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { formatRupiahShort } from '@/lib/format';

function fmtTime(ms: number) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}
function initials(name: string) {
  return (name || '?').replace(/^CS\s+/i, '').trim().slice(0, 2).toUpperCase();
}

export function LiveTodayDashboard() {
  const data = useQuery(api.analytics.getLiveToday, {});

  if (data === undefined) {
    return <div className="p-6 text-sm text-neutral-500">Memuat data live…</div>;
  }
  const t = data.totals;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Live Hari Ini</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
          </span>
        </div>
        <p className="text-sm text-neutral-500">
          Kalender hari ini · {fmtTime(data.windowStart)}–{fmtTime(data.windowEnd)} WIB
        </p>
        <p className="text-xs text-neutral-400">
          Pandangan owner sejak tengah malam — bukan window laporan CS (16:00).
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Leads" value={String(t.leads)} />
        <Kpi label="Closing" value={String(t.closings)} />
        <Kpi label="CR" value={`${t.cr}%`} />
        <Kpi label="Omzet" value={formatRupiahShort(t.revenue)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200">
        <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium text-neutral-700">Per CS</div>
        {data.cs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-400">Belum ada data hari ini.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {data.cs.map((c: any) => (
              <li key={c.csName} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600">
                  {initials(c.csName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-800">{c.csName}</div>
                  <div className="text-xs text-neutral-400">CR {c.cr}%</div>
                </div>
                <div className="text-right text-sm tabular-nums text-neutral-700">
                  <span className="font-semibold">{c.leads}</span> <span className="text-neutral-400">leads</span>
                  <span className="mx-1 text-neutral-300">·</span>
                  <span className="font-semibold">{c.closings}</span> <span className="text-neutral-400">closing</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</div>
    </div>
  );
}
