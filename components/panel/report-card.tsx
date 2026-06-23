'use client';

import { useState } from 'react';
import { Copy, Check, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { formatRupiah, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { reportText, crLabel, type ReportCsCard } from '@/components/panel/report-text';

export type ReportCardData = ReportCsCard & { duplicates: number; revenue: number };

export type RespStat = { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number };

export function ReportCard({
  card, label, windowLabel, isCurrent, resp,
}: {
  card: ReportCardData;
  label: { y: number; m: number; d: number; dow: number };
  windowLabel: string;
  isCurrent: boolean;
  resp?: RespStat;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(card, label));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context) — ignore */
    }
  };

  return (
    <Card className="transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevate hover:border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <CsAvatar name={card.csName} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold tracking-tight">{card.csName}</span>
              {isCurrent && <Badge variant="secondary">berjalan</Badge>}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{windowLabel}</div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onCopy} className="shrink-0 gap-1.5">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Tersalin' : 'Copy teks WA'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Closing Rate — the satisfying headline, visualised */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Closing Rate</span>
            <span className={cn('text-xl font-semibold tabular-nums', crTone(card.cr))}>{crLabel(card.cr, card.leads)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', crBar(card.cr))}
              style={{ width: `${Math.min(Math.max(card.cr, 0), 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{card.closings} closing</span>
            <span>{card.leads} leads</span>
          </div>
        </div>

        {/* Per-product breakdown */}
        <div className="space-y-1 border-t pt-3">
          {card.products.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada produk.</div>
          ) : (
            card.products.map((p) => (
              <div key={p.product} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{p.product}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {crLabel(p.cr, p.leads)} ({p.closings}/{p.leads})
                </span>
              </div>
            ))
          )}
        </div>

        {resp && resp.firstReplyCount > 0 && (
          <div className={cn('flex items-center justify-between gap-2 border-t pt-3 text-sm', resp.firstReplyCount < 3 && 'opacity-50')}>
            <span className="flex items-center gap-1.5 text-muted-foreground"><Zap className="size-3.5 text-primary" /> Balas chat baru</span>
            <span className="font-medium tabular-nums text-foreground">
              {formatDuration(resp.firstReplyMedianMs)} <span className="font-normal text-muted-foreground">· {resp.firstReplyCount} chat</span>
            </span>
          </div>
        )}

        {/* Potensi mis-rep: double orders inflate the lead list */}
        {card.duplicates > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <Copy className="size-3.5 shrink-0" />
            <span>{card.duplicates} order double — CR sudah dihitung dari leads unik</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
          <Row label="Total Leads" value={card.leads} />
          <Row label="Total Closing" value={card.closings} />
          <Row label="Diskon" value={formatRupiah(card.discount)} />
          <Row label="CP Diskon" value={formatRupiah(card.cpDiscount)} />
        </div>
      </CardContent>
    </Card>
  );
}

function crTone(cr: number): string {
  if (cr >= 60) return 'text-positive';
  if (cr >= 35) return 'text-foreground';
  return 'text-negative';
}

function crBar(cr: number): string {
  if (cr >= 60) return 'bg-positive';
  if (cr >= 35) return 'bg-primary';
  return 'bg-negative';
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
