'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard, type StatTone } from '@/components/ui/stat-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { useHighlightOnChange } from '@/components/ui/use-highlight-on-change';
import { api } from '@/convex/_generated/api';
import type { Stats, PerformanceData } from '@/components/panel/types';
import { pct, fmtTime, formatRupiah } from '@/lib/format';
import { usePanelFilters } from '@/components/panel/use-panel-filters';

export default function DashboardPage() {
  const { startAt, endAt, csName, jakartaDate } = usePanelFilters();

  const summaryData = useQuery(api.metrics.getDashboardSummary, {
    startAt,
    endAt,
    csName,
  });

  const duplicateOrders = useQuery(api.metrics.getDuplicateOrders, {
    startAt,
    endAt,
    csName,
  });

  const performanceData = useQuery(api.shippingRecaps.getPerformance, {
    startAt,
    endAt,
    includeInferredDiscount: false,
    csName,
  });

  const performance = performanceData as PerformanceData | undefined;
  const stats: Stats = {
    orders: summaryData?.leads ?? 0,
    closings: summaryData?.closings ?? 0,
    ai_closings: Math.max((summaryData?.closings ?? 0) - (summaryData?.manualClosings ?? 0), 0),
    manual_closings: summaryData?.manualClosings ?? 0,
    cancelled: summaryData?.cancelled ?? 0,
    handovers: summaryData?.handovers ?? 0,
    closed_today: 0,
    date: jakartaDate,
  };

  const loading = summaryData === undefined || performanceData === undefined;

  // Dashboard-only derivations
  const totalClosing = performance?.totalClosing ?? 0;
  const manualClosings = stats.manual_closings ?? 0;
  const aiClosings = Math.max(totalClosing - manualClosings, 0);
  const crPerf = performance?.overallCr ?? 0;
  const handoverTodayCount = stats.handovers;
  const handoverRate = stats.orders > 0 ? Math.round((handoverTodayCount / stats.orders) * 100) : 0;
  const revenue = summaryData?.revenue ?? 0;

  const cards = useMemo(
    (): Array<{
      label: string;
      value: number;
      detail: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: StatTone;
      format?: (n: number) => string;
      highlightable?: boolean;
    }> => [
      {
        label: 'Orders',
        value: stats.orders,
        detail: 'Leads · HP unik',
        icon: Activity,
        tone: 'lead',
        highlightable: true,
      },
      {
        label: 'Total Closing',
        value: totalClosing,
        detail: `AI: ${aiClosings} · Manual: ${manualClosings}`,
        icon: CheckCircle2,
        tone: 'positive',
        highlightable: true,
      },
      {
        label: 'Closing rate',
        value: crPerf,
        detail: 'Closing / orders',
        icon: BarChart3,
        tone: crPerf > 100 ? 'negative' : 'positive',
        format: pct,
      },
      {
        label: 'Cancelled',
        value: performance?.cancelled ?? stats.cancelled ?? 0,
        detail: 'Customer cancelled',
        icon: CircleAlert,
        tone: 'negative',
      },
      {
        label: 'Omzet',
        value: revenue,
        detail: 'Revenue periode',
        icon: Wallet,
        tone: 'positive',
        format: formatRupiah,
      },
    ],
    [aiClosings, crPerf, manualClosings, performance, revenue, stats, totalClosing],
  );

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, index) => <MetricSkeleton key={index} />)
          : cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚠️ Order Dobel</CardTitle>
          <CardDescription>
            Customer dengan ≥2 order di periode ini — kroscek di Berdu, cancel jika dobel tak sengaja.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {duplicateOrders === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : duplicateOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada order dobel di periode ini ✅</p>
          ) : (
            duplicateOrders.map((d) => (
              <div key={d.phone} className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{d.customerName || 'Tanpa Nama'}</span>
                  <span className="text-muted-foreground">{d.phone}</span>
                  <span className="text-muted-foreground">· {d.csName || '—'}</span>
                  <Badge variant="secondary">{d.count}× order</Badge>
                  {d.likelyAccidental ? (
                    <Badge variant="warning">⚠ kemungkinan accidental</Badge>
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
        </CardContent>
      </Card>

    </>
  );
}

function DashboardStatCard({
  label,
  value,
  detail,
  icon,
  tone,
  format,
  highlightable,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatTone;
  format?: (n: number) => string;
  highlightable?: boolean;
}) {
  const highlight = useHighlightOnChange(highlightable ? value : undefined);
  return (
    <StatCard
      label={label}
      value={<AnimatedNumber value={value} format={format} />}
      detail={detail}
      icon={icon}
      tone={tone}
      highlight={highlight}
    />
  );
}

function MetricSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

