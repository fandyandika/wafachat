'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';

interface Conversation {
  phone: string;
  status: 'active' | 'handover' | 'closed';
  customerName: string;
  productName: string;
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<Stats>({
    orders: 0,
    closings: 0,
    handovers: 0,
    closed_today: 0,
    date: '',
  });
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setError('');
      const [convRes, statsRes, globalRes] = await Promise.all([
        fetch('/api/conversations'),
        fetch('/api/stats'),
        fetch('/api/global'),
      ]);

      if (!convRes.ok || !statsRes.ok || !globalRes.ok) {
        throw new Error('Panel data request failed');
      }

      const convData = await convRes.json();
      const statsData = await statsRes.json();
      const globalData = await globalRes.json();
      setConversations(convData.conversations || []);
      setStats(statsData);
      setGlobalEnabled(globalData.globalEnabled !== false);
      setLastUpdated(new Date().toLocaleTimeString('id-ID'));
    } catch {
      setError('Tidak bisa memuat data terbaru. Data terakhir tetap ditampilkan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await fetch('/api/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    fetchAll();
  };

  const setStatus = async (phone: string, status: string, note?: string) => {
    setActionLoading(phone + ':' + status);
    await fetch('/api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, status, note }),
    });
    await fetchAll();
    setActionLoading(null);
  };

  const active = conversations.filter((conversation) => conversation.status === 'active');
  const handover = conversations.filter((conversation) => conversation.status === 'handover');
  const closed = conversations.filter((conversation) => conversation.status === 'closed');
  const crAI = stats.orders > 0 ? Math.round((stats.closings / stats.orders) * 100) : 0;
  const handoverRate = stats.orders > 0 ? Math.round((stats.handovers / stats.orders) * 100) : 0;

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
        value: stats.handovers,
        detail: 'Needs CS attention',
        icon: CircleAlert,
        tone: 'text-amber-400',
      },
      {
        label: 'Handover rate',
        value: `${handoverRate}%`,
        detail: 'Handover / orders',
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
    [active.length, crAI, handoverRate, stats],
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
                  <Switch checked={globalEnabled} onCheckedChange={toggleGlobal} />
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
            {error && (
              <Card className="border-amber-500/30 bg-amber-500/10">
                <CardContent className="flex items-center gap-3 py-3 text-sm text-amber-200">
                  <CircleAlert className="size-4" />
                  {error}
                </CardContent>
              </Card>
            )}

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
                    onPauseAI={(phone) => setStatus(phone, 'handover', 'manual by CS')}
                    onResumeAI={(phone) => setStatus(phone, 'active')}
                    onSelesai={(phone) => setStatus(phone, 'closed')}
                  />
                )}

                <ConversationPanel
                  title="Active conversations"
                  description="Current non-closed conversations synced from n8n State Manager."
                  rows={active}
                  actionLoading={actionLoading}
                  loading={loading}
                  onPauseAI={(phone) => setStatus(phone, 'handover', 'manual by CS')}
                  onResumeAI={(phone) => setStatus(phone, 'active')}
                  onSelesai={(phone) => setStatus(phone, 'closed')}
                />

                {closed.length > 0 && (
                  <ConversationPanel
                    title="Closed today"
                    description="Finished conversations. Reactivate if Done was clicked by mistake."
                    rows={closed}
                    actionLoading={actionLoading}
                    loading={loading}
                    onPauseAI={(phone) => setStatus(phone, 'handover', 'manual by CS')}
                    onResumeAI={(phone) => setStatus(phone, 'active', 'reactivated by CS')}
                    onSelesai={(phone) => setStatus(phone, 'closed')}
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
                    <Formula label="Handover rate" value="handovers / orders" />
                  </CardContent>
                </Card>
              </aside>
            </section>
          </div>
        </main>
      </div>
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
}: {
  title: string;
  description: string;
  rows: Conversation[];
  actionLoading: string | null;
  loading: boolean;
  highlighted?: boolean;
  onPauseAI: (phone: string) => void;
  onResumeAI: (phone: string) => void;
  onSelesai: (phone: string) => void;
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
                  <TableRow key={conversation.phone}>
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
                      <div className="flex items-center justify-end gap-2">
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
                            onClick={() => onPauseAI(conversation.phone)}
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
                            onClick={() => onResumeAI(conversation.phone)}
                            size="sm"
                            variant="secondary"
                          >
                            <PlayCircle className="size-3.5" />
                            Resume
                          </Button>
                        )}
                        {conversation.status === 'closed' ? (
                          <Button
                            disabled={actionLoading === conversation.phone + ':active'}
                            onClick={() => onResumeAI(conversation.phone)}
                            size="sm"
                            variant="secondary"
                          >
                            <PlayCircle className="size-3.5" />
                            Reactivate
                          </Button>
                        ) : (
                          <Button
                            disabled={actionLoading === conversation.phone + ':closed'}
                            onClick={() => onSelesai(conversation.phone)}
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
