'use client';

import React, { useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import type {
  FollowUpActionRow,
  FollowUpArchivedRow,
  FollowUpClosedRow,
  FollowUpQueueRow,
  FollowUpSearchRow,
  FollowUpStage,
} from './follow-up-types';
import { FOLLOW_UP_STAGE_LABEL } from './follow-up-types';
import { archiveFollowUp, confirmContact } from './follow-up-client';
import { FollowUpStageMenu } from './follow-up-stage-menu';
import { formatFollowUpTime } from './follow-up-status';

function waNumber(phone: string) { return phone.replace(/\D/g, '').replace(/^0/, '62'); }
function isQueueRow(row: FollowUpActionRow): row is FollowUpQueueRow { return 'cycleInboundAt' in row; }

export async function completeFollowUpAction<T>(action: () => Promise<T>, conversationId: string, onChanged?: (conversationId: string) => void): Promise<T> {
  const result = await action();
  onChanged?.(conversationId);
  return result;
}

const TRANSITION_LABEL = {
  cycle_armed: 'Siklus dimulai',
  stage_completed: 'Tahap selesai',
  customer_replied: 'Customer membalas',
  stage_corrected: 'Tahap diubah',
  closing: 'Closing',
  cancelled: 'Dibatalkan',
  archived: 'Diarsipkan',
} as const;

export function FollowUpDetail({ candidate, onBack, onChanged, onSendTemplate }: {
  candidate: FollowUpActionRow | null;
  onBack?: () => void;
  onChanged?: (conversationId: string) => void;
  onSendTemplate?: (candidate: FollowUpQueueRow) => void;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const correctStage = useMutation(api.followUp.correctFollowUpStage);
  const markClosing = useMutation(api.followUp.markFollowUpClosing);
  const markCancelled = useMutation(api.followUp.markFollowUpCancelled);
  const conversationId = candidate?.conversationId as Id<'conversations'> | undefined;
  const messages = useQuery(
    api.messages.listMessages,
    conversationId ? { conversationId, limit: 50 } : 'skip',
  );
  const transitions = usePaginatedQuery(
    api.followUpTransitions.listConversationTransitions,
    conversationId ? { conversationId } : 'skip',
    { initialNumItems: 50 },
  );
  const channelHealth = useQuery(
    api.providerChannelHealth.getProviderChannelHealthForCs,
    candidate ? { csKey: candidate.csKey } : 'skip',
  );

  if (!candidate) return <div className="hidden h-full items-center justify-center bg-muted/20 p-8 text-center text-sm text-muted-foreground md:flex">Pilih customer untuk melihat konteks dan tindakan.</div>;

  const currentCandidate = candidate;
  const queue = isQueueRow(candidate) ? candidate : null;
  const hasActiveCycle = Boolean(candidate.cycleId?.trim());

  async function runAction(label: string, action: () => Promise<unknown>, success: string) {
    if (busyAction) return;
    setBusyAction(label);
    setFeedback(null);
    try {
      const result = await action() as { success?: boolean; error?: string } | undefined;
      if (result?.success === false) throw new Error(result.error || 'Tindakan tidak dapat diselesaikan.');
      setFeedback({ tone: 'success', message: success });
      await completeFollowUpAction(async () => result, currentCandidate.conversationId, onChanged);
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Tindakan gagal. Coba lagi.' });
    } finally {
      setBusyAction(null);
    }
  }

  function updateStage(stage: FollowUpStage) {
    if (stage === currentCandidate.stage) return;
    void runAction('stage', () => correctStage({
      conversationId: currentCandidate.conversationId as Id<'conversations'>,
      targetStage: stage,
      requestId: crypto.randomUUID(),
    }), `Tahap diubah ke ${FOLLOW_UP_STAGE_LABEL[stage]}.`);
  }

  return <div className="flex h-full flex-col bg-background">
    <header className="flex items-center gap-3 border-b p-4">
      {onBack ? <button type="button" onClick={onBack} className="min-h-11 min-w-11 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-label="Kembali">←</button> : null}
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{candidate.customerName || candidate.customerPhone}</h2><p className="text-sm text-muted-foreground">{candidate.customerPhone} · {candidate.orderId}</p></div>
      {candidate.stage ? <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{FOLLOW_UP_STAGE_LABEL[candidate.stage]}</span> : null}
    </header>

    <div className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4">
      <section className="rounded-xl border bg-background p-4" aria-labelledby="context-title">
        <p id="context-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konteks</p>
        <p className="mt-2 font-medium">{candidate.productName}</p>
        <p className="mt-1 text-sm text-muted-foreground">{queue?.reason ?? ('reviewReason' in candidate ? candidate.reviewReason : undefined) ?? 'Periksa riwayat sebelum mengambil tindakan.'}</p>
      </section>

      <section className="rounded-xl border bg-background p-4" aria-labelledby="channel-title">
        <h3 id="channel-title" className="text-sm font-semibold">Kesehatan kanal</h3>
        {channelHealth === undefined ? <p className="mt-2 text-sm text-muted-foreground">Memeriksa kanal…</p>
          : channelHealth === null ? <p className="mt-2 text-sm text-muted-foreground">Belum ada sinyal webhook</p>
            : channelHealth.lastError ? <div role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-semibold">Masalah kanal</p>
              <p className="mt-1">{channelHealth.lastError} · {formatFollowUpTime(channelHealth.errorAt)}</p>
            </div>
              : <p className="mt-2 text-sm text-muted-foreground">Sinyal webhook terakhir: {formatFollowUpTime(Math.max(channelHealth.lastInboundAt ?? 0, channelHealth.lastOutboundAt ?? 0, channelHealth.updatedAt))}</p>}
      </section>

      <FollowUpStageMenu currentStage={candidate.stage} disabled={Boolean(busyAction)} onSelect={updateStage} />

      <section aria-labelledby="conversation-title">
        <h3 id="conversation-title" className="mb-2 text-sm font-semibold">Percakapan terakhir</h3>
        {messages === undefined ? <p className="text-sm text-muted-foreground">Memuat percakapan…</p>
          : messages.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada pesan.</p>
            : messages.map((message) => <div key={message._id} className={`mb-2 max-w-[85%] rounded-xl border bg-background p-3 text-sm ${message.role === 'cs' ? 'ml-auto' : ''}`}>
              <p>{message.content}</p><time dateTime={new Date(message.createdAt).toISOString()} className="mt-1 block text-[11px] text-muted-foreground">{formatFollowUpTime(message.createdAt)}</time>
            </div>)}
      </section>

      <section className="rounded-xl border bg-background p-4" aria-labelledby="timeline-title">
        <h3 id="timeline-title" className="text-sm font-semibold">Riwayat tahap</h3>
        {transitions.status === 'LoadingFirstPage' ? <p className="mt-2 text-sm text-muted-foreground">Memuat riwayat…</p>
          : transitions.results.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada transisi.</p>
            : <ol className="mt-3 space-y-3 border-l pl-4">{transitions.results.map((event) => <li key={event.transitionId} className="text-sm">
              <p className="font-medium">{TRANSITION_LABEL[event.kind]}</p>
              {event.fromStage && event.toStage ? <p className="text-muted-foreground">{FOLLOW_UP_STAGE_LABEL[event.fromStage]} → {FOLLOW_UP_STAGE_LABEL[event.toStage]}</p> : null}
              <p className="text-xs text-muted-foreground">{event.actorName ?? event.source} · {formatFollowUpTime(event.createdAt)}</p>
            </li>)}</ol>}
      </section>
    </div>

    {feedback ? <div role={feedback.tone === 'error' ? 'alert' : 'status'} className={`border-t px-4 py-2 text-sm ${feedback.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-900'}`}>{feedback.message}</div> : null}
    {!hasActiveCycle ? <p role="note" className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900">Closing dan Batal tidak tersedia karena siklus follow-up tidak aktif.</p> : null}

    <footer className="sticky bottom-0 z-10 grid grid-cols-2 gap-2 border-t bg-card p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] sm:grid-cols-3 lg:grid-cols-4">
      <a href={`https://wa.me/${waNumber(candidate.customerPhone)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-3 text-center text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Buka WhatsApp</a>
      {queue ? <Button type="button" className="min-h-11" disabled={Boolean(busyAction)} onClick={() => onSendTemplate?.(queue)}>Kirim template</Button> : null}
      <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busyAction)} onClick={() => void runAction('contact', () => confirmContact({ conversationId: candidate.conversationId, requestId: crypto.randomUUID() }), 'Kontak manual berhasil dicatat.')}>{busyAction === 'contact' ? 'Mencatat…' : 'Sudah dihubungi'}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busyAction) || !hasActiveCycle} onClick={() => void runAction('closing', () => markClosing({ conversationId: candidate.conversationId as Id<'conversations'>, expectedCycleId: candidate.cycleId! }), 'Closing berhasil dicatat.')}>Closing</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busyAction) || !hasActiveCycle} onClick={() => void runAction('cancel', () => markCancelled({ conversationId: candidate.conversationId as Id<'conversations'>, expectedCycleId: candidate.cycleId!, reason: 'Customer membatalkan pesanan' }), 'Pembatalan berhasil dicatat.')}>Batal</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busyAction)} onClick={() => void runAction('archive', () => archiveFollowUp(candidate.conversationId), 'Follow-up diarsipkan.')}>{busyAction === 'archive' ? 'Mengarsipkan…' : 'Arsip'}</Button>
    </footer>
  </div>;
}

export function FollowUpReadOnlyDetail({ row, onBack }: {
  row: FollowUpSearchRow | FollowUpArchivedRow | FollowUpClosedRow;
  onBack?: () => void;
}) {
  const product = 'productName' in row ? row.productName : 'product' in row ? row.product : undefined;
  return <div className="flex h-full flex-col bg-background">
    <header className="flex items-center gap-3 border-b p-4">
      {onBack ? <button type="button" onClick={onBack} className="min-h-11 min-w-11 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-label="Kembali">←</button> : null}
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{row.customerName || row.customerPhone}</h2><p className="text-sm text-muted-foreground">{row.customerPhone}</p></div>
    </header>
    <div className="flex-1 p-5">
      <dl className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order</dt><dd className="mt-1 font-medium">{row.orderId || 'Tidak tersedia'}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CS</dt><dd className="mt-1 font-medium">{row.csName}</dd></div>
        {product ? <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Produk</dt><dd className="mt-1 font-medium">{product}</dd></div> : null}
        {'stage' in row && row.stage ? <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tahap terakhir</dt><dd className="mt-1 font-medium">{FOLLOW_UP_STAGE_LABEL[row.stage]}</dd></div> : null}
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">Tampilan ini hanya untuk pemeriksaan. Tindakan follow-up tersedia pada antrean aktif atau Perlu dicek.</p>
    </div>
    <footer className="sticky bottom-0 border-t bg-card p-3"><a href={`https://wa.me/${waNumber(row.customerPhone)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-background px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto">Buka WhatsApp</a></footer>
  </div>;
}
