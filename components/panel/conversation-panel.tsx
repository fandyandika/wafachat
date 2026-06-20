'use client';

import { useQuery } from 'convex/react';
import {
  CheckCircle2,
  ExternalLink,
  MessagesSquare,
  PauseCircle,
  PlayCircle,
  Search,
  Trash2,
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Conversation, QueueKey } from '@/components/panel/types';
import { formatTime } from '@/lib/format';

export function ConversationPanel({
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

export function ConversationDetailSheet({
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

export function ConfirmDeleteDialog({
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
    <AlertDialog open={Boolean(conversation)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" />
            Delete order?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the order, conversation, chat history, and related today counters from Convex. This cannot be
            undone from the panel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{conversation.customerName || 'Unknown'}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{conversation.order_id || conversation.phone}</div>
          <div className="mt-1 text-muted-foreground">{conversation.productName || '-'}</div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={loading} onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            <Trash2 className="size-4" />
            Delete Order
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
    return <Badge variant="warning">handover</Badge>;
  }

  if (status === 'closed') {
    return <Badge variant="secondary">closed</Badge>;
  }

  return <Badge variant="success">active</Badge>;
}

function OutcomeBadge({ outcome }: { outcome: 'ai_won' | 'manual_won' | 'cancelled' }) {
  if (outcome === 'cancelled') {
    return <Badge variant="destructive">cancelled</Badge>;
  }

  return (
    <Badge variant={outcome === 'manual_won' ? 'info' : 'success'}>
      {outcome === 'manual_won' ? 'manual closing' : 'AI closing'}
    </Badge>
  );
}
