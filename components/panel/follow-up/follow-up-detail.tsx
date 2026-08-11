'use client';

import React from 'react';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import type { FollowUpQueueRow } from './follow-up-types';
import { FOLLOW_UP_STAGE_LABEL } from './follow-up-types';
import { confirmContact } from './follow-up-client';

function waNumber(phone: string) { return phone.replace(/\D/g, '').replace(/^0/, '62'); }

export function FollowUpDetail({ candidate, onBack, onChanged, onSendTemplate }: {
  candidate: FollowUpQueueRow | null;
  onBack?: () => void;
  onChanged?: () => void;
  onSendTemplate?: (candidate: FollowUpQueueRow) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const messages = useQuery(api.messages.listMessages, candidate ? { conversationId: candidate.conversationId as Id<'conversations'>, limit: 30 } : 'skip');
  if (!candidate) return <div className="hidden h-full items-center justify-center bg-muted/20 p-8 text-center text-sm text-muted-foreground md:flex">Pilih customer untuk melihat konteks dan tindakan.</div>;

  async function markContacted() {
    if (!candidate || confirming || !window.confirm('Tandai bahwa customer sudah dihubungi secara manual? Tindakan ini memajukan tahap follow-up.')) return;
    setConfirming(true); setFeedback(null);
    try {
      await confirmContact({ conversationId: candidate.conversationId, stage: candidate.stage, requestId: crypto.randomUUID() });
      setFeedback('Kontak manual berhasil dicatat.'); onChanged?.();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Konfirmasi gagal.'); }
    finally { setConfirming(false); }
  }

  return <div className="flex h-full flex-col bg-background">
    <header className="flex items-center gap-3 border-b p-4">
      {onBack && <button type="button" onClick={onBack} className="min-h-11 min-w-11 rounded-lg md:hidden" aria-label="Kembali">←</button>}
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{candidate.customerName}</h2><p className="text-sm text-muted-foreground">{candidate.customerPhone} · {candidate.orderId}</p></div>
      <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{FOLLOW_UP_STAGE_LABEL[candidate.stage]}</span>
    </header>
    <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
      <div className="rounded-xl border bg-background p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konteks</p><p className="mt-2 font-medium">{candidate.productName}</p><p className="mt-1 text-sm text-muted-foreground">{candidate.reason}</p></div>
      {messages === undefined ? <p className="text-sm text-muted-foreground">Memuat percakapan…</p> : messages.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada pesan.</p> : messages.map((message) => <div key={message._id} className={`max-w-[85%] rounded-xl border bg-background p-3 text-sm ${message.role === 'cs' ? 'ml-auto' : ''}`}>{message.content}</div>)}
    </div>
    {feedback && <div role="status" className="border-t bg-muted px-4 py-2 text-sm">{feedback}</div>}
    <footer className="grid gap-2 border-t bg-card p-3 sm:grid-cols-3">
      <a href={`https://wa.me/${waNumber(candidate.customerPhone)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold">Buka WhatsApp</a>
      <Button type="button" className="min-h-11" onClick={() => onSendTemplate?.(candidate)}>Kirim template</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={confirming} onClick={markContacted}>{confirming ? 'Mencatat…' : 'Tandai sudah dihubungi'}</Button>
    </footer>
  </div>;
}
