'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { formatRupiah } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ReportCard, type ReportCardData } from '@/components/panel/report-card';
import { crLabel } from '@/components/panel/report-text';
import {
  JAK_MS, clampStartToCutoff, currentReportLabelDate, reportWindowForLabelDate, wibDateParts,
} from '@/components/panel/report-window';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS_SHORT = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function fmtBoundary(ms: number): string {
  const p = wibDateParts(ms);
  const t = new Date(ms + JAK_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${p.d} ${MONTHS_SHORT[p.m]} ${hh}:${mm}`;
}
function pad(n: number) { return String(n).padStart(2, '0'); }

export function DailyReportDashboard() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { csName } = usePanelFilters();
  const dayParam = sp.get('day');

  const now = Date.now();
  const current = useMemo(() => currentReportLabelDate(now), [now]);
  const labelDate = useMemo(() => {
    if (dayParam) {
      const [y, m, d] = dayParam.split('-').map(Number);
      if (y && m && d) return { y, m: m - 1, d };
    }
    return current;
  }, [dayParam, current]);

  const rawWindow = reportWindowForLabelDate(labelDate.y, labelDate.m, labelDate.d);
  const { startAt, clamped } = clampStartToCutoff(rawWindow.startAt);
  const endAt = rawWindow.endAt;
  const isCurrent = current.y === labelDate.y && current.m === labelDate.m && current.d === labelDate.d;

  const report = useQuery(api.analytics.getDailyReport, { startAt, endAt });
  const respData = useQuery(api.responseTime.getResponseTimes, { startAt, endAt });
  // cs is sorted by firstReplyCount desc; keep the FIRST (dominant) row per display name —
  // conversation.assignedCsName has mixed forms ("Aisyah"/"CS Aisyah") that normalize equal,
  // so a tiny straggler row must not overwrite the real one.
  const respByCs = new Map<string, { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number }>();
  for (const r of respData?.cs ?? []) if (!respByCs.has(r.csName)) respByCs.set(r.csName, r);

  // Open-date label = the day the window OPENS (= rawWindow.startAt's WIB date), not endAt (next day).
  const label = wibDateParts(rawWindow.startAt);
  const windowLabel = `Periode ${fmtBoundary(startAt)} → ${fmtBoundary(endAt)} WIB`;
  const titleDate = `${DAYS_SHORT[label.dow]} ${label.d} ${MONTHS_SHORT[label.m]} ${label.y}`;
  const dateInputValue = `${label.y}-${pad(label.m + 1)}-${pad(label.d)}`;

  const goTo = (next: { y: number; m: number; d: number }) => {
    const nextIsCurrent = current.y === next.y && current.m === next.m && current.d === next.d;
    const qs = new URLSearchParams(sp.toString());
    if (nextIsCurrent) qs.delete('day');
    else qs.set('day', `${next.y}-${pad(next.m + 1)}-${pad(next.d)}`);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };
  const step = (delta: number) => {
    const L = new Date(Date.UTC(labelDate.y, labelDate.m, labelDate.d) + delta * 86_400_000);
    goTo({ y: L.getUTCFullYear(), m: L.getUTCMonth(), d: L.getUTCDate() });
  };
  const onPick = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    if (y && m && d) goTo({ y, m: m - 1, d });
  };

  const cards = ((report?.cs ?? []) as ReportCardData[]).filter((c) => !csName || c.csName === csName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" className="size-9" onClick={() => step(-1)} aria-label="Hari sebelumnya">
          <ChevronLeft className="size-4" />
        </Button>
        <input
          type="date"
          value={dateInputValue}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button size="icon" variant="outline" className="size-9" onClick={() => step(1)} disabled={isCurrent} aria-label="Hari berikutnya">
          <ChevronRight className="size-4" />
        </Button>
        <div className="ml-1 text-base font-semibold tracking-tight">Laporan {titleDate}</div>
      </div>

      <div className="text-xs text-muted-foreground">
        {windowLabel}
        {isCurrent && ' · berjalan'}
        {clamped && ' · data dari 22 Jun 00:00 (sebelumnya belum akurat)'}
      </div>

      {report === undefined ? (
        <div className="text-sm text-muted-foreground">Memuat…</div>
      ) : (
        <>
          <GrandStrip totals={report.totals} />
          {cards.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <ClipboardList className="size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">Belum ada aktivitas</p>
              <p className="text-xs text-muted-foreground">Leads & closing untuk periode ini akan muncul di sini begitu masuk.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((c) => (
                <ReportCard key={c.csName} card={c} label={label} windowLabel={windowLabel} isCurrent={isCurrent} resp={respByCs.get(c.csName)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GrandStrip({
  totals,
}: {
  totals: { leads: number; closings: number; cr: number; revenue: number; discount: number; cpDiscount: number };
}) {
  const items = [
    { label: 'Total Leads', value: totals.leads },
    { label: 'Total Closing', value: totals.closings },
    { label: 'CR', value: crLabel(totals.cr, totals.leads) },
    { label: 'Omzet', value: formatRupiah(totals.revenue) },
    { label: 'Diskon', value: formatRupiah(totals.discount) },
    { label: 'CP Diskon', value: formatRupiah(totals.cpDiscount) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevate"
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
