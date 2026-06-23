'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardList, Copy, CheckCircle2, Info } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { MetricCard, DeltaPill } from '@/components/ui/metric-card';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatRupiah, formatDuration } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ReportCard, type ReportCardData, type ReportDelta } from '@/components/panel/report-card';
import { crLabel } from '@/components/panel/report-text';
import {
  JAK_MS, DATA_CUTOFF_MS, clampStartToCutoff, currentReportLabelDate, reportWindowForLabelDate, wibDateParts,
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
  // Previous window (same 24h length, one day earlier) for ▲▼ deltas. Skipped when
  // the prior period falls before the data cutoff (no reliable comparison).
  const prevStart = rawWindow.startAt - 86_400_000;
  const prevValid = prevStart >= DATA_CUTOFF_MS;
  const prevReport = useQuery(
    api.analytics.getDailyReport,
    prevValid ? { startAt: prevStart, endAt: rawWindow.startAt } : 'skip',
  );
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
  const totalDuplicates = cards.reduce((s, c) => s + (c.duplicates ?? 0), 0);

  // Team highlights (only on the unfiltered team view). Derived, not new data.
  const allCs = (report?.cs ?? []) as ReportCardData[];
  const topClosing = allCs.reduce<ReportCardData | null>((best, c) => (!best || c.closings > best.closings ? c : best), null);
  const topCr = allCs
    .filter((c) => c.leads >= 3)
    .reduce<ReportCardData | null>((best, c) => (!best || c.cr > best.cr ? c : best), null);
  let fastestResp: { csName: string; ms: number } | null = null;
  for (const c of allCs) {
    const r = respByCs.get(c.csName);
    if (r && r.firstReplyCount >= 3 && r.firstReplyMedianMs != null && (!fastestResp || r.firstReplyMedianMs < fastestResp.ms)) {
      fastestResp = { csName: c.csName, ms: r.firstReplyMedianMs };
    }
  }
  const showHighlights = !csName && allCs.length > 0 && (topClosing?.closings ?? 0) > 0;

  // Peringkat by closing (getDailyReport already returns CS sorted by closing) + team-average CR.
  const rankByCs = new Map<string, number>();
  allCs.forEach((c, i) => rankByCs.set(c.csName, i + 1));
  const avgCr = report?.totals.cr ?? 0;

  // Deltas vs the previous window.
  const prevByCs = new Map<string, { leads: number; closings: number; cr: number }>(
    (prevReport?.cs ?? []).map((c: { csName: string; leads: number; closings: number; cr: number }) => [c.csName, c]),
  );
  const deltaFor = (c: ReportCardData): ReportDelta | null => {
    if (!prevValid || prevReport === undefined) return null;
    const p = prevByCs.get(c.csName);
    return {
      leads: c.leads - (p?.leads ?? 0),
      closings: c.closings - (p?.closings ?? 0),
      cr: Math.round((c.cr - (p?.cr ?? 0)) * 10) / 10,
    };
  };

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
          <GrandStrip totals={report.totals} prev={prevValid ? (prevReport?.totals ?? null) : null} />
          {showHighlights && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sorotan</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {topClosing && <HighlightCard title="Closing terbanyak" name={topClosing.csName} value={`${topClosing.closings} closing`} />}
                {topCr && <HighlightCard title="CR tertinggi" name={topCr.csName} value={crLabel(topCr.cr, topCr.leads)} />}
                {fastestResp && <HighlightCard title="Respon tercepat" name={fastestResp.csName} value={formatDuration(fastestResp.ms)} />}
              </div>
            </div>
          )}
          {cards.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <ClipboardList className="size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">Belum ada aktivitas</p>
              <p className="text-xs text-muted-foreground">Leads & closing untuk periode ini akan muncul di sini begitu masuk.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <DoubleOrderBanner count={totalDuplicates} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((c) => (
                  <ReportCard
                    key={c.csName}
                    card={c}
                    label={label}
                    windowLabel={windowLabel}
                    isCurrent={isCurrent}
                    resp={respByCs.get(c.csName)}
                    rank={rankByCs.get(c.csName)}
                    avgCr={avgCr}
                    delta={deltaFor(c)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HighlightCard({ title, name, value }: { title: string; name: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevate">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 flex items-center gap-2.5">
        <CsAvatar name={name} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{name}</div>
          <div className="text-xs tabular-nums text-muted-foreground">{value}</div>
        </div>
      </div>
    </div>
  );
}

function DoubleOrderBanner({ count }: { count: number }) {
  if (count > 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Copy className="size-5" />
        </span>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <span>{count} order double terdeteksi</span>
          <Tooltip>
            <TooltipTrigger
              aria-label="Penjelasan order double"
              className="inline-flex items-center justify-center rounded-full text-amber-600 transition-colors hover:text-amber-800 focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              Pelanggan dengan ≥2 order di periode ini — calon mis-rep. CR sudah dihitung dari leads unik, jadi angkanya tetap akurat.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-positive/20 bg-positive-soft/50 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-positive-soft text-positive">
        <CheckCircle2 className="size-5" />
      </span>
      <div className="text-sm font-medium text-foreground">Tidak ada order double — semua leads unik.</div>
    </div>
  );
}

function GrandStrip({
  totals,
  prev,
}: {
  totals: { leads: number; closings: number; cr: number; revenue: number; discount: number; cpDiscount: number };
  prev?: { leads: number; closings: number; cr: number } | null;
}) {
  const dLeads = prev ? totals.leads - prev.leads : null;
  const dClosings = prev ? totals.closings - prev.closings : null;
  const dCr = prev ? Math.round((totals.cr - prev.cr) * 10) / 10 : null;
  const pill = (d: number | null, suffix = '') =>
    d != null && d !== 0 ? <DeltaPill value={d} suffix={suffix} /> : undefined;

  const items = [
    { label: 'Total Leads', node: <AnimatedNumber value={totals.leads} />, delta: pill(dLeads) },
    { label: 'Total Closing', node: <AnimatedNumber value={totals.closings} />, delta: pill(dClosings) },
    {
      label: 'Closing Rate',
      node: totals.leads > 0 ? <AnimatedNumber value={totals.cr} format={(n) => `${Math.round(n * 10) / 10}%`} /> : <>–</>,
      emphasis: true,
      delta: pill(dCr, '%'),
    },
    { label: 'Omzet', node: <AnimatedNumber value={totals.revenue} format={formatRupiah} /> },
    { label: 'Diskon', node: <AnimatedNumber value={totals.discount} format={formatRupiah} /> },
    { label: 'CP Diskon', node: <AnimatedNumber value={totals.cpDiscount} format={formatRupiah} /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <MetricCard key={it.label} label={it.label} value={it.node} emphasis={it.emphasis} delta={it.delta} />
      ))}
    </div>
  );
}
