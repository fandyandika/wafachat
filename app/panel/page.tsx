'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  Activity,
  BarChart3,
  Bot,
  BotOff,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { StatCard, type StatTone } from '@/components/ui/stat-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { useHighlightOnChange } from '@/components/ui/use-highlight-on-change';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { Conversation, Stats, CsConfig, QueueKey, RecapStatus, PaymentFilter, RecapSort, ShippingRecap, PerformanceData } from '@/components/panel/types';
import { formatRupiah, formatTime, pct, fmtTime } from '@/lib/format';
import { ConversationPanel, ConversationDetailSheet, ConfirmDeleteDialog } from '@/components/panel/conversation-panel';
import { ShippingRecapPanel, ShippingRecapDetailSheet } from '@/components/panel/shipping-recap-panel';
import { PerformancePanel } from '@/components/panel/performance-panel';

type PanelView = 'dashboard' | 'shipping' | 'performance';
type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'shipping', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { key: 'performance', label: 'Performance', icon: BarChart3 },
] as const;

export default function PanelPage() {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<QueueKey>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [panelView, setPanelView] = useState<PanelView>('dashboard');
  const [recapStatus, setRecapStatus] = useState<RecapStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [recapSearch, setRecapSearch] = useState('');
  const [selectedRecap, setSelectedRecap] = useState<ShippingRecap | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>('today');
  const [customDate, setCustomDate] = useState('');
  const [recapSort, setRecapSort] = useState<RecapSort>('newest');
  const [selectedRecapIds, setSelectedRecapIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [selectedCsName, setSelectedCsName] = useState('all');
  const [globalAiConfirmOpen, setGlobalAiConfirmOpen] = useState(false);
  const [optimisticGlobal, setOptimisticGlobal] = useState<boolean | null>(null);

  const selectedDateRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    if (dateRange === 'custom' && customDate) {
      const d = new Date(customDate + 'T12:00:00'); // noon avoids DST edge cases
      start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      start.setHours(0, 0, 0, 0);
      end.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      end.setHours(23, 59, 59, 999);
    } else if (dateRange === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (dateRange === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (dateRange === '30d') {
      start.setDate(start.getDate() - 29);
    } else if (dateRange === 'month') {
      start.setDate(1);
    }

    return { startAt: start.getTime(), endAt: end.getTime() };
  }, [dateRange, customDate]);

  // Jakarta date string for the END of selected range — used by getDailyStats
  const selectedJakartaDate = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(selectedDateRange.endAt));
  }, [selectedDateRange.endAt]);

  const csFilter = selectedCsName === 'all' ? undefined : selectedCsName;
  const conversationsData = useQuery(api.state.listConversations, { includeClosed: true, csName: csFilter });
  const summaryData = useQuery(api.metrics.getDashboardSummary, {
    startAt: selectedDateRange.startAt,
    endAt: selectedDateRange.endAt,
    csName: csFilter,
  });
  // Perf: tab-specific heavy derive-on-read queries run ONLY when their tab is
  // active (Convex 'skip'), so opening the Dashboard doesn't fire the
  // Performance/Rekap full-table scans. Cross-tab queries (conversations,
  // summary, global AI, csConfigs) stay always-on.
  const duplicateOrders = useQuery(
    api.metrics.getDuplicateOrders,
    panelView === 'dashboard'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt, csName: csFilter }
      : 'skip',
  );
  const csLeaderboard = useQuery(
    api.analytics.getCsLeaderboard,
    panelView === 'performance'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt }
      : 'skip',
  );
  const productDifficulty = useQuery(
    api.analytics.getProductDifficulty,
    panelView === 'performance'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt }
      : 'skip',
  );
  const trendData = useQuery(
    api.metrics.getTrend,
    panelView === 'performance'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt, bucket: 'day' }
      : 'skip',
  );
  const globalEnabledData = useQuery(api.settings.getGlobalAiEnabled, {});
  const csConfigsData = useQuery(api.csConfigs.list, {});
  const shippingRecapsData = useQuery(
    api.shippingRecaps.list,
    panelView === 'shipping'
      ? {
          startAt: selectedDateRange.startAt,
          endAt: selectedDateRange.endAt,
          status: recapStatus === 'all' ? undefined : recapStatus,
          paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
          search: recapSearch || undefined,
          csName: csFilter,
        }
      : 'skip',
  );
  // getPerformance feeds the Dashboard's Total Closing/CR/Cancelled cards AND the
  // Performance tab, so it runs everywhere except Rekap.
  const performanceData = useQuery(
    api.shippingRecaps.getPerformance,
    panelView !== 'shipping'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt, includeInferredDiscount: false, csName: csFilter }
      : 'skip',
  );
  const countsData = useQuery(
    api.shippingRecaps.getCounts,
    panelView === 'shipping'
      ? { startAt: selectedDateRange.startAt, endAt: selectedDateRange.endAt, csName: csFilter }
      : 'skip',
  );
  const setConversationStatus = useMutation(api.state.setConversationStatusFromN8n);
  const markNotClosing = useMutation(api.state.markConversationNotClosing);
  const markClosing = useMutation(api.state.markConversationClosing);
  const markCancelled = useMutation(api.state.markConversationCancelled);
  const undoCancelled = useMutation(api.state.undoConversationCancelled);
  const deleteOrder = useMutation(api.state.deleteConversationOrder);
  const setGlobalAiEnabled = useMutation(api.settings.setGlobalAiEnabled);
  const markRecapReady = useMutation(api.shippingRecaps.markReady);
  const markRecapCancelled = useMutation(api.shippingRecaps.markCancelled);
  const undoRecapCancelled = useMutation(api.shippingRecaps.undoCancelled);
  const markRecapsExported = useMutation(api.shippingRecaps.markExported);
  const markRecapsDelivered = useMutation(api.shippingRecaps.markDelivered);
  const undoRecapDelivered = useMutation(api.shippingRecaps.undoDelivered);
  const markReadyBulk = useMutation(api.shippingRecaps.markReadyBulk);
  const markCancelledBulk = useMutation(api.shippingRecaps.markCancelledBulk);
  const createPanelClosingRecap = useMutation(api.shippingRecaps.createFromPanelClosing);

  useEffect(() => {
    if (conversationsData !== undefined && summaryData !== undefined && globalEnabledData !== undefined) {
      setLastUpdated(new Date().toLocaleTimeString('id-ID'));
    }
  }, [conversationsData, globalEnabledData, summaryData]);

  const conversations = (conversationsData ?? []) as Conversation[];
  const csConfigs = (csConfigsData ?? []) as CsConfig[];
  const shippingRecaps = (shippingRecapsData ?? []) as ShippingRecap[];
  const performance = performanceData as PerformanceData | undefined;
  const stats: Stats = {
    orders: summaryData?.leads ?? 0,
    closings: summaryData?.closings ?? 0,
    ai_closings: Math.max((summaryData?.closings ?? 0) - (summaryData?.manualClosings ?? 0), 0),
    manual_closings: summaryData?.manualClosings ?? 0,
    cancelled: summaryData?.cancelled ?? 0,
    handovers: summaryData?.handovers ?? 0,
    closed_today: 0,
    date: selectedJakartaDate,
  };
  const globalEnabled = globalEnabledData !== false;
  const loading = conversationsData === undefined || summaryData === undefined || globalEnabledData === undefined;

  useEffect(() => {
    setSelectedRecapIds(new Set());
  }, [selectedCsName]);

  const displayGlobalEnabled = optimisticGlobal !== null ? optimisticGlobal : globalEnabled;

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
      csName: conversation.csName || (selectedCsName !== 'all' ? selectedCsName : ''),
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

  const markDeliveredRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':delivered');
    await markRecapsDelivered({ recapIds: [recap._id] });
    setActionLoading(null);
  };

  const undoDeliveredRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':undo-delivered');
    await undoRecapDelivered({ recapId: recap._id });
    setActionLoading(null);
  };

  const bulkMarkReady = async (ids: string[]) => {
    setActionLoading('bulk:ready');
    await markReadyBulk({ recapIds: ids as Id<'shippingRecaps'>[] });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const bulkMarkDelivered = async (ids: string[]) => {
    setActionLoading('bulk:delivered');
    await markRecapsDelivered({ recapIds: ids as Id<'shippingRecaps'>[] });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const bulkCancel = async (ids: string[]) => {
    setActionLoading('bulk:cancel');
    await markCancelledBulk({ recapIds: ids as Id<'shippingRecaps'>[], reason: 'cancelled from panel' });
    setSelectedRecapIds(new Set());
    setBulkCancelOpen(false);
    setActionLoading(null);
  };

  const readyRecaps = shippingRecaps.filter((row) => row.status === 'ready');

  const markReadyRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':ready');
    await markRecapReady({ recapId: recap._id });
    setActionLoading(null);
  };

  const cancelRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':cancel');
    await markRecapCancelled({ recapId: recap._id, reason: 'cancelled from panel' });
    setActionLoading(null);
  };

  const undoCancelRecap = async (recap: ShippingRecap) => {
    setActionLoading(recap._id + ':undo-cancel');
    await undoRecapCancelled({ recapId: recap._id });
    setActionLoading(null);
  };

  const downloadRecapCsv = async (rowsToExport?: ShippingRecap[]) => {
    const toExport = rowsToExport ?? readyRecaps;
    if (toExport.length === 0) return;
    const exportBatchId = 'export-' + new Date().toISOString().replace(/[:.]/g, '-');
    setActionLoading('shipping-export');
    const response = await fetch('/api/shipping-recaps/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: toExport }),
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wafachat-rekap-pengiriman-${stats.date || 'today'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    await markRecapsExported({ recapIds: toExport.map((row) => row._id), exportBatchId });
    setSelectedRecapIds(new Set());
    setActionLoading(null);
  };

  const active = conversations.filter((conversation) => conversation.status === 'active');
  const handover = conversations.filter((conversation) => conversation.status === 'handover' && conversation.aiEnabled !== false);
  const closed = conversations.filter((conversation) => conversation.status === 'closed');
  // Closing stats from shippingRecaps (same source as Performance tab) — accurate
  const totalClosing = performance?.totalClosing ?? 0;
  const manualClosings = stats.manual_closings ?? 0;
  const aiClosings = Math.max(totalClosing - manualClosings, 0);
  const crPerf = performance?.overallCr ?? 0;
  // Stats cards show today-scoped counts; queue tabs still show all unresolved conversations
  const activeTodayCount = active.filter((c) => new Date(c.updatedAt).getTime() >= selectedDateRange.startAt).length;
  const handoverTodayCount = stats.handovers; // from dailyStats — unique handover events for the selected day
  const handoverRate = stats.orders > 0 ? Math.round((handoverTodayCount / stats.orders) * 100) : 0;
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

  const cards = useMemo(
    (): Array<{
      label: string;
      value: number;
      detail: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: StatTone;
      format?: (n: number) => string;
      highlightable?: boolean;
    }> => [
      {
        label: 'Orders',
        value: stats.orders,
        detail: 'Leads · HP unik',
        icon: Activity,
        tone: 'lead',
        highlightable: true,
      },
      {
        label: 'Total Closing',
        value: totalClosing,
        detail: `AI: ${aiClosings} · Manual: ${manualClosings}`,
        icon: CheckCircle2,
        tone: 'positive',
        highlightable: true,
      },
      {
        label: 'Manual closing',
        value: manualClosings,
        detail: 'Marked by CS',
        icon: CheckCircle2,
        tone: 'lead',
      },
      {
        label: 'Cancelled',
        value: performance?.cancelled ?? stats.cancelled ?? 0,
        detail: 'Customer cancelled',
        icon: CircleAlert,
        tone: 'negative',
      },
      {
        label: 'Closing rate',
        value: crPerf,
        detail: 'Closing / orders',
        icon: BarChart3,
        tone: crPerf > 100 ? 'negative' : 'positive',
        format: pct,
      },
      {
        label: 'Handovers',
        value: handoverTodayCount,
        detail: `Today · Queue: ${handover.length}`,
        icon: CircleAlert,
        tone: 'default',
      },
      {
        label: 'Handover rate',
        value: handoverRate,
        detail: 'Today handover / orders',
        icon: ShieldCheck,
        tone: 'default',
        format: pct,
      },
      {
        label: 'Active chats',
        value: active.length,
        detail: `Today · Updated: ${activeTodayCount}`,
        icon: MessageCircle,
        tone: 'lead',
      },
      {
        label: 'Archived',
        value: closed.length,
        detail: 'Chat archived',
        icon: Clock3,
        tone: 'default',
      },
    ],
    [active.length, activeTodayCount, aiClosings, closed.length, crPerf, handover.length, handoverTodayCount, handoverRate, manualClosings, performance, stats, totalClosing],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Bot className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none text-foreground">WaFaChat</div>
                <div className="mt-1 text-xs text-muted-foreground">CS Automation</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-4">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={cn(
                  'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                  panelView === item.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onClick={() => setPanelView(item.key)}
                type="button"
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-4">
            <Card size="sm" className="border-transparent bg-accent/60 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Production</CardTitle>
                <CardDescription className="text-xs">n8n.miqra.dev</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="success">Live workflows</Badge>
              </CardContent>
            </Card>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    {panelView === 'dashboard' ? 'Dashboard' : panelView === 'shipping' ? 'Rekap Pengiriman' : 'Performance'}
                  </h1>
                  <Badge variant="secondary">pustakaislam.net</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  WhatsApp automation control room for CS operations.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={selectedCsName} onValueChange={(value) => setSelectedCsName(value ?? 'all')}>
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue placeholder="Semua CS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua CS</SelectItem>
                    {csConfigs.map((config) => (
                      <SelectItem key={config.csName} value={config.csName}>
                        {config.csName.replace(/^CS\s+/i, '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5" />
                  <span>Updated {lastUpdated || '-'}</span>
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
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-bold',
                    displayGlobalEnabled
                      ? 'bg-positive text-primary-foreground'
                      : 'bg-muted-foreground/15 text-muted-foreground',
                  )}>
                    {displayGlobalEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {navItems.map((item) => (
                <Badge
                  key={item.key}
                  onClick={() => setPanelView(item.key)}
                  role="button"
                  variant={panelView === item.key ? 'default' : 'secondary'}
                >
                  {item.label}
                </Badge>
              ))}
            </div>
          </header>

          <div className="space-y-6 p-4 md:p-6">
            {/* Global date filter — controls all views */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Periode:</span>
              {([
                { label: 'Hari ini', value: 'today' },
                { label: 'Kemarin', value: 'yesterday' },
                { label: '7 hari', value: '7d' },
                { label: '30 hari', value: '30d' },
                { label: 'Bulan ini', value: 'month' },
              ] as Array<{ label: string; value: DateRangeKey }>).map((item) => (
                <Button
                  key={item.value}
                  size="sm"
                  variant={dateRange === item.value ? 'default' : 'outline'}
                  onClick={() => setDateRange(item.value)}
                >
                  {item.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={dateRange === 'custom' ? 'default' : 'outline'}
                onClick={() => setDateRange('custom')}
              >
                Pilih Tanggal
              </Button>
              {dateRange === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => { setCustomDate(e.target.value); }}
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>

            {panelView === 'dashboard' && (
              <>
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {loading
                    ? Array.from({ length: 9 }).map((_, index) => <MetricSkeleton key={index} />)
                    : cards.map((card) => <DashboardStatCard key={card.label} {...card} />)}
                </section>

                <Card className="mt-3">
                  <CardHeader>
                    <CardTitle className="text-base">⚠️ Order Dobel</CardTitle>
                    <CardDescription>Customer dengan ≥2 order di periode ini — kroscek di Berdu, cancel jika dobel tak sengaja.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {duplicateOrders === undefined ? (
                      <p className="text-sm text-muted-foreground">Memuat…</p>
                    ) : duplicateOrders.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Tidak ada order dobel di periode ini ✅</p>
                    ) : (
                      duplicateOrders.map((d) => (
                        <div key={d.phone} className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{d.customerName || 'Tanpa Nama'}</span>
                            <span className="text-muted-foreground">{d.phone}</span>
                            <span className="text-muted-foreground">· {d.csName || '—'}</span>
                            <Badge variant="secondary">{d.count}× order</Badge>
                            {d.likelyAccidental ? (
                              <Badge variant="warning">⚠ kemungkinan accidental</Badge>
                            ) : (
                              <Badge variant="secondary">repeat customer</Badge>
                            )}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {d.orders.map((o) => (
                              <li key={o.orderId} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                <code className="text-foreground">{o.orderId}</code>
                                <span>{o.productName || '—'}</span>
                                <span>{o.total || '—'}</span>
                                <span>{fmtTime(o.createdAt)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-6">
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
                  </div>

                  <aside className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">System readiness</CardTitle>
                        <CardDescription>Operational checks for this panel.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <ReadinessRow label="n8n State Manager" value="Connected" ok />
                        <ReadinessRow label="Outcome dedup" value="order_id" ok />
                        <ReadinessRow label="Global AI switch" value={displayGlobalEnabled ? 'Enabled' : 'Disabled'} ok={displayGlobalEnabled} />
                        <Separator />
                        <div className="rounded-lg border border-border bg-accent/40 p-3 text-xs text-muted-foreground">
                          Rekap Pengiriman and Performance are sourced from Convex realtime data.
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Today formula</CardTitle>
                        <CardDescription>How the main metrics are calculated.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <Formula label="Orders" value="leads (HP unik)" />
                        <Formula label="Total Closing" value="recap non-cancelled (order unik)" />
                        <Formula label="AI Closing" value="total − manual closing" />
                        <Formula label="Manual Closing" value="CS marked di panel" />
                        <Formula label="Cancelled" value="recap cancelled (excluded)" />
                        <Formula label="Closing rate" value="closing / leads" />
                        <Formula label="Handover rate" value="handovers / leads" />
                      </CardContent>
                    </Card>
                  </aside>
                </section>
              </>
            )}

            {panelView === 'shipping' && (
              <>
                <ShippingRecapPanel
                  actionLoading={actionLoading}
                  csName={csFilter}
                  totalCounts={countsData}
                  paymentFilter={paymentFilter}
                  readyCount={readyRecaps.length}
                  recapSearch={recapSearch}
                  recapSort={recapSort}
                  recapStatus={recapStatus}
                  rows={shippingRecaps}
                  selectedIds={selectedRecapIds}
                  onBulkCancel={() => setBulkCancelOpen(true)}
                  onBulkDelivered={() => bulkMarkDelivered(Array.from(selectedRecapIds))}
                  onBulkExport={() => {
                    const selected = shippingRecaps.filter((r) => selectedRecapIds.has(r._id));
                    const readySelected = selected.filter((r) => r.status === 'ready');
                    downloadRecapCsv(readySelected.length > 0 ? readySelected : undefined);
                  }}
                  onBulkReady={() => bulkMarkReady(Array.from(selectedRecapIds))}
                  onCancel={cancelRecap}
                  onDelivered={markDeliveredRecap}
                  onDownload={() => downloadRecapCsv()}
                  onOpenDetail={setSelectedRecap}
                  onPaymentFilterChange={setPaymentFilter}
                  onReady={markReadyRecap}
                  onSearchChange={setRecapSearch}
                  onSelectAll={(ids) => setSelectedRecapIds(new Set(ids))}
                  onSelectRow={(id, checked) => {
                    setSelectedRecapIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(id); else next.delete(id);
                      return next;
                    });
                  }}
                  onSortChange={setRecapSort}
                  onStatusChange={setRecapStatus}
                  onUndoCancel={undoCancelRecap}
                  onUndoDelivered={undoDeliveredRecap}
                />
                <AlertDialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Batalkan {selectedRecapIds.size} pesanan?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Pesanan yang dibatalkan tidak akan masuk ke export. Tindakan ini bisa di-undo satu per satu.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => bulkCancel(Array.from(selectedRecapIds))}
                      >
                        Ya, Batalkan
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            {panelView === 'performance' && (
              <PerformancePanel data={performance} csLeaderboard={csLeaderboard} productDifficulty={productDifficulty} trendData={trendData} />
            )}
          </div>
        </main>
      </div>
      {/* Global AI OFF confirmation */}
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
      <ShippingRecapDetailSheet
        recap={selectedRecap}
        onOpenChange={(open) => {
          if (!open) setSelectedRecap(null);
        }}
      />
      <ConfirmDeleteDialog
        conversation={pendingDelete}
        loading={Boolean(pendingDelete && actionLoading === pendingDelete.phone + ':delete')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteOrder}
      />
    </div>
  );
}

function DashboardStatCard({
  label,
  value,
  detail,
  icon,
  tone,
  format,
  highlightable,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatTone;
  format?: (n: number) => string;
  highlightable?: boolean;
}) {
  const highlight = useHighlightOnChange(highlightable ? value : undefined);
  return (
    <StatCard
      label={label}
      value={<AnimatedNumber value={value} format={format} />}
      detail={detail}
      icon={icon}
      tone={tone}
      highlight={highlight}
    />
  );
}

function MetricSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}


function ReadinessRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? 'success' : 'outline'}>{value}</Badge>
    </div>
  );
}

function Formula({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
