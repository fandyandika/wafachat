'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { searchCustomers } from './follow-up/follow-up-client';
import type {
  FollowUpActionRow,
  FollowUpArchivedRow,
  FollowUpClosedRow,
  FollowUpListRow,
  FollowUpQueueRow,
  FollowUpSearchRow,
  FollowUpStage,
  FollowUpView,
} from './follow-up/follow-up-types';
import { FollowUpList } from './follow-up/follow-up-list';
import { FollowUpDetail, FollowUpReadOnlyDetail } from './follow-up/follow-up-detail';
import { TemplateSendDialog } from './follow-up/template-send-dialog';

type Me = { name: string; role: 'admin' | 'cs'; csName?: string };

const VIEWS: Array<{ key: FollowUpView; label: string; description: string; countKey?: 'h1' | 'h2' | 'h3' | 'review' }> = [
  { key: 'h1', label: 'H+1', description: 'Tindak lanjut pertama', countKey: 'h1' },
  { key: 'h2', label: 'H+2', description: 'Pengingat lanjutan', countKey: 'h2' },
  { key: 'h3', label: 'H+3', description: 'Tindak lanjut terakhir', countKey: 'h3' },
  { key: 'review', label: 'Perlu dicek', description: 'Status yang perlu keputusan manual', countKey: 'review' },
  { key: 'closing', label: 'Closing', description: 'Order yang berhasil closing' },
  { key: 'archived', label: 'Arsip', description: 'Siklus follow-up yang diarsipkan' },
];

export function getNextFollowUpTabIndex(key: string, currentIndex: number, tabCount: number): number | null {
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  return null;
}

function rowId(row: FollowUpListRow): string {
  return row.conversationId ?? `${row.customerPhone}:${row.orderId}`;
}

function stageForView(view: FollowUpView): FollowUpStage | null {
  if (view === 'h1') return 1;
  if (view === 'h2') return 2;
  if (view === 'h3') return 3;
  return null;
}

export function FollowUpDashboard({ initialMe, initialView = 'h1' }: { initialMe?: Me; initialView?: FollowUpView } = {}) {
  const [me, setMe] = useState<Me | null>(initialMe ?? null);
  const { cs } = usePanelFilters();
  const [csFilter, setCsFilter] = useState(cs && cs !== 'all' ? cs : 'all');
  const [view, setView] = useState<FollowUpView>(initialView);
  const [selected, setSelected] = useState<FollowUpListRow | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchRows, setSearchRows] = useState<FollowUpSearchRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [templateCandidate, setTemplateCandidate] = useState<FollowUpQueueRow | null>(null);
  const [queryNow] = useState(() => Date.now());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (initialMe) return;
    let cancelled = false;
    fetch('/api/me').then((response) => response.ok ? response.json() : null)
      .then((next) => { if (!cancelled) setMe(next); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, [initialMe]);

  const isCs = me?.role === 'cs';
  const csName = isCs ? (me?.csName || me?.name) : csFilter !== 'all' ? csFilter : undefined;
  const csList = useQuery(api.cs.listCs, me ? {} : 'skip') ?? [];
  const counts = useQuery(api.followUp.getFollowUpCounts, me ? { csName } : 'skip');
  const activeStage = stageForView(view);

  const stagePage = usePaginatedQuery(
    api.followUp.listFollowUpQueue,
    me && activeStage ? { csName, stage: activeStage, now: queryNow } : 'skip',
    { initialNumItems: 30 },
  );
  const reviewPage = usePaginatedQuery(
    api.followUp.listFollowUpAttentionPage,
    me && view === 'review' ? { csName } : 'skip',
    { initialNumItems: 30 },
  );
  const closingPage = usePaginatedQuery(
    api.followUp.listClosedFollowUpsPage,
    me && view === 'closing' ? { csName } : 'skip',
    { initialNumItems: 30 },
  );
  const archivePage = usePaginatedQuery(
    api.followUp.listArchivedFollowUpsPage,
    me && view === 'archived' ? { csName } : 'skip',
    { initialNumItems: 30 },
  );

  const templateSetup = useQuery(api.followUpTemplates.getFollowUpTemplateSetup, templateCandidate ? {} : 'skip');

  const activePage = activeStage ? stagePage : view === 'review' ? reviewPage : view === 'closing' ? closingPage : archivePage;
  const reactiveRows = activePage.results as FollowUpListRow[];
  const rows = searchRows ?? reactiveRows;
  const loading = searchRows === null && activePage.status === 'LoadingFirstPage' || searchLoading;
  const listView = searchRows === null ? view : 'search';

  async function runSearch() {
    const term = searchInput.trim();
    if (term.length < 3) {
      setSearchError('Ketik minimal 3 karakter untuk mencari customer.');
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    setSelected(null);
    setMobileDetail(false);
    try {
      const result = await searchCustomers(term, csName);
      setSearchRows(result.page);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Pencarian gagal.');
    } finally {
      setSearchLoading(false);
    }
  }

  function selectRow(row: FollowUpListRow) {
    setSelected(row);
    setMobileDetail(true);
  }

  function switchView(next: FollowUpView, focus = false) {
    setView(next);
    setSelected(null);
    setMobileDetail(false);
    setSearchRows(null);
    setSearchError(null);
    if (focus) requestAnimationFrame(() => tabRefs.current[VIEWS.findIndex((item) => item.key === next)]?.focus());
  }

  const actionSelection = selected && ('cycleInboundAt' in selected || 'reviewReason' in selected) ? selected as FollowUpActionRow : null;
  const readOnlySelection = selected && !actionSelection ? selected as FollowUpSearchRow | FollowUpArchivedRow | FollowUpClosedRow : null;
  const templateSender = templateCandidate
    ? csList.find((item) => item.csName.replace(/^CS\s+/i, '').trim().toLocaleLowerCase('id-ID') === templateCandidate.csName.replace(/^CS\s+/i, '').trim().toLocaleLowerCase('id-ID'))
    : undefined;
  const activeView = VIEWS.find((item) => item.key === view)!;

  return <div className="mx-auto flex h-[calc(100dvh-8.25rem)] min-h-[32rem] max-w-[1500px] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm md:h-[calc(100dvh-5rem)]">
    <div className={`border-b bg-card p-3 md:p-4 ${mobileDetail ? 'hidden md:block' : ''}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div><h2 className="text-base font-semibold">Workspace follow-up</h2><p className="mt-1 text-sm text-muted-foreground">Hubungi customer secara manual, tanpa pengiriman otomatis.</p></div>
        {!isCs ? <label className="text-xs font-medium text-muted-foreground">CS
          <select value={csFilter} onChange={(event) => { setCsFilter(event.target.value); setSelected(null); }} className="mt-1 block min-h-11 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="all">Semua CS</option>{csList.filter((item) => item.isActive).map((item) => <option key={item.key} value={item.csName}>{item.csName.replace(/^CS\s+/i, '')}</option>)}
          </select></label> : null}
      </div>

      <nav role="tablist" aria-label="Tahap follow-up" className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
        {VIEWS.map((item, index) => <button key={item.key} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" aria-selected={view === item.key} tabIndex={view === item.key ? 0 : -1}
          onClick={() => switchView(item.key)} onKeyDown={(event) => { const next = getNextFollowUpTabIndex(event.key, index, VIEWS.length); if (next !== null) { event.preventDefault(); switchView(VIEWS[next].key, true); } }}
          className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${view === item.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {item.label}{item.countKey && counts ? <span className="min-w-6 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">{counts[item.countKey]}</span> : null}
        </button>)}
      </nav>

      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
        <label className="sr-only" htmlFor="follow-up-search">Cari customer</label>
        <input id="follow-up-search" aria-label="Cari customer" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari customer: nama atau nomor" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <Button type="submit" className="min-h-11" disabled={searchLoading || searchInput.trim().length < 3}>Cari</Button>
        {searchRows !== null ? <Button type="button" variant="outline" className="min-h-11" onClick={() => { setSearchRows(null); setSelected(null); }}>Tutup hasil</Button> : null}
      </form>
      <p className="mt-1 text-xs text-muted-foreground">Ketik minimal 3 karakter. Tekan Cari untuk menjalankan pencarian.</p>
    </div>

    <div className="flex min-h-0 flex-1">
      <section className={`${mobileDetail ? 'hidden md:block' : 'block'} w-full overflow-y-auto border-r md:w-[27rem] md:shrink-0`}>
        <div className="border-b px-4 py-3"><p className="font-semibold">{searchRows === null ? activeView.label : 'Hasil pencarian'}</p><p className="text-xs text-muted-foreground">{searchRows === null ? activeView.description : `Hasil untuk “${searchInput.trim()}”`}</p></div>
        <FollowUpList view={listView} rows={rows} loading={loading} error={searchError} selectedId={selected ? rowId(selected) : null} onSelect={selectRow} onRetry={searchError ? runSearch : undefined} />
        {searchRows === null && (activePage.status === 'CanLoadMore' || activePage.status === 'LoadingMore') ? <div className="p-3"><Button variant="outline" className="min-h-11 w-full" disabled={activePage.status === 'LoadingMore'} onClick={() => activePage.loadMore(30)}>{activePage.status === 'LoadingMore' ? 'Memuat…' : 'Muat berikutnya'}</Button></div> : null}
      </section>

      <main className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 flex-1`}>
        {actionSelection
          ? <FollowUpDetail candidate={actionSelection} onBack={() => setMobileDetail(false)} onChanged={() => { setSelected(null); setMobileDetail(false); }} onSendTemplate={setTemplateCandidate} />
          : readOnlySelection
            ? <FollowUpReadOnlyDetail row={readOnlySelection} onBack={() => setMobileDetail(false)} />
            : <FollowUpDetail candidate={null} />}
      </main>
    </div>

    <TemplateSendDialog
      open={templateCandidate !== null}
      candidate={templateCandidate}
      sender={templateSender ? { csName: templateSender.csName, providerNumberId: templateSender.providerNumberId } : undefined}
      templates={(templateSetup?.templates ?? []).map((item) => ({ ...item, id: String(item.id) }))}
      onClose={() => setTemplateCandidate(null)}
      onAccepted={() => { setTemplateCandidate(null); setSelected(null); setMobileDetail(false); }}
    />
  </div>;
}
