'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Me } from '@/components/panel/use-me';
import { cn } from '@/lib/utils';
import { DashboardContextBar, LedgerMetric, LedgerMetricGrid, LedgerSection } from './ledger';
import { formatDashboardUpdatedAt, useDashboardData } from './use-dashboard-data';
import { windowKeyToday, windowRangeForKey } from '@/lib/report-window-core';

type QueueCounts = { h1: number; h2: number; h3: number };

export function CsHome({ me }: { me: Me }) {
  const workDate = windowKeyToday();
  const data = useDashboardData({
    range: { date: workDate, basis: 'work', ...windowRangeForKey(workDate), running: true },
    csName: me.csName,
    includeDuplicates: false,
    includePerformance: false,
  });
  const [counts, setCounts] = useState<QueueCounts>();
  const [countsTruncated, setCountsTruncated] = useState(false);
  const [countsError, setCountsError] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    setCountsError(null);
    const response = await fetch('/api/follow-up/counts', { method: 'POST' });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'Gagal memuat antrean');
    setCounts(body.counts as QueueCounts);
    setCountsTruncated(body.truncated === true);
  }, []);

  useEffect(() => {
    void loadCounts().catch((error) => setCountsError((error as Error).message));
  }, [loadCounts]);

  const refreshAll = async () => {
    await Promise.all([
      data.refreshAll(),
      loadCounts().catch((error) => setCountsError((error as Error).message)),
    ]);
  };

  return (
    <div className="space-y-4">
      <DashboardContextBar
        title={`Shift ${me.csName || me.name}`}
        period="Periode kerja 16:00–16:00"
        updatedAt={formatDashboardUpdatedAt(data.lastUpdatedAt)}
        actions={(
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={data.loading}>
            <RefreshCw className={cn('size-4', data.loading && 'animate-spin')} />
            Refresh
          </Button>
        )}
      />

      <LedgerSection
        title="Pekerjaan berikutnya"
        action={<Link href="/panel/follow-up" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary">Buka Follow-up <ArrowRight className="size-4" /></Link>}
      >
        {countsError ? <p role="alert" className="border-b border-negative bg-negative-soft px-4 py-2 text-sm text-negative">{countsError}</p> : null}
        <LedgerMetricGrid>
          <LedgerMetric label="H+1" value={counts ? `${counts.h1}${countsTruncated ? '+' : ''}` : '—'} detail={countsTruncated ? 'Minimum · antrean besar' : 'Tindak lanjut pertama'} />
          <LedgerMetric label="H+2" value={counts ? `${counts.h2}${countsTruncated ? '+' : ''}` : '—'} detail={countsTruncated ? 'Minimum · antrean besar' : 'Pengingat'} />
          <LedgerMetric label="H+3" value={counts ? `${counts.h3}${countsTruncated ? '+' : ''}` : '—'} detail={countsTruncated ? 'Minimum · antrean besar' : 'Penawaran terakhir'} />
        </LedgerMetricGrid>
      </LedgerSection>

      <LedgerSection title="Progress saya" description="Hanya data CS Anda pada periode kerja">
        {data.ready.summary ? (
          <LedgerMetricGrid>
            <LedgerMetric label="Leads" value={data.stats.orders} detail="Periode kerja" />
            <LedgerMetric label="Closing" value={data.totalClosing} detail="Periode kerja" tone="positive" />
            <LedgerMetric label="Closing Rate" value={`${data.closingRate.toFixed(1)}%`} detail="Periode kerja" tone="positive" />
            <LedgerMetric label="Respon saya" value={data.responseLabel} detail="Median balasan pertama, 24 jam" />
          </LedgerMetricGrid>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-4" aria-label="Memuat progress saya">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="min-h-28 border-b border-r border-ledger-rule p-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-4 h-7 w-20" /><Skeleton className="mt-2 h-3 w-16" /></div>)}
          </div>
        )}
      </LedgerSection>

      <Link href="/panel/laporan" className="flex min-h-11 items-center justify-between border-y border-ledger-rule bg-card px-4 text-sm font-semibold text-ledger-ink">
        Lihat status Queen di Laporan
        <ArrowRight className="size-4 text-primary" />
      </Link>
    </div>
  );
}
