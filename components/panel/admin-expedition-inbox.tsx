"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowLeft, Ban, CheckCheck, Clock3, MessageSquareText, Plus, RefreshCw, RotateCcw, Send, Settings2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { filterAdminThreads, type AdminInboxView } from "./admin-expedition-inbox-model";
import { AdminExpeditionThreadList } from "./admin-expedition-thread-list";

type Feedback = { kind: "ok" | "error"; message: string } | null;

type AdminTemplateOption = {
  id: string;
  label: string;
  variables: Array<{ key: string; label: string; required: boolean }>;
};

type AdminExpeditionNewChatDialogProps = {
  templates: AdminTemplateOption[];
  selectedTemplate?: AdminTemplateOption;
  templateId: string;
  templateValues: Record<string, string>;
  customerPhone: string;
  customerName: string;
  productName: string;
  totalAmount: string;
  busy: boolean;
  onCustomerPhoneChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onProductNameChange: (value: string) => void;
  onTotalAmountChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onTemplateValueChange: (key: string, value: string) => void;
  onClose: () => void;
  onSend: () => void;
};

export function parseOptionalRupiah(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/[.\s]/g, "");
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Harga total harus berupa rupiah bulat yang tidak negatif.");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Harga total harus berupa rupiah bulat yang tidak negatif.");
  }
  return parsed;
}

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

type AdminThreadContext = {
  customerPhone: string;
  productName?: string;
  totalAmount?: number;
  orderId?: string;
};

export function adminThreadListSubtitle(context: AdminThreadContext) {
  return context.productName || (context.orderId ? `Order ${context.orderId}` : context.customerPhone);
}

export function adminThreadMeta(context: AdminThreadContext) {
  return [
    context.customerPhone,
    context.productName,
    context.totalAmount === undefined ? undefined : formatRupiah(context.totalAmount),
    context.orderId ? `Order ${context.orderId}` : undefined,
  ].filter(Boolean).join(" · ");
}

export function AdminExpeditionNewChatDialog({
  templates,
  selectedTemplate,
  templateId,
  templateValues,
  customerPhone,
  customerName,
  productName,
  totalAmount,
  busy,
  onCustomerPhoneChange,
  onCustomerNameChange,
  onProductNameChange,
  onTotalAmountChange,
  onTemplateChange,
  onTemplateValueChange,
  onClose,
  onSend,
}: AdminExpeditionNewChatDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="new-expedition-title">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-card p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="new-expedition-title" className="text-lg font-semibold">Hubungi customer</h3>
            <p className="text-sm text-muted-foreground">Mulai percakapan dengan template approved.</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Tutup" onClick={onClose}>×</Button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Nomor WhatsApp
            <input inputMode="tel" value={customerPhone} onChange={(event) => onCustomerPhoneChange(event.target.value)} placeholder="08xxx / 62xxx" className="min-h-11 rounded-lg border border-input bg-background px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Nama customer <span className="font-normal text-muted-foreground">(opsional)</span></span>
            <input value={customerName} onChange={(event) => onCustomerNameChange(event.target.value)} className="min-h-11 rounded-lg border border-input bg-background px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Produk <span className="font-normal text-muted-foreground">(opsional)</span></span>
            <input value={productName} onChange={(event) => onProductNameChange(event.target.value)} className="min-h-11 rounded-lg border border-input bg-background px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Harga total <span className="font-normal text-muted-foreground">(opsional)</span></span>
            <input inputMode="numeric" value={totalAmount} onChange={(event) => onTotalAmountChange(event.target.value)} placeholder="189.000" className="min-h-11 rounded-lg border border-input bg-background px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Template
            <select value={templateId} onChange={(event) => onTemplateChange(event.target.value)} className="min-h-11 rounded-lg border border-input bg-background px-3">
              {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
          </label>
          {selectedTemplate?.variables.map((variable) => (
            <label key={variable.key} className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              <span>{variable.label}{!variable.required && <span className="font-normal text-muted-foreground"> (opsional)</span>}</span>
              <input value={templateValues[variable.key] ?? ""} onChange={(event) => onTemplateValueChange(variable.key, event.target.value)} className="min-h-11 rounded-lg border border-input bg-background px-3" />
            </label>
          ))}
          {selectedTemplate?.variables.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground sm:col-span-2">
              Template tanpa variabel — siap dikirim sesuai isi approved di KirimDev.
            </p>
          )}
        </div>
        {selectedTemplate && (
          <div className="mt-4 rounded-xl border border-ledger-rule bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview template</p>
            <p className="mt-1 text-sm font-medium">{selectedTemplate.label}</p>
            {selectedTemplate.variables.length > 0 && <dl className="mt-2 space-y-1 text-xs">{selectedTemplate.variables.map((variable) => <div key={variable.key} className="flex justify-between gap-4"><dt className="text-muted-foreground">{variable.label}</dt><dd className="truncate text-right font-medium">{templateValues[variable.key] || "—"}</dd></div>)}</dl>}
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={onClose}>Batal</Button>
          <Button disabled={busy || !customerPhone.trim() || !selectedTemplate} onClick={onSend}>{busy ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />} Kirim template</Button>
        </div>
      </div>
    </div>
  );
}

function requestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function timeLabel(value?: number) {
  if (!value) return "Belum ada pesan";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(value);
}

function statusLabel(status: string) {
  if (status === "accepted") return "Terkirim";
  if (status === "delivered") return "Diterima";
  if (status === "read") return "Dibaca";
  if (status === "failed") return "Gagal";
  if (status === "unknown") return "Perlu dicek";
  return "Mengirim";
}

export function AdminExpeditionInbox() {
  const setup = useQuery(api.adminInbox.getSetup, {});
  const channelId = setup?.channel?.id;
  const threads = usePaginatedQuery(
    api.adminInbox.listThreads,
    channelId ? { channelId, includeArchived: false } : "skip",
    { initialNumItems: 30 },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<AdminInboxView>("all");
  const selectedThread = threads.results.find((thread) => String(thread.id) === selectedId) ?? null;
  const visibleThreads = useMemo(
    () => filterAdminThreads(threads.results, search, view),
    [search, threads.results, view],
  );
  const messages = useQuery(api.adminInbox.listMessages, selectedThread ? { threadId: selectedThread.id, limit: 100 } : "skip");
  const linkedOrder = useQuery(api.adminInbox.getLinkedOrderState, selectedThread ? { threadId: selectedThread.id } : "skip");
  const cancelLinkedOrder = useMutation(api.adminInbox.cancelLinkedOrder);
  const undoLinkedOrderCancellation = useMutation(api.adminInbox.undoLinkedOrderCancellation);
  const [newOpen, setNewOpen] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [productName, setProductName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [reply, setReply] = useState("");
  const [templateAttemptId, setTemplateAttemptId] = useState<string | null>(null);
  const [replyAttemptId, setReplyAttemptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const activeTemplates = useMemo(() => setup?.templates.filter((template) => template.isActive) ?? [], [setup?.templates]);
  const selectedTemplate = activeTemplates.find((template) => String(template.id) === templateId) ?? activeTemplates[0];

  useEffect(() => {
    if (!templateId && activeTemplates[0]) setTemplateId(String(activeTemplates[0].id));
  }, [activeTemplates, templateId]);

  async function sendTemplate() {
    if (!setup?.channel || !selectedTemplate) return;
    const attemptId = templateAttemptId ?? requestId();
    if (!templateAttemptId) setTemplateAttemptId(attemptId);
    let keepAttempt = false;
    setBusy(true);
    setFeedback(null);
    try {
      const parsedTotalAmount = parseOptionalRupiah(totalAmount);
      const response = await fetch("/api/admin-inbox/send-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId: setup.channel.id,
          customerPhone,
          customerName: customerName.trim() || undefined,
          productName: productName.trim() || undefined,
          totalAmount: parsedTotalAmount,
          templateId: selectedTemplate.id,
          values: selectedTemplate.variables.map((variable) => ({ key: variable.key, value: templateValues[variable.key] ?? "" })),
          clientRequestId: attemptId,
        }),
      });
      const result = await response.json();
      keepAttempt = result.statusUnknown === true;
      if (!response.ok || !result.ok) throw new Error(result.error || "Template gagal dikirim.");
      setFeedback({ kind: "ok", message: "Template diterima KirimDev." });
      setNewOpen(false);
      setCustomerPhone("");
      setCustomerName("");
      setProductName("");
      setTotalAmount("");
      setTemplateValues({});
      setTemplateAttemptId(null);
    } catch (error) {
      if (!keepAttempt) setTemplateAttemptId(null);
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Template gagal dikirim." });
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!selectedThread || !reply.trim()) return;
    const attemptId = replyAttemptId ?? requestId();
    if (!replyAttemptId) setReplyAttemptId(attemptId);
    let keepAttempt = false;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin-inbox/send-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: selectedThread.id, text: reply, clientRequestId: attemptId }),
      });
      const result = await response.json();
      keepAttempt = result.statusUnknown === true;
      if (!response.ok || !result.ok) throw new Error(result.error || "Pesan gagal dikirim.");
      setReply("");
      setReplyAttemptId(null);
      setFeedback({ kind: "ok", message: "Pesan diterima KirimDev." });
    } catch (error) {
      if (!keepAttempt) setReplyAttemptId(null);
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Pesan gagal dikirim." });
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!selectedThread || !cancelReason.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      await cancelLinkedOrder({ threadId: selectedThread.id, reason: cancelReason });
      setCancelOpen(false);
      setCancelReason("");
      setFeedback({ kind: "ok", message: `Order ${linkedOrder?.orderId ?? ""} dibatalkan.` });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Pembatalan order gagal." });
    } finally {
      setBusy(false);
    }
  }

  async function undoCancellation() {
    if (!selectedThread) return;
    setBusy(true);
    setFeedback(null);
    try {
      await undoLinkedOrderCancellation({ threadId: selectedThread.id });
      setFeedback({ kind: "ok", message: `Pembatalan order ${linkedOrder?.orderId ?? ""} dibatalkan.` });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Pembatalan tidak dapat dipulihkan." });
    } finally {
      setBusy(false);
    }
  }

  if (setup === undefined) {
    return <div role="status" className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" /> Memuat inbox ekspedisi…</div>;
  }

  if (!setup.ready || !setup.channel) {
    return (
      <section className="mx-auto flex min-h-[60vh] max-w-xl items-center">
        <div className="w-full rounded-2xl border border-ledger-rule bg-card p-6 text-center shadow-sm md:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Settings2 className="size-5" /></span>
          <h2 className="mt-4 text-xl font-semibold">Inbox Ekspedisi belum siap</h2>
          <p className="mt-2 text-sm text-muted-foreground">Lengkapi nomor API KirimDev dan minimal satu template approved.</p>
          <ul className="mx-auto mt-4 max-w-sm text-left text-sm text-amber-900">{setup.missing.map((item) => <li key={item}>• {item}</li>)}</ul>
          <Link href="/panel/settings?section=expedition" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Buka pengaturan</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ledger-rule bg-card px-4 py-3">
        <div>
          <h2 className="font-semibold text-ledger-ink">Inbox Ekspedisi</h2>
          <p className="text-xs text-muted-foreground">Live via webhook · Tidak ada query berulang</p>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> Hubungi customer</Button>
      </div>

      {feedback && (
        <div role={feedback.kind === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", feedback.kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/30 bg-destructive/5 text-destructive")}>{feedback.message}</div>
      )}

      <div className="min-h-[calc(100dvh-12rem)] overflow-hidden rounded-xl border border-ledger-rule bg-card xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
        <AdminExpeditionThreadList
          className={selectedThread ? "hidden xl:flex" : undefined}
          threads={visibleThreads}
          totalLoaded={threads.results.length}
          selectedId={selectedId}
          search={search}
          view={view}
          loadingFirstPage={threads.status === "LoadingFirstPage"}
          canLoadMore={threads.status === "CanLoadMore"}
          loadingMore={threads.status === "LoadingMore"}
          onSearchChange={setSearch}
          onViewChange={setView}
          onSelect={setSelectedId}
          onLoadMore={() => threads.loadMore(30)}
        />

        <main className={cn("min-w-0", !selectedThread && "hidden xl:block")}>
          {!selectedThread ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center"><MessageSquareText className="size-7 text-muted-foreground" /><p className="mt-3 font-semibold">Pilih percakapan</p><p className="mt-1 text-sm text-muted-foreground">Riwayat pesan dan tindakan tampil di sini.</p></div>
          ) : (
            <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
              <header className="flex items-center gap-3 border-b border-ledger-rule px-3 py-3 md:px-5">
                <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Kembali ke daftar" onClick={() => setSelectedId(null)}><ArrowLeft className="size-5" /></Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selectedThread.customerName || selectedThread.customerPhone}</p>
                  <p className="truncate text-xs text-muted-foreground">{adminThreadMeta(selectedThread)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {linkedOrder && (linkedOrder.status === "cancelled" || linkedOrder.status === "cancelled_after_export" ? linkedOrder.canUndo ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void undoCancellation()}><RotateCcw className="size-3.5" /> <span className="hidden sm:inline">Batalkan pembatalan</span></Button>
                  ) : (
                    <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">Order dibatalkan</span>
                  ) : (
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => setCancelOpen(true)}><Ban className="size-3.5" /> <span className="hidden sm:inline">Batalkan order</span></Button>
                  ))}
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", selectedThread.windowOpen ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>{selectedThread.windowOpen ? "Balasan bebas aktif" : "Hanya template"}</span>
                </div>
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4 md:p-6">
                {messages === undefined ? <p className="text-center text-sm text-muted-foreground">Memuat pesan…</p> : messages.map((message) => (
                  <div key={String(message.id)} className={cn("flex", message.direction === "outbound" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm md:max-w-[70%]", message.direction === "outbound" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-ledger-rule bg-card")}>
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      {message.failureReason && <p className={cn("mt-2 rounded-md px-2 py-1 text-xs", message.direction === "outbound" ? "bg-black/15 text-primary-foreground" : "bg-destructive/10 text-destructive")}>{message.failureReason}</p>}
                      <div className={cn("mt-1.5 flex items-center justify-end gap-1 text-[10px]", message.direction === "outbound" ? "text-primary-foreground/75" : "text-muted-foreground")}><span>{timeLabel(message.createdAt)}</span>{message.direction === "outbound" && <><CheckCheck className="size-3" /><span>{statusLabel(message.status)}</span></>}</div>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="border-t border-ledger-rule bg-card p-3 md:p-4">
                {selectedThread.windowOpen ? (
                  <div className="flex items-end gap-2"><label className="sr-only" htmlFor="admin-inbox-reply">Balas customer</label><textarea id="admin-inbox-reply" rows={1} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Tulis balasan…" className="min-h-11 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm" /><Button size="icon" aria-label="Kirim balasan" disabled={busy || !reply.trim()} onClick={() => void sendReply()}><Send className="size-4" /></Button></div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="flex items-center gap-2"><Clock3 className="size-4" /> Jendela 24 jam tertutup.</span><Button size="sm" variant="outline" onClick={() => { setCustomerPhone(selectedThread.customerPhone); setCustomerName(selectedThread.customerName ?? ""); setProductName(selectedThread.productName ?? ""); setTotalAmount(selectedThread.totalAmount === undefined ? "" : String(selectedThread.totalAmount)); setNewOpen(true); }}>Kirim template</Button></div>
                )}
              </footer>
            </div>
          )}
        </main>
      </div>

      {newOpen && (
        <AdminExpeditionNewChatDialog
          templates={activeTemplates}
          selectedTemplate={selectedTemplate}
          templateId={selectedTemplate ? String(selectedTemplate.id) : ""}
          templateValues={templateValues}
          customerPhone={customerPhone}
          customerName={customerName}
          productName={productName}
          totalAmount={totalAmount}
          busy={busy}
          onCustomerPhoneChange={setCustomerPhone}
          onCustomerNameChange={setCustomerName}
          onProductNameChange={setProductName}
          onTotalAmountChange={setTotalAmount}
          onTemplateChange={(value) => { setTemplateId(value); setTemplateValues({}); }}
          onTemplateValueChange={(key, value) => setTemplateValues((current) => ({ ...current, [key]: value }))}
          onClose={() => setNewOpen(false)}
          onSend={() => void sendTemplate()}
        />
      )}

      {cancelOpen && linkedOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="alertdialog" aria-modal="true" aria-labelledby="cancel-order-title">
          <div className="w-full rounded-t-2xl bg-card p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
            <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><TriangleAlertIcon /></span>
            <h3 id="cancel-order-title" className="mt-4 text-lg font-semibold">Batalkan order {linkedOrder.orderId}?</h3>
            <p className="mt-1 text-sm text-muted-foreground">Hanya order ini yang akan dibatalkan. Tindakan tercatat dan dapat di-undo.</p>
            <label className="mt-4 grid gap-1.5 text-sm font-medium">Alasan pembatalan<textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2" placeholder="Contoh: alamat perlu dikoreksi" /></label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => setCancelOpen(false)}>Kembali</Button><Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={() => void cancelOrder()}>Batalkan order {linkedOrder.orderId}</Button></div>
          </div>
        </div>
      )}
    </section>
  );
}

function TriangleAlertIcon() {
  return <span aria-hidden="true" className="text-lg font-bold">!</span>;
}
