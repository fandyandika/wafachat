'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { BotOff, Loader2, Bot } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Conversation, QueueKey } from '@/components/panel/types';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { ConversationPanel, ConversationDetailSheet, ConfirmDeleteDialog } from '@/components/panel/conversation-panel';

export default function CsAiPage() {
  const { startAt, endAt, csName } = usePanelFilters();

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<QueueKey>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [globalAiConfirmOpen, setGlobalAiConfirmOpen] = useState(false);
  const [optimisticGlobal, setOptimisticGlobal] = useState<boolean | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const conversationsData = useQuery(api.state.listConversations, { includeClosed: true, csName });
  const globalEnabledData = useQuery(api.settings.getGlobalAiEnabled, {});
  const summaryData = useQuery(api.metrics.getDashboardSummary, {
    startAt,
    endAt,
    csName,
  });

  const setConversationStatus = useMutation(api.state.setConversationStatusFromN8n);
  const markNotClosing = useMutation(api.state.markConversationNotClosing);
  const markClosing = useMutation(api.state.markConversationClosing);
  const markCancelled = useMutation(api.state.markConversationCancelled);
  const undoCancelled = useMutation(api.state.undoConversationCancelled);
  const deleteOrder = useMutation(api.state.deleteConversationOrder);
  const setGlobalAiEnabled = useMutation(api.settings.setGlobalAiEnabled);
  const createPanelClosingRecap = useMutation(api.shippingRecaps.createFromPanelClosing);

  const conversations = (conversationsData ?? []) as Conversation[];
  const globalEnabled = globalEnabledData !== false;
  const loading = conversationsData === undefined || globalEnabledData === undefined;

  const displayGlobalEnabled = optimisticGlobal !== null ? optimisticGlobal : globalEnabled;

  const active = conversations.filter((conversation) => conversation.status === 'active');
  const handover = conversations.filter((conversation) => conversation.status === 'handover' && conversation.aiEnabled !== false);
  const closed = conversations.filter((conversation) => conversation.status === 'closed');

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const rowsByQueue = {
    active,
    handover,
    closed,
    all: conversations,
  };

  const visibleRows = rowsByQueue[selectedQueue].filter((conversation) => {
    if (!normalizedSearch) return true;
    return [
      conversation.customerName,
      conversation.phone,
      conversation.order_id,
      conversation.productName,
      conversation.products,
      conversation.note,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });

  const queueItems: Array<{ key: QueueKey; label: string; count: number }> = [
    { key: 'active', label: 'Active', count: active.length },
    { key: 'handover', label: 'Handover', count: handover.length },
    { key: 'closed', label: 'Archived Today', count: closed.length },
    { key: 'all', label: 'All', count: conversations.length },
  ];

  const handleGlobalAiToggle = () => {
    if (displayGlobalEnabled) {
      setGlobalAiConfirmOpen(true);
    } else {
      void doToggleGlobal(true);
    }
  };

  const doToggleGlobal = async (next: boolean) => {
    setOptimisticGlobal(next);
    setActionLoading('global');
    try {
      await setGlobalAiEnabled({ enabled: next });
    } finally {
      setOptimisticGlobal(null);
      setActionLoading(null);
    }
  };

  const setStatus = async (phone: string, status: Conversation['status'], note?: string, orderId?: string) => {
    setActionLoading(phone + ':' + status);
    await setConversationStatus({
      phone,
      status,
      note,
      order_id: orderId,
    });
    setActionLoading(null);
  };

  const notClosing = async (conversation: Conversation) => {
    setActionLoading(conversation.phone + ':not-closing');
    await markNotClosing({
      phone: conversation.phone,
      order_id: conversation.order_id,
      note: 'marked not closing by CS',
    });
    setActionLoading(null);
  };

  const markWonManual = async (conversation: Conversation) => {
    setActionLoading(conversation.phone + ':mark-closing');
    await markClosing({
      phone: conversation.phone,
      order_id: conversation.order_id,
      note: 'marked closing by CS',
    });
    // Also create a needs_review shipping recap so it appears in Rekap Pengiriman & Performance
    await createPanelClosingRecap({
      customerPhone: conversation.phone,
      orderId: conversation.order_id,
      packageContent: conversation.productName || conversation.products,
      csName: conversation.csName || (csName ?? ''),
    });
    setActionLoading(null);
  };

  const cancelOrder = async (conversation: Conversation) => {
    setActionLoading(conversation.phone + ':mark-cancelled');
    await markCancelled({
      phone: conversation.phone,
      order_id: conversation.order_id,
      note: 'customer cancelled',
    });
    setActionLoading(null);
  };

  const undoCancelOrder = async (conversation: Conversation) => {
    setActionLoading(conversation.phone + ':undo-cancelled');
    await undoCancelled({
      phone: conversation.phone,
      order_id: conversation.order_id,
      note: 'cancel undone by CS',
    });
    setActionLoading(null);
  };

  const confirmDeleteOrder = async () => {
    if (!pendingDelete) return;
    setActionLoading(pendingDelete.phone + ':delete');
    await deleteOrder({
      phone: pendingDelete.phone,
      order_id: pendingDelete.order_id,
    });
    if (selectedConversation?.order_id === pendingDelete.order_id) {
      setSelectedConversation(null);
    }
    setPendingDelete(null);
    setActionLoading(null);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Status</h2>
          <p className="text-sm text-muted-foreground">Global AI toggle &amp; conversation metrics</p>
        </div>
        <button
          onClick={handleGlobalAiToggle}
          disabled={actionLoading === 'global' || loading}
          className={cn(
            'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all duration-200',
            'disabled:cursor-not-allowed disabled:opacity-60',
            displayGlobalEnabled
              ? 'border-positive bg-positive-soft text-positive hover:brightness-95'
              : 'border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {actionLoading === 'global' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : displayGlobalEnabled ? (
            <Bot className="size-4" />
          ) : (
            <BotOff className="size-4" />
          )}
          <span>Global AI</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-bold',
              displayGlobalEnabled
                ? 'bg-positive text-primary-foreground'
                : 'bg-muted-foreground/15 text-muted-foreground',
            )}
          >
            {displayGlobalEnabled ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      <ConversationPanel
        title="Conversation queue"
        description="Search, triage, and act on support-AI conversations."
        queueItems={queueItems}
        rows={visibleRows}
        actionLoading={actionLoading}
        loading={loading}
        searchQuery={searchQuery}
        selectedQueue={selectedQueue}
        onDeleteOrder={setPendingDelete}
        onMarkCancelled={cancelOrder}
        onMarkClosing={markWonManual}
        onNotClosing={notClosing}
        onUndoCancelled={undoCancelOrder}
        onOpenDetail={setSelectedConversation}
        onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
        onResumeAI={(conversation) => setStatus(conversation.phone, 'active', undefined, conversation.order_id)}
        onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
        onSearchChange={setSearchQuery}
        onSelectQueue={setSelectedQueue}
      />

      <ConversationDetailSheet
        actionLoading={actionLoading}
        conversation={selectedConversation}
        onNotClosing={notClosing}
        onDeleteOrder={setPendingDelete}
        onMarkCancelled={cancelOrder}
        onMarkClosing={markWonManual}
        onUndoCancelled={undoCancelOrder}
        onOpenChange={(open) => {
          if (!open) setSelectedConversation(null);
        }}
        onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
        onResumeAI={(conversation) => setStatus(conversation.phone, 'active', undefined, conversation.order_id)}
        onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
      />

      <ConfirmDeleteDialog
        conversation={pendingDelete}
        loading={actionLoading?.startsWith(pendingDelete?.phone ?? '') ?? false}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteOrder}
      />

      <AlertDialog open={globalAiConfirmOpen} onOpenChange={setGlobalAiConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <BotOff className="size-5 text-destructive" />
              Matikan Global AI?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Semua percakapan aktif akan berhenti mendapat balasan otomatis dari AI. CS perlu membalas manual sampai AI dinyalakan kembali.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setGlobalAiConfirmOpen(false);
                void doToggleGlobal(false);
              }}
            >
              Ya, Matikan AI
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
