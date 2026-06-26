'use client';

import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Candidate = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  productName: string;
  orderId: string;
  csName: string;
  lastInboundAt: number;
};

type Tab = 'stage1' | 'stage2';

const formatRelativeTime = (ms: number): string => {
  const now = Date.now();
  const diffMs = now - ms;
  const diffH = Math.round(diffMs / 3.6e6);
  if (diffH < 1) return '<1h lalu';
  if (diffH < 24) return `${diffH}h lalu`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d lalu`;
};

export function FollowUpDashboard() {
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs' } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('stage1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, 'ok' | string>>({});

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const csName = me?.role === 'cs' ? me.name : undefined;
  const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');

  const isLoading = data === undefined;
  const candidates = activeTab === 'stage1' ? (data?.stage1 ?? []) : (data?.stage2 ?? []);
  const allIds = candidates.map((c) => c.conversationId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

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

  async function send(conversationId: string, stage: 1 | 2) {
    setSending((s) => ({ ...s, [conversationId]: true }));
    const r = await fetch('/api/follow-up/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, stage }),
    })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: 'Gagal' }));
    setSending((s) => ({ ...s, [conversationId]: false }));
    setResult((m) => ({
      ...m,
      [conversationId]: r.ok ? 'ok' : (r.error || 'Gagal'),
    }));
  }

  async function sendSelected() {
    const ids = Array.from(selected);
    if (ids.length > 20) {
      const confirmed = window.confirm(
        `Kirim follow-up ke ${ids.length} customer sekaligus?`,
      );
      if (!confirmed) return;
    }
    for (const id of ids) {
      const stage = activeTab === 'stage1' ? 1 : 2;
      await send(id, stage);
    }
    setSelected(new Set());
  }

  const stage1Count = data?.stage1.length ?? 0;
  const stage2Count = data?.stage2.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Tab toggle */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setActiveTab('stage1')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'stage1'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          H+1 ({stage1Count})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('stage2')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'stage2'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          H+2 ({stage2Count})
        </button>
      </div>

      {/* Loading state */}
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
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium">Produk</th>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Chat Terakhir</th>
                {me?.role === 'admin' && (
                  <th className="px-4 py-3 text-left font-medium">CS</th>
                )}
                <th className="px-4 py-3 text-left font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((c) => {
                const rowResult = result[c.conversationId];
                const isSending = sending[c.conversationId];
                const stage = activeTab === 'stage1' ? 1 : 2;
                return (
                  <tr key={c.conversationId} className="hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.conversationId)}
                        onChange={() => toggleSelect(c.conversationId)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {c.customerName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.customerPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.productName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.orderId}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeTime(c.lastInboundAt)}
                    </td>
                    {me?.role === 'admin' && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.csName}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {rowResult === 'ok' ? (
                        <span className="text-sm font-medium text-green-600">
                          ✓ Terkirim
                        </span>
                      ) : rowResult ? (
                        <span className="text-sm font-medium text-red-600">
                          {rowResult}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSending}
                          onClick={() => send(c.conversationId, stage)}
                        >
                          {isSending ? 'Mengirim...' : 'Kirim'}
                        </Button>
                      )}
                    </td>
                  </tr>
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
