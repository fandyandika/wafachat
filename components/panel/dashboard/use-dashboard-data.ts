'use client';

import { useMemo, useState } from 'react';

import { api } from '@/convex/_generated/api';
import { formatDuration } from '@/lib/format';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { useResponseTimesState } from '@/components/panel/use-response-times';
import type { PerformanceData, Stats } from '@/components/panel/types';
import type { DashboardDayRange } from './dashboard-history-filter';

export type DuplicateOrder = {
  phone: string;
  customerName: string;
  csName: string;
  count: number;
  likelyAccidental: boolean;
  orders: Array<{ orderId: string; productName: string; total: string; createdAt: number }>;
};

export function formatDashboardUpdatedAt(ms: number | null) {
  if (!ms) return 'Belum dimuat';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

export function useDashboardData({ range, csName, includeDuplicates, includePerformance = true }: {
  range: DashboardDayRange;
  csName?: string;
  includeDuplicates: boolean;
  includePerformance?: boolean;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { startAt, endAt } = range;
  const periodLabel = range.basis === 'calendar' ? 'Hari kalender' : 'Periode kerja 16:00';
  const rangeArgs = useMemo(() => ({ startAt, endAt, csName }), [csName, endAt, startAt]);
  const summaryArgs = useMemo(() => ({ ...rangeArgs, raw: range.basis === 'calendar' }), [range.basis, rangeArgs]);
  const performanceArgs = useMemo(() => ({ ...rangeArgs, includeInferredDiscount: false }), [rangeArgs]);

  const summary = useConvexSnapshotQuery<{
    leads: number; closings: number; manualClosings: number; cancelled: number; handovers: number; revenue: number;
  }>(api.metrics.getDashboardSummary, summaryArgs);
  const duplicates = useConvexSnapshotQuery<DuplicateOrder[]>(
    api.metrics.getDuplicateOrders,
    includeDuplicates ? rangeArgs : 'skip',
  );
  const performance = useConvexSnapshotQuery<PerformanceData>(api.shippingRecaps.getPerformance, includePerformance ? performanceArgs : 'skip');
  const responseTimes = useResponseTimesState({ startAt, endAt, csName, refreshKey });
  const summaryValue = summary.data;
  const performanceValue = performance.data;
  const stats: Stats = {
    orders: summaryValue?.leads ?? 0,
    closings: summaryValue?.closings ?? 0,
    ai_closings: Math.max((summaryValue?.closings ?? 0) - (summaryValue?.manualClosings ?? 0), 0),
    manual_closings: summaryValue?.manualClosings ?? 0,
    cancelled: summaryValue?.cancelled ?? 0,
    handovers: summaryValue?.handovers ?? 0,
    closed_today: 0,
    date: range.date,
  };

  return {
    stats,
    revenue: summaryValue?.revenue ?? 0,
    totalClosing: performanceValue?.totalClosing ?? summaryValue?.closings ?? 0,
    closingRate: performanceValue?.overallCr ?? (summaryValue?.leads ? (summaryValue.closings / summaryValue.leads) * 100 : 0),
    cancelled: performanceValue?.cancelled ?? summaryValue?.cancelled ?? 0,
    responseLabel: responseTimes.data?.overall.firstReplyMedianMs != null
      ? formatDuration(responseTimes.data.overall.firstReplyMedianMs)
      : responseTimes.loading ? 'Memuat…' : '—',
    topCs: [...(performanceValue?.cs ?? [])].sort((a, b) => b.closing - a.closing).slice(0, 5),
    topProducts: [...(performanceValue?.products ?? [])].sort((a, b) => b.closing - a.closing || b.leads - a.leads),
    productSources: performanceValue?.productSources ?? [],
    sourceBreakdown: performanceValue?.sources ?? [],
    duplicateOrders: duplicates.data ?? [],
    loading: summary.loading || (includePerformance && performance.loading) || (includeDuplicates && duplicates.loading),
    hasData: summary.data !== undefined || performance.data !== undefined,
    ready: {
      summary: summary.data !== undefined,
      duplicates: !includeDuplicates || duplicates.data !== undefined,
      performance: !includePerformance || performance.data !== undefined,
    },
    errors: { summary: summary.error, duplicates: duplicates.error, performance: performance.error, response: responseTimes.error },
    lastUpdatedAt: Math.max(summary.lastUpdatedAt ?? 0, duplicates.lastUpdatedAt ?? 0, performance.lastUpdatedAt ?? 0) || null,
    periodLabel,
    refreshAll: async () => {
      await Promise.all([summary.refresh(), ...(includePerformance ? [performance.refresh()] : []), ...(includeDuplicates ? [duplicates.refresh()] : [])]);
      setRefreshKey((value) => value + 1);
    },
  };
}
