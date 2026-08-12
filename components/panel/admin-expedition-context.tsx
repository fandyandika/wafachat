"use client";

import React from "react";
import { Ban, LoaderCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminInboxThreadView } from "./admin-expedition-inbox-model";

type LinkedOrderStatus = "ready" | "needs_review" | "exported" | "delivered" | "cancelled" | "cancelled_after_export";

type LinkedOrderContext = {
  orderId: string;
  status: LinkedOrderStatus;
  cancelReason?: string;
  canUndo: boolean;
} | null | undefined;

type AdminExpeditionContextProps = {
  thread: AdminInboxThreadView;
  linkedOrder: LinkedOrderContext;
  busy: boolean;
  onCancel: () => void;
  onUndoCancellation: () => void;
};

function formatRupiah(value?: number) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function linkedOrderStatusLabel(status: LinkedOrderStatus) {
  if (status === "ready") return "Siap diproses";
  if (status === "needs_review") return "Perlu diperiksa";
  if (status === "exported") return "Sudah diekspor";
  if (status === "delivered") return "Terkirim";
  if (status === "cancelled_after_export") return "Dibatalkan setelah ekspor";
  return "Dibatalkan";
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-ledger-rule py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-ledger-ink">{children}</dd>
    </div>
  );
}

export function AdminExpeditionContext({
  thread,
  linkedOrder,
  busy,
  onCancel,
  onUndoCancellation,
}: AdminExpeditionContextProps) {
  const cancelled = linkedOrder?.status === "cancelled" || linkedOrder?.status === "cancelled_after_export";

  return (
    <aside aria-label="Konteks customer dan order" className="hidden min-h-0 flex-col border-l border-ledger-rule bg-card xl:flex">
      <div className="border-b border-ledger-rule px-4 py-3">
        <h3 className="text-sm font-semibold text-ledger-ink">Detail customer</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Konteks untuk percakapan aktif</p>
      </div>

      <dl className="px-4">
        <Fact label="Nomor WhatsApp">{thread.customerPhone}</Fact>
        <Fact label="Produk">{thread.productName || "—"}</Fact>
        <Fact label="Total">{formatRupiah(thread.totalAmount)}</Fact>
      </dl>

      <div className="mt-2 border-y border-ledger-rule bg-muted/30 px-4 py-3">
        <h3 className="text-sm font-semibold text-ledger-ink">Order terkait</h3>
      </div>

      <div className="px-4 py-3">
        {linkedOrder === undefined ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Memeriksa status order…
          </div>
        ) : linkedOrder === null ? (
          <div className="rounded-[0.625rem] bg-muted px-3 py-3">
            <p className="text-sm font-medium">Belum terhubung ke order</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Tindakan order hanya tersedia jika ID order telah diverifikasi.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tabular-nums">{linkedOrder.orderId}</p>
                <p className={cn("mt-1 text-xs font-medium", cancelled ? "text-destructive" : "text-muted-foreground")}>
                  {linkedOrderStatusLabel(linkedOrder.status)}
                </p>
              </div>
              <span className={cn("mt-0.5 size-2 shrink-0 rounded-full", cancelled ? "bg-destructive" : "bg-positive")} aria-hidden="true" />
            </div>

            {linkedOrder.cancelReason && (
              <div className="rounded-[0.625rem] bg-negative-soft px-3 py-2 text-xs leading-5 text-negative">
                Alasan: {linkedOrder.cancelReason}
              </div>
            )}

            {cancelled ? linkedOrder.canUndo ? (
              <button type="button" disabled={busy} onClick={onUndoCancellation} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-input bg-background px-3 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                <RotateCcw className="size-4" /> Pulihkan order
              </button>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">Pembatalan tidak dapat dipulihkan.</p>
            ) : (
              <button type="button" disabled={busy} onClick={onCancel} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-destructive/30 bg-background px-3 text-sm font-semibold text-destructive transition-colors hover:bg-negative-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                <Ban className="size-4" /> Batalkan order
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
