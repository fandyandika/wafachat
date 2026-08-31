'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Copy, CheckCircle2, Info, Clock, Crown, RefreshCw, ImageDown } from 'lucide-react';
import { shareNodeAsPng } from '@/lib/capture';
import { api } from '@/convex/_generated/api';
import { csKey } from '@/lib/cs-key';
import { Button } from '@/components/ui/button';
import { MetricCard, DeltaPill } from '@/components/ui/metric-card';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatRupiahShort } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { useResponseTimes } from '@/components/panel/use-response-times';
import { useMe } from '@/components/panel/use-me';
import { ArenaHero } from '@/components/panel/arena-hero';
import { CsDetailSheet } from '@/components/panel/cs-detail-sheet';
import { PanelState } from '@/components/panel/panel-state';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { ReportCard, type ReportCardData, type ReportDelta } from '@/components/panel/report-card';
import {
  JAK_MS, DATA_CUTOFF_MS, clampStartToCutoff, currentReportLabelDate, reportWindowForLabelDate, wibDateParts,
} from '@/components/panel/report-window';
import type { QueenScoreRow } from '@/lib/queen';

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
function fmtUpdatedAt(ms: number | null): string {
  if (!ms) return 'Belum dimuat';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

export function DailyReportDashboard() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { csName } = usePanelFilters();
  const [respRefreshKey, setRespRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sharingBoard, setSharingBoard] = useState(false);
  const [detailCs, setDetailCs] = useState<string | null>(null); // csName whose Rincian sheet is open
  const boardRef = useRef<HTMLDivElement>(null);
  const dayParam = sp.get('day');
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((c) => [c.key, c.avatarUrl])), [csList]);
  const me = useMe();
  const isCs = me?.role === 'cs';
  // A CS account is scoped to one CS: show only their card + rank, hide team totals/omzet/queen.
  const scopedCs = isCs ? (me?.csName || me?.name) : undefined;
  const scopedView = isCs && !!scopedCs;

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
  const businessDate = `${labelDate.y}-${pad(labelDate.m + 1)}-${pad(labelDate.d)}`;

  const reportArgs = useMemo(() => ({ startAt, endAt }), [startAt, endAt]);
  const {
    data: report,
    loading: reportLoading,
    error: reportError,
    lastUpdatedAt,
    refresh: refreshReport,
  } = useConvexSnapshotQuery<{
    totals: { leads: number; closings: number; cr: number; revenue: number; discount: number; cpDiscount: number };
    cs: ReportCardData[];
  }>(api.analytics.getDailyReport, reportArgs);
  const {
    data: queenStanding,
    loading: queenLoading,
    refresh: refreshQueen,
  } = useConvexSnapshotQuery<{
    winnerCsName: string | null;
    scores: QueenScoreRow[];
    sealed: boolean;
    excludedReason: string | null;
  }>(api.queens.getDailyStanding, { businessDate });
  const respData = useResponseTimes({ startAt, endAt, refreshKey: respRefreshKey });
  // Previous window (same 24h length, one day earlier) for ▲▼ deltas. Skipped when
  // the prior period falls before the data cutoff (no reliable comparison).
  const prevStart = rawWindow.startAt - 86_400_000;
  const prevValid = prevStart >= DATA_CUTOFF_MS;
  const prevReportArgs = useMemo(
    () => (prevValid ? { startAt: prevStart, endAt: rawWindow.startAt } : 'skip' as const),
    [prevStart, prevValid, rawWindow.startAt],
  );
  const {
    data: prevReport,
    loading: prevReportLoading,
    refresh: refreshPrevReport,
  } = useConvexSnapshotQuery<{
    totals: { leads: number; closings: number; cr: number };
    cs: Array<{ csName: string; leads: number; closings: number; cr: number }>;
  }>(api.analytics.getDailyReport, prevReportArgs);
  // cs is sorted by firstReplyCount desc; keep the FIRST (dominant) row per display name —
  // conversation.assignedCsName has mixed forms ("Aisyah"/"CS Aisyah") that normalize equal,
  // so a tiny straggler row must not overwrite the real one.
  const respByCs = new Map<string, { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number; slaBreaches: number }>();
  for (const r of respData?.cs ?? []) if (!respByCs.has(csKey(r.csName))) respByCs.set(csKey(r.csName), r);

  const slaBreaches = respData?.overall?.slaBreaches ?? 0;
  // Flag by breach RATE (breaches ÷ measured first-replies), not absolute count — otherwise
  // the busiest CS gets smeared just for handling the most chats. Floor the sample at 5
  // first-replies (matching QUEEN_MIN_RESP) so a 1/1 micro-sample can't top the list.
  const worstSla = (respData?.cs ?? [])
    .filter((c) => c.slaBreaches > 0 && c.firstReplyCount >= 5)
    .map((c) => ({ csName: c.csName, ratePct: Math.round((c.slaBreaches / c.firstReplyCount) * 100) }))
    .sort((a, b) => b.ratePct - a.ratePct)[0];

  const label = wibDateParts(rawWindow.endAt);
  const windowLabel = `Dari ${fmtBoundary(startAt)} sampai ${fmtBoundary(endAt)} WIB.`;
  const titleDate = `${DAYS_SHORT[label.dow]} ${label.d} ${MONTHS_SHORT[label.m]} ${label.y}`;
  const dateInputValue = businessDate;

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
  const onPickCs = (value: string) => {
    const qs = new URLSearchParams(sp.toString());
    if (value === 'all') qs.delete('cs');
    else qs.set('cs', value);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshReport(), refreshQueen(), prevValid ? refreshPrevReport() : Promise.resolve()]);
      setRespRefreshKey((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const allCs = (report?.cs ?? []) as ReportCardData[];
  // Scoped CS forces the filter to their own CS (csKey-tolerant), ignoring any URL filter.
  const effectiveCsName = scopedCs ?? csName;
  const totalCsCount = allCs.length;

  // Team highlights (only on the unfiltered team view). Derived, not new data.
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
  // Queen is computed once from organization-wide inputs in Convex. Never recompute it
  // from the CS-scoped response payload: that made each account see a different winner.
  const queenScores = queenStanding?.scores ?? [];
  const queenName = queenStanding?.winnerCsName ?? undefined;
  const queenCard = queenName ? allCs.find((c) => c.csName === queenName) : undefined;

  // Rank + card order follow the Queen SCORE (CR+closing+speed), so the #1 card IS the
  // Queen — consistent with the hero and the CS Arena. (computeQueenScores already sorts
  // eligible-first by score, closing only breaking ties; <10-lead CS sort last.)
  const rankByCs = new Map<string, number>();
  queenScores.forEach((s, i) => rankByCs.set(s.csName, i + 1));
  const cards = allCs
    .filter((c) => !effectiveCsName || csKey(c.csName) === csKey(effectiveCsName))
    .sort((a, b) => (rankByCs.get(a.csName) ?? 999) - (rankByCs.get(b.csName) ?? 999));
  const totalDuplicates = cards.reduce((s, c) => s + (c.duplicates ?? 0), 0);
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

  const onShareBoard = async () => {
    if (!boardRef.current || sharingBoard) return;
    setSharingBoard(true);
    // Capture a clone forced to the desktop layout (fixed width + multi-column
    // grids) rather than the live board, so a phone export looks like the desktop
    // panel instead of the 1-column mobile stack. The off-screen positioning MUST
    // live on a wrapper, not the captured node itself: html-to-image copies the
    // captured root's computed styles into the snapshot, so position:fixed;
    // left:-10000px on the clone shoved the content out of the SVG frame — that
    // was the "blank background-only PNG" bug.
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '-12000px';
    wrapper.style.zIndex = '-1';
    const clone = boardRef.current.cloneNode(true) as HTMLElement;
    clone.classList.add('capture-desktop');
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    try {
      void clone.offsetWidth; // force reflow at the desktop width before capture
      await shareNodeAsPng(clone, `laporan-${dateInputValue}.png`);
    } catch {
      /* capture failed (very old browser) — silently ignore */
    } finally {
      wrapper.remove();
      setSharingBoard(false);
    }
  };

  return (
    <div className="space-y-6">
      <div role="toolbar" aria-label="Kontrol laporan" className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" className="size-11 sm:size-9" onClick={() => step(-1)} aria-label="Hari sebelumnya">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-1">
          <label htmlFor="report-day" className="text-xs font-medium text-muted-foreground">Tanggal</label>
          <input
            id="report-day"
            type="date"
            value={dateInputValue}
            onChange={(e) => e.target.value && onPick(e.target.value)}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm sm:h-9"
          />
        </div>
        <Button size="icon" variant="outline" className="size-11 sm:size-9" onClick={() => step(1)} disabled={isCurrent} aria-label="Hari berikutnya">
          <ChevronRight className="size-4" />
        </Button>
        <div className="ml-1 text-base font-semibold tracking-tight">Laporan {titleDate}</div>
        <PeriodStatusPill isCurrent={isCurrent} endAt={endAt} now={now} />
        {!scopedView && (
          <div className="flex items-center gap-1">
            <label htmlFor="report-cs" className="text-xs font-medium text-muted-foreground">CS</label>
            <select
              id="report-cs"
              value={csName ?? 'all'}
              onChange={(e) => onPickCs(e.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3 text-sm sm:h-9"
            >
              <option value="all">Semua CS</option>
              {csList.map((cs) => <option key={cs.key} value={cs.csName}>{cs.csName}</option>)}
            </select>
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-11 gap-2 sm:h-9"
          onClick={refreshAll}
          disabled={refreshing || reportLoading || queenLoading || prevReportLoading}
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {/* CS get this too — dokumentasi pribadi / pamer hasil 😄 (per owner) */}
        <Button
          size="sm"
          variant="outline"
          className="h-11 gap-2 sm:h-9"
          onClick={onShareBoard}
          disabled={sharingBoard || report === undefined}
          title="Simpan/share laporan sebagai gambar (siap kirim WA)"
        >
          <ImageDown className={`size-4 ${sharingBoard ? 'animate-pulse' : ''}`} />
          Share PNG
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Periode kerja 16:00</span> {windowLabel}
        {isCurrent && ' · berjalan'}
        {clamped && ' · data dari 22 Jun 00:00 (sebelumnya belum akurat)'}
        {' · update '}
        {fmtUpdatedAt(lastUpdatedAt)}
      </div>

      {reportError ? (
        <PanelState kind="error" title="Laporan gagal dimuat" description={reportError} action={<Button variant="outline" onClick={refreshAll}>Coba lagi</Button>} />
      ) : report === undefined ? (
        <ReportSkeleton />
      ) : (
        <div ref={boardRef} className="space-y-6">
          {queenStanding?.excludedReason && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <span className="font-medium">Queen tidak dihitung · {queenStanding.excludedReason}</span>
              <span className="text-muted-foreground"> · Data performa tetap ditampilkan.</span>
            </div>
          )}
          {scopedView && (
            <ArenaHero
              scores={queenScores}
              ownName={cards[0]?.csName ?? null}
              ownLeads={cards[0]?.leads ?? 0}
              queenName={queenName}
              medals={cards[0] ? rewardsByCs.get(cards[0].csName) ?? [] : []}
              deltaClosings={cards[0] ? deltaFor(cards[0])?.closings ?? null : null}
              isCurrent={isCurrent}
              endAt={endAt}
              titleDate={titleDate}
              avatarUrl={cards[0] ? avatarByKey.get(csKey(cards[0].csName)) ?? undefined : undefined}
            />
          )}
          {!scopedView && (
            <GrandStrip totals={report.totals} prev={prevValid ? (prevReport?.totals ?? null) : null} hideRevenue={isCs} />
          )}
          {!scopedView && queenName && queenCard && (
            <QueenHero name={queenCard.csName} closings={queenCard.closings} cr={queenCard.cr} avatarByKey={avatarByKey} />
          )}
          {cards.length === 0 ? (
            <PanelState kind="empty" title="Belum ada aktivitas" description="Leads dan closing untuk periode ini akan muncul di sini begitu masuk." />
          ) : (
            <div className="space-y-4">
              {!scopedView && <InfoStrip dup={totalDuplicates} sla={slaBreaches} worstSla={worstSla} />}
              {/* grid-cols-1 (minmax(0,1fr)) so long product names can't stretch the column past the phone viewport */}
              <div data-capture-grid="cards" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((c) => (
                  <ReportCard
                    key={csKey(c.csName)}
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
                    onDetail={() => setDetailCs(c.csName)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <CsDetailSheet
        open={detailCs != null}
        onOpenChange={(o) => { if (!o) setDetailCs(null); }}
        csName={detailCs ?? ''}
        startAt={startAt}
        endAt={endAt}
        titleDate={titleDate}
        avatarUrl={detailCs ? avatarByKey.get(csKey(detailCs)) ?? undefined : undefined}
      />
    </div>
  );
}

// Lean one-line summary: order-double + SLA status (detail lives in each CS card).
function ReportSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Memuat laporan">
      {[0, 1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-xl bg-muted" />)}
    </div>
  );
}

function InfoStrip({ dup, sla, worstSla }: { dup: number; sla: number; worstSla?: { csName: string; ratePct: number } }) {
  if (dup === 0 && sla === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs">
      {dup > 0 && (
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
              Pelanggan dengan ≥2 order di periode ini adalah calon mis-rep. CR dihitung dari pelanggan unik, jadi order double tidak menggelembungkan angka.
            </TooltipContent>
          </Tooltip>
        </span>
      )}
      {dup > 0 && sla > 0 && <span data-capture-sep className="hidden h-3 w-px bg-border sm:block" />}
      {sla > 0 && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="size-3.5 shrink-0 text-destructive" />
          <span className="font-semibold text-destructive">{sla}</span> chat lewat SLA
          <span className="text-muted-foreground/80">(&gt;15m{worstSla ? ` · rawan ${worstSla.csName} ${worstSla.ratePct}%` : ''})</span>
        </span>
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
  hideRevenue,
}: {
  totals: { leads: number; closings: number; cr: number; revenue: number; discount: number; cpDiscount: number };
  prev?: { leads: number; closings: number; cr: number } | null;
  hideRevenue?: boolean;
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
  ].filter((it) => !(hideRevenue && it.label === 'Omzet')); // CS staff don't see total-business omzet
  return (
    <div data-capture-grid="totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <MetricCard key={it.label} label={it.label} value={it.node} emphasis={it.emphasis} delta={it.delta} />
      ))}
    </div>
  );
}
