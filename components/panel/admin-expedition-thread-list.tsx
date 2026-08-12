"use client";

import React from "react";
import { Inbox, LoaderCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  adminThreadNeedsReply,
  adminThreadPreview,
  type AdminInboxThreadView,
  type AdminInboxView,
} from "./admin-expedition-inbox-model";

type AdminExpeditionThreadListProps = {
  className?: string;
  threads: AdminInboxThreadView[];
  totalLoaded: number;
  selectedId: string | null;
  search: string;
  view: AdminInboxView;
  loadingFirstPage: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  onSearchChange: (value: string) => void;
  onViewChange: (view: AdminInboxView) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
};

const viewOptions: Array<{ value: AdminInboxView; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "needs_reply", label: "Belum dibalas" },
  { value: "window_open", label: "24 jam aktif" },
];

function activityLabel(value: number) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(value);
}

export function AdminExpeditionThreadList({
  className,
  threads,
  totalLoaded,
  selectedId,
  search,
  view,
  loadingFirstPage,
  canLoadMore,
  loadingMore,
  onSearchChange,
  onViewChange,
  onSelect,
  onLoadMore,
}: AdminExpeditionThreadListProps) {
  return (
    <aside aria-label="Daftar percakapan ekspedisi" className={cn("flex min-h-0 flex-col border-ledger-rule xl:border-r", className)}>
      <div className="space-y-3 border-b border-ledger-rule p-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ledger-ink">Percakapan</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{totalLoaded} customer dimuat</span>
        </div>

        <label className="relative block">
          <span className="sr-only">Cari customer atau order</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Cari customer atau order"
            className="min-h-11 w-full rounded-[0.625rem] border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>

        <div className="grid grid-cols-3 gap-1 rounded-[0.625rem] bg-muted p-1" aria-label="Filter percakapan">
          {viewOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => onViewChange(option.value)}
              className={cn(
                "min-h-9 rounded-lg px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === option.value
                  ? "bg-card text-ledger-ink shadow-sm"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-[11px] leading-4 text-muted-foreground">
          Pencarian hanya mencakup percakapan yang sudah dimuat.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingFirstPage ? (
          <div role="status" className="space-y-px bg-ledger-rule">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex min-h-[5.25rem] animate-pulse gap-3 bg-card px-4 py-3">
                <span className="size-10 shrink-0 rounded-full bg-muted" />
                <span className="flex-1 space-y-2 pt-1"><span className="block h-3 w-2/3 rounded bg-muted" /><span className="block h-3 w-5/6 rounded bg-muted" /></span>
              </div>
            ))}
            <span className="sr-only">Memuat percakapan…</span>
          </div>
        ) : totalLoaded === 0 ? (
          <div className="px-6 py-14 text-center">
            <Inbox className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Belum ada percakapan</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Hubungi customer dengan template approved untuk memulai.</p>
          </div>
        ) : threads.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Search className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Tidak ada hasil</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Ubah pencarian atau filter percakapan.</p>
          </div>
        ) : (
          <div className="divide-y divide-ledger-rule">
            {threads.map((thread) => {
              const selected = thread.id === selectedId;
              const needsReply = adminThreadNeedsReply(thread);
              return (
                <button
                  key={thread.id}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(thread.id)}
                  className={cn(
                    "group flex min-h-[5.25rem] w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected ? "bg-secondary text-ledger-ink" : "bg-card hover:bg-muted/60",
                  )}
                >
                  <span className={cn("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {(thread.customerName || thread.customerPhone).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <strong className="truncate text-sm font-semibold">{thread.customerName || thread.customerPhone}</strong>
                      <time className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{activityLabel(thread.updatedAt)}</time>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{adminThreadPreview(thread)}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {needsReply && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Menunggu balasan</span>}
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", thread.windowOpen ? "bg-positive-soft text-positive" : "bg-muted text-muted-foreground")}>
                        {thread.windowOpen ? "Balasan aktif" : "Perlu template"}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {canLoadMore && (
        <div className="border-t border-ledger-rule p-3">
          <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? <><LoaderCircle className="size-4 animate-spin" /> Memuat…</> : "Muat lainnya"}
          </button>
        </div>
      )}
    </aside>
  );
}
