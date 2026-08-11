'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FollowUpClientError, sendTemplate } from './follow-up-client';
import type { FollowUpQueueRow, FollowUpStage } from './follow-up-types';

export type FollowUpTemplate = {
  id: string;
  stage: FollowUpStage;
  label: string;
  templateName: string;
  language: string;
  variables: Array<'customer_name' | 'product_name' | 'order_id'>;
  isActive: boolean;
};

function valueFor(variable: FollowUpTemplate['variables'][number], candidate: FollowUpQueueRow) {
  if (variable === 'customer_name') return candidate.customerName;
  if (variable === 'product_name') return candidate.productName;
  return candidate.orderId;
}

export function TemplateSendDialog({ open, candidate, templates, sender, onClose, onAccepted }: {
  open: boolean;
  candidate: FollowUpQueueRow | null;
  templates: FollowUpTemplate[];
  sender?: { csName: string; providerNumberId?: string };
  onClose: () => void;
  onAccepted: () => void;
}) {
  const active = useMemo(() => templates.filter((item) => item.isActive), [templates]);
  const recommended = active.find((item) => item.stage === candidate?.stage) ?? active[0];
  const [templateId, setTemplateId] = useState(recommended?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ type: 'error' | 'unknown'; message: string } | null>(null);
  const requestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  useEffect(() => { setTemplateId(recommended?.id ?? ''); setOutcome(null); requestId.current = null; }, [candidate?.conversationId, recommended?.id, open]);
  if (!open || !candidate) return null;
  const currentCandidate = candidate;
  const selected = active.find((item) => item.id === templateId) ?? recommended;
  const ready = Boolean(sender?.providerNumberId && selected);
  const preview = selected ? selected.variables.map((variable) => valueFor(variable, candidate)).join(' · ') : 'Preview belum tersedia.';

  async function submit() {
    if (!selected || !ready || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setOutcome(null);
    requestId.current ??= crypto.randomUUID();
    try {
      await sendTemplate({ conversationId: currentCandidate.conversationId, stage: currentCandidate.stage, templateId: selected.id, requestId: requestId.current });
      requestId.current = null; onAccepted();
    } catch (cause) {
      const error = cause instanceof FollowUpClientError ? cause : null;
      if (error?.code === 'unknown') {
        setOutcome({ type: 'unknown', message: 'Status belum pasti. Periksa KirimDev sebelum mencoba lagi.' });
      } else {
        requestId.current = null;
        setOutcome({ type: 'error', message: error?.message ?? 'Template gagal dikirim.' });
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section role="dialog" aria-modal="true" aria-labelledby="template-dialog-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border bg-background shadow-2xl sm:max-w-xl sm:rounded-2xl">
      <header className="flex items-start justify-between gap-4 border-b p-5"><div><h2 id="template-dialog-title" className="text-lg font-semibold">Konfirmasi kirim template</h2><p className="mt-1 text-sm text-muted-foreground">Pesan dikirim via KirimDev setelah Anda mengonfirmasi.</p></div><button type="button" onClick={onClose} disabled={busy} className="min-h-11 min-w-11 rounded-lg text-xl" aria-label="Tutup">×</button></header>
      <div className="space-y-4 p-5">
        <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Penerima</dt><dd className="mt-1 font-medium">{candidate.customerName}</dd><dd className="text-muted-foreground">{candidate.customerPhone}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nomor pengirim</dt><dd className="mt-1 font-medium">{sender?.csName ?? candidate.csName}</dd><dd className="font-mono text-muted-foreground">{sender?.providerNumberId ?? 'Belum dikonfigurasi'}</dd></div>
        </dl>
        <label className="block text-sm font-medium">Template<select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3" disabled={busy || !active.length}>{active.map((item) => <option key={item.id} value={item.id}>{item.label} · H+{item.stage}</option>)}</select></label>
        <div><p className="text-sm font-medium">Preview pesan</p><div className="mt-2 rounded-xl border bg-muted/30 p-4 text-sm"><p className="font-medium">{selected?.templateName ?? 'Template belum tersedia'}</p><p className="mt-2 text-muted-foreground">{preview}</p></div></div>
        {!ready && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Lengkapi nomor API CS dan template aktif di <a href="/panel/settings?section=follow-up" className="font-semibold underline">Settings</a>.</p>}
        {outcome && <p role="alert" className={`rounded-lg p-3 text-sm ${outcome.type === 'unknown' ? 'bg-amber-50 text-amber-900' : 'bg-destructive/10 text-destructive'}`}>{outcome.message}</p>}
      </div>
      <footer className="flex gap-2 border-t p-4"><Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onClose} disabled={busy}>Batal</Button><Button type="button" className="min-h-11 flex-1" disabled={!ready || busy || outcome?.type === 'unknown'} onClick={submit}>{busy ? 'Mengirim…' : outcome?.type === 'error' ? 'Coba kirim lagi' : 'Kirim template'}</Button></footer>
    </section>
  </div>;
}
