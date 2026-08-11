'use client';

import React from 'react';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import type { FollowUpHistoryRow, FollowUpQueueRow, FollowUpSearchRow } from './follow-up-types';
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
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const messages = useQuery(api.messages.listMessages, candidate ? { conversationId: candidate.conversationId as Id<'conversations'>, limit: 30 } : 'skip');
  if (!candidate) return <div className="hidden h-full items-center justify-center bg-muted/20 p-8 text-center text-sm text-muted-foreground md:flex">Pilih customer untuk melihat konteks dan tindakan.</div>;

  async function markContacted() {
    if (!candidate || confirming) return;
    setConfirming(true); setFeedback(null);
    try {
      await confirmContact({ conversationId: candidate.conversationId, stage: candidate.stage, requestId: crypto.randomUUID() });
      setFeedback('Kontak manual berhasil dicatat.'); setManualConfirmOpen(false); onChanged?.();
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
      <Button type="button" variant="outline" className="min-h-11" disabled={confirming} onClick={() => setManualConfirmOpen(true)}>Tandai sudah dihubungi</Button>
    </footer>
    {manualConfirmOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="manual-contact-title" className="w-full rounded-t-2xl border bg-background p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <h2 id="manual-contact-title" className="text-lg font-semibold">Catat kontak manual?</h2>
        <p className="mt-2 text-sm text-muted-foreground">Konfirmasi hanya jika Anda benar-benar sudah menghubungi customer. Catatan ini menyimpan nama akun Anda dan memajukan tahap follow-up, tetapi tidak mengklaim pesan dikirim lewat API.</p>
        <div className="mt-5 flex gap-2"><Button variant="outline" className="min-h-11 flex-1" disabled={confirming} onClick={() => setManualConfirmOpen(false)}>Batal</Button><Button className="min-h-11 flex-1" disabled={confirming} onClick={markContacted}>{confirming ? 'Mencatat…' : 'Ya, sudah dihubungi'}</Button></div>
      </section>
    </div>}
  </div>;
}

export function FollowUpReadOnlyDetail({ row, onBack }: { row: FollowUpSearchRow | FollowUpHistoryRow; onBack?: () => void }) {
  return <div className="flex h-full flex-col bg-background">
    <header className="flex items-center gap-3 border-b p-4">
      {onBack && <button type="button" onClick={onBack} className="min-h-11 min-w-11 rounded-lg md:hidden" aria-label="Kembali">←</button>}
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{row.customerName || row.customerPhone}</h2><p className="text-sm text-muted-foreground">{row.customerPhone}</p></div>
    </header>
    <div className="flex-1 p-5">
      <dl className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order</dt><dd className="mt-1 font-medium">{row.orderId || 'Tidak tersedia'}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CS</dt><dd className="mt-1 font-medium">{row.csName}</dd></div>
        {row.stage && <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tahap terakhir</dt><dd className="mt-1 font-medium">{FOLLOW_UP_STAGE_LABEL[row.stage]}</dd></div>}
        {'status' in row && <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</dt><dd className="mt-1 font-medium capitalize">{row.status}</dd></div>}
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">Tampilan ini hanya untuk pemeriksaan. Tindakan follow-up tersedia saat customer memenuhi aturan di Perlu tindakan.</p>
    </div>
    <footer className="border-t p-3"><a href={`https://wa.me/${waNumber(row.customerPhone)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold sm:w-auto">Buka WhatsApp</a></footer>
  </div>;
}
