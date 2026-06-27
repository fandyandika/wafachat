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

type Tab = 'all' | 'stage1' | 'stage2' | 'stage3' | 'archived';

type ArchivedRow = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  followUpArchivedAt: number;
};

const STAGE_LABEL: Record<1 | 2 | 3, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+3' };
const STAGE_NAMES = ['H+1', 'H+2', 'H+3'];
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

// Avatar with customer initial
function Avatar({ name }: { name: string }) {
  const initial = name?.[0]?.toUpperCase() ?? 'U';
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white text-sm font-medium">
      {initial}
    </div>
  );
}

// Progress dots: v = done, o = pending
function ProgressDots({ touchAts }: { touchAts: number[] }) {
  return (
    <div className="flex gap-1">
      {STAGE_NAMES.map((_, i) => (
        <span key={i} className={`text-xs font-bold ${touchAts.length > i ? 'text-green-600' : 'text-gray-400'}`}>
          {touchAts.length > i ? 'v' : 'o'}
        </span>
      ))}
    </div>
  );
}

// Truncate message preview
function truncateText(text: string, maxLen: number = 50): string {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

// Chat list item
function ChatListItem({
  candidate,
  isSelected,
  onClick,
}: {
  candidate: Staged;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer gap-3 border-b border-border p-3 transition-colors hover:bg-accent ${
        isSelected ? 'bg-blue-50 dark:bg-blue-950' : ''
      }`}
    >
      <Avatar name={candidate.customerName} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-foreground truncate">{candidate.customerName || 'Unknown'}</h3>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeTime(candidate.lastInboundAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 px-2 py-0.5 rounded">
            {STAGE_LABEL[candidate.stage]}
          </span>
          <ProgressDots touchAts={candidate.touchAts} />
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">{truncateText(candidate.lastMessageText)}</p>
      </div>
    </div>
  );
}

// Feature #2: Archived list item with restore button
function ArchivedListItem({
  archived,
  isSelected,
  onClick,
  onRestore,
  isRestoring,
}: {
  archived: ArchivedRow;
  isSelected: boolean;
  onClick: () => void;
  onRestore: () => Promise<void>;
  isRestoring: boolean;
}) {
  return (
    <div
      className={`flex cursor-pointer gap-3 border-b border-border p-3 transition-colors hover:bg-accent ${
        isSelected ? 'bg-blue-50 dark:bg-blue-950' : ''
      }`}
    >
      <Avatar name={archived.customerName} />
      <div className="flex-1 min-w-0" onClick={onClick}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-foreground truncate">{archived.customerName || 'Unknown'}</h3>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(archived.followUpArchivedAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-xs bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">
            Diarsipkan
          </span>
          <span className="text-xs text-muted-foreground">{archived.orderId}</span>
        </div>
      </div>
      <Button
        onClick={(e) => {
          e.stopPropagation();
          onRestore();
        }}
        disabled={isRestoring}
        variant="ghost"
        size="sm"
        className="shrink-0"
      >
        {isRestoring ? 'Pulih...' : 'Pulihkan'}
      </Button>
    </div>
  );
}

// WhatsApp-style message bubble
function MessageBubble({ message }: { message: any }) {
  const isOutbound = message.direction === 'outbound';
  const timeStr = new Date(message.createdAt).toLocaleString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex mb-3 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-xs px-4 py-2 rounded-2xl ${
          isOutbound
            ? 'bg-[#dcf8c6] text-[#111b21]'
            : 'bg-white dark:bg-muted text-foreground'
        }`}
      >
        <p className="break-words whitespace-pre-wrap text-sm">{message.content || `[${message.messageType}]`}</p>
        <p className="text-xs mt-1 opacity-70">{timeStr}</p>
      </div>
    </div>
  );
}

// Conversation pane
function ConversationPane({
  candidate,
  onBack,
}: {
  candidate: Staged | null;
  onBack?: () => void;
}) {
  const [selectedStage, setSelectedStage] = useState<1 | 2 | 3>(1);
  const [sending, setSending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useQuery(
    api.messages.listMessages,
    candidate ? { conversationId: candidate.conversationId as Id<'conversations'>, limit: 50 } : 'skip'
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Default the template picker to the lead's CURRENT stage (the next touch due) when it changes.
  useEffect(() => {
    if (candidate) setSelectedStage(candidate.stage);
  }, [candidate?.conversationId, candidate?.stage]);

  if (!candidate) {
    return (
      <div className="hidden md:flex flex-col items-center justify-center h-full bg-muted/30">
        <p className="text-muted-foreground">Pilih chat di kiri untuk lihat & follow-up</p>
      </div>
    );
  }

  const isStageDone = candidate.touchAts.length > (selectedStage - 1);

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
        setTimeout(() => {
          setStatus(null);
        }, 2000);
      } else {
        setStatus({ type: 'error', message: r.error || 'Gagal mengirim' });
      }
    } catch (e) {
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
        setTimeout(() => {
          onBack?.();
        }, 1000);
      } else {
        setStatus({ type: 'error', message: r.error || 'Gagal mengarsipkan' });
      }
    } catch (e) {
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
    } catch (e) {
      setStatus({ type: 'error', message: 'Gagal menghubungi server' });
    } finally {
      setMovingStage(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-4 bg-card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1">
            {onBack && (
              <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
                ←
              </button>
            )}
            <div>
              <h2 className="font-bold text-foreground">{candidate.customerName}</h2>
              <p className="text-xs text-muted-foreground">{candidate.customerPhone}</p>
            </div>
          </div>
          <ProgressDots touchAts={candidate.touchAts} />
        </div>
        {/* Feature #8: Move stage control */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Pindah ke:</span>
          <div className="flex gap-1">
            {(([1, 2, 3] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleMoveStage(s)}
                disabled={movingStage || sending || archiving}
                title="Geser manual kalau deteksi otomatis kurang pas"
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  candidate.stage === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {STAGE_LABEL[s]}
              </button>
            )))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages === undefined ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Memuat...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Belum ada pesan</p>
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

      {/* Status message */}
      {status && (
        <div className={`px-4 py-2 text-sm font-medium ${
          status.type === 'ok'
            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
        }`}>
          {status.message}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-4 bg-card space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Template:</label>
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(parseInt(e.target.value) as 1 | 2 | 3)}
            disabled={sending || archiving || movingStage}
            className="flex-1 px-3 py-2 rounded border border-input bg-background text-foreground text-sm"
          >
            <option value={1}>{STAGE_TEMPLATE_LABELS[1]}</option>
            <option value={2}>{STAGE_TEMPLATE_LABELS[2]}</option>
            <option value={3}>{STAGE_TEMPLATE_LABELS[3]}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSend}
            disabled={sending || archiving || movingStage || isStageDone}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            size="sm"
          >
            {sending ? 'Mengirim...' : 'Kirim'}
          </Button>
          <Button
            onClick={handleArchive}
            disabled={sending || archiving || movingStage}
            variant="outline"
            size="sm"
          >
            {archiving ? 'Mengarsip...' : 'Arsip'}
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
  const [sortBy, setSortBy] = useState<'oldest' | 'newest'>('oldest'); // by day: most overdue first (default)
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [togglingAutoSend, setTogglingAutoSend] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const { cs } = usePanelFilters();
  const csName = me?.role === 'cs' ? me.name : (cs && cs !== 'all' ? cs : undefined);
  const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');

  // Feature #2: Load archived follow-ups when Arsip tab is active
  const archivedData = useQuery(
    api.followUp.getArchivedFollowUps,
    me && activeTab === 'archived' ? { csName } : 'skip'
  );

  // Feature #5b: Load auto-send status
  const autoFollowUpData = useQuery(
    api.followUp.getAutoFollowUp,
    me && csName ? { csName } : 'skip'
  );

  // Feature #10: Load KPI effectiveness
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const kpiData = useQuery(
    api.followUp.getFollowUpEffectiveness,
    me ? { startAt: thirtyDaysAgo, endAt: now, csName } : 'skip'
  );

  // Sync auto-send state
  useEffect(() => {
    if (autoFollowUpData && typeof autoFollowUpData === 'object' && 'enabled' in autoFollowUpData) {
      setAutoSendEnabled(autoFollowUpData.enabled);
    }
  }, [autoFollowUpData]);

  const isLoading = data === undefined || (activeTab === 'archived' && archivedData === undefined);

  const withStage: Staged[] = [
    ...(data?.stage1 ?? []).map((c) => ({ ...c, stage: 1 as const })),
    ...(data?.stage2 ?? []).map((c) => ({ ...c, stage: 2 as const })),
    ...(data?.stage3 ?? []).map((c) => ({ ...c, stage: 3 as const })),
  ];

  // Feature #2: Handle Arsip tab separately
  let candidates: (Staged | ArchivedRow)[] = [];
  if (activeTab === 'archived') {
    candidates = archivedData ?? [];
  } else {
    const want = activeTab === 'stage1' ? 1 : activeTab === 'stage2' ? 2 : activeTab === 'stage3' ? 3 : null;
    candidates = want ? withStage.filter((c) => c.stage === want) : withStage;
  }

  // Client-side search by name or phone
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    candidates = candidates.filter(
      (c) => c.customerName.toLowerCase().includes(q) || c.customerPhone.includes(q)
    );
  }

  // Sort by day: most overdue first (oldest last-chat) by default, or newest first.
  // For archived, sort by followUpArchivedAt; for active, by lastInboundAt
  candidates = [...candidates].sort((a, b) => {
    const timeA = 'followUpArchivedAt' in a ? a.followUpArchivedAt : a.lastInboundAt;
    const timeB = 'followUpArchivedAt' in b ? b.followUpArchivedAt : b.lastInboundAt;
    return sortBy === 'oldest' ? timeA - timeB : timeB - timeA;
  });

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: 'Semua', count: withStage.length },
    { key: 'stage1', label: 'H+1', count: data?.stage1.length ?? 0 },
    { key: 'stage2', label: 'H+2', count: data?.stage2.length ?? 0 },
    { key: 'stage3', label: 'H+3', count: data?.stage3.length ?? 0 },
    { key: 'archived', label: 'Arsip', count: archivedData?.length ?? 0 },
  ];

  const selected =
    activeTab === 'archived'
      ? (candidates as ArchivedRow[]).find((c) => c.conversationId === selectedId) || null
      : (candidates as Staged[]).find((c) => c.conversationId === selectedId) || null;

  const handleBack = () => {
    setShowConvOnMobile(false);
    setSelectedId(null);
  };

  // Feature #5b: Handle auto-send toggle
  async function handleAutoSendToggle(newState: boolean) {
    if (!csName) return;
    setTogglingAutoSend(true);
    try {
      const r = await fetch('/api/follow-up/auto-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csName, enabled: newState }),
      }).then((x) => x.json());

      if (r.ok) {
        setAutoSendEnabled(newState);
      }
    } catch (e) {
      console.error('Failed to toggle auto-send:', e);
    } finally {
      setTogglingAutoSend(false);
    }
  }

  // Feature #2: Handle restore from archive
  async function handleRestoreArchived(conversationId: string) {
    setRestoringId(conversationId);
    try {
      const r = await fetch('/api/follow-up/unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).then((x) => x.json());

      if (r.ok) {
        // The conversation will reappear in the funnel via Convex reactivity
        setSelectedId(null);
      }
    } catch (e) {
      console.error('Failed to restore:', e);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* KPI strip - Feature #10 */}
      {kpiData && typeof kpiData === 'object' && 'totalClosings' in kpiData && (
        <div className="border-b border-border px-4 py-2 bg-muted/40 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>
              30 hari: <strong>{kpiData.totalClosings}</strong> closing ·{' '}
              <strong>{kpiData.fromFollowUp}</strong> dari follow-up ({kpiData.totalClosings > 0 ? Math.round((kpiData.fromFollowUp / kpiData.totalClosings) * 100) : 0}%) — H+1: {kpiData.byStage.h1} ·
              H+2: {kpiData.byStage.h2} · H+3: {kpiData.byStage.h3}
            </span>
          </div>
        </div>
      )}

      {/* Header with tabs and controls */}
      <div className="border-b border-border p-4 bg-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 flex-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setActiveTab(t.key);
                  setSelectedId(null);
                }}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          {/* Feature #5b: Auto-send toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs font-medium text-muted-foreground">Auto-send:</label>
            <Switch
              checked={autoSendEnabled}
              onCheckedChange={handleAutoSendToggle}
              disabled={!csName || togglingAutoSend}
              title={!csName ? 'Pilih CS dulu' : 'Toggle auto-send 08-14 WIB'}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Cari nama atau nomor..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedId(null);
            }}
            className="flex-1 px-3 py-2 rounded border border-input bg-background text-foreground text-sm placeholder-muted-foreground"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'oldest' | 'newest')}
            title="Urutkan berdasarkan lama ghosting"
            className="px-2 py-2 rounded border border-input bg-background text-foreground text-sm"
          >
            <option value="oldest">Paling lama</option>
            <option value="newest">Paling baru</option>
          </select>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat list pane */}
        <div
          className={`w-full md:w-96 border-r border-border overflow-y-auto bg-background ${
            showConvOnMobile ? 'hidden md:block' : ''
          }`}
        >
          {isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {activeTab === 'archived' ? 'Belum ada yang diarsipkan' : 'Tidak ada yang perlu di-follow-up'}
            </div>
          ) : activeTab === 'archived' ? (
            (candidates as ArchivedRow[]).map((c) => (
              <ArchivedListItem
                key={c.conversationId}
                archived={c}
                isSelected={selectedId === c.conversationId}
                onClick={() => {
                  setSelectedId(c.conversationId);
                  setShowConvOnMobile(true);
                }}
                onRestore={() => handleRestoreArchived(c.conversationId)}
                isRestoring={restoringId === c.conversationId}
              />
            ))
          ) : (
            (candidates as Staged[]).map((c) => (
              <ChatListItem
                key={c.conversationId}
                candidate={c}
                isSelected={selectedId === c.conversationId}
                onClick={() => {
                  setSelectedId(c.conversationId);
                  setShowConvOnMobile(true);
                }}
              />
            ))
          )}
        </div>

        {/* Conversation pane */}
        <div
          className={`flex-1 ${
            showConvOnMobile ? 'block' : 'hidden md:block'
          }`}
        >
          {selected && activeTab !== 'archived' ? (
            <ConversationPane
              candidate={selected as Staged}
              onBack={handleBack}
            />
          ) : (
            <ConversationPane candidate={null} />
          )}
        </div>
      </div>
    </div>
  );
}
