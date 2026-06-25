'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardList, Copy, CheckCircle2, Info, Clock, Crown } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { csKey } from '@/lib/cs-key';
import { Button } from '@/components/ui/button';
import { MetricCard, DeltaPill } from '@/components/ui/metric-card';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatRupiahShort } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ReportCard, type ReportCardData, type ReportDelta } from '@/components/panel/report-card';
import {
  JAK_MS, DATA_CUTOFF_MS, clampStartToCutoff, currentReportLabelDate, reportWindowForLabelDate, wibDateParts,
} from '@/components/panel/report-window';
import { computeQueenCs } from '@/lib/queen';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS_SHORT = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

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
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((c) => [c.key, c.avatarUrl])), [csList]);

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
  const respByCs = new Map<string, { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number; slaBreaches: number }>();
  for (const r of respData?.cs ?? []) if (!respByCs.has(csKey(r.csName))) respByCs.set(csKey(r.csName), r);

  const slaBreaches = respData?.overall?.slaBreaches ?? 0;
  const worstSla = (respData?.cs ?? [])
    .filter((c) => c.slaBreaches > 0)
    .sort((a, b) => b.slaBreaches - a.slaBreaches)[0];

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
    const r = respByCs.get(csKey(c.csName));
    if (r && r.firstReplyCount >= 3 && r.firstReplyMedianMs != null && (!fastestResp || r.firstReplyMedianMs < fastestResp.ms)) {
      fastestResp = { csName: c.csName, ms: r.firstReplyMedianMs };
    }
  }
  const queen = !csName
    ? computeQueenCs(
        allCs.map((c) => {
          const r = respByCs.get(csKey(c.csName));
          return {
            csName: c.csName,
            closings: c.closings,
            cr: c.cr,
            leads: c.leads,
            respMedianMs: r?.firstReplyMedianMs ?? null,
            respCount: r?.firstReplyCount ?? 0,
          };
        }),
      )
    : null;
  const queenName = queen?.csName;
  const queenCard = queenName ? allCs.find((c) => c.csName === queenName) : undefined;

  // Peringkat by closing (getDailyReport already returns CS sorted by closing) + team-average CR.
  const rankByCs = new Map<string, number>();
  allCs.forEach((c, i) => rankByCs.set(c.csName, i + 1));
  const avgCr = report?.totals.cr ?? 0;

  // Gamification: award one badge per category to the day's leaders (works Live + Selesai).
  const rewardsByCs = new Map<string, string[]>();
  const addReward = (name: string | undefined, labelText: string) => {
    if (!name) return;
    rewardsByCs.set(name, [...(rewardsByCs.get(name) ?? []), labelText]);
  };
  if (topClosing && topClosing.closings > 0) addReward(topClosing.csName, 'Closing Terbanyak');
  if (topCr) addReward(topCr.csName, 'CR Tertinggi');
  if (fastestResp) addReward(fastestResp.csName, 'Respon Tercepat');

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
        <PeriodStatusPill isCurrent={isCurrent} endAt={endAt} now={now} />
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
          {queen && queenCard && (
            <QueenHero name={queenCard.csName} closings={queenCard.closings} cr={queenCard.cr} avatarByKey={avatarByKey} />
          )}
          {cards.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <ClipboardList className="size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">Belum ada aktivitas</p>
              <p className="text-xs text-muted-foreground">Leads & closing untuk periode ini akan muncul di sini begitu masuk.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <InfoStrip dup={totalDuplicates} sla={slaBreaches} worstSla={worstSla?.csName} loading={respData === undefined} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((c) => (
                  <ReportCard
                    key={c.csName}
                    card={c}
                    label={label}
                    isCurrent={isCurrent}
                    resp={respByCs.get(csKey(c.csName))}
                    rank={rankByCs.get(c.csName)}
                    avgCr={avgCr}
                    delta={deltaFor(c)}
                    rewards={rewardsByCs.get(c.csName)}
                    avatarByKey={avatarByKey}
                    isQueen={c.csName === queenName}
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

// Lean one-line summary: order-double + SLA status (detail lives in each CS card).
function InfoStrip({ dup, sla, worstSla, loading }: { dup: number; sla: number; worstSla?: string; loading: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs">
      {dup > 0 ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
          <Copy className="size-3.5 shrink-0" /> {dup} order double
          <Tooltip>
            <TooltipTrigger
              aria-label="Penjelasan order double"
              className="inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              Pelanggan dengan ≥2 order di periode ini — calon mis-rep. CR sudah dihitung dari leads unik, jadi angkanya tetap akurat.
            </TooltipContent>
          </Tooltip>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0 text-positive" /> Tidak ada order double
        </span>
      )}
      {!loading && (
        <>
          <span className="hidden h-3 w-px bg-border sm:block" />
          {sla > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Clock className="size-3.5 shrink-0 text-destructive" />
              <span className="font-semibold text-destructive">{sla}</span> chat lewat SLA
              <span className="text-muted-foreground/80">(&gt;15m{worstSla ? ` · terbanyak ${worstSla}` : ''})</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Clock className="size-3.5 shrink-0 text-positive" /> Semua chat dalam SLA
            </span>
          )}
        </>
      )}
    </div>
  );
}

function PeriodStatusPill({ isCurrent, endAt, now }: { isCurrent: boolean; endAt: number; now: number }) {
  if (!isCurrent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <CheckCircle2 className="size-3.5" /> Selesai · final
      </span>
    );
  }
  const rem = Math.max(0, endAt - now);
  const h = Math.floor(rem / 3_600_000);
  const m = Math.floor((rem % 3_600_000) / 60_000);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-2.5 py-1 text-xs font-medium text-positive">
      <span className="size-1.5 animate-pulse rounded-full bg-positive" /> Live · tutup 16:00 WIB · sisa {h}j {m}m
    </span>
  );
}

function QueenHero({ name, closings, cr, avatarByKey }: { name: string; closings: number; cr: number; avatarByKey: Map<string, string | null> }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-accent p-4 shadow-sm ring-1 ring-primary/20">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
        <Crown className="size-6" />
      </span>
      <CsAvatar name={name} size="md" src={avatarByKey.get(csKey(name)) ?? undefined} />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">Queen CS · juara umum</div>
        <div className="truncate text-base font-bold tracking-tight text-accent-foreground">{name}</div>
        <div className="text-xs tabular-nums text-accent-foreground/70">{closings} closing · CR {Math.round(cr * 10) / 10}%</div>
      </div>
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
    { label: 'Omzet', node: <AnimatedNumber value={totals.revenue} format={formatRupiahShort} /> },
    { label: 'Diskon', node: <AnimatedNumber value={totals.discount} format={formatRupiahShort} /> },
    { label: 'CP Diskon', node: <AnimatedNumber value={totals.cpDiscount} format={formatRupiahShort} /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <MetricCard key={it.label} label={it.label} value={it.node} emphasis={it.emphasis} delta={it.delta} />
      ))}
    </div>
  );
}
