'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { PerformanceData } from '@/components/panel/types';
import { formatRupiah, formatDuration } from '@/lib/format';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { TrendChart } from '@/components/ui/trend-chart';
import { DeltaPill } from '@/components/ui/metric-card';

export function PerformancePanel({
  data,
  csLeaderboard,
  productDifficulty,
  trendData,
  responseTimes,
}: {
  data?: PerformanceData;
  csLeaderboard?: Array<{
    csName: string; leads: number; closings: number; cr: number; revenue: number;
    deltaLeads: number; deltaClosings: number; deltaCr: number;
  }>;
  productDifficulty?: Array<{ productName: string; leads: number; closings: number; cr: number; prevCr: number; deltaCr: number }>;
  trendData?: Array<{ bucket: string; leads: number; closings: number; cr: number }>;
  responseTimes?: Array<{ csNameRaw: string; firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number }>;
}) {
  const deltaTag = (d: number, suffix = '') => <DeltaPill value={d} suffix={suffix} />;
  const [perfTab, setPerfTab] = useState<'summary' | 'cs' | 'product'>('summary');
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('week');
  const report = useQuery(api.analytics.getPeriodReport, { period: reportPeriod });

  const tabs = [
    { key: 'summary' as const, label: 'Ringkasan' },
    { key: 'cs' as const, label: 'Per CS' },
    { key: 'product' as const, label: 'Per Produk' },
  ];

  const kpiCards = [
    { label: 'Total Percakapan', value: data?.totalLeads ?? 0, tone: 'text-lead' },
    { label: 'Total Closing', value: data?.totalClosing ?? 0, tone: 'text-positive' },
    { label: 'Conversion Rate', value: `${data?.overallCr ?? 0}%`, tone: 'text-primary' },
    { label: 'COD', value: data?.totalCod ?? 0, tone: 'text-amber-600' },
    { label: 'Transfer', value: data?.totalTransfer ?? 0, tone: 'text-lead' },
    { label: 'Omzet', value: formatRupiah(data?.totalRevenue), tone: 'text-positive' },
    { label: 'Terkirim', value: data?.delivered ?? 0, tone: 'text-positive' },
    { label: 'Dibatalkan', value: data?.cancelled ?? 0, tone: 'text-destructive' },
  ];

  const sortedProducts = [...(data?.products ?? [])].sort((a, b) => b.closing - a.closing);
  const respByRaw = new Map((responseTimes ?? []).map((r) => [r.csNameRaw, r]));

  return (
    <div className="max-w-5xl space-y-4">
      {/* Topbar: tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPerfTab(tab.key)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              perfTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevate"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.label}</div>
            <div className={cn('mt-1.5 truncate text-xl font-semibold tabular-nums sm:text-2xl', card.tone)}>{card.value}</div>
          </div>
        ))}
      </div>

      {perfTab === 'cs' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leaderboard CS</CardTitle>
          <CardDescription>Ranking juara→lesu periode terpilih. Pill ↑/↓ = perubahan vs periode sebelumnya yang sama panjang. “Balas chat” = median waktu balas chat pertama.</CardDescription>
        </CardHeader>
        <CardContent>
          {csLeaderboard === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : csLeaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada data di periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">CS</th>
                    <th className="py-2 pr-3 text-right font-medium">Leads (Δ)</th>
                    <th className="py-2 pr-3 text-right font-medium">Closing (Δ)</th>
                    <th className="py-2 pr-3 text-right font-medium">CR (Δ)</th>
                    <th className="py-2 pr-3 text-right font-medium">Balas chat</th>
                    <th className="py-2 pr-3 text-right font-medium">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {csLeaderboard.map((r, i) => (
                      <tr
                        key={r.csName}
                        className={cn(
                          'border-t border-border transition-colors hover:bg-accent',
                          i === 0 && 'bg-accent/40',
                        )}
                      >
                        <td className="py-2.5 pr-3">
                          <span
                            className={cn(
                              'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                              i === 0
                                ? 'bg-primary text-primary-foreground'
                                : i < 3
                                  ? 'bg-accent text-accent-foreground'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <CsAvatar name={r.csName || '?'} size="sm" />
                            <span className={cn('font-medium', i === 0 && 'font-semibold')}>{r.csName || '—'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.leads} {deltaTag(r.deltaLeads)}</td>
                        <td className={cn('py-2.5 pr-3 text-right tabular-nums', i === 0 && 'font-semibold')}>{r.closings} {deltaTag(r.deltaClosings)}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-col items-end gap-1">
                            <span className="tabular-nums">{r.cr}% {deltaTag(r.deltaCr, '%')}</span>
                            <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn('h-full rounded-full', r.cr >= 60 ? 'bg-positive' : r.cr >= 35 ? 'bg-primary' : 'bg-negative')}
                                style={{ width: `${Math.min(Math.max(r.cr, 0), 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{respByRaw.get(r.csName)?.firstReplyCount ? formatDuration(respByRaw.get(r.csName)!.firstReplyMedianMs) : '–'}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatRupiah(r.revenue)}</td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {perfTab === 'product' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produk Tersusah Closing</CardTitle>
          <CardDescription>CR terendah dulu (min 3 leads). ΔCR = perubahan vs periode sebelumnya.</CardDescription>
        </CardHeader>
        <CardContent>
          {productDifficulty === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : productDifficulty.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum cukup data produk di periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="py-2 pr-3 font-medium">Produk</th><th className="py-2 pr-3 text-right font-medium">Leads</th><th className="py-2 pr-3 text-right font-medium">Closing</th><th className="py-2 pr-3 text-right font-medium">CR (Δ)</th></tr>
                </thead>
                <tbody>
                  {productDifficulty.map((p) => (
                    <tr key={p.productName} className="border-t border-border transition-colors hover:bg-accent">
                      <td className="py-2.5 pr-3 font-medium">{p.productName}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{p.leads}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{p.closings}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{p.cr}% {deltaTag(p.deltaCr, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {perfTab === 'summary' && (
      <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trend Harian</CardTitle>
          <CardDescription>Leads & closing per hari di periode terpilih.</CardDescription>
        </CardHeader>
        <CardContent>
          {trendData === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : trendData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada data.</p>
          ) : (
            <TrendChart data={trendData.map((b) => ({ label: b.bucket, leads: b.leads, closings: b.closings }))} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Laporan {reportPeriod === 'week' ? 'Mingguan' : 'Bulanan'}</CardTitle>
              <CardDescription>{report ? report.label : '…'} — total + Δ vs periode sebelumnya.</CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
              {(['week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setReportPeriod(p)}
                  className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', reportPeriod === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  {p === 'week' ? 'Mingguan' : 'Bulanan'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {report === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div><div className="text-xs text-muted-foreground">Leads</div><div className="font-semibold">{report.leads} {deltaTag(report.leads - report.prevLeads)}</div></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><div className="font-semibold">{report.closings} {deltaTag(report.closings - report.prevClosings)}</div></div>
                <div><div className="text-xs text-muted-foreground">CR</div><div className="font-semibold">{report.cr}% {deltaTag(Math.round((report.cr - report.prevCr) * 10) / 10, '%')}</div></div>
                <div><div className="text-xs text-muted-foreground">Omzet</div><div className="font-semibold">{formatRupiah(report.revenue)}</div></div>
                <div><div className="text-xs text-muted-foreground">Dibatalkan</div><div className="font-semibold text-destructive">{report.cancelled}</div></div>
              </div>
              {report.perCs.length > 0 && (
                <div className="space-y-2.5 border-t pt-3">
                  {report.perCs.map((c) => (
                    <div key={c.csName} className="flex items-center gap-3">
                      <CsAvatar name={c.csName || '?'} size="sm" />
                      <span className="w-16 shrink-0 truncate text-sm font-medium">{c.csName || '—'}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', c.cr >= 60 ? 'bg-positive' : c.cr >= 35 ? 'bg-primary' : 'bg-negative')}
                          style={{ width: `${Math.min(Math.max(c.cr, 0), 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {c.closings}/{c.leads} · {c.cr}% · {formatRupiah(c.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
      )}

      {perfTab === 'product' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance per Produk</CardTitle>
            <CardDescription>Diurutkan dari closing terbanyak. Bar = closing rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {sortedProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada data produk.</p>
            ) : (
              sortedProducts.map((p) => (
                <div key={p.product} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.product}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {p.closing}/{p.leads} · {formatRupiah(p.revenue)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', p.cr >= 60 ? 'bg-positive' : p.cr >= 35 ? 'bg-primary' : 'bg-negative')}
                        style={{ width: `${Math.min(Math.max(p.cr, 0), 100)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">{p.cr}%</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
