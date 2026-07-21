'use client';

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { useResponseTimes } from '@/components/panel/use-response-times';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { PerformancePanel } from '@/components/panel/performance-panel';
import type { PerformanceData } from '@/components/panel/types';
import { Button } from '@/components/ui/button';
import { WindowModeToggle, type WindowMode } from '@/components/panel/window-mode-toggle';

function fmtUpdatedAt(ms: number | null): string {
  if (!ms) return 'Belum dimuat';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

// Same UI in both modes — only the DATA window changes. DEFAULT = "Hari ini" (live,
// calendar-day midnight→now; raw queries, cheap for today's small slice). "Periode kerja"
// = the 16:00 window from the range filter (rollup-backed). No layout change between modes.
export default function PerformancePage() {
  const [mode, setMode] = useState<WindowMode>('live');
  return <PerformanceWork mode={mode} onModeChange={setMode} />;
}

const JAK_OFFSET = 7 * 60 * 60 * 1000;
function wibMidnight(now: number) { return Math.floor((now + JAK_OFFSET) / 86_400_000) * 86_400_000 - JAK_OFFSET; }

function PerformanceWork({ mode, onModeChange }: { mode: WindowMode; onModeChange: (m: WindowMode) => void }) {
  const { startAt: workStart, endAt: workEnd, csName } = usePanelFilters();
  const [responseRefreshKey, setResponseRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((c) => [c.key, c.avatarUrl])), [csList]);

  // live = calendar-day (midnight WIB → now); work = 16:00-window. `now` captured on mount +
  // each refresh so args stay stable (no refetch loop). raw=true routes the rollup-backed
  // queries to their cheap raw computation for the small "today" slice.
  const now = useMemo(() => Date.now(), [responseRefreshKey]);
  const startAt = mode === 'live' ? wibMidnight(now) : workStart;
  const endAt = mode === 'live' ? now : workEnd;
  const rawMode = mode === 'live';

  const rangeArgs = useMemo(() => ({ startAt, endAt }), [startAt, endAt]);
  const leaderboardArgs = useMemo(() => ({ startAt, endAt, raw: rawMode }), [startAt, endAt, rawMode]);
  const performanceArgs = useMemo(() => ({
    startAt,
    endAt,
    includeInferredDiscount: false,
    csName,
  }), [csName, endAt, startAt]);

  const csLeaderboard = useConvexSnapshotQuery<Array<{
    csName: string; leads: number; closings: number; cr: number; revenue: number;
    deltaLeads: number; deltaClosings: number; deltaCr: number;
  }>>(api.analytics.getCsLeaderboard, leaderboardArgs);
  const productDifficulty = useConvexSnapshotQuery<Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>>(
    api.analytics.getProductDifficulty,
    rangeArgs,
  );
  const trendData = useConvexSnapshotQuery<Array<{ bucket: string; leads: number; closings: number; cr: number }>>(
    api.metrics.getTrend,
    'skip',
  );
  const performanceData = useConvexSnapshotQuery<PerformanceData>(api.shippingRecaps.getPerformance, performanceArgs);

  const responseTimes = useResponseTimes({ startAt, endAt, refreshKey: responseRefreshKey });

  const loading = csLeaderboard.loading || productDifficulty.loading || trendData.loading || performanceData.loading || refreshing;
  const error = csLeaderboard.error || productDifficulty.error || trendData.error || performanceData.error;
  const lastUpdatedAt = Math.max(
    performanceData.lastUpdatedAt ?? 0,
    csLeaderboard.lastUpdatedAt ?? 0,
    productDifficulty.lastUpdatedAt ?? 0,
    trendData.lastUpdatedAt ?? 0,
  ) || null;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        csLeaderboard.refresh(),
        productDifficulty.refresh(),
        trendData.refresh(),
        performanceData.refresh(),
      ]);
      setResponseRefreshKey((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight">Performance</h1>
          <p className="text-xs text-muted-foreground">
            Snapshot analytics · update {fmtUpdatedAt(lastUpdatedAt)}
          </p>
        </div>
        <WindowModeToggle mode={mode} onChange={onModeChange} />
        <Button size="sm" variant="outline" className="h-9 gap-2" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <PerformancePanel
        data={performanceData.data}
        csLeaderboard={csLeaderboard.data}
        productDifficulty={productDifficulty.data}
        trendData={trendData.data}
        responseTimes={responseTimes?.cs ?? undefined}
        avatarByKey={avatarByKey}
      />
    </div>
  );
}
