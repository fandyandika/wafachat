'use client';

import React from 'react';
import type {
  FollowUpArchivedRow,
  FollowUpAttentionRow,
  FollowUpClosedRow,
  FollowUpListRow,
  FollowUpQueueRow,
  FollowUpView,
} from './follow-up-types';
import { FOLLOW_UP_STAGE_LABEL } from './follow-up-types';
import { FOLLOW_UP_DUE_CLASS, formatFollowUpDue, formatFollowUpTime } from './follow-up-status';

function isQueueRow(row: FollowUpListRow): row is FollowUpQueueRow {
  return 'cycleInboundAt' in row;
}

function hasSnapshot(row: FollowUpListRow): row is FollowUpQueueRow | FollowUpAttentionRow | FollowUpArchivedRow | FollowUpClosedRow {
  return 'lastInboundPreview' in row && (!('contextAvailable' in row) || row.contextAvailable);
}

function isClosedRow(row: FollowUpListRow): row is FollowUpClosedRow {
  return 'closedAt' in row;
}

function rowId(row: FollowUpListRow): string {
  return row.conversationId ?? `${row.customerPhone}:${row.orderId}`;
}

function Preview({ label, preview, at }: { label: string; preview?: string; at?: number }) {
  return <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs">
    <span className="font-semibold text-foreground">{label}</span>
    <div className="min-w-0">
      <p className="line-clamp-2 text-muted-foreground">{preview || 'Preview belum tersedia.'}</p>
      <time dateTime={at === undefined ? undefined : new Date(at).toISOString()} className="mt-0.5 block text-[11px] text-muted-foreground">{formatFollowUpTime(at)}</time>
    </div>
  </div>;
}

export function FollowUpList({ view, rows, loading, error, selectedId, onSelect, onRetry }: {
  view: FollowUpView | 'search';
  rows: FollowUpListRow[];
  loading: boolean;
  error?: string | null;
  selectedId: string | null;
  onSelect: (row: FollowUpListRow) => void;
  onRetry?: () => void;
}) {
  if (loading) return <div role="status" className="p-6 text-sm text-muted-foreground">Memuat data follow-up…</div>;
  if (error) return <div role="alert" className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
    <p className="font-medium text-destructive">{error}</p>
    {onRetry ? <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border bg-background px-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Coba lagi</button> : null}
  </div>;
  if (!rows.length) return <div className="flex min-h-56 items-center justify-center p-6 text-center">
    <div><p className="font-medium">Belum ada data</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {view === 'h1' || view === 'h2' || view === 'h3'
          ? 'Tidak ada customer pada tahap ini.'
          : view === 'search'
            ? 'Tekan Cari untuk menampilkan hasil.'
            : 'Data akan muncul setelah ada aktivitas pada tampilan ini.'}
      </p></div>
  </div>;

  return <div className="divide-y divide-border" aria-label="Daftar follow-up">
    {rows.map((row) => {
      const id = rowId(row);
      const queue = isQueueRow(row) ? row : null;
      const due = 'dueAt' in row && row.dueAt !== undefined ? formatFollowUpDue(row.dueAt) : null;
      return <button key={id} type="button" onClick={() => onSelect(row)}
        className={`min-h-11 w-full p-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === id ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate font-semibold">{row.customerName || row.customerPhone}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.customerPhone} · CS {row.csName}</p></div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {'stage' in row && row.stage ? <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{FOLLOW_UP_STAGE_LABEL[row.stage]}</span> : null}
            {due ? <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${FOLLOW_UP_DUE_CLASS[due.tone]}`}>{due.label}</span> : null}
          </div>
        </div>

        {hasSnapshot(row) ? <div className="mt-3 space-y-2 rounded-lg border bg-muted/20 p-3">
          <Preview label="Customer" preview={row.lastInboundPreview} at={row.lastInboundAt} />
          <Preview label="CS" preview={row.lastOutboundPreview} at={row.lastOutboundAt} />
        </div> : null}

        {hasSnapshot(row) ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">{row.productName}</span>
          <span className="rounded-md bg-muted px-2 py-1">Order {row.orderId || '—'}</span>
          <span className="rounded-md bg-muted px-2 py-1">Trigger terdeteksi: {row.lastDetectedStage ? FOLLOW_UP_STAGE_LABEL[row.lastDetectedStage] : 'Belum ada'}{row.lastDetectedTemplate ? ` · ${row.lastDetectedTemplate}` : ''}</span>
        </div> : null}

        {isClosedRow(row) ? <div className="mt-3 text-sm">
          <p className="font-medium">{row.product || 'Produk tidak tersedia'} · Order {row.orderId || '—'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Closing {formatFollowUpTime(row.closedAt)} · {row.touches} sentuhan follow-up</p>
          {!row.contextAvailable ? <p className="mt-2 rounded-lg bg-muted p-2 text-xs font-medium">Konteks Follow-up tidak tersedia</p> : null}
        </div> : null}

        {'lastError' in row && row.lastError ? <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs font-medium text-destructive">{row.lastError}</p> : null}
      </button>;
    })}
  </div>;
}
