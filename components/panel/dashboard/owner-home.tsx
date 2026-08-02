'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { CircleAlert, RefreshCw } from 'lucide-react';

import { api } from '@/convex/_generated/api';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WindowModeToggle, type WindowMode } from '@/components/panel/window-mode-toggle';
import { cn } from '@/lib/utils';
import { crBarClass } from '@/lib/cr';
import { csKey } from '@/lib/cs-key';
import { fmtTime, formatRupiah } from '@/lib/format';
import type { PerformanceData } from '@/components/panel/types';
import { DashboardContextBar, LedgerMetric, LedgerMetricGrid, LedgerSection, StatusStamp } from './ledger';
import { formatDashboardUpdatedAt, useDashboardData, type DuplicateOrder } from './use-dashboard-data';

export function OwnerHome() {
  const [mode, setMode] = useState<WindowMode>('live');
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const data = useDashboardData({ mode, includeDuplicates: true });
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((cs) => [cs.key, cs.avatarUrl])), [csList]);
  const errors = Object.entries(data.errors).filter(([, message]) => message);

  return (
    <div className="space-y-4">
      <DashboardContextBar
        title="Kendali operasional"
        period={data.periodLabel}
        updatedAt={formatDashboardUpdatedAt(data.lastUpdatedAt)}
        actions={(
          <>
            <WindowModeToggle mode={mode} onChange={setMode} />
            <Button variant="outline" size="sm" onClick={data.refreshAll} disabled={data.loading}>
              <RefreshCw className={cn('size-4', data.loading && 'animate-spin')} />
              Refresh
            </Button>
          </>
        )}
      />

      {errors.length ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-negative bg-negative-soft px-4 py-3 text-sm text-negative">
          <span>Sebagian data gagal dimuat: {errors.map(([source]) => source).join(', ')}.</span>
          <Button variant="outline" size="sm" onClick={data.refreshAll}>Coba lagi</Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <LedgerSection title="Kinerja bisnis" description="Snapshot periode aktif">
          <LedgerMetricGrid>
            <LedgerMetric label="Leads" value={<AnimatedNumber value={data.stats.orders} />} detail={data.periodLabel} />
            <LedgerMetric label="Closing" value={<AnimatedNumber value={data.totalClosing} />} detail={data.periodLabel} tone="positive" />
            <LedgerMetric label="Closing Rate" value={`${data.closingRate.toFixed(1)}%`} detail={data.periodLabel} tone="positive" />
            <LedgerMetric label="Omzet" value={<AnimatedNumber value={data.revenue} format={formatRupiah} />} detail={data.periodLabel} />
            <LedgerMetric label="Dibatalkan" value={<AnimatedNumber value={data.cancelled} />} detail={data.periodLabel} tone="negative" />
            <LedgerMetric label="Respon CS" value={data.responseLabel} detail="Median balasan pertama, 24 jam" />
          </LedgerMetricGrid>
        </LedgerSection>

        <LedgerSection title="Perlu perhatian">
          <div className="p-4">
            {data.duplicateOrders.length ? (
              <button type="button" onClick={() => setDuplicatesOpen(true)} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-ledger-rule py-2 text-left">
                <span>
                  <span className="block font-semibold text-ledger-ink">Order ganda</span>
                  <span className="text-sm text-muted-foreground">{data.duplicateOrders.length} customer perlu diperiksa</span>
                </span>
                <StatusStamp tone="warning">Perlu cek</StatusStamp>
              </button>
            ) : (
              <div className="space-y-2 py-2">
                <StatusStamp tone="positive">Operasional normal</StatusStamp>
                <p className="text-sm text-muted-foreground">Tidak ada perhatian mendesak.</p>
              </div>
            )}
          </div>
        </LedgerSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CsRanking rows={data.topCs} avatarByKey={avatarByKey} periodLabel={data.periodLabel} />
        <ProductRanking rows={data.topProducts} periodLabel={data.periodLabel} />
      </div>

      <DuplicateSheet open={duplicatesOpen} onOpenChange={setDuplicatesOpen} rows={data.duplicateOrders} />
    </div>
  );
}

function CsRanking({ rows, avatarByKey, periodLabel }: {
  rows: PerformanceData['cs'];
  avatarByKey: Map<string, string | null>;
  periodLabel: string;
}) {
  return (
    <LedgerSection title="Top CS" description={`Closing terbanyak · ${periodLabel}`}>
      <div className="divide-y divide-ledger-rule px-4">
        {rows.length ? rows.map((row, index) => (
          <div key={row.csName} className="flex min-h-14 items-center gap-3 py-2">
            <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <CsAvatar name={row.csName || '?'} size="sm" src={avatarByKey.get(csKey(row.csName)) ?? undefined} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.csName || '—'}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{row.closing} · {row.cr}%</span>
          </div>
        )) : <p className="py-5 text-sm text-muted-foreground">Belum ada data pada periode ini.</p>}
      </div>
    </LedgerSection>
  );
}

function ProductRanking({ rows, periodLabel }: { rows: PerformanceData['products']; periodLabel: string }) {
  return (
    <LedgerSection title="Top Produk" description={`Closing terbanyak · ${periodLabel}`}>
      <div className="divide-y divide-ledger-rule px-4">
        {rows.length ? rows.map((row) => (
          <div key={row.product} className="py-3">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate font-medium">{row.product}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.closing} · {row.cr}%</span>
            </div>
            <div className="mt-2 h-1 bg-muted"><div className={cn('h-full', crBarClass(row.cr))} style={{ width: `${Math.min(Math.max(row.cr, 0), 100)}%` }} /></div>
          </div>
        )) : <p className="py-5 text-sm text-muted-foreground">Belum ada data pada periode ini.</p>}
      </div>
    </LedgerSection>
  );
}

function DuplicateSheet({ open, onOpenChange, rows }: { open: boolean; onOpenChange: (open: boolean) => void; rows: DuplicateOrder[] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Order ganda</SheetTitle>
          <SheetDescription>Periksa di Berdu sebelum membatalkan order.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 divide-y divide-ledger-rule border-y border-ledger-rule">
          {rows.map((row) => (
            <div key={row.phone} className="py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.customerName || 'Tanpa nama'}</span>
                <span className="text-muted-foreground">{row.phone}</span>
                <Badge variant="warning"><CircleAlert className="size-3" /> {row.count} order</Badge>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {row.orders.map((order) => <li key={order.orderId}>{order.orderId} · {order.productName || '—'} · {fmtTime(order.createdAt)}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
