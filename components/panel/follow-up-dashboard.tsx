'use client';

import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { usePanelFilters } from '@/components/panel/use-panel-filters';
import { fetchHistory, fetchQueue, searchCustomers } from './follow-up/follow-up-client';
import type { FollowUpHistoryRow, FollowUpHistoryView, FollowUpQueueRow, FollowUpSearchRow, FollowUpStage } from './follow-up/follow-up-types';
import { FollowUpList } from './follow-up/follow-up-list';
import { FollowUpDetail, FollowUpReadOnlyDetail } from './follow-up/follow-up-detail';
import { TemplateSendDialog } from './follow-up/template-send-dialog';

export type FollowUpView = 'action' | 'search' | 'sent' | 'review' | 'completed';
type ListRow = FollowUpQueueRow | FollowUpSearchRow | FollowUpHistoryRow;

const VIEWS: Array<{ key: FollowUpView; label: string; description: string }> = [
  { key: 'action', label: 'Perlu tindakan', description: 'Customer yang sudah waktunya dihubungi' },
  { key: 'search', label: 'Cari customer', description: 'Cari nama atau nomor tertentu' },
  { key: 'sent', label: 'Terkirim', description: 'Kontak yang sudah dilakukan' },
  { key: 'review', label: 'Perlu dicek', description: 'Pengiriman gagal atau belum pasti' },
  { key: 'completed', label: 'Selesai', description: 'Customer yang sudah closing' },
];

export function getNextFollowUpTabIndex(key: string, currentIndex: number, tabCount: number): number | null {
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  return null;
}

function rowId(row: ListRow) { return row.conversationId ?? ('id' in row ? row.id : ''); }

export function FollowUpDashboard() {
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs'; csName?: string } | null>(null);
  const { cs } = usePanelFilters();
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const templateSetup = useQuery(api.followUpTemplates.getFollowUpTemplateSetup, {});
  const [csFilter, setCsFilter] = useState(cs && cs !== 'all' ? cs : 'all');
  const [view, setView] = useState<FollowUpView>('action');
  const [stage, setStage] = useState<'all' | FollowUpStage>('all');
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<ListRow | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchMessage, setSearchMessage] = useState('Masukkan minimal 3 karakter, lalu tekan Cari.');
  const [pagination, setPagination] = useState({ isDone: true, continueCursor: '' });
  const [templateCandidate, setTemplateCandidate] = useState<FollowUpQueueRow | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    fetch('/api/me').then((r) => r.ok ? r.json() : null).then(setMe).catch(() => setMe(null));
  }, []);
  const isCs = me?.role === 'cs';
  const csName = isCs ? (me?.csName || me?.name) : csFilter !== 'all' ? csFilter : undefined;

  const loadQueue = useCallback(async (cursor: string | null = null, append = false) => {
    if (!me) return;
    setLoading(true); setError(null);
    try {
      const result = await fetchQueue({ csName, stage: stage === 'all' ? undefined : stage }, cursor);
      setRows((current) => append ? [...current, ...result.page.filter((next) => !current.some((old) => rowId(old) === rowId(next)))] : result.page);
      setPagination(result.pagination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal memuat antrean follow-up.'); }
    finally { setLoading(false); }
  }, [csName, me, stage]);

  const loadHistory = useCallback(async (historyView: FollowUpHistoryView, cursor: string | null = null, append = false) => {
    if (!me) return;
    setLoading(true); setError(null);
    try {
      const result = await fetchHistory(historyView, csName, cursor);
      setRows((current) => append ? [...current, ...result.page] : result.page);
      setPagination({ isDone: result.isDone, continueCursor: result.continueCursor });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal memuat riwayat follow-up.'); }
    finally { setLoading(false); }
  }, [csName, me]);

  useEffect(() => {
    setSelected(null); setMobileDetail(false); setRows([]);
    if (view === 'action') void loadQueue();
    else if (view !== 'search') void loadHistory(view);
  }, [view, loadHistory, loadQueue]);

  async function runSearch() {
    const term = searchInput.trim();
    if (term.length < 3) { setSearchMessage('Ketik minimal 3 karakter untuk mencari customer.'); return; }
    setLoading(true); setError(null); setSearchMessage('');
    try { const result = await searchCustomers(term, csName); setRows(result.page); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pencarian gagal.'); }
    finally { setLoading(false); }
  }

  function selectRow(row: ListRow) { setSelected(row); setMobileDetail(true); }
  function switchView(next: FollowUpView, focus = false) {
    setView(next); setSelected(null); setMobileDetail(false); setError(null);
    if (next === 'search') { setRows([]); setSearchMessage('Masukkan minimal 3 karakter, lalu tekan Cari.'); }
    if (focus) requestAnimationFrame(() => tabRefs.current[VIEWS.findIndex((item) => item.key === next)]?.focus());
  }
  const queueSelection = selected && 'dueAt' in selected ? selected : null;
  const visibleRows = stage === 'all' || view === 'search' || view === 'completed'
    ? rows
    : rows.filter((row) => row.stage === stage);
  const retry = () => view === 'action' ? loadQueue() : view === 'search' ? runSearch() : loadHistory(view);
  const templateSender = templateCandidate
    ? csList.find((item) => item.csName.replace(/^CS\s+/i, '').trim().toLocaleLowerCase('id-ID') === templateCandidate.csName.replace(/^CS\s+/i, '').trim().toLocaleLowerCase('id-ID'))
    : undefined;

  return <div className="mx-auto flex h-[calc(100dvh-8.25rem)] min-h-[32rem] max-w-[1500px] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm md:h-[calc(100dvh-5rem)]">
    <div className={`border-b bg-card p-3 md:p-4 ${mobileDetail ? 'hidden md:block' : ''}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div><h2 className="text-base font-semibold">Workspace follow-up</h2><p className="mt-1 text-sm text-muted-foreground">Hubungi customer secara manual, tanpa pengiriman otomatis.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          {view !== 'search' && view !== 'completed' && <label className="text-xs font-medium text-muted-foreground">Tahap
            <select value={stage} onChange={(event) => setStage(event.target.value === 'all' ? 'all' : Number(event.target.value) as FollowUpStage)} className="mt-1 block min-h-11 rounded-lg border bg-background px-3 text-sm md:min-h-9">
              <option value="all">Semua tahap</option><option value="1">H+1</option><option value="2">H+2</option><option value="3">H+3</option>
            </select></label>}
          {!isCs && <label className="text-xs font-medium text-muted-foreground">CS
            <select value={csFilter} onChange={(event) => setCsFilter(event.target.value)} className="mt-1 block min-h-11 rounded-lg border bg-background px-3 text-sm md:min-h-9">
              <option value="all">Semua CS</option>{csList.filter((item) => item.isActive).map((item) => <option key={item.key} value={item.csName}>{item.csName.replace(/^CS\s+/i, '')}</option>)}
            </select></label>}
          <Button variant="outline" className="min-h-11 md:min-h-9" disabled={loading} onClick={retry}>{loading ? 'Memuat…' : 'Muat ulang'}</Button>
        </div>
      </div>
      <nav role="tablist" aria-label="Tugas follow-up" className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
        {VIEWS.map((item, index) => <button key={item.key} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" aria-selected={view === item.key} tabIndex={view === item.key ? 0 : -1}
          onClick={() => switchView(item.key)} onKeyDown={(event) => { const next = getNextFollowUpTabIndex(event.key, index, VIEWS.length); if (next !== null) { event.preventDefault(); switchView(VIEWS[next].key, true); } }}
          className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${view === item.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{item.label}</button>)}
      </nav>
      {view === 'search' && <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
        <label className="sr-only" htmlFor="follow-up-search">Cari customer</label><input id="follow-up-search" aria-label="Cari customer" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nama atau nomor customer" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" />
        <Button type="submit" className="min-h-11" disabled={loading || searchInput.trim().length < 3}>Cari</Button>
      </form>}
      {view === 'search' && searchMessage && <p className="mt-2 text-xs text-muted-foreground">{searchMessage}</p>}
    </div>
    <div className="flex min-h-0 flex-1">
      <section className={`${mobileDetail ? 'hidden md:block' : 'block'} w-full overflow-y-auto border-r md:w-[25rem] md:shrink-0`}>
        <div className="border-b px-4 py-3"><p className="font-semibold">{VIEWS.find((item) => item.key === view)?.label}</p><p className="text-xs text-muted-foreground">{VIEWS.find((item) => item.key === view)?.description}</p></div>
        <FollowUpList view={view} rows={visibleRows} loading={loading} error={error} selectedId={selected ? rowId(selected) : null} onSelect={selectRow} onRetry={retry} />
        {!loading && !pagination.isDone && <div className="p-3"><Button variant="outline" className="min-h-11 w-full" onClick={() => view === 'action' ? loadQueue(pagination.continueCursor, true) : view !== 'search' && loadHistory(view, pagination.continueCursor, true)}>Muat berikutnya</Button></div>}
      </section>
      <main className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 flex-1`}>
        {queueSelection
          ? <FollowUpDetail candidate={queueSelection} onBack={() => setMobileDetail(false)} onChanged={() => { setSelected(null); setMobileDetail(false); void loadQueue(); }} onSendTemplate={setTemplateCandidate} />
          : selected
            ? <FollowUpReadOnlyDetail row={selected as FollowUpSearchRow | FollowUpHistoryRow} onBack={() => setMobileDetail(false)} />
            : <FollowUpDetail candidate={null} />}
      </main>
    </div>
    <TemplateSendDialog
      open={templateCandidate !== null}
      candidate={templateCandidate}
      sender={templateSender ? { csName: templateSender.csName, providerNumberId: templateSender.providerNumberId } : undefined}
      templates={(templateSetup?.templates ?? []).map((item) => ({ ...item, id: String(item.id) }))}
      onClose={() => setTemplateCandidate(null)}
      onAccepted={() => { setTemplateCandidate(null); setSelected(null); setMobileDetail(false); switchView('sent'); }}
    />
  </div>;
}
