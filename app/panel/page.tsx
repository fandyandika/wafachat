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
  Settings,
  ShieldCheck,
  SlidersHorizontal,
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
}

interface Stats {
  orders: number;
  closings: number;
  handovers: number;
  closed_today: number;
  date: string;
}

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, active: true },
  { label: 'Conversations', icon: MessagesSquare },
  { label: 'CS Team', icon: UsersRound },
  { label: 'Automation', icon: SlidersHorizontal },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
];

export default function PanelPage() {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  const conversationsData = useQuery(api.state.listConversations, { includeClosed: true });
  const statsData = useQuery(api.state.getDailyStats, {});
  const globalEnabledData = useQuery(api.settings.getGlobalAiEnabled, {});
  const setConversationStatus = useMutation(api.state.setConversationStatusFromN8n);
  const markNotClosing = useMutation(api.state.markConversationNotClosing);
  const setGlobalAiEnabled = useMutation(api.settings.setGlobalAiEnabled);

  useEffect(() => {
    if (conversationsData !== undefined && statsData !== undefined && globalEnabledData !== undefined) {
      setLastUpdated(new Date().toLocaleTimeString('id-ID'));
    }
  }, [conversationsData, globalEnabledData, statsData]);

  const conversations = (conversationsData ?? []) as Conversation[];
  const stats: Stats = {
    orders: statsData?.orders ?? 0,
    closings: statsData?.closings ?? 0,
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
      note: 'not closing / corrected by CS',
    });
    setActionLoading(null);
  };

  const active = conversations.filter((conversation) => conversation.status === 'active');
  const handover = conversations.filter((conversation) => conversation.status === 'handover');
  const closed = conversations.filter((conversation) => conversation.status === 'closed');
  const crAI = stats.orders > 0 ? Math.round((stats.closings / stats.orders) * 100) : 0;
  const handoverRate = stats.orders > 0 ? Math.round((handover.length / stats.orders) * 100) : 0;

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
        label: 'AI closings',
        value: stats.closings,
        detail: 'Deduped by order ID',
        icon: CheckCircle2,
        tone: 'text-emerald-400',
      },
      {
        label: 'AI CR',
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
        label: 'Closed today',
        value: stats.closed_today,
        detail: 'Marked finished',
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
                key={item.label}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors',
                  item.active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                type="button"
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
                {!item.active && <span className="ml-auto text-[10px] text-muted-foreground/70">soon</span>}
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
                  <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
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
                <Badge key={item.label} variant={item.active ? 'default' : 'secondary'}>
                  {item.label}
                </Badge>
              ))}
            </div>
          </header>

          <div className="space-y-6 p-4 md:p-6">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              {loading
                ? Array.from({ length: 7 }).map((_, index) => <MetricSkeleton key={index} />)
                : cards.map((card) => <MetricCard key={card.label} {...card} />)}
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                {handover.length > 0 && (
                  <ConversationPanel
                    title="Needs CS attention"
                    description="Handover conversations should be handled manually."
                    rows={handover}
                    actionLoading={actionLoading}
                    loading={loading}
                    highlighted
                    onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
                    onResumeAI={(conversation) => setStatus(conversation.phone, 'active', undefined, conversation.order_id)}
                    onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
                    onNotClosing={notClosing}
                    onOpenDetail={setSelectedConversation}
                  />
                )}

                <ConversationPanel
                  title="Active conversations"
                  description="Current non-closed conversations synced from n8n State Manager."
                  rows={active}
                  actionLoading={actionLoading}
                  loading={loading}
                  onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
                  onResumeAI={(conversation) => setStatus(conversation.phone, 'active', undefined, conversation.order_id)}
                  onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
                  onNotClosing={notClosing}
                  onOpenDetail={setSelectedConversation}
                />

                {closed.length > 0 && (
                  <ConversationPanel
                    title="Closed today"
                    description="Finished conversations. Reactivate if Done was clicked by mistake."
                    rows={closed}
                    actionLoading={actionLoading}
                    loading={loading}
                    onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
                    onResumeAI={(conversation) => setStatus(conversation.phone, 'active', 'reactivated by CS', conversation.order_id)}
                    onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
                    onNotClosing={notClosing}
                    onOpenDetail={setSelectedConversation}
                  />
                )}
              </div>

              <aside className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">System readiness</CardTitle>
                    <CardDescription>Operational checks for this panel.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ReadinessRow label="n8n State Manager" value="Connected" ok />
                    <ReadinessRow label="Closing dedup" value="order_id" ok />
                    <ReadinessRow label="Global AI switch" value={globalEnabled ? 'Enabled' : 'Disabled'} ok={globalEnabled} />
                    <Separator />
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Future modules are staged in the sidebar. Dashboard is the only active surface in this slice.
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
                    <Formula label="Closing AI" value="unique order_id" />
                    <Formula label="CR AI" value="closings / orders" />
                    <Formula label="Handover rate" value="current handovers / orders" />
                  </CardContent>
                </Card>
              </aside>
            </section>
          </div>
        </main>
      </div>
      <ConversationDetailSheet
        actionLoading={actionLoading}
        conversation={selectedConversation}
        onNotClosing={notClosing}
        onOpenChange={(open) => {
          if (!open) setSelectedConversation(null);
        }}
        onPauseAI={(conversation) => setStatus(conversation.phone, 'handover', 'manual by CS', conversation.order_id)}
        onResumeAI={(conversation) => setStatus(conversation.phone, 'active', undefined, conversation.order_id)}
        onSelesai={(conversation) => setStatus(conversation.phone, 'closed', undefined, conversation.order_id)}
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

function ConversationPanel({
  title,
  description,
  rows,
  actionLoading,
  loading,
  highlighted = false,
  onPauseAI,
  onResumeAI,
  onSelesai,
  onNotClosing,
  onOpenDetail,
}: {
  title: string;
  description: string;
  rows: Conversation[];
  actionLoading: string | null;
  loading: boolean;
  highlighted?: boolean;
  onPauseAI: (conversation: Conversation) => void;
  onResumeAI: (conversation: Conversation) => void;
  onSelesai: (conversation: Conversation) => void;
  onNotClosing: (conversation: Conversation) => void;
  onOpenDetail: (conversation: Conversation) => void;
}) {
  return (
    <Card className={cn(highlighted && 'border-amber-500/30 bg-amber-500/5')}>
      <CardHeader>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <CardAction>
          <Badge variant={highlighted ? 'outline' : 'secondary'}>{rows.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
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
          <div className="overflow-x-auto rounded-lg border">
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
                            Done
                          </Button>
                        )}
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
  onPauseAI,
  onResumeAI,
  onSelesai,
  onNotClosing,
}: {
  conversation: Conversation | null;
  actionLoading: string | null;
  onOpenChange: (open: boolean) => void;
  onPauseAI: (conversation: Conversation) => void;
  onResumeAI: (conversation: Conversation) => void;
  onSelesai: (conversation: Conversation) => void;
  onNotClosing: (conversation: Conversation) => void;
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
                  Done
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
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
