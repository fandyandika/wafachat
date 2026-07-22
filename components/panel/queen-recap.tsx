'use client';

import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Crown, RefreshCw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Standing = { csKey: string; csName: string; wins: number };
export type QueenRecapData = {
  awards: Array<{ windowKey: string; status: 'won' | 'no_winner'; winnerCsName?: string; score?: number; leads?: number; closings?: number; cr?: number; respMedianMs?: number }>;
  monthly: { winners: string[]; winCount: number; standings: Standing[] };
  weekly: Array<{ weekStart: string; winners: string[]; winCount: number; standings: Standing[] }>;
  setupNeeded: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function monthKey(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${p.find((part) => part.type === 'year')!.value}-${p.find((part) => part.type === 'month')!.value}`;
}

function winnerLabel(winners: string[]) {
  if (!winners.length) return 'Belum ada Queen';
  return winners.length === 1 ? winners[0] : `Seri · ${winners.join(' & ')}`;
}

function minutes(ms?: number) {
  return ms == null ? '–' : `${Math.round(ms / 60_000)} mnt`;
}

export function QueenRecapView({ recap, onBackfill, busy }: { recap: QueenRecapData; onBackfill: () => void; busy: boolean }) {
  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Crown className="size-4 text-gold" /> Queen Recap</CardTitle>
          <CardDescription>Queen pekanan dan bulanan dihitung hanya dari jumlah kemenangan Queen harian.</CardDescription>
        </div>
        {recap.setupNeeded && (
          <Button size="sm" variant="outline" className="gap-2" onClick={onBackfill} disabled={busy}>
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Siapkan rekap bulan ini
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gold/30 bg-gold-soft/50 p-4">
            <div className="text-xs font-medium text-muted-foreground">Queen Bulan Ini</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{winnerLabel(recap.monthly.winners)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{recap.monthly.winCount ? `${recap.monthly.winCount} kemenangan harian` : 'Menunggu penobatan harian'}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="text-xs font-medium text-muted-foreground">Queen Pekanan</div>
            <div className="mt-2 space-y-1.5 text-sm">
              {recap.weekly.length ? recap.weekly.map((week) => (
                <div key={week.weekStart} className="flex justify-between gap-3"><span>{formatDate(week.weekStart)}</span><span className="text-right font-medium">{winnerLabel(week.winners)}</span></div>
              )) : <span className="text-muted-foreground">Belum ada pekan lengkap.</span>}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Perolehan Queen Harian</div>
          {recap.monthly.standings.length ? (
            <div className="space-y-2">{recap.monthly.standings.map((row, index) => (
              <div key={row.csKey} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"><span className="w-5 text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 font-medium">{row.csName}</span><span>{row.wins}x Queen</span></div>
            ))}</div>
          ) : <p className="text-sm text-muted-foreground">Belum ada Queen harian yang memenuhi syarat pada bulan ini.</p>}
        </div>

        <div className="overflow-x-auto">
          <div className="mb-2 text-sm font-medium">Riwayat Harian</div>
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Tanggal</th><th className="pb-2 font-medium">Queen</th><th className="pb-2 text-right font-medium">Skor</th><th className="pb-2 text-right font-medium">CR</th><th className="pb-2 text-right font-medium">Closing</th><th className="pb-2 text-right font-medium">Respon</th></tr></thead>
            <tbody>{recap.awards.map((award) => <tr key={award.windowKey} className="border-b last:border-0"><td className="py-2.5">{formatDate(award.windowKey)}</td><td className="py-2.5 font-medium">{award.status === 'won' ? award.winnerCsName : 'Tidak ada Queen'}</td><td className="py-2.5 text-right">{award.score?.toFixed(1) ?? '–'}</td><td className="py-2.5 text-right">{award.cr == null ? '–' : `${award.cr}%`}</td><td className="py-2.5 text-right">{award.closings ?? '–'}</td><td className="py-2.5 text-right">{minutes(award.respMedianMs)}</td></tr>)}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function QueenRecap() {
  const recap = useQuery(api.queens.getMonth, { month: monthKey() }) as QueenRecapData | undefined;
  const queueBackfill = useMutation(api.queens.queueCurrentMonthBackfill);
  const [busy, setBusy] = useState(false);
  const onBackfill = async () => {
    setBusy(true);
    try { await queueBackfill({}); } finally { setBusy(false); }
  };
  if (!recap) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Memuat Queen recap…</CardContent></Card>;
  return <QueenRecapView recap={recap} onBackfill={onBackfill} busy={busy} />;
}
