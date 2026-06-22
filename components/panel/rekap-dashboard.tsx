'use client';

// Preserved Rekap Pengiriman view (route hidden — focus is live CS performance,
// shipping recap is handled by a separate CS/admin tool). Re-enable by rendering
// <RekapDashboard/> from app/panel/rekap/page.tsx and restoring the nav entry.
import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ShippingRecapPanel, ShippingRecapDetailSheet } from '@/components/panel/shipping-recap-panel';
import type { ShippingRecap, RecapStatus, PaymentFilter, RecapSort } from '@/components/panel/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function RekapDashboard() {
  const { startAt, endAt, csName, jakartaDate } = usePanelFilters();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [recapStatus, setRecapStatus] = useState<RecapStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [recapSearch, setRecapSearch] = useState('');
  const [selectedRecap, setSelectedRecap] = useState<ShippingRecap | null>(null);
  const [recapSort, setRecapSort] = useState<RecapSort>('newest');
  const [selectedRecapIds, setSelectedRecapIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);

  const shippingRecapsData = useQuery(api.shippingRecaps.list, {
    startAt,
    endAt,
    status: recapStatus === 'all' ? undefined : recapStatus,
    paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
    search: recapSearch || undefined,
    csName,
  });

  const countsData = useQuery(api.shippingRecaps.getCounts, {
    startAt,
    endAt,
    csName,
  });

  const markRecapReady = useMutation(api.shippingRecaps.markReady);
  const markRecapCancelled = useMutation(api.shippingRecaps.markCancelled);
  const undoRecapCancelled = useMutation(api.shippingRecaps.undoCancelled);
  const markRecapsExported = useMutation(api.shippingRecaps.markExported);
  const markRecapsDelivered = useMutation(api.shippingRecaps.markDelivered);
  const undoRecapDelivered = useMutation(api.shippingRecaps.undoDelivered);
  const markReadyBulk = useMutation(api.shippingRecaps.markReadyBulk);
  const markCancelledBulk = useMutation(api.shippingRecaps.markCancelledBulk);

  const shippingRecaps = (shippingRecapsData ?? []) as ShippingRecap[];

  const markDeliveredRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':delivered');
    await markRecapsDelivered({ recapIds: [recap._id] });
    setActionLoading(null);
  };

  const undoDeliveredRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':undo-delivered');
    await undoRecapDelivered({ recapId: recap._id });
    setActionLoading(null);
  };

  const bulkMarkReady = async (ids: string[]) => {
    setActionLoading('bulk:ready');
    await markReadyBulk({ recapIds: ids as Id<'shippingRecaps'>[] });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const bulkMarkDelivered = async (ids: string[]) => {
    setActionLoading('bulk:delivered');
    await markRecapsDelivered({ recapIds: ids as Id<'shippingRecaps'>[] });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const bulkCancel = async (ids: string[]) => {
    setActionLoading('bulk:cancel');
    await markCancelledBulk({ recapIds: ids as Id<'shippingRecaps'>[], reason: 'cancelled from panel' });
    setSelectedRecapIds(new Set());
    setBulkCancelOpen(false);
    setActionLoading(null);
  };

  const readyRecaps = shippingRecaps.filter((row) => row.status === 'ready');

  const markReadyRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':ready');
    await markRecapReady({ recapId: recap._id });
    setActionLoading(null);
  };

  const cancelRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':cancel');
    await markRecapCancelled({ recapId: recap._id, reason: 'cancelled from panel' });
    setActionLoading(null);
  };

  const undoCancelRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':undo-cancel');
    await undoRecapCancelled({ recapId: recap._id });
    setActionLoading(null);
  };

  const downloadRecapCsv = async (rowsToExport?: ShippingRecap[]) => {
    const toExport = rowsToExport ?? readyRecaps;
    if (toExport.length === 0) return;
    const exportBatchId = 'export-' + new Date().toISOString().replace(/[:.]/g, '-');
    setActionLoading('shipping-export');
    const response = await fetch('/api/shipping-recaps/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: toExport }),
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wafachat-rekap-pengiriman-${jakartaDate || 'today'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    await markRecapsExported({ recapIds: toExport.map((row) => row._id), exportBatchId });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const selectedIds = Array.from(selectedRecapIds);
  const readySelected = shippingRecaps.filter((r) => selectedIds.includes(r._id) && r.status === 'ready');

  return (
    <>
      <ShippingRecapPanel
        actionLoading={actionLoading}
        csName={csName}
        totalCounts={countsData}
        paymentFilter={paymentFilter}
        readyCount={readyRecaps.length}
        recapSearch={recapSearch}
        recapSort={recapSort}
        recapStatus={recapStatus}
        rows={shippingRecaps}
        selectedIds={selectedRecapIds}
        onBulkCancel={() => setBulkCancelOpen(true)}
        onBulkDelivered={() => void bulkMarkDelivered(selectedIds)}
        onBulkExport={() => void downloadRecapCsv(readySelected.length > 0 ? readySelected : undefined)}
        onBulkReady={() => void bulkMarkReady(selectedIds)}
        onCancel={(recap) => void cancelRecap(recap)}
        onDelivered={(recap) => void markDeliveredRecap(recap)}
        onDownload={() => void downloadRecapCsv()}
        onOpenDetail={(recap) => setSelectedRecap(recap)}
        onPaymentFilterChange={setPaymentFilter}
        onReady={(recap) => void markReadyRecap(recap)}
        onSearchChange={setRecapSearch}
        onSelectAll={(selected) => {
          if (selected) {
            setSelectedRecapIds(new Set(shippingRecaps.map((r) => r._id)));
          } else {
            setSelectedRecapIds(new Set());
          }
        }}
        onSelectRow={(id, selected) => {
          const next = new Set(selectedRecapIds);
          if (selected) {
            next.add(id);
          } else {
            next.delete(id);
          }
          setSelectedRecapIds(next);
        }}
        onSortChange={setRecapSort}
        onStatusChange={setRecapStatus}
        onUndoCancel={(recap) => void undoCancelRecap(recap)}
        onUndoDelivered={(recap) => void undoDeliveredRecap(recap)}
      />

      <ShippingRecapDetailSheet
        recap={selectedRecap}
        onOpenChange={(open) => {
          if (!open) setSelectedRecap(null);
        }}
      />

      <AlertDialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan {selectedRecapIds.size} pesanan?</AlertDialogTitle>
            <AlertDialogDescription>
              Pesanan yang dibatalkan tidak akan masuk ke export. Tindakan ini bisa di-undo satu per satu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkCancel(Array.from(selectedRecapIds))}
            >
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
