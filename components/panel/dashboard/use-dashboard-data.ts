'use client';

import { useMemo, useState } from 'react';

import { api } from '@/convex/_generated/api';
import { formatDuration } from '@/lib/format';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { useResponseTimes } from '@/components/panel/use-response-times';
import type { PerformanceData, Stats } from '@/components/panel/types';
import type { WindowMode } from '@/components/panel/window-mode-toggle';

const DAY = 86_400_000;
const WIB_OFFSET = 7 * 60 * 60 * 1000;

function wibMidnight(now: number) {
  return Math.floor((now + WIB_OFFSET) / DAY) * DAY - WIB_OFFSET;
}

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

export function useDashboardData({ mode, csName, includeDuplicates }: {
  mode: WindowMode;
  csName?: string;
  includeDuplicates: boolean;
}) {
  const { startAt: workStart, endAt: workEnd, jakartaDate, range } = usePanelFilters();
  const [refreshKey, setRefreshKey] = useState(0);
  const now = useMemo(() => Date.now(), [refreshKey]);
  const startAt = mode === 'live' ? wibMidnight(now) : workStart;
  const endAt = mode === 'live' ? now : workEnd;
  const periodLabel = mode === 'live'
    ? 'Hari kalender'
    : ({ today: 'Hari ini', yesterday: 'Kemarin', '7d': '7 hari', '30d': '30 hari', month: 'Bulan ini', custom: 'Tanggal dipilih' } as const)[range];
  const rangeArgs = useMemo(() => ({ startAt, endAt, csName }), [csName, endAt, startAt]);
  const summaryArgs = useMemo(() => ({ ...rangeArgs, raw: mode === 'live' }), [mode, rangeArgs]);
  const performanceArgs = useMemo(() => ({ ...rangeArgs, includeInferredDiscount: false }), [rangeArgs]);

  const summary = useConvexSnapshotQuery<{
    leads: number; closings: number; manualClosings: number; cancelled: number; handovers: number; revenue: number;
  }>(api.metrics.getDashboardSummary, summaryArgs);
  const duplicates = useConvexSnapshotQuery<DuplicateOrder[]>(
    api.metrics.getDuplicateOrders,
    includeDuplicates ? rangeArgs : 'skip',
  );
  const performance = useConvexSnapshotQuery<PerformanceData>(api.shippingRecaps.getPerformance, performanceArgs);
  const responseTimes = useResponseTimes({ startAt: endAt - DAY, endAt, csName, refreshKey });
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
    date: jakartaDate,
  };

  return {
    stats,
    revenue: summaryValue?.revenue ?? 0,
    totalClosing: performanceValue?.totalClosing ?? 0,
    closingRate: performanceValue?.overallCr ?? 0,
    cancelled: performanceValue?.cancelled ?? summaryValue?.cancelled ?? 0,
    responseLabel: responseTimes?.overall.firstReplyMedianMs != null
      ? formatDuration(responseTimes.overall.firstReplyMedianMs)
      : '—',
    topCs: [...(performanceValue?.cs ?? [])].sort((a, b) => b.closing - a.closing).slice(0, 5),
    topProducts: [...(performanceValue?.products ?? [])].sort((a, b) => b.closing - a.closing).slice(0, 5),
    duplicateOrders: duplicates.data ?? [],
    loading: summary.loading || performance.loading,
    hasData: summary.data !== undefined || performance.data !== undefined,
    errors: { summary: summary.error, duplicates: duplicates.error, performance: performance.error },
    lastUpdatedAt: Math.max(summary.lastUpdatedAt ?? 0, duplicates.lastUpdatedAt ?? 0, performance.lastUpdatedAt ?? 0) || null,
    periodLabel,
    refreshAll: async () => {
      await Promise.all([summary.refresh(), performance.refresh(), ...(includeDuplicates ? [duplicates.refresh()] : [])]);
      setRefreshKey((value) => value + 1);
    },
  };
}
