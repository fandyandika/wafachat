'use client';

import React from 'react';
import type { FollowUpHistoryRow, FollowUpQueueRow, FollowUpSearchRow } from './follow-up-types';
import { FOLLOW_UP_STAGE_LABEL } from './follow-up-types';

type Row = FollowUpQueueRow | FollowUpSearchRow | FollowUpHistoryRow;

function relativeHours(at: number) {
  const hours = Math.max(0, Math.round((Date.now() - at) / 3_600_000));
  return hours < 72 ? `${hours} jam` : `${Math.round(hours / 24)} hari`;
}

function isQueueRow(row: Row): row is FollowUpQueueRow {
  return 'dueAt' in row;
}

export function FollowUpList({ view, rows, loading, error, selectedId, onSelect, onRetry }: {
  view: 'action' | 'search' | 'sent' | 'review' | 'completed';
  rows: Row[];
  loading: boolean;
  error?: string | null;
  selectedId: string | null;
  onSelect: (row: Row) => void;
  onRetry?: () => void;
}) {
  if (loading) return <div role="status" className="p-6 text-sm text-muted-foreground">Memuat data follow-up…</div>;
  if (error) return (
    <div role="alert" className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">{error}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border px-4 font-medium">Coba lagi</button>}
    </div>
  );
  if (!rows.length) return (
    <div className="flex min-h-56 items-center justify-center p-6 text-center">
      <div><p className="font-medium">{view === 'action' ? 'Semua tertangani' : 'Belum ada data'}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {view === 'action' ? 'Tidak ada customer yang memenuhi aturan follow-up saat ini.' : 'Data akan muncul setelah ada aktivitas pada tampilan ini.'}
      </p></div>
    </div>
  );
  return <div className="divide-y divide-border" aria-label="Daftar follow-up">
    {rows.map((row) => {
      const id = row.conversationId ?? ('id' in row ? row.id : '');
      const queue = isQueueRow(row) ? row : null;
      return <button key={id} type="button" onClick={() => onSelect(row)}
        className={`min-h-11 w-full p-4 text-left transition-colors hover:bg-muted/60 ${selectedId === id ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate font-semibold">{row.customerName || row.customerPhone}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.customerPhone} · {row.csName}</p></div>
          {row.stage && <span className="shrink-0 rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{FOLLOW_UP_STAGE_LABEL[row.stage]}</span>}
        </div>
        {queue && <>
          <p className="mt-3 truncate text-sm font-medium">{queue.productName}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{queue.lastMessagePreview || 'Belum ada preview pesan.'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Diam {relativeHours(queue.lastMessageAt)}</span><span>•</span><span>{queue.reason}</span>
          </div>
        </>}
        {'at' in row && <p className="mt-2 text-xs text-muted-foreground">{new Date(row.at).toLocaleString('id-ID')}</p>}
      </button>;
    })}
  </div>;
}
