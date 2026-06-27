'use client';

import { Fragment, useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePanelFilters } from '@/components/panel/use-panel-filters';

type Candidate = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  productName: string;
  orderId: string;
  csName: string;
  lastInboundAt: number;
  touchAts: number[]; // [H+1 sentAt, H+2 sentAt, H+2B sentAt] — only the ones already sent
};
type Staged = Candidate & { stage: 1 | 2 | 3 };

type Tab = 'all' | 'stage1' | 'stage2' | 'stage3';

const STAGE_LABEL: Record<1 | 2 | 3, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+2B' };
const STAGE_NAMES = ['H+1', 'H+2', 'H+2B'];

const formatRelativeTime = (ms: number): string => {
  const now = Date.now();
  const diffH = Math.round((now - ms) / 3.6e6);
  if (diffH < 1) return '<1j lalu';
  if (diffH < 24) return `${diffH}j lalu`;
  return `${Math.round(diffH / 24)}h lalu`;
};

// Progress badges: which follow-up touches already went out (manual-via-WABA or API) + when.
function ProgressBadges({ touchAts }: { touchAts: number[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STAGE_NAMES.map((lbl, i) => {
        const done = touchAts.length > i;
        return (
          <span
            key={lbl}
            title={done ? new Date(touchAts[i]).toLocaleString('id-ID') : 'belum dikirim'}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              done ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
            }`}
          >
            {done ? '✓' : '○'}{lbl}
          </span>
        );
      })}
    </div>
  );
}

// Lazy chat preview: only queried when its row is expanded (one conversation at a time), so it adds
// no load to the candidate list. Shows the last few messages so a CS can eyeball whether the lead was
// already followed up (and is genuinely ghosted) before sending — the raw evidence, not a guess.
function ChatPreview({ conversationId }: { conversationId: string }) {
  const msgs = useQuery(api.messages.listMessages, {
    conversationId: conversationId as Id<'conversations'>,
    limit: 6,
  });
  if (msgs === undefined)
    return <div className="px-4 py-3 text-xs text-muted-foreground">Memuat chat…</div>;
  if (msgs.length === 0)
    return <div className="px-4 py-3 text-xs text-muted-foreground">Belum ada pesan.</div>;
  return (
    <div className="space-y-2 bg-muted/30 px-4 py-3">
      {msgs.map((m) => {
        const inbound = m.direction === 'inbound';
        return (
          <div key={m._id} className="text-xs">
            <span className={`font-medium ${inbound ? 'text-foreground' : 'text-blue-600'}`}>
              {inbound ? '← Customer' : '→ CS'}
            </span>
            <span className="ml-2 text-muted-foreground">
              {new Date(m.createdAt).toLocaleString('id-ID', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
            </span>
            <div className="ml-4 whitespace-pre-wrap break-words text-foreground/90">
              {m.content || `[${m.messageType}]`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FollowUpDashboard() {
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs' } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, 'ok' | string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const { cs } = usePanelFilters();
  // CS users see their own; admin sees all CS by default, or narrows via the header filter.
  // (The active pool is bounded by the lifecycle sweep, so the unscoped query stays under the read limit.)
  const csName = me?.role === 'cs' ? me.name : (cs && cs !== 'all' ? cs : undefined);
  const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');

  const isLoading = data === undefined;
  // One unified list tagged with each lead's current stage → powers the "Semua" pipeline view.
  const withStage: Staged[] = [
    ...(data?.stage1 ?? []).map((c) => ({ ...c, stage: 1 as const })),
    ...(data?.stage2 ?? []).map((c) => ({ ...c, stage: 2 as const })),
    ...(data?.stage3 ?? []).map((c) => ({ ...c, stage: 3 as const })),
  ];
  const want = activeTab === 'stage1' ? 1 : activeTab === 'stage2' ? 2 : activeTab === 'stage3' ? 3 : null;
  const candidates = want ? withStage.filter((c) => c.stage === want) : withStage;

  const allIds = candidates.map((c) => c.conversationId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: 'Semua', count: withStage.length },
    { key: 'stage1', label: 'H+1', count: data?.stage1.length ?? 0 },
    { key: 'stage2', label: 'H+2', count: data?.stage2.length ?? 0 },
    { key: 'stage3', label: 'H+2B', count: data?.stage3.length ?? 0 },
  ];

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected((s) => {
        const next = new Set(s);
        allIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((s) => new Set([...s, ...allIds]));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function send(conversationId: string, stage: 1 | 2 | 3) {
    setSending((s) => ({ ...s, [conversationId]: true }));
    const r = await fetch('/api/follow-up/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, stage }),
    })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: 'Gagal' }));
    setSending((s) => ({ ...s, [conversationId]: false }));
    setResult((m) => ({ ...m, [conversationId]: r.ok ? 'ok' : (r.error || 'Gagal') }));
  }

  async function sendSelected() {
    const ids = Array.from(selected);
    if (ids.length > 20 && !window.confirm(`Kirim follow-up ke ${ids.length} customer sekaligus?`)) return;
    // Each lead sends its OWN stage (in the "Semua" tab the selection can span stages).
    const stageById = new Map(withStage.map((c) => [c.conversationId, c.stage]));
    for (const id of ids) {
      const stage = stageById.get(id);
      if (stage) await send(id, stage);
    }
    setSelected(new Set());
  }

  const colSpan = me?.role === 'admin' ? 8 : 7;

  return (
    <div className="space-y-6">
      {/* Tab toggle */}
      <div className="flex flex-wrap gap-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : candidates.length === 0 ? (
        /* Empty state */
        <div className="rounded-lg border border-border bg-card/50 p-8 text-center">
          <div className="text-sm text-muted-foreground">
            Tidak ada yang perlu di-follow-up 🎉
          </div>
        </div>
      ) : (
        /* Table */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                </th>
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium">Produk</th>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Progres FU</th>
                <th className="px-4 py-3 text-left font-medium">Chat Terakhir</th>
                {me?.role === 'admin' && <th className="px-4 py-3 text-left font-medium">CS</th>}
                <th className="px-4 py-3 text-left font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((c) => {
                const rowResult = result[c.conversationId];
                const isSending = sending[c.conversationId];
                return (
                  <Fragment key={c.conversationId}>
                    <tr className="hover:bg-accent/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.conversationId)}
                          onChange={() => toggleSelect(c.conversationId)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{c.customerName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.customerPhone}</div>
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => (e === c.conversationId ? null : c.conversationId))}
                          className="mt-1 text-xs text-blue-600 hover:underline"
                        >
                          {expanded === c.conversationId ? '▲ Tutup chat' : '👁 Lihat chat'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.productName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.orderId}</td>
                      <td className="px-4 py-3"><ProgressBadges touchAts={c.touchAts} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(c.lastInboundAt)}</td>
                      {me?.role === 'admin' && <td className="px-4 py-3 text-muted-foreground">{c.csName}</td>}
                      <td className="px-4 py-3">
                        {rowResult === 'ok' ? (
                          <span className="text-sm font-medium text-green-600">✓ Terkirim</span>
                        ) : rowResult ? (
                          <span className="text-sm font-medium text-red-600">{rowResult}</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSending}
                            onClick={() => send(c.conversationId, c.stage)}
                          >
                            {isSending ? 'Mengirim...' : `Kirim ${STAGE_LABEL[c.stage]}`}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {expanded === c.conversationId && (
                      <tr>
                        <td colSpan={colSpan} className="border-t border-border/50 p-0">
                          <ChatPreview conversationId={c.conversationId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Batch send button */}
      {!isLoading && candidates.length > 0 && selected.size > 0 && (
        <div className="flex justify-end">
          <Button onClick={sendSelected} variant="default" size="lg">
            Kirim terpilih ({selected.size})
          </Button>
        </div>
      )}
    </div>
  );
}
