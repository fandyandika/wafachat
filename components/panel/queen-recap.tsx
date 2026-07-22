'use client';

import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Crown, RefreshCw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Standing = { csKey: string; csName: string; wins: number };
export type QueenRecapData = {
  awards: Array<{ windowKey: string; status: 'won' | 'no_winner'; winnerCsName?: string; score?: number; leads?: number; closings?: number; cr?: number }>;
  monthly: { winners: string[]; winCount: number; standings: Standing[] };
  weekly: Array<{ weekStart: string; winners: string[]; winCount: number; standings: Standing[] }>;
  setupNeeded: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function formatMonth(key: string) {
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function monthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')!.value}-${parts.find((part) => part.type === 'month')!.value}`;
}

function winnerLabel(winners: string[]) {
  if (!winners.length) return 'Belum ada Queen';
  return winners.length === 1 ? winners[0] : `Seri · ${winners.join(' & ')}`;
}

function weekStatus(month: string, currentMonth: string) {
  return month === currentMonth ? 'Berjalan' : 'Selesai';
}

export function QueenRecapView({ recap, month, currentMonth, onBackfill, busy }: { recap: QueenRecapData; month: string; currentMonth: string; onBackfill: () => void; busy: boolean }) {
  const status = weekStatus(month, currentMonth);
  const canBackfill = recap.setupNeeded && month === currentMonth;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Crown className="size-4 text-gold" /> Queen Recap</CardTitle>
            <CardDescription>Rekap pemenang harian untuk {formatMonth(month)}. Pekanan dan bulanan dihitung dari kemenangan harian.</CardDescription>
          </div>
          {canBackfill && (
            <Button size="sm" variant="outline" className="gap-2" onClick={onBackfill} disabled={busy}>
              <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Siapkan rekap
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gold/30 bg-gold-soft/50 p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                Queen Bulan Terpilih
                <span className="rounded-full border border-gold/30 bg-background/70 px-2 py-0.5 text-[11px] text-foreground">{status}</span>
              </div>
              <div className="mt-1 text-lg font-semibold text-foreground">{winnerLabel(recap.monthly.winners)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{recap.monthly.winCount ? `${recap.monthly.winCount} kemenangan harian` : 'Menunggu penobatan harian'}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="text-xs font-medium text-muted-foreground">Perolehan Queen</div>
              {recap.monthly.standings.length ? (
                <div className="mt-2 space-y-1.5 text-sm">
                  {recap.monthly.standings.slice(0, 3).map((row, index) => <div key={row.csKey} className="flex justify-between gap-3"><span>{index + 1}. {row.csName}</span><span className="font-medium">{row.wins}x</span></div>)}
                </div>
              ) : <p className="mt-2 text-sm text-muted-foreground">Belum ada pemenang harian.</p>}
            </div>
          </div>

          <section>
            <div className="mb-2 text-sm font-medium">Pemenang Pekanan</div>
            {recap.weekly.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {recap.weekly.map((week, index) => <div key={week.weekStart} className="rounded-lg border border-border px-3 py-2.5 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">Pekan {index + 1}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{status}</span></div><div className="mt-1 text-muted-foreground">Mulai {formatDate(week.weekStart)}</div><div className="mt-1 font-medium">{winnerLabel(week.winners)}</div></div>)}
              </div>
            ) : <p className="text-sm text-muted-foreground">Belum ada data pekanan.</p>}
          </section>

          <section>
            <div className="mb-2 text-sm font-medium">Perolehan Queen Harian</div>
            {recap.monthly.standings.length ? (
              <div className="space-y-2">{recap.monthly.standings.map((row, index) => <div key={row.csKey} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"><span className="w-5 text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 font-medium">{row.csName}</span><span>{row.wins}x Queen</span></div>)}</div>
            ) : <p className="text-sm text-muted-foreground">Belum ada Queen harian yang memenuhi syarat.</p>}
          </section>

          <section className="overflow-x-auto">
            <div className="mb-2 text-sm font-medium">Riwayat Harian</div>
            {recap.awards.length ? (
              <table className="w-full min-w-[480px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Tanggal</th><th className="pb-2 font-medium">Queen</th><th className="pb-2 text-right font-medium">Skor</th><th className="pb-2 text-right font-medium">CR</th><th className="pb-2 text-right font-medium">Closing</th></tr></thead><tbody>{recap.awards.map((award) => <tr key={award.windowKey} className="border-b last:border-0"><td className="py-2.5">{formatDate(award.windowKey)}</td><td className="py-2.5 font-medium">{award.status === 'won' ? award.winnerCsName : 'Tidak ada Queen'}</td><td className="py-2.5 text-right">{award.score?.toFixed(1) ?? '–'}</td><td className="py-2.5 text-right">{award.cr == null ? '–' : `${award.cr}%`}</td><td className="py-2.5 text-right">{award.closings ?? '–'}</td></tr>)}</tbody></table>
            ) : <p className="text-sm text-muted-foreground">Belum ada rekap harian untuk bulan ini.</p>}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

export function QueenRecap() {
  const currentMonth = monthKey();
  const [month, setMonth] = useState(currentMonth);
  const recap = useQuery(api.queens.getMonth, { month }) as QueenRecapData | undefined;
  const queueBackfill = useMutation(api.queens.queueCurrentMonthBackfill);
  const [busy, setBusy] = useState(false);
  const onBackfill = async () => { setBusy(true); try { await queueBackfill({}); } finally { setBusy(false); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div><div className="text-sm font-medium">Bulan rekap</div><div className="text-xs text-muted-foreground">Pilih bulan untuk melihat Queen harian, pekanan, dan bulanan.</div></div>
        <input aria-label="Bulan rekap" type="month" min="2026-07" max={currentMonth} value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
      </div>
      {recap ? <QueenRecapView recap={recap} month={month} currentMonth={currentMonth} onBackfill={onBackfill} busy={busy} /> : <Card><CardContent className="py-6 text-sm text-muted-foreground">Memuat Queen recap…</CardContent></Card>}
    </div>
  );
}
