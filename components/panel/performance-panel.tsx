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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { PerformanceData } from '@/components/panel/types';
import { formatRupiah, formatDuration } from '@/lib/format';

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-8 items-end gap-0.5">
      {values.map((v, i) => (
        <div key={i} className={cn('w-1.5 rounded-sm', tone)} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={String(v)} />
      ))}
    </div>
  );
}

function PerformanceTable({ columns, rows, title }: { columns: string[]; rows: Array<Array<string | number>>; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Hari ini, dihitung dari unique leads dan final recap closing.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={columns.length}>
                    Belum ada data performance pada filter ini.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

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
  const deltaTag = (d: number, suffix = '') => {
    if (d > 0) return <span className="text-positive">▲{d}{suffix}</span>;
    if (d < 0) return <span className="text-destructive">▼{Math.abs(d)}{suffix}</span>;
    return <span className="text-muted-foreground">–</span>;
  };
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

  const sortedCS = [...(data?.cs ?? [])].sort((a, b) => b.closing - a.closing);
  const maxCSClosing = sortedCS[0]?.closing ?? 1;
  const sortedProducts = [...(data?.products ?? [])].sort((a, b) => b.closing - a.closing);
  const respByRaw = new Map((responseTimes ?? []).map((r) => [r.csNameRaw, r]));

  return (
    <div className="space-y-4">
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-8">
        {kpiCards.map((card) => (
          <Card key={card.label} size="sm">
            <CardHeader>
              <CardDescription className="text-[11px]">{card.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={cn('text-lg font-bold tabular-nums', card.tone)}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">🏆 Leaderboard CS</CardTitle>
          <CardDescription>Ranking juara→lesu periode terpilih, dengan perubahan ▲▼ vs periode sebelumnya yang sama panjang. Kolom “Balas chat” = median waktu balas chat pertama (sepanjang periode terpilih).</CardDescription>
        </CardHeader>
        <CardContent>
          {csLeaderboard === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : csLeaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada data di periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">CS</th>
                    <th className="py-1 pr-3">Leads (Δ)</th>
                    <th className="py-1 pr-3">Closing (Δ)</th>
                    <th className="py-1 pr-3">CR (Δ)</th>
                    <th className="py-1 pr-3">Balas chat</th>
                    <th className="py-1 pr-3">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {csLeaderboard.map((r, i) => (
                    <tr key={r.csName} className="border-t border-border transition-colors hover:bg-muted/50">
                      <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 pr-3 font-medium">{r.csName || '—'}</td>
                      <td className="py-1.5 pr-3">{r.leads} {deltaTag(r.deltaLeads)}</td>
                      <td className="py-1.5 pr-3">{r.closings} {deltaTag(r.deltaClosings)}</td>
                      <td className="py-1.5 pr-3">{r.cr}% {deltaTag(r.deltaCr, '%')}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{respByRaw.get(r.csName)?.firstReplyCount ? formatDuration(respByRaw.get(r.csName)!.firstReplyMedianMs) : '–'}</td>
                      <td className="py-1.5 pr-3">{formatRupiah(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📉 Produk Tersusah Closing</CardTitle>
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
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 pr-3">Produk</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR (Δ)</th></tr>
                </thead>
                <tbody>
                  {productDifficulty.map((p) => (
                    <tr key={p.productName} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-medium">{p.productName}</td>
                      <td className="py-1.5 pr-3">{p.leads}</td>
                      <td className="py-1.5 pr-3">{p.closings}</td>
                      <td className="py-1.5 pr-3">{p.cr}% {deltaTag(p.deltaCr, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📈 Trend Harian</CardTitle>
          <CardDescription>Leads & closing per hari di periode terpilih.</CardDescription>
        </CardHeader>
        <CardContent>
          {trendData === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : trendData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada data.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div><div className="text-xs text-muted-foreground">Leads</div><Sparkline values={trendData.map((b) => b.leads)} tone="bg-lead" /></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><Sparkline values={trendData.map((b) => b.closings)} tone="bg-positive" /></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-1 pr-3">Hari</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR</th></tr>
                  </thead>
                  <tbody>
                    {trendData.map((b) => (
                      <tr key={b.bucket} className="border-t border-border">
                        <td className="py-1.5 pr-3">{b.bucket}</td>
                        <td className="py-1.5 pr-3">{b.leads}</td>
                        <td className="py-1.5 pr-3">{b.closings}</td>
                        <td className="py-1.5 pr-3">{b.cr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">🧾 Laporan {reportPeriod === 'week' ? 'Mingguan' : 'Bulanan'}</CardTitle>
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div><div className="text-xs text-muted-foreground">Leads</div><div className="font-semibold">{report.leads} {deltaTag(report.leads - report.prevLeads)}</div></div>
                <div><div className="text-xs text-muted-foreground">Closing</div><div className="font-semibold">{report.closings} {deltaTag(report.closings - report.prevClosings)}</div></div>
                <div><div className="text-xs text-muted-foreground">CR</div><div className="font-semibold">{report.cr}% {deltaTag(Math.round((report.cr - report.prevCr) * 10) / 10, '%')}</div></div>
                <div><div className="text-xs text-muted-foreground">Omzet</div><div className="font-semibold">{formatRupiah(report.revenue)}</div></div>
                <div><div className="text-xs text-muted-foreground">Dibatalkan</div><div className="font-semibold text-destructive">{report.cancelled}</div></div>
              </div>
              {report.perCs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr><th className="py-1 pr-3">CS</th><th className="py-1 pr-3">Leads</th><th className="py-1 pr-3">Closing</th><th className="py-1 pr-3">CR</th><th className="py-1 pr-3">Omzet</th></tr>
                    </thead>
                    <tbody>
                      {report.perCs.map((c) => (
                        <tr key={c.csName} className="border-t border-border">
                          <td className="py-1.5 pr-3 font-medium">{c.csName || '—'}</td>
                          <td className="py-1.5 pr-3">{c.leads}</td>
                          <td className="py-1.5 pr-3">{c.closings}</td>
                          <td className="py-1.5 pr-3">{c.cr}%</td>
                          <td className="py-1.5 pr-3">{formatRupiah(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab content */}
      {perfTab === 'summary' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-1">
            <PerformanceTable
              columns={['Produk', 'Leads', 'Closing', 'CR', 'Omzet']}
              rows={sortedProducts.map((row) => [
                row.product,
                row.leads,
                row.closing,
                `${row.cr}%`,
                formatRupiah(row.revenue),
              ])}
              title="Produk Terlaris"
            />
          </div>
          <PerformanceTable
            columns={['CS', 'Leads', 'Closing', 'CR', 'Omzet']}
            rows={sortedCS.map((row) => [
              row.csName,
              row.leads,
              row.closing,
              `${row.cr}%`,
              formatRupiah(row.revenue),
            ])}
            title="Ranking CS"
          />
        </div>
      )}

      {perfTab === 'cs' && (
        <Card>
          <CardHeader>
            <CardTitle>Performa per CS</CardTitle>
            <CardDescription>Diurutkan berdasarkan closing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>CS</TableHead>
                    <TableHead>Percakapan</TableHead>
                    <TableHead>Closing</TableHead>
                    <TableHead>Conversion Rate</TableHead>
                    <TableHead>Omzet</TableHead>
                    <TableHead>Diskon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCS.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Belum ada data.</TableCell></TableRow>
                  ) : sortedCS.map((row, idx) => (
                    <TableRow key={row.csName}>
                      <TableCell className="text-sm font-bold text-muted-foreground">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </TableCell>
                      <TableCell className="font-medium">{row.csName}</TableCell>
                      <TableCell>{row.leads}</TableCell>
                      <TableCell className="font-bold text-positive">{row.closing}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-positive"
                              style={{ width: `${row.cr}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-positive">{row.cr}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatRupiah(row.revenue)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatRupiah(row.discount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {perfTab === 'product' && (
        <PerformanceTable
          columns={['Produk', 'Leads', 'Closing', 'CR', 'Omzet', 'Diskon']}
          rows={sortedProducts.map((row) => [
            row.product,
            row.leads,
            row.closing,
            `${row.cr}%`,
            formatRupiah(row.revenue),
            formatRupiah(row.discount),
          ])}
          title="Performance per Produk"
        />
      )}
    </div>
  );
}
