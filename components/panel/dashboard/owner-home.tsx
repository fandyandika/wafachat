'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { ArrowRight, CircleAlert, RefreshCw } from 'lucide-react';

import { api } from '@/convex/_generated/api';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { crBarClass } from '@/lib/cr';
import { csKey } from '@/lib/cs-key';
import { fmtTime, formatRupiah } from '@/lib/format';
import type { PerformanceData } from '@/components/panel/types';
import { DashboardContextBar, LedgerMetric, LedgerMetricGrid, LedgerSection, StatusStamp } from './ledger';
import { formatDashboardUpdatedAt, useDashboardData, type DuplicateOrder } from './use-dashboard-data';
import {
  dashboardPerformanceHref,
  DashboardHistoryFilter,
  formatDashboardBoundary,
  isHistoricalDashboardRange,
  type DashboardDayDraft,
} from './dashboard-history-filter';
import { DashboardMobileCommandBar } from './dashboard-mobile-command-bar';
import { resolveDashboardDay } from '@/lib/history-period';
import { windowKeyToday } from '@/lib/report-window-core';
import { visibleProductRows, type ProductSourceFilter } from './product-ranking-model';

function jakartaDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
}

export function OwnerHome({
  now,
  initialSelection,
}: {
  now?: number;
  initialSelection?: DashboardDayDraft;
} = {}) {
  const [openedAt] = useState(() => now ?? Date.now());
  const today = useMemo(() => jakartaDate(openedAt), [openedAt]);
  const currentWorkDate = useMemo(() => windowKeyToday(openedAt), [openedAt]);
  const [selection, setSelection] = useState<DashboardDayDraft>(
    initialSelection ?? { date: today, basis: 'calendar' },
  );
  const range = useMemo(
    () => resolveDashboardDay(selection.date, selection.basis, openedAt),
    [openedAt, selection],
  );
  const historical = isHistoricalDashboardRange(range);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const data = useDashboardData({ range, includeDuplicates: !historical });
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const avatarByKey = useMemo(() => new Map(csList.map((cs) => [cs.key, cs.avatarUrl])), [csList]);
  const errors = Object.entries(data.errors).filter(([, message]) => message);

  return (
    <div className="space-y-4">
      <div data-dashboard-mobile-controls="true" className="md:hidden">
        <DashboardMobileCommandBar
          today={today}
          currentWorkDate={currentWorkDate}
          applied={selection}
          range={range}
          periodLabel={data.periodLabel}
          updatedAt={formatDashboardUpdatedAt(data.lastUpdatedAt)}
          loading={data.loading}
          onApply={setSelection}
          onRefresh={data.refreshAll}
        />
      </div>

      <div data-dashboard-desktop-controls="true" className="hidden space-y-4 md:block">
        <DashboardContextBar
          title="Kendali operasional"
          period={historical ? `Mode histori · ${formatDashboardBoundary(range)}` : `${data.periodLabel} · ${formatDashboardBoundary(range)}`}
          updatedAt={formatDashboardUpdatedAt(data.lastUpdatedAt)}
          actions={(
            <Button variant="outline" size="sm" onClick={data.refreshAll} disabled={data.loading}>
              <RefreshCw className={cn('size-4', data.loading && 'animate-spin')} />
              Refresh
            </Button>
          )}
        />

        <div className="flex flex-col gap-3 border-b border-ledger-rule bg-card px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <DashboardHistoryFilter
            today={today}
            currentWorkDate={currentWorkDate}
            applied={selection}
            onApply={setSelection}
          />
          <Link
            href={dashboardPerformanceHref(selection)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-ledger-ink transition-colors hover:bg-muted"
          >
            Lihat analisis lengkap <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      {errors.length ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-negative bg-negative-soft px-4 py-3 text-sm text-negative">
          <span>Sebagian data gagal dimuat: {errors.map(([source]) => source).join(', ')}.</span>
          <Button variant="outline" size="sm" onClick={data.refreshAll}>Coba lagi</Button>
        </div>
      ) : null}

      <div className={cn('grid gap-4', !historical && 'xl:grid-cols-[minmax(0,1fr)_20rem]')}>
        <div data-dashboard-section="metrics" className={cn(!historical && 'xl:col-start-1 xl:row-start-1')}>
          <LedgerSection title="Kinerja bisnis" description="Snapshot periode aktif">
          {data.ready.summary && data.ready.performance ? (
            <LedgerMetricGrid className="grid-cols-2">
              <LedgerMetric label="Leads" value={<AnimatedNumber value={data.stats.orders} />} detail={data.periodLabel} />
              <LedgerMetric label="Closing" value={<AnimatedNumber value={data.totalClosing} />} detail={data.periodLabel} tone="positive" />
              <LedgerMetric label="Closing Rate" value={`${data.closingRate.toFixed(1)}%`} detail={data.periodLabel} tone="positive" />
              <LedgerMetric label="Omzet" value={<AnimatedNumber value={data.revenue} format={formatRupiah} />} detail={data.periodLabel} />
              <LedgerMetric label="Dibatalkan" value={<AnimatedNumber value={data.cancelled} />} detail={data.periodLabel} tone="negative" />
              <LedgerMetric label="Respon CS" value={data.responseLabel} detail="Median balasan pertama, 24 jam" />
            </LedgerMetricGrid>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3" aria-label="Memuat kinerja bisnis">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="min-h-28 border-b border-r border-ledger-rule p-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-4 h-7 w-24" /><Skeleton className="mt-2 h-3 w-16" /></div>)}
            </div>
          )}
          </LedgerSection>
        </div>

        {!historical ? (
          <div data-dashboard-section="attention" className="xl:col-start-2 xl:row-start-1">
            <div className="rounded-xl border border-ledger-rule bg-card p-4 xl:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Perlu perhatian</p>
              <AttentionContent
                ready={data.ready.duplicates}
                count={data.duplicateOrders.length}
                onOpen={() => setDuplicatesOpen(true)}
                compact
              />
            </div>
            <LedgerSection title="Perlu perhatian" className="hidden xl:block">
              <div className="p-4">
                <AttentionContent
                  ready={data.ready.duplicates}
                  count={data.duplicateOrders.length}
                  onOpen={() => setDuplicatesOpen(true)}
                />
              </div>
            </LedgerSection>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CsRanking rows={data.topCs} avatarByKey={avatarByKey} periodLabel={data.periodLabel} />
        <ProductRanking
          rows={data.topProducts}
          productSources={data.productSources}
          sources={data.sourceBreakdown}
          overall={{ leads: data.stats.orders, closings: data.totalClosing }}
          periodLabel={data.periodLabel}
        />
      </div>

      {!historical ? <DuplicateSheet open={duplicatesOpen} onOpenChange={setDuplicatesOpen} rows={data.duplicateOrders} /> : null}
    </div>
  );
}

function AttentionContent({
  ready,
  count,
  onOpen,
  compact = false,
}: {
  ready: boolean;
  count: number;
  onOpen: () => void;
  compact?: boolean;
}) {
  if (!ready) {
    return (
      <div className={cn('flex items-center justify-between gap-3', compact ? 'mt-2' : 'py-2')}>
        <p className="text-sm text-muted-foreground">Memeriksa data operasional…</p>
        <StatusStamp>Memeriksa</StatusStamp>
      </div>
    );
  }

  if (count) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-3 text-left',
          compact ? 'mt-1' : 'border-b border-ledger-rule py-2',
        )}
      >
        <span>
          <span className="block font-semibold text-ledger-ink">Order ganda</span>
          <span className="text-sm text-muted-foreground">{count} customer perlu diperiksa</span>
        </span>
        <StatusStamp tone="warning">Perlu cek</StatusStamp>
      </button>
    );
  }

  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? 'mt-2' : 'py-2')}>
      <p className="text-sm text-muted-foreground">Tidak ada perhatian mendesak.</p>
      <StatusStamp tone="positive">Normal</StatusStamp>
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

function ProductRanking({ rows, productSources, sources, overall, periodLabel }: {
  rows: PerformanceData['products'];
  productSources: NonNullable<PerformanceData['productSources']>;
  sources: NonNullable<PerformanceData['sources']>;
  overall: { leads: number; closings: number };
  periodLabel: string;
}) {
  const [source, setSource] = useState<ProductSourceFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const rowsForSource = source === 'all' ? rows : productSources;
  const filteredCount = source === 'all'
    ? rows.length
    : productSources.filter((row) => row.source === source).length;
  const visibleRows = visibleProductRows(rowsForSource, expanded, source);
  const sourceMetrics = new Map(sources.map((row) => [row.source, row]));
  const filters: Array<{ value: ProductSourceFilter; label: string; leads: number; closings: number }> = [
    { value: 'all', label: 'Semua sumber', ...overall },
    { value: 'berdu', label: 'Berdu', leads: sourceMetrics.get('berdu')?.leads ?? 0, closings: sourceMetrics.get('berdu')?.closings ?? 0 },
    { value: 'scalev', label: 'Scalev', leads: sourceMetrics.get('scalev')?.leads ?? 0, closings: sourceMetrics.get('scalev')?.closings ?? 0 },
  ];

  return (
    <LedgerSection title="Top Produk" description={`Leads, closing, dan CR · ${periodLabel}`}>
      <div className="grid grid-cols-1 border-b border-ledger-rule sm:grid-cols-3" aria-label="Filter sumber produk">
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={source === filter.value}
            onClick={() => { setSource(filter.value); setExpanded(false); }}
            className={cn(
              'min-h-14 border-b border-ledger-rule px-4 py-2 text-left transition-colors last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0',
              source === filter.value ? 'bg-secondary text-ledger-ink' : 'bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            <span className="block text-sm font-semibold">{filter.label}</span>
            <span className="block text-xs tabular-nums">{filter.leads} leads · {filter.closings} closing</span>
          </button>
        ))}
      </div>
      <div className="divide-y divide-ledger-rule px-4">
        {visibleRows.length ? visibleRows.map((row) => (
          <div key={row.product} className="py-3">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate font-medium">{row.product}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.leads} leads · {row.closing} closing · {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.cr)}% CR
              </span>
            </div>
            <div className="mt-2 h-1 bg-muted"><div className={cn('h-full', crBarClass(row.cr))} style={{ width: `${Math.min(Math.max(row.cr, 0), 100)}%` }} /></div>
          </div>
        )) : <p className="py-5 text-sm text-muted-foreground">Belum ada produk dari sumber ini pada periode terpilih.</p>}
      </div>
      {filteredCount > 5 ? (
        <div className="border-t border-ledger-rule px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="min-h-11 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {expanded ? 'Tampilkan 5 produk teratas' : `Lihat semua ${filteredCount} produk`}
          </button>
        </div>
      ) : null}
    </LedgerSection>
  );
}

export function DuplicateSheet({ open, onOpenChange, rows }: { open: boolean; onOpenChange: (open: boolean) => void; rows: DuplicateOrder[] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-hidden sm:max-w-xl">
        <SheetHeader className="border-b border-ledger-rule pr-14">
          <SheetTitle>Order ganda</SheetTitle>
          <SheetDescription>Periksa di Berdu sebelum membatalkan order.</SheetDescription>
        </SheetHeader>
        <ul aria-label="Daftar order ganda" className="flex-1 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.phone} className="border-b border-ledger-rule px-5 py-5 text-sm last:border-b-0">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ledger-ink">{row.customerName || 'Tanpa nama'}</p>
                  <p className="mt-0.5 tabular-nums text-muted-foreground">{row.phone}</p>
                </div>
                <Badge variant="warning"><CircleAlert className="size-3" /> {row.count} order</Badge>
              </header>
              <ul className="mt-4 divide-y divide-ledger-rule border-y border-ledger-rule">
                {row.orders.map((order) => (
                  <li key={order.orderId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="font-medium tabular-nums text-ledger-ink">#{order.orderId}</p>
                      <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{order.productName || '—'}</p>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-xs tabular-nums text-muted-foreground sm:block sm:text-right">
                      <span>{fmtTime(order.createdAt)}</span>
                      <span className="font-medium text-ledger-ink sm:mt-1 sm:block">{formatRupiah(Number(order.total))}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
