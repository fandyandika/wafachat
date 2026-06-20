'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { PerformancePanel } from '@/components/panel/performance-panel';
import type { PerformanceData } from '@/components/panel/types';

export default function PerformancePage() {
  const { startAt, endAt, csName } = usePanelFilters();

  const csLeaderboard = useQuery(api.analytics.getCsLeaderboard, { startAt, endAt });
  const productDifficulty = useQuery(api.analytics.getProductDifficulty, { startAt, endAt });
  const trendData = useQuery(api.metrics.getTrend, { startAt, endAt, bucket: 'day' });
  const performanceData = useQuery(api.shippingRecaps.getPerformance, {
    startAt,
    endAt,
    includeInferredDiscount: false,
    csName,
  });

  const performance = performanceData as PerformanceData | undefined;

  return (
    <PerformancePanel
      data={performance}
      csLeaderboard={csLeaderboard ?? undefined}
      productDifficulty={productDifficulty ?? undefined}
      trendData={trendData ?? undefined}
    />
  );
}
