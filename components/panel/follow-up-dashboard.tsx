'use client';

import { useEffect, useState, useRef } from 'react';
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
  touchAts: number[];
  lastMessageText: string;
};
type Staged = Candidate & { stage: 1 | 2 | 3 };

type Tab = 'all' | 'stage1' | 'stage2' | 'stage3';

const STAGE_LABEL: Record<1 | 2 | 3, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+3' };
const STAGE_NAMES = ['H+1', 'H+2', 'H+3'];

const formatRelativeTime = (ms: number): string => {
  const now = Date.now();
  const diffH = Math.round((now - ms) / 3.6e6);
  if (diffH < 1) return '<1j';
  if (diffH < 24) return `${diffH}j`;
  return `${Math.round(diffH / 24)}h`;
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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-4 bg-card">
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
            disabled={sending || archiving}
            className="flex-1 px-3 py-2 rounded border border-input bg-background text-foreground text-sm"
          >
            <option value={1}>H+1</option>
            <option value={2}>H+2</option>
            <option value={3}>H+3</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSend}
            disabled={sending || archiving || isStageDone}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            size="sm"
          >
            {sending ? 'Mengirim...' : 'Kirim'}
          </Button>
          <Button
            onClick={handleArchive}
            disabled={sending || archiving}
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

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const { cs } = usePanelFilters();
  const csName = me?.role === 'cs' ? me.name : (cs && cs !== 'all' ? cs : undefined);
  const data = useQuery(api.followUp.getFollowUpCandidates, me ? { csName } : 'skip');

  const isLoading = data === undefined;

  const withStage: Staged[] = [
    ...(data?.stage1 ?? []).map((c) => ({ ...c, stage: 1 as const })),
    ...(data?.stage2 ?? []).map((c) => ({ ...c, stage: 2 as const })),
    ...(data?.stage3 ?? []).map((c) => ({ ...c, stage: 3 as const })),
  ];

  const want = activeTab === 'stage1' ? 1 : activeTab === 'stage2' ? 2 : activeTab === 'stage3' ? 3 : null;
  let candidates = want ? withStage.filter((c) => c.stage === want) : withStage;

  // Client-side search by name or phone
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    candidates = candidates.filter(
      (c) => c.customerName.toLowerCase().includes(q) || c.customerPhone.includes(q)
    );
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: 'Semua', count: withStage.length },
    { key: 'stage1', label: 'H+1', count: data?.stage1.length ?? 0 },
    { key: 'stage2', label: 'H+2', count: data?.stage2.length ?? 0 },
    { key: 'stage3', label: 'H+3', count: data?.stage3.length ?? 0 },
  ];

  const selected = candidates.find((c) => c.conversationId === selectedId) || null;

  const handleBack = () => {
    setShowConvOnMobile(false);
    setSelectedId(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header with tabs */}
      <div className="border-b border-border p-4 bg-card space-y-3">
        <div className="flex flex-wrap gap-2">
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
        <input
          type="text"
          placeholder="Cari nama atau nomor..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedId(null);
          }}
          className="w-full px-3 py-2 rounded border border-input bg-background text-foreground text-sm placeholder-muted-foreground"
        />
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
              Tidak ada yang perlu di-follow-up
            </div>
          ) : (
            candidates.map((c) => (
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
          {selected ? (
            <ConversationPane
              candidate={selected}
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
