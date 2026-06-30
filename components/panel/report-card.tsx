'use client';

import { useState, type ComponentType } from 'react';
import { Copy, Check, Zap, Trophy, Crown, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { DeltaPill } from '@/components/ui/metric-card';
import { formatRupiah, formatDuration } from '@/lib/format';
import { crBarClass, crTextClass } from '@/lib/cr';
import { cn } from '@/lib/utils';
import { reportText, crLabel, type ReportCsCard } from '@/components/panel/report-text';
import { csKey } from '@/lib/cs-key';

export type ReportCardData = ReportCsCard & { duplicates: number; revenue: number };

export type RespStat = { firstReplyMedianMs: number | null; firstReplyP90Ms: number | null; firstReplyCount: number; slaBreaches: number; lastReplyAt?: number | null };

// "Terakhir online" relative label — minute granularity so a fresh reply reads as live.
function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'barusan';
  if (mins < 60) return `${mins} mnt lalu`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export type ReportDelta = { leads: number; closings: number; cr: number };

const REWARD_ICON: Record<string, ComponentType<{ className?: string }>> = {
  'Closing Terbanyak': Trophy,
  'CR Tertinggi': Crown,
  'Respon Tercepat': Zap,
};

export function ReportCard({
  card, label, isCurrent, resp, rank, avgCr, delta, rewards, avatarByKey, isQueen,
}: {
  card: ReportCardData;
  label: { y: number; m: number; d: number; dow: number };
  isCurrent: boolean;
  resp?: RespStat;
  rank?: number;
  avgCr?: number;
  delta?: ReportDelta | null;
  rewards?: string[];
  avatarByKey?: Map<string, string | null>;
  isQueen?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [productsExpanded, setProductsExpanded] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(card, label));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context) — ignore */
    }
  };

  const lastReplyAt = resp?.lastReplyAt ?? null;
  const recentlyOnline = lastReplyAt != null && Date.now() - lastReplyAt < 30 * 60_000;

  return (
    <Card className={cn(
      'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevate hover:border-primary/30',
      rank === 1 && 'ring-1 ring-primary/20',
      isQueen && 'ring-2 ring-primary/50',
    )}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {rank != null && (
            <span className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
              rank === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}>
              {rank}
            </span>
          )}
          <CsAvatar name={card.csName} size="md" online={recentlyOnline} src={avatarByKey?.get(csKey(card.csName)) ?? undefined} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold leading-tight tracking-tight">{card.csName}</span>
            {/* WhatsApp-style presence line under the name */}
            {lastReplyAt != null && (
              <span className={cn('truncate text-[11px] leading-tight', recentlyOnline ? 'font-medium text-positive' : 'text-muted-foreground')}>
                {recentlyOnline ? 'online' : `terakhir online ${timeAgo(lastReplyAt)}`}
              </span>
            )}
          </div>
          {isCurrent ? (
            <Badge className="shrink-0 gap-1.5 bg-positive-soft text-positive">
              <span className="size-1.5 animate-pulse rounded-full bg-positive" /> Live
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">Selesai</Badge>
          )}
          {resp && resp.slaBreaches > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
              title={`${resp.slaBreaches} chat lewat SLA (>15m)`}
            >
              <Clock className="size-3.5" /> {resp.slaBreaches}
            </span>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onCopy} aria-label="Copy teks WA" className="shrink-0 text-muted-foreground hover:text-foreground">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isQueen && (
          <div className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground ring-1 ring-primary/30">
            <Crown className="size-4 text-gold" /> Queen CS · juara umum
          </div>
        )}
        {/* Gamification: badge penghargaan untuk juara hari itu */}
        {rewards && rewards.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rewards.map((r) => {
              const Icon = REWARD_ICON[r] ?? Trophy;
              return (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 rounded-full bg-gold-soft/60 px-2.5 py-1 text-[11px] font-semibold text-gold-foreground ring-1 ring-gold/20"
                >
                  <Icon className="size-3.5 text-gold" /> {r}
                </span>
              );
            })}
          </div>
        )}
        {/* Closing Rate — the satisfying headline, visualised */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Closing Rate</span>
            <span className={cn('flex items-baseline gap-1.5 text-xl font-semibold tabular-nums', crTextClass(card.cr))}>
              {card.leads > 0 ? <AnimatedNumber value={card.cr} format={(n) => `${Math.round(n * 10) / 10}%`} /> : '–'}
              {delta && delta.cr !== 0 && <DeltaPill value={delta.cr} suffix="%" />}
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', crBarClass(card.cr))}
              style={{ width: `${clampPct(card.cr)}%` }}
            />
            {avgCr != null && avgCr > 0 && (
              <div className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${clampPct(avgCr)}%` }} />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{card.closings} closing · {card.leads} leads</span>
            {avgCr != null && <span>rata-rata tim {Math.round(avgCr * 10) / 10}%</span>}
          </div>
        </div>

        {/* Per-product breakdown — bars + top 5, the rest collapsed (sinks the 0-lead SKU fragments) */}
        <div className="space-y-2 border-t pt-3">
          {card.products.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada produk.</div>
          ) : (
            <>
              {(productsExpanded ? card.products : card.products.slice(0, 5)).map((p) => (
                <div key={p.product} className="flex items-center gap-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{p.product}</span>
                  {p.leads > 0 && (
                    <div className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                      <div className={cn('h-full rounded-full', crBarClass(p.cr))} style={{ width: `${clampPct(p.cr)}%` }} />
                    </div>
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {crLabel(p.cr, p.leads)} <span className="text-xs">({p.closings}/{p.leads})</span>
                  </span>
                </div>
              ))}
              {card.products.length > 5 && (
                <button
                  type="button"
                  onClick={() => setProductsExpanded((v) => !v)}
                  className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {productsExpanded ? 'Sembunyikan' : `Lihat ${card.products.length - 5} produk lainnya`}
                </button>
              )}
            </>
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
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Copy className="size-3.5 shrink-0" />
            <span>{card.duplicates} order double — CR sudah dihitung dari leads unik</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
          <RowAnimated label="Total Leads" value={card.leads} delta={delta?.leads} />
          <RowAnimated label="Total Closing" value={card.closings} delta={delta?.closings} />
          <Row label="Diskon" value={formatRupiah(card.discount)} />
          <Row label="CP Diskon" value={formatRupiah(card.cpDiscount)} />
        </div>
      </CardContent>
    </Card>
  );
}

function clampPct(n: number): number {
  return Math.min(Math.max(n, 0), 100);
}

function RowAnimated({ label, value, delta }: { label: string; value: number; delta?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium tabular-nums text-foreground">
        <AnimatedNumber value={value} />
        {delta != null && delta !== 0 && <DeltaPill value={delta} />}
      </span>
    </div>
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
