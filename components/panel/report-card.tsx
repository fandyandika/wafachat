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
      <CardContent className="space-y-3">
        <div className="space-y-1">
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
          <div className={cn('border-t pt-2', resp.firstReplyCount < 3 && 'opacity-50')}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Zap className="size-3.5 text-primary" /> Balas chat baru</span>
              <span className="font-medium tabular-nums text-foreground">{formatDuration(resp.firstReplyMedianMs)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">dari {resp.firstReplyCount} chat</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
          <Row label="Total Leads" value={card.leads} />
          <Row label="Total Closing" value={card.closings} />
          <Row label="CR" value={crLabel(card.cr, card.leads)} />
          <Row label="Diskon" value={formatRupiah(card.discount)} />
          <Row label="CP Diskon" value={formatRupiah(card.cpDiscount)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
