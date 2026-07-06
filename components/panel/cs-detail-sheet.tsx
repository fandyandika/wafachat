'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, ChevronDown, ClipboardList, Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { useConvexSnapshotQuery } from '@/components/panel/use-convex-snapshot-query';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';

// "Rincian" self-check bottom sheet: the exact rows behind a card's Total Closing /
// Total Leads, GROUPED per product (collapsed accordion) so a CS checking a single
// product's discrepancy doesn't scroll a wall of rows. Rows without a customer name
// fall back to the customer's phone number so every closing stays identifiable.
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
// A recap without a parsed customer name comes back as "-": show the phone instead
// so the CS can still tell whose closing it is.
function who(name: string, phone: string): string {
  return name && name !== '-' ? name : phone;
}
function realOrderId(id: string | null): string | null {
  return id && !id.startsWith('manual:') ? id : null;
}

type ClosingRow = { closedAt: number; customerName: string; customerPhone: string; orderIdBerdu: string | null; product: string; total: number; payment: string | null };
type LeadRow = { createdAt: number; customerName: string; customerPhone: string; orderId: string; product: string; orderCount: number };
type Detail = {
  closings: ClosingRow[];
  excludedCancelled: Array<{ closedAt: number; customerName: string; orderIdBerdu: string | null }>;
  boundary: Array<{ closedAt: number; customerName: string; orderIdBerdu: string | null; when: 'before' | 'after' }>;
  leads: LeadRow[];
  counts: { closings: number; leadsUnique: number; leadOrders: number };
};

function groupBy<T>(rows: T[], key: (r: T) => string): Array<{ group: string; rows: T[] }> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const g = key(r) || 'Lainnya';
    const arr = m.get(g);
    if (arr) arr.push(r);
    else m.set(g, [r]);
  }
  return Array.from(m.entries())
    .map(([group, rows]) => ({ group, rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.group.localeCompare(b.group));
}

function GroupHeader({ open, label, count, extra, onClick }: { open: boolean; label: string; count: number; extra?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-left transition-colors active:bg-muted"
    >
      <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</span>
      {extra && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{extra}</span>}
      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold tabular-nums text-primary">{count}</span>
    </button>
  );
}

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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { data, loading } = useConvexSnapshotQuery<Detail>(
    api.analytics.getCsDetail,
    open && csName ? { startAt, endAt, csName } : ('skip' as const),
  );

  const closingGroups = useMemo(() => groupBy(data?.closings ?? [], (r) => r.product), [data?.closings]);
  const leadGroups = useMemo(() => groupBy(data?.leads ?? [], (r) => r.product), [data?.leads]);

  const toggle = (k: string) => setOpenGroups((s) => ({ ...s, [k]: !s[k] }));
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
                <div className="space-y-2 py-1">
                  <p className="text-[11px] text-muted-foreground">Tap produk untuk lihat daftarnya — cocokkan dengan catatanmu per produk.</p>
                  {closingGroups.map(({ group, rows }) => {
                    const k = `c:${group}`;
                    const sub = rows.reduce((s, r) => s + r.total, 0);
                    return (
                      <div key={k}>
                        <GroupHeader open={!!openGroups[k]} label={group} count={rows.length} extra={formatRupiah(sub)} onClick={() => toggle(k)} />
                        {openGroups[k] && (
                          <ol className="divide-y divide-border px-1">
                            {rows.map((c, i) => {
                              const orderId = realOrderId(c.orderIdBerdu);
                              const primary = who(c.customerName, c.customerPhone);
                              const showPhoneSub = primary !== c.customerPhone;
                              return (
                                <li key={`${c.orderIdBerdu ?? c.customerPhone}-${i}`} className="flex items-center gap-3 py-2.5">
                                  <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                    <span className="mr-1 inline-block w-5 text-right font-semibold text-foreground/60">{i + 1}.</span>
                                    {hhmm(c.closedAt)}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-foreground">{primary}</span>
                                    <span className="block truncate text-[11px] text-muted-foreground">
                                      {orderId && <span className="font-mono">{orderId}</span>}
                                      {orderId && showPhoneSub && ' · '}
                                      {showPhoneSub && <span className="font-mono">{c.customerPhone}</span>}
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
                      </div>
                    );
                  })}
                </div>
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
                <div className="space-y-2 py-1">
                  <p className="text-[11px] text-muted-foreground">
                    {data.counts.leadOrders} order Berdu · {data.counts.leadsUnique} pelanggan unik — tap produk untuk lihat daftarnya.
                  </p>
                  {leadGroups.map(({ group, rows }) => {
                    const k = `l:${group}`;
                    return (
                      <div key={k}>
                        <GroupHeader open={!!openGroups[k]} label={group} count={rows.length} onClick={() => toggle(k)} />
                        {openGroups[k] && (
                          <ol className="divide-y divide-border px-1">
                            {rows.map((l, i) => {
                              const primary = who(l.customerName, l.customerPhone);
                              const showPhoneSub = primary !== l.customerPhone;
                              return (
                                <li key={`${l.orderId}-${i}`} className="flex items-center gap-3 py-2.5">
                                  <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                    <span className="mr-1 inline-block w-5 text-right font-semibold text-foreground/60">{i + 1}.</span>
                                    {hhmm(l.createdAt)}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-foreground">{primary}</span>
                                    <span className="block truncate text-[11px] text-muted-foreground">
                                      <span className="font-mono">{l.orderId}</span>
                                      {showPhoneSub && <> · <span className="font-mono">{l.customerPhone}</span></>}
                                    </span>
                                  </span>
                                  {l.orderCount > 1 && (
                                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Pelanggan ini order lebih dari 1x — dihitung 1 pelanggan">
                                      {l.orderCount}×
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
