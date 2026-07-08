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

      <div className="space-y-3">
        <div className="text-sm font-medium text-neutral-700">Per CS · breakdown produk</div>
        {data.cs.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 px-4 py-6 text-sm text-neutral-400">Belum ada data hari ini.</div>
        ) : (
          data.cs.map((c: any) => (
            <div key={c.csName} className="rounded-xl border border-neutral-200 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600">
                  {initials(c.csName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-neutral-800">{c.csName}</div>
                  <div className="text-xs text-neutral-400">
                    {c.leads} leads · {c.closings} closing{c.revenue ? ` · ${formatRupiahShort(c.revenue)}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-neutral-900">{c.cr}%</div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">CR</div>
                </div>
              </div>
              {c.products?.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                  {c.products.map((p: any) => (
                    <li key={p.product} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-neutral-600" title={p.product}>{p.product}</span>
                      <div className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-neutral-100 sm:block">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, p.cr)}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right tabular-nums text-neutral-700">
                        {p.cr}% <span className="text-neutral-400">({p.closings}/{p.leads})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
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
