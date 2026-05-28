'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UsersRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

interface Conversation {
  conversationId: Id<'conversations'>;
  phone: string;
  status: 'active' | 'handover' | 'closed';
  customerName: string;
  productName: string;
  products?: string;
  productsSubtotal?: string;
  shippingCost?: string;
  total?: string;
  shippingAddress?: string;
  shippingDistrict?: string;
  shippingCity?: string;
  csName: string;
  csNumber?: string;
  order_id?: string;
  updatedAt: string;
  note: string;
  closingSource?: 'ai' | 'manual' | null;
  salesOutcome?: 'pending' | 'ai_won' | 'manual_won' | 'cancelled';
}

interface Stats {
  orders: number;
  closings: number;
  ai_closings?: number;
  manual_closings?: number;
  cancelled?: number;
  handovers: number;
  closed_today: number;
  date: string;
}

type QueueKey = 'active' | 'handover' | 'closed' | 'all';
type PanelView = 'dashboard' | 'shipping' | 'performance';
type RecapStatus = 'ready' | 'needs_review' | 'exported' | 'cancelled' | 'cancelled_after_export';
type PaymentFilter = 'all' | 'cod' | 'transfer';

interface ShippingRecap {
  _id: Id<'shippingRecaps'>;
  orderIdBerdu?: string;
  customerPhone: string;
  customerName: string;
  csName: string;
  csPhone?: string;
  orderedAt?: number;
  closedAt: number;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientDistrict: string;
  recipientCity: string;
  packageContent: string;
  paymentMethod: 'cod' | 'transfer' | 'unknown';
  nonCodItemPrice?: number;
  codValue?: number;
  shippingCost?: number;
  total?: number;
  discount?: number;
  inferredDiscount?: number;
  bumpOrder?: string;
  upsell?: string;
  specialBonus?: string;
  shippingInstruction?: string;
  status: RecapStatus;
  flags: string[];
  sourceMessageText: string;
  version: number;
  exportedAt?: number;
  exportBatchId?: string;
  cancelReason?: string;
}

interface PerformanceData {
  totalLeads: number;
  totalClosing: number;
  overallCr: number;
  totalCod: number;
  totalTransfer: number;
  totalRevenue: number;
  totalDiscount: number;
  cancelled: number;
  products: Array<{ product: string; leads: number; closing: number; cr: number; revenue: number; discount: number }>;
  cs: Array<{ csName: string; leads: number; closing: number; cr: number; revenue: number; discount: number }>;
}

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

  const todayRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startAt: start.getTime(), endAt: end.getTime() };
  }, []);

  const conversationsData = useQuery(api.state.listConversations, { includeClosed: true });
  const statsData = useQuery(api.state.getDailyStats, {});
  const globalEnabledData = useQuery(api.settings.getGlobalAiEnabled, {});
  const shippingRecapsData = useQuery(api.shippingRecaps.list, {
    startAt: todayRange.startAt,
    endAt: todayRange.endAt,
    status: recapStatus === 'all' ? undefined : recapStatus,
    paymentMethod: paymentFilter === 'all' ? undefined : paymentFilter,
    search: recapSearch || undefined,
    limit: 75,
  });
  const performanceData = useQuery(api.shippingRecaps.getPerformance, {
    startAt: todayRange.startAt,
    endAt: todayRange.endAt,
    includeInferredDiscount: false,
  });
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

  useEffect(() => {
    if (conversationsData !== undefined && statsData !== undefined && globalEnabledData !== undefined) {
      setLastUpdated(new Date().toLocaleTimeString('id-ID'));
    }
  }, [conversationsData, globalEnabledData, statsData]);

  const conversations = (conversationsData ?? []) as Conversation[];
  const shippingRecaps = (shippingRecapsData ?? []) as ShippingRecap[];
  const performance = performanceData as PerformanceData | undefined;
  const stats: Stats = {
    orders: statsData?.orders ?? 0,
    closings: statsData?.closings ?? 0,
    ai_closings: statsData?.ai_closings ?? 0,
    manual_closings: statsData?.manual_closings ?? 0,
    cancelled: statsData?.cancelled ?? 0,
    handovers: statsData?.handovers ?? 0,
    closed_today: statsData?.closed_today ?? 0,
    date: statsData?.date ?? '',
  };
  const globalEnabled = globalEnabledData !== false;
  const loading = conversationsData === undefined || statsData === undefined || globalEnabledData === undefined;

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setActionLoading('global');
    await setGlobalAiEnabled({ enabled: next });
    setActionLoading(null);
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

  const downloadRecapCsv = async () => {
    if (readyRecaps.length === 0) return;
    const exportBatchId = 'export-' + new Date().toISOString().replace(/[:.]/g, '-');
    setActionLoading('shipping-export');
    const response = await fetch('/api/shipping-recaps/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: readyRecaps }),
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wafachat-rekap-pengiriman-${stats.date || 'today'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    await markRecapsExported({ recapIds: readyRecaps.map((row) => row._id), exportBatchId });
    setActionLoading(null);
  };

  const active = conversations.filter((conversation) => conversation.status === 'active');
  const handover = conversations.filter((conversation) => conversation.status === 'handover');
  const closed = conversations.filter((conversation) => conversation.status === 'closed');
  const crAI = stats.orders > 0 ? Math.round((stats.closings / stats.orders) * 100) : 0;
  const handoverRate = stats.orders > 0 ? Math.round((handover.length / stats.orders) * 100) : 0;
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
    () => [
      {
        label: 'Orders today',
        value: stats.orders,
        detail: 'Unique order count',
        icon: Activity,
        tone: 'text-sky-400',
      },
      {
        label: 'AI closing',
        value: stats.ai_closings ?? Math.max(stats.closings - (stats.manual_closings ?? 0), 0),
        detail: 'Detected by AI',
        icon: CheckCircle2,
        tone: 'text-emerald-400',
      },
      {
        label: 'Manual closing',
        value: stats.manual_closings ?? 0,
        detail: 'Marked by CS',
        icon: CheckCircle2,
        tone: 'text-sky-400',
      },
      {
        label: 'Cancelled',
        value: stats.cancelled ?? 0,
        detail: 'Customer cancelled',
        icon: CircleAlert,
        tone: 'text-destructive',
      },
      {
        label: 'Closing rate',
        value: `${crAI}%`,
        detail: 'Closing / orders',
        icon: BarChart3,
        tone: crAI > 100 ? 'text-destructive' : 'text-emerald-400',
      },
      {
        label: 'Handovers',
        value: handover.length,
        detail: 'Currently paused',
        icon: CircleAlert,
        tone: 'text-amber-400',
      },
      {
        label: 'Handover rate',
        value: `${handoverRate}%`,
        detail: 'Current handover / orders',
        icon: ShieldCheck,
        tone: 'text-amber-400',
      },
      {
        label: 'Active chats',
        value: active.length,
        detail: 'AI currently handles',
        icon: MessageCircle,
        tone: 'text-sky-400',
      },
      {
        label: 'Archived today',
        value: stats.closed_today,
        detail: 'Chat archived',
        icon: Clock3,
        tone: 'text-muted-foreground',
      },
    ],
    [active.length, crAI, handover.length, handoverRate, stats],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r bg-card/40 md:flex md:flex-col">
          <div className="px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bot className="size-4" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none">WaFaChat</div>
                <div className="mt-1 text-xs text-muted-foreground">CS Automation</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors',
                  panelView === item.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
            <Card size="sm" className="bg-background/60">
              <CardHeader>
                <CardTitle className="text-sm">Production</CardTitle>
                <CardDescription className="text-xs">n8n.miqra.dev</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                  Live workflows
                </Badge>
              </CardContent>
            </Card>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b bg-background/95 px-4 py-4 md:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">
                    {panelView === 'dashboard' ? 'Dashboard' : panelView === 'shipping' ? 'Rekap Pengiriman' : 'Performance'}
                  </h1>
                  <Badge variant="secondary">pustakaislam.net</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  WhatsApp automation control room for CS operations.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 items-center gap-2 rounded-lg border px-3 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5" />
                  <span>Updated {lastUpdated || '-'}</span>
                </div>
                <div className="flex h-9 items-center gap-3 rounded-lg border px-3">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" />
                    <span className="text-sm">Global AI</span>
                  </div>
                  <Switch checked={globalEnabled} disabled={actionLoading === 'global'} onCheckedChange={toggleGlobal} />
                  <Badge
                    variant="outline"
                    className={cn(
                      globalEnabled
                        ? 'border-emerald-500/30 text-emerald-400'
                        : 'border-muted-foreground/30 text-muted-foreground',
                    )}
                  >
                    {globalEnabled ? 'ON' : 'OFF'}
                  </Badge>
                </div>
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
            {panelView === 'dashboard' && (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
                  {loading
                    ? Array.from({ length: 9 }).map((_, index) => <MetricSkeleton key={index} />)
                    : cards.map((card) => <MetricCard key={card.label} {...card} />)}
                </section>

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
                        <ReadinessRow label="Global AI switch" value={globalEnabled ? 'Enabled' : 'Disabled'} ok={globalEnabled} />
                        <Separator />
                        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
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
                        <Formula label="Orders" value="unique phone + product" />
                        <Formula label="AI Closing" value="AI detected" />
                        <Formula label="Manual Closing" value="CS marked" />
                        <Formula label="Cancelled" value="CS marked" />
                        <Formula label="Closing rate" value="closing / orders" />
                        <Formula label="Handover rate" value="current handovers / orders" />
                      </CardContent>
                    </Card>
                  </aside>
                </section>
              </>
            )}

            {panelView === 'shipping' && (
              <ShippingRecapPanel
                actionLoading={actionLoading}
                paymentFilter={paymentFilter}
                readyCount={readyRecaps.length}
                recapSearch={recapSearch}
                recapStatus={recapStatus}
                rows={shippingRecaps}
                onCancel={cancelRecap}
                onDownload={downloadRecapCsv}
                onOpenDetail={setSelectedRecap}
                onPaymentFilterChange={setPaymentFilter}
                onReady={markReadyRecap}
                onSearchChange={setRecapSearch}
                onStatusChange={setRecapStatus}
                onUndoCancel={undoCancelRecap}
              />
            )}

            {panelView === 'performance' && <PerformancePanel data={performance} />}
          </div>
        </main>
      </div>
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

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Card size="sm" className="min-h-[112px]">
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase text-muted-foreground">{label}</CardTitle>
        <CardAction>
          <Icon className={cn('size-4', tone)} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function MetricSkeleton() {
  return (
    <Card size="sm" className="min-h-[112px]">
      <CardHeader>
        <Skeleton className="h-3 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-14" />
        <Skeleton className="mt-2 h-3 w-28" />
      </CardContent>
    </Card>
  );
}

function ShippingRecapPanel({
  actionLoading,
  paymentFilter,
  readyCount,
  recapSearch,
  recapStatus,
  rows,
  onCancel,
  onDownload,
  onOpenDetail,
  onPaymentFilterChange,
  onReady,
  onSearchChange,
  onStatusChange,
  onUndoCancel,
}: {
  actionLoading: string | null;
  paymentFilter: PaymentFilter;
  readyCount: number;
  recapSearch: string;
  recapStatus: RecapStatus | 'all';
  rows: ShippingRecap[];
  onCancel: (recap: ShippingRecap) => void;
  onDownload: () => void;
  onOpenDetail: (recap: ShippingRecap) => void;
  onPaymentFilterChange: (filter: PaymentFilter) => void;
  onReady: (recap: ShippingRecap) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (status: RecapStatus | 'all') => void;
  onUndoCancel: (recap: ShippingRecap) => void;
}) {
  const statusItems: Array<{ label: string; value: RecapStatus | 'all' }> = [
    { label: 'Semua', value: 'all' },
    { label: 'Siap Export', value: 'ready' },
    { label: 'Perlu Cek', value: 'needs_review' },
    { label: 'Sudah Export', value: 'exported' },
    { label: 'Cancel', value: 'cancelled' },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Rekap Pengiriman</CardTitle>
            <CardDescription>Closing final untuk bulk upload pengiriman. Default data adalah hari ini.</CardDescription>
          </div>
          <Button disabled={readyCount === 0 || actionLoading === 'shipping-export'} onClick={onDownload}>
            <CheckCircle2 className="size-4" />
            Download Excel ({readyCount})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              aria-label="Search shipping recap"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => onSearchChange(event.target.value)}
              value={recapSearch}
            />
          </div>
          {statusItems.map((item) => (
            <Button
              key={item.value}
              onClick={() => onStatusChange(item.value)}
              size="sm"
              variant={recapStatus === item.value ? 'default' : 'outline'}
            >
              {item.label}
            </Button>
          ))}
          <Button
            onClick={() => onPaymentFilterChange(paymentFilter === 'cod' ? 'all' : 'cod')}
            size="sm"
            variant={paymentFilter === 'cod' ? 'default' : 'outline'}
          >
            COD
          </Button>
          <Button
            onClick={() => onPaymentFilterChange(paymentFilter === 'transfer' ? 'all' : 'transfer')}
            size="sm"
            variant={paymentFilter === 'transfer' ? 'default' : 'outline'}
          >
            Transfer
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Closing</TableHead>
                <TableHead>Penerima</TableHead>
                <TableHead>Isi paket</TableHead>
                <TableHead>Bayar</TableHead>
                <TableHead>Total/COD</TableHead>
                <TableHead>Kecamatan/Kota</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={8}>
                    Belum ada rekap pengiriman pada filter ini.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.closedAt)}
                    </TableCell>
                    <TableCell>
                      <button className="text-left font-medium hover:underline" onClick={() => onOpenDetail(row)}>
                        {row.recipientName || row.customerName || 'Unknown'}
                      </button>
                      <div className="font-mono text-xs text-muted-foreground">{row.recipientPhone || row.customerPhone}</div>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">{row.packageContent || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.paymentMethod.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>{formatRupiah(row.codValue ?? row.total ?? row.nonCodItemPrice)}</TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {[row.recipientDistrict, row.recipientCity].filter(Boolean).join(', ') || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <RecapStatusBadge status={row.status} />
                        {row.flags.length > 0 && (
                          <Badge className="w-fit" variant="outline">{row.flags.length} flag</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {row.status === 'needs_review' && (
                          <Button
                            disabled={actionLoading === row._id + ':ready'}
                            onClick={() => onReady(row)}
                            size="sm"
                            variant="secondary"
                          >
                            Ready
                          </Button>
                        )}
                        {row.status === 'cancelled' || row.status === 'cancelled_after_export' ? (
                          <Button
                            disabled={actionLoading === row._id + ':undo-cancel'}
                            onClick={() => onUndoCancel(row)}
                            size="sm"
                            variant="outline"
                          >
                            Undo
                          </Button>
                        ) : (
                          <Button
                            disabled={actionLoading === row._id + ':cancel'}
                            onClick={() => onCancel(row)}
                            size="sm"
                            variant="outline"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function PerformancePanel({ data }: { data?: PerformanceData }) {
  const cards = [
    { label: 'Total Leads', value: data?.totalLeads ?? 0 },
    { label: 'Total Closing', value: data?.totalClosing ?? 0 },
    { label: 'CR', value: `${data?.overallCr ?? 0}%` },
    { label: 'Total COD', value: data?.totalCod ?? 0 },
    { label: 'Total Transfer', value: data?.totalTransfer ?? 0 },
    { label: 'Omzet Closing', value: formatRupiah(data?.totalRevenue) },
    { label: 'Total Diskon', value: formatRupiah(data?.totalDiscount) },
    { label: 'Cancel', value: data?.cancelled ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} size="sm">
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle>{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <PerformanceTable
        columns={['Produk', 'Leads', 'Closing', 'CR', 'Omzet', 'Diskon']}
        rows={(data?.products ?? []).map((row) => [
          row.product,
          row.leads,
          row.closing,
          `${row.cr}%`,
          formatRupiah(row.revenue),
          formatRupiah(row.discount),
        ])}
        title="Performance Produk"
      />

      <PerformanceTable
        columns={['CS', 'Leads', 'Closing', 'CR', 'Omzet', 'Diskon']}
        rows={(data?.cs ?? []).map((row) => [
          row.csName,
          row.leads,
          row.closing,
          `${row.cr}%`,
          formatRupiah(row.revenue),
          formatRupiah(row.discount),
        ])}
        title="Performance CS"
      />
    </div>
  );
}

function PerformanceTable({ columns, rows, title }: { columns: string[]; rows: Array<Array<string | number>>; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Hari ini, dihitung dari unique leads dan final recap closing.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={columns.length}>
                    Belum ada data performance pada filter ini.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ConversationPanel({
  title,
  description,
  queueItems,
  rows,
  actionLoading,
  loading,
  searchQuery,
  selectedQueue,
  onDeleteOrder,
  onMarkCancelled,
  onMarkClosing,
  onNotClosing,
  onOpenDetail,
  onPauseAI,
  onResumeAI,
  onSelesai,
  onSearchChange,
  onSelectQueue,
  onUndoCancelled,
}: {
  title: string;
  description: string;
  queueItems: Array<{ key: QueueKey; label: string; count: number }>;
  rows: Conversation[];
  actionLoading: string | null;
  loading: boolean;
  searchQuery: string;
  selectedQueue: QueueKey;
  onDeleteOrder: (conversation: Conversation) => void;
  onMarkCancelled: (conversation: Conversation) => void;
  onMarkClosing: (conversation: Conversation) => void;
  onNotClosing: (conversation: Conversation) => void;
  onOpenDetail: (conversation: Conversation) => void;
  onPauseAI: (conversation: Conversation) => void;
  onResumeAI: (conversation: Conversation) => void;
  onSelesai: (conversation: Conversation) => void;
  onSearchChange: (value: string) => void;
  onSelectQueue: (queue: QueueKey) => void;
  onUndoCancelled: (conversation: Conversation) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <CardAction>
          <Badge variant="secondary">{rows.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {queueItems.map((item) => (
              <Button
                aria-pressed={selectedQueue === item.key}
                key={item.key}
                onClick={() => onSelectQueue(item.key)}
                size="sm"
                variant={selectedQueue === item.key ? 'default' : 'outline'}
              >
                {item.label}
                <Badge className="ml-1" variant={selectedQueue === item.key ? 'secondary' : 'outline'}>
                  {item.count}
                </Badge>
              </Button>
            ))}
          </div>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search name, phone, order ID, product..."
              value={searchQuery}
            />
          </div>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center">
            <MessagesSquare className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No conversations in this queue</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              New orders and handovers will appear here after n8n updates the State Manager.
            </p>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">CS</TableHead>
                  <TableHead className="hidden xl:table-cell">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((conversation) => (
                  <TableRow
                    className="cursor-pointer"
                    key={conversation.order_id || conversation.phone}
                    onClick={() => onOpenDetail(conversation)}
                  >
                    <TableCell className="min-w-[180px]">
                      <div className="font-medium">{conversation.customerName || 'Unknown'}</div>
                      <div className="font-mono text-xs text-muted-foreground">{conversation.phone}</div>
                      {conversation.order_id && (
                        <div className="mt-1 text-[11px] text-muted-foreground">{conversation.order_id}</div>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[180px] text-sm text-muted-foreground">
                      {conversation.productName || '-'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={conversation.status} />
                      {conversation.salesOutcome && conversation.salesOutcome !== 'pending' && (
                        <div className="mt-1">
                          <OutcomeBadge outcome={conversation.salesOutcome} />
                        </div>
                      )}
                      {conversation.note && (
                        <div className="mt-1 max-w-[180px] truncate text-xs text-muted-foreground">{conversation.note}</div>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {conversation.csName || '-'}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      {formatTime(conversation.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <a
                                className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }))}
                                href={`https://wa.me/${conversation.phone}`}
                                rel="noopener noreferrer"
                                target="_blank"
                              />
                            }
                          >
                            <ExternalLink className="size-3.5" />
                            <span className="sr-only">Open WhatsApp</span>
                          </TooltipTrigger>
                          <TooltipContent>Open WhatsApp</TooltipContent>
                        </Tooltip>
                        {conversation.status === 'active' && (
                          <Button
                            disabled={actionLoading === conversation.phone + ':handover'}
                            onClick={() => onPauseAI(conversation)}
                            size="sm"
                            variant="outline"
                          >
                            <PauseCircle className="size-3.5" />
                            Pause AI
                          </Button>
                        )}
                        {conversation.salesOutcome !== 'cancelled' && !conversation.closingSource && (
                          <Button
                            disabled={actionLoading === conversation.phone + ':mark-closing'}
                            onClick={() => onMarkClosing(conversation)}
                            size="sm"
                            variant="secondary"
                          >
                            <CheckCircle2 className="size-3.5" />
                            Mark Closing
                          </Button>
                        )}
                        {conversation.salesOutcome === 'cancelled' ? (
                          <Button
                            disabled={actionLoading === conversation.phone + ':undo-cancelled'}
                            onClick={() => onUndoCancelled(conversation)}
                            size="sm"
                            variant="secondary"
                          >
                            Undo Cancel
                          </Button>
                        ) : (
                          <Button
                            disabled={actionLoading === conversation.phone + ':mark-cancelled'}
                            onClick={() => onMarkCancelled(conversation)}
                            size="sm"
                            variant="outline"
                          >
                            Mark Cancelled
                          </Button>
                        )}
                        {conversation.status === 'handover' && (
                          <Button
                            disabled={actionLoading === conversation.phone + ':active'}
                            onClick={() => onResumeAI(conversation)}
                            size="sm"
                            variant="secondary"
                          >
                            <PlayCircle className="size-3.5" />
                            Resume
                          </Button>
                        )}
                        {conversation.status === 'closed' ? (
                          <>
                            <Button
                              disabled={actionLoading === conversation.phone + ':active'}
                              onClick={() => onResumeAI(conversation)}
                              size="sm"
                              variant="secondary"
                            >
                              <PlayCircle className="size-3.5" />
                              Reactivate
                            </Button>
                            <Button
                              disabled={actionLoading === conversation.phone + ':not-closing'}
                              onClick={() => onNotClosing(conversation)}
                              size="sm"
                              variant="outline"
                            >
                              Not Closing
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={actionLoading === conversation.phone + ':closed'}
                            onClick={() => onSelesai(conversation)}
                            size="sm"
                            variant="destructive"
                          >
                            <CheckCircle2 className="size-3.5" />
                            Archive
                          </Button>
                        )}
                        <Button
                          disabled={actionLoading === conversation.phone + ':delete'}
                          onClick={() => onDeleteOrder(conversation)}
                          size="sm"
                          variant="outline"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConversationDetailSheet({
  conversation,
  actionLoading,
  onOpenChange,
  onDeleteOrder,
  onMarkCancelled,
  onMarkClosing,
  onPauseAI,
  onResumeAI,
  onSelesai,
  onNotClosing,
  onUndoCancelled,
}: {
  conversation: Conversation | null;
  actionLoading: string | null;
  onOpenChange: (open: boolean) => void;
  onDeleteOrder: (conversation: Conversation) => void;
  onMarkCancelled: (conversation: Conversation) => void;
  onMarkClosing: (conversation: Conversation) => void;
  onPauseAI: (conversation: Conversation) => void;
  onResumeAI: (conversation: Conversation) => void;
  onSelesai: (conversation: Conversation) => void;
  onNotClosing: (conversation: Conversation) => void;
  onUndoCancelled: (conversation: Conversation) => void;
}) {
  const messages = useQuery(
    api.messages.listMessages,
    conversation ? { conversationId: conversation.conversationId, limit: 50 } : 'skip',
  );

  return (
    <Sheet open={Boolean(conversation)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
        {conversation && (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{conversation.customerName || 'Unknown customer'}</SheetTitle>
                  <SheetDescription className="mt-1 font-mono">{conversation.phone}</SheetDescription>
                </div>
                <StatusBadge status={conversation.status} />
              </div>
              {conversation.salesOutcome && conversation.salesOutcome !== 'pending' && (
                <div className="mt-3">
                  <OutcomeBadge outcome={conversation.salesOutcome} />
                </div>
              )}
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Order detail</h2>
                  {conversation.order_id && <Badge variant="secondary">{conversation.order_id}</Badge>}
                </div>
                <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                  <DetailRow label="Product" value={conversation.products || conversation.productName || '-'} />
                  <DetailRow label="Subtotal" value={conversation.productsSubtotal || '-'} />
                  <DetailRow label="Ongkir" value={conversation.shippingCost || '-'} />
                  <DetailRow label="Total" value={conversation.total || '-'} strong />
                  <DetailRow
                    label="Alamat"
                    value={[conversation.shippingAddress, conversation.shippingDistrict, conversation.shippingCity]
                      .filter(Boolean)
                      .join(', ') || '-'}
                  />
                  <DetailRow label="CS" value={conversation.csName || '-'} />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">Handover note</h2>
                <div className="min-h-12 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                  {conversation.note || 'No handover note.'}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Chat history</h2>
                  <Badge variant="outline">last 50</Badge>
                </div>
                <div className="space-y-2">
                  {messages === undefined ? (
                    <>
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-4/5" />
                    </>
                  ) : messages.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No chat history stored yet.
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        className={cn(
                          'rounded-lg border p-3 text-sm',
                          message.role === 'ai'
                            ? 'ml-8 border-emerald-500/20 bg-emerald-500/10'
                            : 'mr-8 bg-muted/30',
                        )}
                        key={message._id}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{message.role === 'ai' ? 'AI' : message.role === 'cs' ? 'CS' : 'Customer'}</span>
                          <span>{formatTime(new Date(message.createdAt).toISOString())}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              {conversation.status === 'active' && (
                <Button
                  disabled={actionLoading === conversation.phone + ':handover'}
                  onClick={() => onPauseAI(conversation)}
                  variant="outline"
                >
                  <PauseCircle className="size-4" />
                  Pause AI
                </Button>
              )}
              {conversation.salesOutcome !== 'cancelled' && !conversation.closingSource && (
                <Button
                  disabled={actionLoading === conversation.phone + ':mark-closing'}
                  onClick={() => onMarkClosing(conversation)}
                  variant="secondary"
                >
                  <CheckCircle2 className="size-4" />
                  Mark Closing
                </Button>
              )}
              {conversation.salesOutcome === 'cancelled' ? (
                <Button
                  disabled={actionLoading === conversation.phone + ':undo-cancelled'}
                  onClick={() => onUndoCancelled(conversation)}
                  variant="secondary"
                >
                  Undo Cancel
                </Button>
              ) : (
                <Button
                  disabled={actionLoading === conversation.phone + ':mark-cancelled'}
                  onClick={() => onMarkCancelled(conversation)}
                  variant="outline"
                >
                  Mark Cancelled
                </Button>
              )}
              {conversation.status === 'handover' && (
                <Button
                  disabled={actionLoading === conversation.phone + ':active'}
                  onClick={() => onResumeAI(conversation)}
                  variant="secondary"
                >
                  <PlayCircle className="size-4" />
                  Resume
                </Button>
              )}
              {conversation.status === 'closed' && (
                <>
                  <Button
                    disabled={actionLoading === conversation.phone + ':active'}
                    onClick={() => onResumeAI(conversation)}
                    variant="secondary"
                  >
                    <PlayCircle className="size-4" />
                    Reactivate
                  </Button>
                  <Button
                    disabled={actionLoading === conversation.phone + ':not-closing'}
                    onClick={() => onNotClosing(conversation)}
                    variant="outline"
                  >
                    Not Closing
                  </Button>
                </>
              )}
              {conversation.status !== 'closed' && (
                <Button
                  disabled={actionLoading === conversation.phone + ':closed'}
                  onClick={() => onSelesai(conversation)}
                  variant="destructive"
                >
                  <CheckCircle2 className="size-4" />
                  Archive
                </Button>
              )}
              <Button
                disabled={actionLoading === conversation.phone + ':delete'}
                onClick={() => onDeleteOrder(conversation)}
                variant="outline"
              >
                <Trash2 className="size-4" />
                Delete Order
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ShippingRecapDetailSheet({
  recap,
  onOpenChange,
}: {
  recap: ShippingRecap | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(recap)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {recap && (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{recap.recipientName || recap.customerName || 'Unknown recipient'}</SheetTitle>
                  <SheetDescription className="mt-1 font-mono">{recap.orderIdBerdu || recap.customerPhone}</SheetDescription>
                </div>
                <RecapStatusBadge status={recap.status} />
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Export fields</h2>
                <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                  <DetailRow label="CS" value={[recap.csName, recap.csPhone].filter(Boolean).join(' | ') || '-'} />
                  <DetailRow label="Penerima" value={[recap.recipientName, recap.recipientPhone].filter(Boolean).join(' | ') || '-'} />
                  <DetailRow label="Alamat" value={recap.recipientAddress || '-'} />
                  <DetailRow label="Kecamatan" value={recap.recipientDistrict || '-'} />
                  <DetailRow label="Kota" value={recap.recipientCity || '-'} />
                  <DetailRow label="Isi paket" value={recap.packageContent || '-'} />
                  <DetailRow label="Bayar" value={recap.paymentMethod.toUpperCase()} />
                  <DetailRow label="Total" value={formatRupiah(recap.total ?? recap.codValue ?? recap.nonCodItemPrice)} strong />
                  <DetailRow label="Diskon" value={formatRupiah(recap.discount ?? recap.inferredDiscount)} />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">Flags</h2>
                {recap.flags.length === 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">No flags.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {recap.flags.map((flag) => (
                      <Badge key={flag} variant="outline">{flag}</Badge>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">Source message</h2>
                <div className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm">{recap.sourceMessageText}</div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ConfirmDeleteDialog({
  conversation,
  loading,
  onCancel,
  onConfirm,
}: {
  conversation: Conversation | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!conversation) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <Trash2 className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Delete order?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This removes the order, conversation, chat history, and related today counters from Convex. This cannot be
              undone from the panel.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{conversation.customerName || 'Unknown'}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{conversation.order_id || conversation.phone}</div>
          <div className="mt-1 text-muted-foreground">{conversation.productName || '-'}</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={loading} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={loading} onClick={onConfirm} variant="destructive">
            <Trash2 className="size-4" />
            Delete Order
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words', strong && 'font-semibold text-foreground')}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Conversation['status'] }) {
  if (status === 'handover') {
    return <Badge className="border-amber-500/30 text-amber-400" variant="outline">handover</Badge>;
  }

  if (status === 'closed') {
    return <Badge variant="secondary">closed</Badge>;
  }

  return <Badge className="border-emerald-500/30 text-emerald-400" variant="outline">active</Badge>;
}

function OutcomeBadge({ outcome }: { outcome: 'ai_won' | 'manual_won' | 'cancelled' }) {
  if (outcome === 'cancelled') {
    return <Badge className="border-destructive/30 text-destructive" variant="outline">cancelled</Badge>;
  }

  return (
    <Badge className={outcome === 'manual_won' ? 'border-sky-500/30 text-sky-400' : 'border-emerald-500/30 text-emerald-400'} variant="outline">
      {outcome === 'manual_won' ? 'manual closing' : 'AI closing'}
    </Badge>
  );
}

function RecapStatusBadge({ status }: { status: RecapStatus }) {
  if (status === 'ready') {
    return <Badge className="border-emerald-500/30 text-emerald-400" variant="outline">Siap Export</Badge>;
  }

  if (status === 'needs_review') {
    return <Badge variant="destructive">Perlu Cek</Badge>;
  }

  if (status === 'exported') {
    return <Badge variant="secondary">Sudah Export</Badge>;
  }

  if (status === 'cancelled_after_export') {
    return <Badge className="border-destructive/30 text-destructive" variant="outline">Cancel After Export</Badge>;
  }

  return <Badge className="border-destructive/30 text-destructive" variant="outline">Cancel</Badge>;
}

function ReadinessRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge className={ok ? 'border-emerald-500/30 text-emerald-400' : ''} variant="outline">
        {value}
      </Badge>
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

function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRupiah(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  return 'Rp' + new Intl.NumberFormat('id-ID').format(value);
}
