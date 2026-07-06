'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, ClipboardList, Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';

// "Rincian" self-check bottom sheet: the exact rows behind a card's Total Closing /
// Total Leads, so a CS can reconcile their manual count on their own phone.
// Data is fetched ONLY while the sheet is open ('skip' otherwise) — zero standing cost.

const JAK_MS = 7 * 60 * 60 * 1000;
function hhmm(ms: number): string {
  const d = new Date(ms + JAK_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function dayTime(ms: number): string {
  const d = new Date(ms + JAK_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hhmm(ms)}`;
}

type Detail = {
  closings: Array<{ closedAt: number; customerName: string; customerPhone: string; orderIdBerdu: string | null; product: string; total: number; payment: string | null }>;
  excludedCancelled: Array<{ closedAt: number; customerName: string; orderIdBerdu: string | null }>;
  boundary: Array<{ closedAt: number; customerName: string; orderIdBerdu: string | null; when: 'before' | 'after' }>;
  leads: Array<{ createdAt: number; customerName: string; customerPhone: string; orderId: string; product: string; orderCount: number }>;
  counts: { closings: number; leadsUnique: number; leadOrders: number };
};

export function CsDetailSheet({
  open,
  onOpenChange,
  csName,
  startAt,
  endAt,
  titleDate,
  avatarUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csName: string;
  startAt: number;
  endAt: number;
  titleDate: string;
  avatarUrl?: string;
}) {
  const [tab, setTab] = useState<'closing' | 'leads'>('closing');
  const { data, loading } = useConvexSnapshotQuery<Detail>(
    api.analytics.getCsDetail,
    open && csName ? { startAt, endAt, csName } : ('skip' as const),
  );

  const displayName = csName.replace(/^CS\s+/i, '');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[88dvh] w-full flex-col gap-0 rounded-t-2xl p-0 sm:max-w-lg"
      >
        {/* drag handle */}
        <div className="flex justify-center pt-2.5" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
        </div>

        <SheetHeader className="gap-2 px-4 pb-3 pt-2">
          <div className="flex items-center gap-3">
            <CsAvatar name={csName} size="md" src={avatarUrl} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base font-bold tracking-tight">Rincian — {displayName}</SheetTitle>
              <SheetDescription className="text-xs">
                {titleDate} · periode 16:00 → 16:00 WIB
              </SheetDescription>
            </div>
          </div>
          {/* segmented tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(
              [
                { key: 'closing', label: 'Closing', icon: ClipboardList, n: data?.counts.closings },
                { key: 'leads', label: 'Leads', icon: Users, n: data?.counts.leadsUnique },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold transition-colors',
                  tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <t.icon className="size-4" />
                {t.label}
                {t.n != null && <span className="tabular-nums text-muted-foreground">· {t.n}</span>}
              </button>
            ))}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading || data === undefined ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-10" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : tab === 'closing' ? (
            <>
              {data.closings.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Belum ada closing di periode ini.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {data.closings.map((c, i) => {
                    // "manual:<phone>" is an internal dedup key for recaps without a Berdu
                    // order id — noise for the CS, so only real order ids are shown.
                    const orderId = c.orderIdBerdu && !c.orderIdBerdu.startsWith('manual:') ? c.orderIdBerdu : null;
                    return (
                    <li key={`${c.orderIdBerdu ?? c.customerPhone}-${i}`} className="flex items-center gap-3 py-2.5">
                      <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        <span className="mr-1 inline-block w-5 text-right font-semibold text-foreground/60">{i + 1}.</span>
                        {hhmm(c.closedAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{c.customerName}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {orderId && <span className="font-mono">{orderId}</span>}
                          {orderId && c.product && ' · '}
                          {c.product}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-foreground">{formatRupiah(c.total)}</span>
                        {c.payment && <span className="block text-[10px] uppercase text-muted-foreground">{c.payment}</span>}
                      </span>
                    </li>
                    );
                  })}
                </ol>
              )}

              {(data.excludedCancelled.length > 0 || data.boundary.length > 0) && (
                <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                    <AlertTriangle className="size-3.5" /> Tidak dihitung di periode ini
                  </div>
                  {data.excludedCancelled.map((r, i) => (
                    <div key={`x-${i}`} className="flex items-center gap-2 text-xs text-foreground">
                      <Ban className="size-3.5 shrink-0 text-destructive" />
                      <span className="tabular-nums text-muted-foreground">{hhmm(r.closedAt)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{r.customerName}</span>
                      <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">dibatalkan</span>
                    </div>
                  ))}
                  {data.boundary.map((r, i) => (
                    <div key={`b-${i}`} className="flex items-center gap-2 text-xs text-foreground">
                      <ArrowRight className="size-3.5 shrink-0 text-amber-600" />
                      <span className="tabular-nums text-muted-foreground">{dayTime(r.closedAt)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{r.customerName}</span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        periode {r.when === 'before' ? 'sebelumnya' : 'berikutnya'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="py-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                Cocokkan dengan catatanmu. Closing yang tidak muncul di daftar manapun berarti belum
                terekam — pastikan pesannya memuat “PEMESANAN BERHASIL”, lalu laporkan ke admin.
              </p>
            </>
          ) : (
            <>
              {data.leads.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Belum ada leads di periode ini.</p>
              ) : (
                <>
                  <p className="py-2 text-[11px] text-muted-foreground">
                    {data.counts.leadOrders} order Berdu · {data.counts.leadsUnique} pelanggan unik
                  </p>
                  <ol className="divide-y divide-border">
                    {data.leads.map((l, i) => (
                      <li key={`${l.orderId}-${i}`} className="flex items-center gap-3 py-2.5">
                        <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          <span className="mr-1 inline-block w-5 text-right font-semibold text-foreground/60">{i + 1}.</span>
                          {hhmm(l.createdAt)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{l.customerName}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            <span className="font-mono">{l.orderId}</span>
                            {l.product && ` · ${l.product}`}
                          </span>
                        </span>
                        {l.orderCount > 1 && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Pelanggan ini order lebih dari 1x — dihitung 1 pelanggan">
                            {l.orderCount}×
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
