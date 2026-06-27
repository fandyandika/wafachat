'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePanelFilters } from '@/components/panel/use-panel-filters';

type Candidate = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  productName: string;
  orderId: string;
  csName: string;
  lastInboundAt: number;
  touchAts: number[];
  lastMessageText: string;
};
type Staged = Candidate & { stage: 1 | 2 | 3 };

type Tab = 'all' | 'stage1' | 'stage2' | 'stage3' | 'closing' | 'archived';

type ArchivedRow = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  followUpArchivedAt: number;
};

type ClosedRow = {
  customerName: string;
  customerPhone: string;
  csName: string;
  orderId: string;
  closedAt: number;
  product: string;
  touches: number;
  fromFollowUp: boolean;
};

const STAGE_LABEL: Record<1 | 2 | 3, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+3' };
const STAGE_TEMPLATE_LABELS: Record<1 | 2 | 3, string> = {
  1: 'H+1 · Tindak lanjut pertama',
  2: 'H+2 · Pengingat',
  3: 'H+3 · Penawaran terakhir (penutup)',
};

const formatRelativeTime = (ms: number): string => {
  const now = Date.now();
  const diffH = Math.round((now - ms) / 3.6e6);
  if (diffH < 1) return 'baru';
  if (diffH < 24) return `${diffH} jam`;
  return `${Math.round(diffH / 24)} hari`;
};

// Deterministic, desaturated avatar color per name (subtle variety, not a rainbow).
const AVATAR_COLORS = [
  'bg-rose-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? 'U';
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(name || 'U')}`}>
      {initial}
    </div>
  );
}

// Stage progress: 1 2 3 — filled green when that follow-up touch has gone out.
function ProgressDots({ touchAts }: { touchAts: number[] }) {
  return (
    <div className="flex items-center gap-1" title={`${touchAts.length} follow-up terkirim`}>
      {[1, 2, 3].map((n, i) => {
        const done = touchAts.length > i;
        return (
          <span
            key={n}
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
              done ? 'bg-emerald-500 text-white' : 'border border-border bg-muted text-muted-foreground'
            }`}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

function truncateText(text: string, maxLen = 50): string {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
}

// Minimal checkbox that doesn't open the chat when toggled.
function RowCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={checked}
      aria-label={checked ? 'Batalkan pilih' : 'Pilih'}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-input bg-background text-transparent hover:border-emerald-500'
      }`}
    >
      <span className="text-[11px] font-bold leading-none">✓</span>
    </button>
  );
}

// Chat list item (funnel)
function ChatListItem({
  candidate,
  isSelected,
  selectable,
  isChecked,
  onToggleCheck,
  onClick,
}: {
  candidate: Staged;
  isSelected: boolean;
  selectable: boolean;
  isChecked: boolean;
  onToggleCheck: () => void;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-3 transition-colors hover:bg-accent ${
        isSelected ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''
      }`}
    >
      {selectable && <RowCheck checked={isChecked} onToggle={onToggleCheck} />}
      <Avatar name={candidate.customerName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold text-foreground">{candidate.customerName || candidate.customerPhone || 'Unknown'}</h3>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(candidate.lastInboundAt)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900 dark:text-sky-100">
              {STAGE_LABEL[candidate.stage]}
            </span>
            <span className="truncate text-[11px] text-muted-foreground" title={`CS: ${candidate.csName}`}>
              {candidate.csName?.replace(/^CS\s+/i, '') || '—'}
            </span>
          </div>
          <ProgressDots touchAts={candidate.touchAts} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{truncateText(candidate.lastMessageText)}</p>
      </div>
    </div>
  );
}

// Archived row (manual archive) — info + restore. Not navigable (no chat view).
function ArchivedListItem({
  archived,
  onRestore,
  isRestoring,
}: {
  archived: ArchivedRow;
  onRestore: () => Promise<void>;
  isRestoring: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-3">
      <Avatar name={archived.customerName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold text-foreground">{archived.customerName || archived.customerPhone || 'Unknown'}</h3>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(archived.followUpArchivedAt)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Diarsipkan</span>
          <span className="truncate text-xs text-muted-foreground">{archived.orderId}</span>
        </div>
      </div>
      <Button onClick={onRestore} disabled={isRestoring} variant="ghost" size="sm" className="shrink-0">
        {isRestoring ? 'Pulih…' : 'Pulihkan'}
      </Button>
    </div>
  );
}

// Closing row — where a lead WENT after dropping out of the funnel. Read-only.
function ClosingListItem({ row }: { row: ClosedRow }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-3">
      <Avatar name={row.customerName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold text-foreground">{row.customerName || row.customerPhone || '—'}</h3>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(row.closedAt)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          {row.fromFollowUp ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100">
              ✓ via follow-up{row.touches > 1 ? ` (${row.touches}×)` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">closing langsung</span>
          )}
          <span className="max-w-[45%] truncate text-xs text-muted-foreground">{row.product || row.orderId}</span>
        </div>
      </div>
    </div>
  );
}

// WhatsApp-style message bubble
function MessageBubble({ message }: { message: any }) {
  const isOutbound = message.direction === 'outbound';
  const timeStr = new Date(message.createdAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`mb-2.5 flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
          isOutbound ? 'bg-[#dcf8c6] text-[#111b21]' : 'bg-white text-foreground dark:bg-muted'
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{message.content || `[${message.messageType}]`}</p>
        <p className="mt-1 text-right text-[10px] opacity-60">{timeStr}</p>
      </div>
    </div>
  );
}

// Conversation pane (single lead)
function ConversationPane({ candidate, onBack }: { candidate: Staged | null; onBack?: () => void }) {
  const [selectedStage, setSelectedStage] = useState<1 | 2 | 3>(1);
  const [sending, setSending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useQuery(
    api.messages.listMessages,
    candidate ? { conversationId: candidate.conversationId as Id<'conversations'>, limit: 50 } : 'skip',
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (candidate) setSelectedStage(candidate.stage);
  }, [candidate?.conversationId, candidate?.stage]);

  if (!candidate) {
    return (
      <div className="hidden h-full flex-col items-center justify-center bg-muted/30 md:flex">
        <p className="text-sm text-muted-foreground">Pilih chat di kiri untuk lihat &amp; follow-up</p>
      </div>
    );
  }

  const isStageDone = candidate.touchAts.length > selectedStage - 1;
  const busy = sending || archiving || movingStage;

  async function handleSend() {
    if (!candidate) return;
    setSending(true);
    setStatus(null);
    try {
      const r = await fetch('/api/follow-up/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: candidate.conversationId, stage: selectedStage }),
      }).then((x) => x.json());
      if (r.ok) {
        setStatus({ type: 'ok', message: `Follow-up ${STAGE_LABEL[selectedStage]} terkirim!` });
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus({ type: 'error', message: r.error || 'Gagal mengirim' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Gagal menghubungi server' });
    } finally {
      setSending(false);
    }
  }

  async function handleArchive() {
    if (!candidate) return;
    if (!window.confirm('Arsipkan chat ini? Keluar dari daftar follow-up.')) return;
    setArchiving(true);
    setStatus(null);
    try {
      const r = await fetch('/api/follow-up/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: candidate.conversationId }),
      }).then((x) => x.json());
      if (r.ok) {
        setStatus({ type: 'ok', message: 'Chat diarsipkan!' });
        setTimeout(() => onBack?.(), 800);
      } else {
        setStatus({ type: 'error', message: r.error || 'Gagal mengarsipkan' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Gagal menghubungi server' });
    } finally {
      setArchiving(false);
    }
  }

  async function handleMoveStage(newStage: 1 | 2 | 3) {
    if (!candidate || candidate.stage === newStage) return;
    setMovingStage(true);
    setStatus(null);
    try {
      const r = await fetch('/api/follow-up/set-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: candidate.conversationId, stage: newStage }),
      }).then((x) => x.json());
      if (r.ok) {
        setStatus({ type: 'ok', message: `Dipindah ke ${STAGE_LABEL[newStage]}` });
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus({ type: 'error', message: r.error || 'Gagal memindah tahap' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Gagal menghubungi server' });
    } finally {
      setMovingStage(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 space-y-2.5 border-b border-border bg-card p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 items-center gap-2.5">
            {onBack && (
              <button onClick={onBack} className="text-lg text-muted-foreground hover:text-foreground" aria-label="Kembali">
                ←
              </button>
            )}
            <Avatar name={candidate.customerName} />
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{candidate.customerName || candidate.customerPhone}</h2>
              <p className="truncate text-xs text-muted-foreground">{candidate.customerPhone}</p>
            </div>
          </div>
          <ProgressDots touchAts={candidate.touchAts} />
        </div>
        {/* Manual stage move */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Pindah ke:</span>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleMoveStage(s)}
                disabled={busy}
                title="Geser manual kalau deteksi otomatis kurang pas"
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  candidate.stage === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {STAGE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-muted/20 p-3 md:p-4">
        {messages === undefined ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Memuat…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Belum ada pesan</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg._id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Status */}
      {status && (
        <div
          className={`shrink-0 px-4 py-2 text-sm font-medium ${
            status.type === 'ok'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
          }`}
        >
          {status.message}
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 space-y-2.5 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
        <select
          value={selectedStage}
          onChange={(e) => setSelectedStage(parseInt(e.target.value) as 1 | 2 | 3)}
          disabled={busy}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value={1}>{STAGE_TEMPLATE_LABELS[1]}</option>
          <option value={2}>{STAGE_TEMPLATE_LABELS[2]}</option>
          <option value={3}>{STAGE_TEMPLATE_LABELS[3]}</option>
        </select>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSend}
            disabled={busy || isStageDone}
            className="h-11 flex-1 bg-emerald-600 text-base font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            {sending ? 'Mengirim…' : isStageDone ? `${STAGE_LABEL[selectedStage]} sudah dikirim` : `Kirim ${STAGE_LABEL[selectedStage]}`}
          </Button>
          <Button onClick={handleArchive} disabled={busy} variant="outline" className="h-11 px-4">
            {archiving ? '…' : 'Arsip'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Main dashboard
export function FollowUpDashboard() {
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs' } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showConvOnMobile, setShowConvOnMobile] = useState(false);
  const [sortBy, setSortBy] = useState<'oldest' | 'newest'>('oldest');
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [togglingAutoSend, setTogglingAutoSend] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; action: string } | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  // CS filter lives INSIDE the dashboard (local state) so changing it always re-runs the queries —
  // the shared header's URL-based filter wasn't reaching this page reliably. Seeded from ?cs= once.
  const { cs } = usePanelFilters();
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const isCs = me?.role === 'cs';
  const [csFilter, setCsFilter] = useState<string>(cs && cs !== 'all' ? cs : 'all');
  const csName = isCs ? me!.name : csFilter !== 'all' ? csFilter : undefined;

  const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');
  const archivedData = useQuery(api.followUp.getArchivedFollowUps, me && activeTab === 'archived' ? { csName } : 'skip');
  const closingData = useQuery(api.followUp.getClosedFollowUps, me && activeTab === 'closing' ? { csName, sinceDays: 7 } : 'skip');
  const autoFollowUpData = useQuery(api.followUp.getAutoFollowUp, me && csName ? { csName } : 'skip');

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const kpiData = useQuery(api.followUp.getFollowUpEffectiveness, me ? { startAt: thirtyDaysAgo, endAt: now, csName } : 'skip');

  useEffect(() => {
    if (autoFollowUpData && typeof autoFollowUpData === 'object' && 'enabled' in autoFollowUpData) {
      setAutoSendEnabled(autoFollowUpData.enabled);
    }
  }, [autoFollowUpData]);

  const isLoading =
    activeTab === 'archived'
      ? archivedData === undefined
      : activeTab === 'closing'
        ? closingData === undefined
        : data === undefined;

  const withStage: Staged[] = [
    ...(data?.stage1 ?? []).map((c) => ({ ...c, stage: 1 as const })),
    ...(data?.stage2 ?? []).map((c) => ({ ...c, stage: 2 as const })),
    ...(data?.stage3 ?? []).map((c) => ({ ...c, stage: 3 as const })),
  ];
  const stageById = new Map(withStage.map((c) => [c.conversationId, c.stage]));

  const q = searchQuery.trim().toLowerCase();
  const matchesSearch = (name: string, phone: string) =>
    !q || name.toLowerCase().includes(q) || phone.includes(q);

  const selectable = activeTab === 'all' || activeTab === 'stage1' || activeTab === 'stage2' || activeTab === 'stage3';

  // Active funnel list for the current tab
  const wantStage = activeTab === 'stage1' ? 1 : activeTab === 'stage2' ? 2 : activeTab === 'stage3' ? 3 : null;
  const activeList: Staged[] = withStage
    .filter((c) => (wantStage ? c.stage === wantStage : true))
    .filter((c) => matchesSearch(c.customerName, c.customerPhone))
    .sort((a, b) => (sortBy === 'oldest' ? a.lastInboundAt - b.lastInboundAt : b.lastInboundAt - a.lastInboundAt));

  const archivedList: ArchivedRow[] = (archivedData ?? [])
    .filter((c) => matchesSearch(c.customerName, c.customerPhone))
    .sort((a, b) => (sortBy === 'oldest' ? a.followUpArchivedAt - b.followUpArchivedAt : b.followUpArchivedAt - a.followUpArchivedAt));

  const closingList: ClosedRow[] = (closingData ?? [])
    .filter((c) => matchesSearch(c.customerName, c.customerPhone))
    .sort((a, b) => (sortBy === 'oldest' ? a.closedAt - b.closedAt : b.closedAt - a.closedAt));

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: 'Semua', count: withStage.length },
    { key: 'stage1', label: 'H+1', count: data?.stage1.length ?? 0 },
    { key: 'stage2', label: 'H+2', count: data?.stage2.length ?? 0 },
    { key: 'stage3', label: 'H+3', count: data?.stage3.length ?? 0 },
    { key: 'closing', label: 'Closing', count: closingData?.length ?? 0 },
    { key: 'archived', label: 'Arsip', count: archivedData?.length ?? 0 },
  ];

  const selected = selectable ? activeList.find((c) => c.conversationId === selectedId) ?? null : null;

  const switchTab = (key: Tab) => {
    setActiveTab(key);
    setSelectedId(null);
    setSelectedIds(new Set());
  };

  const handleBack = () => {
    setShowConvOnMobile(false);
    setSelectedId(null);
  };

  const toggleCheck = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleChecked = activeList.length > 0 && activeList.every((c) => selectedIds.has(c.conversationId));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) activeList.forEach((c) => next.delete(c.conversationId));
      else activeList.forEach((c) => next.add(c.conversationId));
      return next;
    });
  };

  async function runBulk(action: 'kirim' | 'arsip') {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;
    const verb = action === 'kirim' ? 'Kirim follow-up ke' : 'Arsipkan';
    if (ids.length > 20 && !window.confirm(`${verb} ${ids.length} lead sekaligus?`)) return;
    setBulkBusy(true);
    setBulkStatus(null);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < ids.length; i++) {
      setBulkProgress({ done: i, total: ids.length, action });
      try {
        const r =
          action === 'kirim'
            ? await fetch('/api/follow-up/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: ids[i], stage: stageById.get(ids[i]) ?? 1 }),
              }).then((x) => x.json())
            : await fetch('/api/follow-up/archive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: ids[i] }),
              }).then((x) => x.json());
        if (r.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBulkProgress(null);
    setBulkBusy(false);
    setSelectedIds(new Set());
    setBulkStatus(`${action === 'kirim' ? 'Kirim massal' : 'Arsip massal'}: ${ok} berhasil${fail ? `, ${fail} gagal` : ''}.`);
    setTimeout(() => setBulkStatus(null), 5000);
  }

  async function handleAutoSendToggle(newState: boolean) {
    if (!csName) return;
    setTogglingAutoSend(true);
    try {
      const r = await fetch('/api/follow-up/auto-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csName, enabled: newState }),
      }).then((x) => x.json());
      if (r.ok) setAutoSendEnabled(newState);
    } catch (e) {
      console.error('Failed to toggle auto-send:', e);
    } finally {
      setTogglingAutoSend(false);
    }
  }

  async function handleRestoreArchived(conversationId: string) {
    setRestoringId(conversationId);
    try {
      const r = await fetch('/api/follow-up/unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).then((x) => x.json());
      if (r.ok) setSelectedId(null);
    } catch (e) {
      console.error('Failed to restore:', e);
    } finally {
      setRestoringId(null);
    }
  }

  const kpiPct =
    kpiData && typeof kpiData === 'object' && 'totalClosings' in kpiData && kpiData.totalClosings > 0
      ? Math.round((kpiData.fromFollowUp / kpiData.totalClosings) * 100)
      : 0;

  return (
    // Height tuned to sit below the (now lean) panel header and above the mobile bottom-nav; nudge if needed.
    <div className="flex h-[calc(100dvh-10rem)] min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm md:h-[calc(100dvh-6.5rem)]">
      {/* KPI strip */}
      {kpiData && typeof kpiData === 'object' && 'totalClosings' in kpiData && (
        <div className="shrink-0 border-b border-border bg-gradient-to-r from-emerald-50 to-transparent px-4 py-2.5 dark:from-emerald-950/30">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Efektivitas 30 hari</span>
            <span className="text-foreground">
              <strong>{kpiData.totalClosings}</strong> closing
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {kpiData.fromFollowUp} dari follow-up ({kpiPct}%)
            </span>
            <span className="text-xs text-muted-foreground">
              H+1 {kpiData.byStage.h1} · H+2 {kpiData.byStage.h2} · H+3 {kpiData.byStage.h3}
            </span>
          </div>
        </div>
      )}

      {/* Header: CS label + auto-send, tabs, search/sort */}
      <div className="shrink-0 space-y-2.5 border-b border-border bg-card p-3 md:p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Auto-send with an explicit, high-contrast ON/OFF state */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Auto-send</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                !csName ? 'bg-muted text-muted-foreground' : autoSendEnabled ? 'bg-emerald-600 text-white' : 'bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
              }`}
            >
              {!csName ? '—' : autoSendEnabled ? 'ON' : 'OFF'}
            </span>
            <Switch
              checked={autoSendEnabled}
              onCheckedChange={handleAutoSendToggle}
              disabled={!csName || togglingAutoSend}
              title={!csName ? 'Pilih satu CS dulu' : 'Auto-send 08–14 WIB'}
            />
          </div>
          {/* CS filter — top-right; local state so it always re-filters */}
          {!isCs ? (
            <select
              value={csFilter}
              onChange={(e) => {
                setCsFilter(e.target.value);
                setSelectedId(null);
                setSelectedIds(new Set());
              }}
              title="Filter per CS"
              className="max-w-[55%] shrink-0 rounded-lg border border-input bg-background px-2 py-1.5 text-sm font-medium text-foreground"
            >
              <option value="all">Semua CS</option>
              {csList.map((c) => (
                <option key={c.key} value={c.csName}>
                  {c.csName.replace(/^CS\s+/i, '')}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">
              CS: <strong className="text-foreground">{me?.name}</strong>
            </span>
          )}
        </div>

        {/* Tabs — horizontally scrollable on mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === t.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Cari nama atau nomor…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedId(null);
            }}
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'oldest' | 'newest')}
            title="Urutkan"
            className="rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground"
          >
            <option value="oldest">Paling lama</option>
            <option value="newest">Paling baru</option>
          </select>
        </div>
      </div>

      {/* Bulk status banner */}
      {bulkStatus && (
        <div className="shrink-0 bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">
          {bulkStatus}
        </div>
      )}

      {/* Two-pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* List pane */}
        <div className={`flex w-full flex-col border-r border-border bg-background md:w-96 ${showConvOnMobile ? 'hidden md:flex' : 'flex'}`}>
          {/* Select-all toolbar */}
          {selectable && !isLoading && activeList.length > 0 && (
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-muted/30 px-3 py-2">
              <RowCheck checked={allVisibleChecked} onToggle={toggleSelectAll} />
              <span className="text-xs text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} dipilih` : `Pilih semua (${activeList.length})`}
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : activeTab === 'archived' ? (
              archivedList.length === 0 ? (
                <EmptyState text="Belum ada yang diarsipkan" />
              ) : (
                archivedList.map((c) => (
                  <ArchivedListItem
                    key={c.conversationId}
                    archived={c}
                    onRestore={() => handleRestoreArchived(c.conversationId)}
                    isRestoring={restoringId === c.conversationId}
                  />
                ))
              )
            ) : activeTab === 'closing' ? (
              closingList.length === 0 ? (
                <EmptyState text="Belum ada closing 7 hari terakhir" />
              ) : (
                closingList.map((c, i) => <ClosingListItem key={`${c.orderId}-${c.customerPhone}-${i}`} row={c} />)
              )
            ) : activeList.length === 0 ? (
              <EmptyState text="Tidak ada yang perlu di-follow-up" />
            ) : (
              activeList.map((c) => (
                <ChatListItem
                  key={c.conversationId}
                  candidate={c}
                  isSelected={selectedId === c.conversationId}
                  selectable={selectable}
                  isChecked={selectedIds.has(c.conversationId)}
                  onToggleCheck={() => toggleCheck(c.conversationId)}
                  onClick={() => {
                    setSelectedId(c.conversationId);
                    setShowConvOnMobile(true);
                  }}
                />
              ))
            )}
          </div>

          {/* Bulk action bar */}
          {selectable && selectedIds.size > 0 && (
            <div className="shrink-0 space-y-2 border-t border-border bg-card p-3">
              {bulkProgress ? (
                <p className="text-center text-xs text-muted-foreground">
                  {bulkProgress.action === 'kirim' ? 'Mengirim' : 'Mengarsip'} {bulkProgress.done + 1}/{bulkProgress.total}…
                </p>
              ) : (
                <p className="text-xs font-medium text-foreground">{selectedIds.size} lead dipilih</p>
              )}
              <div className="flex gap-2">
                <Button onClick={() => runBulk('kirim')} disabled={bulkBusy} className="h-10 flex-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700">
                  Kirim massal
                </Button>
                <Button onClick={() => runBulk('arsip')} disabled={bulkBusy} variant="outline" className="h-10">
                  Arsip massal
                </Button>
                <Button onClick={() => setSelectedIds(new Set())} disabled={bulkBusy} variant="ghost" className="h-10">
                  Batal
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Conversation pane */}
        <div className={`flex-1 ${showConvOnMobile ? 'block' : 'hidden md:block'}`}>
          {selected ? <ConversationPane candidate={selected} onBack={handleBack} /> : <ConversationPane candidate={null} />}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground">✓</div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
