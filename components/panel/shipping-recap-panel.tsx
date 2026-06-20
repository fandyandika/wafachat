'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Search,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ShippingRecap, PaymentFilter, RecapSort, RecapStatus } from '@/components/panel/types';
import { formatRupiah, formatDateTime } from '@/lib/format';

export function ShippingRecapPanel({
  actionLoading,
  csName,
  totalCounts,
  paymentFilter,
  readyCount,
  recapSearch,
  recapSort,
  recapStatus,
  rows,
  selectedIds,
  onBulkCancel,
  onBulkDelivered,
  onBulkExport,
  onBulkReady,
  onCancel,
  onDelivered,
  onDownload,
  onOpenDetail,
  onPaymentFilterChange,
  onReady,
  onSearchChange,
  onSelectAll,
  onSelectRow,
  onSortChange,
  onStatusChange,
  onUndoCancel,
  onUndoDelivered,
}: {
  actionLoading: string | null;
  csName: string | undefined;
  totalCounts: {
    all: number;
    needs_review: number;
    ready: number;
    exported: number;
    delivered: number;
    cancelled: number;
    totalCodValue: number;
  } | undefined;
  paymentFilter: PaymentFilter;
  readyCount: number;
  recapSearch: string;
  recapSort: RecapSort;
  recapStatus: RecapStatus | 'all';
  rows: ShippingRecap[];
  selectedIds: Set<string>;
  onBulkCancel: () => void;
  onBulkDelivered: () => void;
  onBulkExport: () => void;
  onBulkReady: () => void;
  onCancel: (recap: ShippingRecap) => void;
  onDelivered: (recap: ShippingRecap) => void;
  onDownload: () => void;
  onOpenDetail: (recap: ShippingRecap) => void;
  onPaymentFilterChange: (filter: PaymentFilter) => void;
  onReady: (recap: ShippingRecap) => void;
  onSearchChange: (value: string) => void;
  onSelectAll: (ids: string[]) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  onSortChange: (sort: RecapSort) => void;
  onStatusChange: (status: RecapStatus | 'all') => void;
  onUndoCancel: (recap: ShippingRecap) => void;
  onUndoDelivered: (recap: ShippingRecap) => void;
}) {
  const rowCounts = {
    all: rows.length,
    needs_review: rows.filter((r) => r.status === 'needs_review').length,
    ready: rows.filter((r) => r.status === 'ready').length,
    exported: rows.filter((r) => r.status === 'exported').length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    cancelled: rows.filter((r) => r.status === 'cancelled' || r.status === 'cancelled_after_export').length,
  };
  const counts = totalCounts ?? rowCounts;

  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [recapStatus, paymentFilter, recapSearch, csName]);

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    if (recapSort === 'oldest') return sorted.sort((a, b) => a.closedAt - b.closedAt);
    if (recapSort === 'value_asc') return sorted.sort((a, b) => (a.codValue ?? a.total ?? 0) - (b.codValue ?? b.total ?? 0));
    if (recapSort === 'value_desc') return sorted.sort((a, b) => (b.codValue ?? b.total ?? 0) - (a.codValue ?? a.total ?? 0));
    if (recapSort === 'status') return sorted.sort((a, b) => a.status.localeCompare(b.status));
    return sorted.sort((a, b) => b.closedAt - a.closedAt);
  }, [rows, recapSort]);

  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const pagedRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectableIds = sortedRows
    .filter((r) => r.status !== 'cancelled' && r.status !== 'cancelled_after_export')
    .map((r) => r._id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const statusItems: Array<{ label: string; value: RecapStatus | 'all'; count: number }> = [
    { label: 'Semua', value: 'all', count: counts.all },
    { label: '⚠ Perlu Review', value: 'needs_review', count: counts.needs_review },
    { label: '✓ Siap Export', value: 'ready', count: counts.ready },
    { label: '📤 Diekspor', value: 'exported', count: counts.exported },
    { label: '✅ Terkirim', value: 'delivered', count: counts.delivered },
    { label: '✕ Dibatalkan', value: 'cancelled', count: counts.cancelled },
  ];

  // Stats for summary cards
  const totalCodValue = totalCounts?.totalCodValue ??
    rows
      .filter((r) => r.status !== 'cancelled' && r.status !== 'cancelled_after_export')
      .reduce((sum, r) => sum + (r.codValue ?? r.total ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total Periode', value: counts.all, tone: 'text-lead' },
          { label: 'Perlu Review', value: counts.needs_review, tone: 'text-amber-600' },
          { label: 'Siap Export', value: counts.ready, tone: 'text-lead' },
          { label: 'Sudah Terkirim', value: counts.delivered, tone: 'text-positive' },
          { label: 'Nilai COD', value: formatRupiah(totalCodValue), tone: 'text-primary' },
        ].map((c) => (
          <Card key={c.label} size="sm">
            <CardHeader>
              <CardDescription className="text-xs">{c.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={cn('text-xl font-bold tabular-nums', c.tone)}>{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[52px] text-xs font-medium text-muted-foreground">Status:</span>
            {statusItems.map((item) => (
              <button
                key={item.value}
                onClick={() => onStatusChange(item.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  recapStatus === item.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                )}
                type="button"
              >
                {item.label}
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  recapStatus === item.value ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted',
                )}>
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          {/* Row 3: Search + payment + sort */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[52px] text-xs font-medium text-muted-foreground">Cari:</span>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                aria-label="Cari rekap pengiriman"
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Nama, kota, produk, Order ID…"
                value={recapSearch}
              />
            </div>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
              {(['all', 'cod', 'transfer'] as PaymentFilter[]).map((p) => (
                <button
                  key={p}
                  onClick={() => onPaymentFilterChange(p)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors',
                    paymentFilter === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                  type="button"
                >
                  {p === 'all' ? 'Semua' : p.toUpperCase()}
                </button>
              ))}
            </div>
            <Select value={recapSort} onValueChange={(v) => onSortChange(v as RecapSort)}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Urutkan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Terbaru dulu</SelectItem>
                <SelectItem value="oldest">Terlama dulu</SelectItem>
                <SelectItem value="value_desc">Nilai ↓</SelectItem>
                <SelectItem value="value_asc">Nilai ↑</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            <Button
              disabled={readyCount === 0 || actionLoading === 'shipping-export'}
              onClick={onDownload}
              size="sm"
            >
              <CheckCircle2 className="size-4" />
              Export Semua ({readyCount})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => {
              if (checked) onSelectAll(selectableIds);
              else onSelectAll([]);
            }}
            className="border-primary-foreground/50 data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
          />
          <span className="text-sm font-medium">{selectedIds.size} pesanan dipilih</span>
          <div className="flex-1" />
          <Button
            disabled={!!actionLoading}
            onClick={onBulkReady}
            size="sm"
            variant="secondary"
          >
            ✓ Tandai Siap Export
          </Button>
          <Button
            disabled={!!actionLoading || actionLoading === 'shipping-export'}
            onClick={onBulkExport}
            size="sm"
            variant="secondary"
          >
            📤 Export Terpilih
          </Button>
          <Button
            disabled={!!actionLoading}
            onClick={onBulkDelivered}
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            ✅ Tandai Terkirim
          </Button>
          <Button
            disabled={!!actionLoading}
            onClick={onBulkCancel}
            size="sm"
            variant="destructive"
          >
            ✕ Batalkan
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    if (checked) onSelectAll(selectableIds);
                    else onSelectAll([]);
                  }}
                  aria-label="Pilih semua"
                />
              </TableHead>
              <TableHead className="w-8 text-muted-foreground">#</TableHead>
              <TableHead>Penerima & Alamat</TableHead>
              <TableHead>CS</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>Metode</TableHead>
              <TableHead>Nilai</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell className="h-24 text-center text-muted-foreground" colSpan={10}>
                  Belum ada rekap pengiriman pada filter ini.
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((row, idx) => {
                const isCancelled = row.status === 'cancelled' || row.status === 'cancelled_after_export';
                const isSelected = selectedIds.has(row._id);
                return (
                  <TableRow
                    key={row._id}
                    className={cn(
                      isSelected && 'bg-primary/5',
                      isCancelled && 'opacity-50',
                    )}
                  >
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        disabled={isCancelled}
                        onCheckedChange={(checked) => onSelectRow(row._id, Boolean(checked))}
                        aria-label={`Pilih ${row.recipientName}`}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{(currentPage - 1) * PAGE_SIZE + idx + 1}</TableCell>
                    <TableCell>
                      <button
                        className={cn('text-left font-medium hover:underline', isCancelled && 'line-through text-muted-foreground')}
                        onClick={() => onOpenDetail(row)}
                      >
                        {row.recipientName || row.customerName || 'Unknown'}
                      </button>
                      <div className="text-xs text-muted-foreground">{row.recipientDistrict}, {row.recipientCity}</div>
                      <div className="font-mono text-xs text-muted-foreground/60">{row.recipientPhone || row.customerPhone}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.csName
                        ? <span className="text-muted-foreground">{row.csName}</span>
                        : <span className="font-medium text-amber-500">? Tanpa CS</span>
                      }
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="truncate text-sm font-medium">{row.packageContent || '-'}</div>
                      {row.flags.length > 0 && (
                        <Badge className="mt-1 w-fit text-[10px]" variant="outline">{row.flags.length} flag</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          row.paymentMethod === 'cod' ? 'border-amber-500/40 text-amber-600' : '',
                          row.paymentMethod === 'transfer' ? 'border-violet-500/40 text-violet-600' : '',
                        )}
                      >
                        {row.paymentMethod.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {formatRupiah(row.codValue ?? row.total ?? row.nonCodItemPrice)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.closedAt)}
                    </TableCell>
                    <TableCell>
                      <RecapStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {row.status === 'needs_review' && (
                          <Button
                            disabled={actionLoading === row._id + ':ready'}
                            onClick={() => onReady(row)}
                            size="sm"
                            variant="outline"
                            className="text-blue-600 border-blue-200 hover:bg-blue-50"
                          >
                            ✓ Siap
                          </Button>
                        )}
                        {row.status === 'exported' && (
                          <Button
                            disabled={actionLoading === row._id + ':delivered'}
                            onClick={() => onDelivered(row)}
                            size="sm"
                            variant="outline"
                            className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                          >
                            ✅ Terkirim
                          </Button>
                        )}
                        {row.status === 'delivered' && (
                          <Button
                            disabled={actionLoading === row._id + ':undo-delivered'}
                            onClick={() => onUndoDelivered(row)}
                            size="sm"
                            variant="ghost"
                            className="text-xs text-muted-foreground"
                          >
                            ↩ Undo
                          </Button>
                        )}
                        {(row.status === 'cancelled' || row.status === 'cancelled_after_export') ? (
                          <Button
                            disabled={actionLoading === row._id + ':undo-cancel'}
                            onClick={() => onUndoCancel(row)}
                            size="sm"
                            variant="ghost"
                            className="text-xs text-muted-foreground"
                          >
                            ↩ Pulihkan
                          </Button>
                        ) : row.status !== 'delivered' && (
                          <Button
                            disabled={actionLoading === row._id + ':cancel'}
                            onClick={() => onCancel(row)}
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            ✕
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-2">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
          >
            ← Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((page) => {
              if (totalPages <= 7) return true;
              if (page === 1 || page === totalPages) return true;
              if (Math.abs(page - currentPage) <= 2) return true;
              return false;
            })
            .reduce<(number | '...')[]>((acc, page, i, arr) => {
              if (i > 0 && typeof arr[i - 1] === 'number' && (page as number) - (arr[i - 1] as number) > 1) {
                acc.push('...');
              }
              acc.push(page);
              return acc;
            }, [])
            .map((item, i) =>
              item === '...' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setCurrentPage(item as number)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    currentPage === item
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                  type="button"
                >
                  {item}
                </button>
              ),
            )}
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export function ShippingRecapDetailSheet({
  recap,
  onOpenChange,
}: {
  recap: ShippingRecap | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(recap)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {recap && (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{recap.recipientName || recap.customerName || 'Unknown recipient'}</SheetTitle>
                  <SheetDescription className="mt-1 font-mono">{recap.orderIdBerdu || recap.customerPhone}</SheetDescription>
                </div>
                <RecapStatusBadge status={recap.status} />
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Export fields</h2>
                <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                  <DetailRow label="CS" value={[recap.csName, recap.csPhone].filter(Boolean).join(' | ') || '-'} />
                  <DetailRow label="Penerima" value={[recap.recipientName, recap.recipientPhone].filter(Boolean).join(' | ') || '-'} />
                  <DetailRow label="Alamat" value={recap.recipientAddress || '-'} />
                  <DetailRow label="Kecamatan" value={recap.recipientDistrict || '-'} />
                  <DetailRow label="Kota" value={recap.recipientCity || '-'} />
                  <DetailRow label="Isi paket" value={recap.packageContent || '-'} />
                  <DetailRow label="Bayar" value={recap.paymentMethod.toUpperCase()} />
                  <DetailRow label="Total" value={formatRupiah(recap.total ?? recap.codValue ?? recap.nonCodItemPrice)} strong />
                  <DetailRow label="Diskon" value={formatRupiah(recap.discount ?? recap.inferredDiscount)} />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">Flags</h2>
                {recap.flags.length === 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">No flags.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {recap.flags.map((flag) => (
                      <Badge key={flag} variant="outline">{flag}</Badge>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">Source message</h2>
                <div className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm">{recap.sourceMessageText}</div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words', strong && 'font-semibold text-foreground')}>{value}</span>
    </div>
  );
}

export function RecapStatusBadge({ status }: { status: RecapStatus }) {
  if (status === 'needs_review') {
    return <Badge className="border-amber-500/40 bg-amber-50 text-amber-700" variant="outline">⚠ Perlu Review</Badge>;
  }

  if (status === 'ready') {
    return <Badge className="border-blue-500/40 bg-blue-50 text-blue-700" variant="outline">✓ Siap Export</Badge>;
  }

  if (status === 'exported') {
    return <Badge className="border-emerald-500/40 bg-emerald-50 text-emerald-700" variant="outline">📤 Diekspor</Badge>;
  }

  if (status === 'delivered') {
    return <Badge className="border-teal-500/40 bg-teal-50 text-teal-700 font-semibold" variant="outline">✅ Terkirim</Badge>;
  }

  if (status === 'cancelled_after_export') {
    return <Badge className="border-destructive/30 text-destructive line-through" variant="outline">Dibatalkan</Badge>;
  }

  return <Badge className="border-destructive/30 text-destructive line-through" variant="outline">Dibatalkan</Badge>;
}
