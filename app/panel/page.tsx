'use client';

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { csKey } from '@/lib/cs-key';
import {
  XCircle,
  Wallet,
  Clock,
  CircleAlert,
  RefreshCw,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard, type MetricTone } from '@/components/ui/metric-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { TrendChart } from '@/components/ui/trend-chart';
import { StatsWidget } from '@/components/ui/stats-widget';
import { cn } from '@/lib/utils';
import { crBarClass } from '@/lib/cr';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { api } from '@/convex/_generated/api';
import type { Stats, PerformanceData } from '@/components/panel/types';
import { fmtTime, formatRupiah, formatDuration } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { useResponseTimes } from '@/components/panel/use-response-times';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';

function fmtUpdatedAt(ms: number | null): string {
  if (!ms) return 'Belum dimuat';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

export default function DashboardPage() {
  const { startAt, endAt, csName, jakartaDate, range } = usePanelFilters();
  const [respRefreshKey, setRespRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((c) => [c.key, c.avatarUrl])), [csList]);
  const periodLabel = ({ today: 'hari ini', yesterday: 'kemarin', '7d': '7 hari', '30d': '30 hari', month: 'bulan ini', custom: 'tanggal dipilih' } as const)[range];

  const filteredRangeArgs = useMemo(() => ({ startAt, endAt, csName }), [csName, endAt, startAt]);
  const performanceArgs = useMemo(() => ({
    startAt,
    endAt,
    includeInferredDiscount: false,
    csName,
  }), [csName, endAt, startAt]);
  const trendArgs = useMemo(() => ({ startAt, endAt, bucket: 'day' as const }), [endAt, startAt]);

  const summaryData = useConvexSnapshotQuery<{
    leads: number;
    closings: number;
    manualClosings: number;
    cancelled: number;
    handovers: number;
    revenue: number;
  }>(api.metrics.getDashboardSummary, filteredRangeArgs);

  const duplicateOrders = useConvexSnapshotQuery<Array<{
    phone: string;
    customerName: string;
    csName: string;
    count: number;
    likelyAccidental: boolean;
    orders: Array<{ orderId: string; productName: string; total: string; createdAt: number }>;
  }>>(api.metrics.getDuplicateOrders, filteredRangeArgs);

  const performanceData = useConvexSnapshotQuery<PerformanceData>(api.shippingRecaps.getPerformance, performanceArgs);
  const trendData = useConvexSnapshotQuery<Array<{ bucket: string; leads: number; closings: number; cr: number }>>(api.metrics.getTrend, trendArgs);
  // "Respon CS" = seberapa cepat bales chat baru → cukup 24 jam terakhir (paling relevan) dan
  // ini motong read messages paling berat (dulu ikut range 7 hari). Anchored ke endAt yang sudah
  // memoized (BUKAN Date.now()) supaya args tetap stabil — ga refetch tiap render.
  const respStartAt = endAt - 24 * 60 * 60 * 1000;
  const respData = useResponseTimes({ startAt: respStartAt, endAt, csName, refreshKey: respRefreshKey });

  const [dupOpen, setDupOpen] = useState(false);
  const dupCount = duplicateOrders.data?.length ?? 0;

  const summary = summaryData.data;
  const performance = performanceData.data;
  const stats: Stats = {
    orders: summary?.leads ?? 0,
    closings: summary?.closings ?? 0,
    ai_closings: Math.max((summary?.closings ?? 0) - (summary?.manualClosings ?? 0), 0),
    manual_closings: summary?.manualClosings ?? 0,
    cancelled: summary?.cancelled ?? 0,
    handovers: summary?.handovers ?? 0,
    closed_today: 0,
    date: jakartaDate,
  };

  const loading = summaryData.loading || performanceData.loading || refreshing;
  const lastUpdatedAt = Math.max(
    summaryData.lastUpdatedAt ?? 0,
    duplicateOrders.lastUpdatedAt ?? 0,
    performanceData.lastUpdatedAt ?? 0,
    trendData.lastUpdatedAt ?? 0,
  ) || null;
  const error = summaryData.error || duplicateOrders.error || performanceData.error || trendData.error;

  // Dashboard-only derivations
  const totalClosing = performance?.totalClosing ?? 0;
  const crPerf = performance?.overallCr ?? 0;
  const handoverTodayCount = stats.handovers;
  const handoverRate = stats.orders > 0 ? Math.round((handoverTodayCount / stats.orders) * 100) : 0;
  const revenue = summary?.revenue ?? 0;

  const topCs = [...(performance?.cs ?? [])].sort((a, b) => b.closing - a.closing).slice(0, 5);
  const topProducts = [...(performance?.products ?? [])].sort((a, b) => b.closing - a.closing).slice(0, 5);
  const trendPoints = (trendData.data ?? []).map((b) => ({ label: b.bucket, leads: b.leads, closings: b.closings }));
  const leadsSeries = trendPoints.map((p) => p.leads);
  const closingSeries = trendPoints.map((p) => p.closings);
  const crSeries = (trendData.data ?? []).map((b) => b.cr);
  // Momentum = second half vs first half of the period (a real signal, not vs a phantom prev query).
  const momentum = (s: number[]): number | null => {
    if (s.length < 4) return null;
    const mid = Math.floor(s.length / 2);
    const a = s.slice(0, mid).reduce((x, y) => x + y, 0);
    const b = s.slice(mid).reduce((x, y) => x + y, 0);
    if (a === 0) return null;
    return Math.round(((b - a) / a) * 100);
  };

  const cards = useMemo(
    (): Array<{
      label: string;
      value: number;
      hint: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: MetricTone;
      emphasis?: boolean;
      format?: (n: number) => string;
    }> => [
      {
        label: 'Omzet',
        value: revenue,
        hint: 'revenue periode',
        icon: Wallet,
        tone: 'default',
        format: formatRupiah,
      },
      {
        label: 'Dibatalkan',
        value: performance?.cancelled ?? stats.cancelled ?? 0,
        hint: 'dibatalkan customer',
        icon: XCircle,
        tone: 'negative',
      },
    ],
    [performance, revenue, stats],
  );
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        summaryData.refresh(),
        duplicateOrders.refresh(),
        performanceData.refresh(),
        trendData.refresh(),
      ]);
      setRespRefreshKey((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Metrik <span className="font-medium text-foreground">{periodLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground">Snapshot analytics · update {fmtUpdatedAt(lastUpdatedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-9 gap-2" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => setDupOpen(true)}
            disabled={dupCount === 0}
            className="gap-2"
          >
            <CircleAlert className="size-4" />
            Order Double
            <Badge variant={dupCount > 0 ? 'warning' : 'secondary'}>{dupCount}</Badge>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Hero stats — figure + momentum + sparkline */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatsWidget label="Leads" value={<AnimatedNumber value={stats.orders} />} hint={periodLabel} series={leadsSeries} deltaPct={momentum(leadsSeries)} />
        <StatsWidget label="Closing" value={<AnimatedNumber value={totalClosing} />} hint={periodLabel} series={closingSeries} deltaPct={momentum(closingSeries)} />
        <StatsWidget label="Closing Rate" value={<AnimatedNumber value={crPerf} format={(n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`} />} hint={periodLabel} series={crSeries} deltaPct={momentum(crSeries)} />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => <MetricSkeleton key={index} />)
        ) : (
          <>
            {cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
            <MetricCard
              label="Respon CS"
              value={respData?.overall.firstReplyMedianMs != null ? formatDuration(respData.overall.firstReplyMedianMs) : '–'}
              hint={`balas chat baru · 24 jam${respData ? ` · ${respData.overall.firstReplyCount} chat` : ''}`}
              icon={Clock}
              tone="default"
            />
          </>
        )}
      </section>

      {trendPoints.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trend Harian</CardTitle>
            <CardDescription>Leads &amp; closing per hari · {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-2xl">
              <TrendChart data={trendPoints} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top CS</CardTitle>
            <CardDescription>Closing terbanyak · {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {performanceData.data === undefined ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : topCs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada data.</p>
            ) : (
              topCs.map((c, i) => (
                <div key={c.csName} className="flex items-center gap-3">
                  <span className="w-3 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  <CsAvatar name={c.csName || '?'} size="sm" src={avatarByKey.get(csKey(c.csName)) ?? undefined} />
                  <span className="w-16 shrink-0 truncate text-sm font-medium">{c.csName || '—'}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', crBarClass(c.cr))} style={{ width: `${Math.min(Math.max(c.cr, 0), 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.closing} · {c.cr}%</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Produk</CardTitle>
            <CardDescription>Closing terbanyak · {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {performanceData.data === undefined ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada data.</p>
            ) : (
              topProducts.map((p) => (
                <div key={p.product} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.product}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{p.closing} · {p.cr}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', crBarClass(p.cr))} style={{ width: `${Math.min(Math.max(p.cr, 0), 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={dupOpen} onOpenChange={setDupOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Order Double</SheetTitle>
            <SheetDescription>
              Customer dengan ≥2 order di periode ini — kroscek di Berdu, cancel jika dobel tak sengaja.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {duplicateOrders.data === undefined ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : duplicateOrders.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada order double di periode ini.</p>
            ) : (
              duplicateOrders.data.map((d) => (
                <div key={d.phone} className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{d.customerName || 'Tanpa Nama'}</span>
                    <span className="text-muted-foreground">{d.phone}</span>
                    <span className="text-muted-foreground">· {d.csName || '—'}</span>
                    <Badge variant="secondary">{d.count}× order</Badge>
                    {d.likelyAccidental ? (
                      <Badge variant="warning">kemungkinan accidental</Badge>
                    ) : (
                      <Badge variant="secondary">repeat customer</Badge>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {d.orders.map((o) => (
                      <li key={o.orderId} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <code className="text-foreground">{o.orderId}</code>
                        <span>{o.productName || '—'}</span>
                        <span>{o.total || '—'}</span>
                        <span>{fmtTime(o.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

    </>
  );
}

function DashboardStatCard({
  label,
  value,
  hint,
  icon,
  tone,
  emphasis,
  format,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: MetricTone;
  emphasis?: boolean;
  format?: (n: number) => string;
}) {
  return (
    <MetricCard
      label={label}
      value={<AnimatedNumber value={value} format={format} />}
      hint={hint}
      icon={icon}
      tone={tone}
      emphasis={emphasis}
    />
  );
}

function MetricSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="size-8 rounded-xl" />
      </div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

