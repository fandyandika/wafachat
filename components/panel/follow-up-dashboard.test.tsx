import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { getFunctionName } from 'convex/server';

const { usePaginatedQueryMock, useQueryMock, buttonClicks } = vi.hoisted(() => ({
  usePaginatedQueryMock: vi.fn(),
  useQueryMock: vi.fn(),
  buttonClicks: new Map<string, () => void>(),
}));

(globalThis as any).React = React;
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  usePaginatedQuery: usePaginatedQueryMock,
  useQuery: useQueryMock,
}));
vi.mock('@/components/panel/use-panel-filters', () => ({ usePanelFilters: () => ({ cs: 'all' }) }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => {
    if (typeof children === 'string' && onClick) buttonClicks.set(children, onClick);
    return <button onClick={onClick} {...props}>{children}</button>;
  },
}));

import { api } from '@/convex/_generated/api';
import { FollowUpDashboard, getNextFollowUpTabIndex, selectionAfterCompletedAction, loadActiveFollowUpPage } from './follow-up-dashboard';

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock
    .mockReturnValueOnce([])
    .mockReturnValueOnce({ h1: 3, h2: 2, h3: 1, review: 4 })
    .mockReturnValue(undefined);
  usePaginatedQueryMock.mockReset();
  buttonClicks.clear();
  usePaginatedQueryMock.mockReturnValue({
    results: [], status: 'Exhausted', isLoading: false, loadMore: vi.fn(),
  });
});

test('follow-up is organized around six lifecycle tabs', () => {
  const html = renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} />);
  expect(html).toContain('H+1');
  expect(html).toContain('H+2');
  expect(html).toContain('H+3');
  expect(html).toContain('Perlu dicek');
  expect(html).toContain('Closing');
  expect(html).toContain('Arsip');
  expect(html).not.toContain('Perlu tindakan');
  expect(html).not.toContain('Terkirim');
  expect(html.match(/role="tab"/g)).toHaveLength(6);
  expect(html).toContain('min-h-11');
});

test('only the active lifecycle tab subscribes to a paginated query', () => {
  renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} />);
  const activeCalls = usePaginatedQueryMock.mock.calls.filter(([, args]) => args !== 'skip');
  expect(activeCalls).toHaveLength(1);
  expect(getFunctionName(activeCalls[0][0])).toBe('followUp:listFollowUpQueue');
  expect(activeCalls[0][1]).toEqual(expect.objectContaining({ stage: 1 }));
  expect(activeCalls[0][2]).toEqual({ initialNumItems: 30 });
});

test.each([
  ['review', 'followUp:listFollowUpAttentionPage'],
  ['closing', 'followUp:listClosedFollowUpsPage'],
  ['archived', 'followUp:listArchivedFollowUpsPage'],
] as const)('activating %s subscribes only to its reactive page', (initialView, functionName) => {
  renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} initialView={initialView} />);
  const activeCalls = usePaginatedQueryMock.mock.calls.filter(([, args]) => args !== 'skip');
  expect(activeCalls).toHaveLength(1);
  expect(getFunctionName(activeCalls[0][0])).toBe(functionName);
});

test('active pagination exposes a load-more control without querying inactive tabs', () => {
  const pagers = Array.from({ length: 4 }, () => vi.fn());
  usePaginatedQueryMock.mockImplementation((_query, args) => ({ results: [], status: 'CanLoadMore', isLoading: false, loadMore: pagers[usePaginatedQueryMock.mock.calls.length - 1] }));
  const html = renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} initialView="archived" />);
  expect(html).toContain('Muat berikutnya');
  expect(usePaginatedQueryMock.mock.calls.filter(([, args]) => args !== 'skip')).toHaveLength(1);
  buttonClicks.get('Muat berikutnya')?.();
  expect(pagers[3]).toHaveBeenCalledWith(30);
  expect(pagers.slice(0, 3).every((pager) => pager.mock.calls.length === 0)).toBe(true);
});

test('reactive page failure exposes retry wired to the active pager', () => {
  const retry = vi.fn();
  usePaginatedQueryMock.mockReturnValue({ results: [], status: 'Error', error: new Error('Query gagal'), isLoading: false, loadMore: retry });
  const html = renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} initialView="review" />);
  expect(html).toContain('Query gagal');
  expect(html).toContain('Coba lagi');
  loadActiveFollowUpPage({ loadMore: retry });
  expect(retry).toHaveBeenCalledWith(30);
});

test('deferred completion from customer A cannot clear newly selected customer B', async () => {
  const { completeFollowUpAction } = await import('./follow-up/follow-up-detail');
  let selected = { conversationId: 'conversation-a' } as any;
  let resolve!: (result: { success: true }) => void;
  const action = new Promise<{ success: true }>((done) => { resolve = done; });
  const pending = completeFollowUpAction(() => action, 'conversation-a', (actedId) => {
    selected = selectionAfterCompletedAction(selected, actedId);
  });
  selected = { conversationId: 'conversation-b' } as any;
  resolve({ success: true });
  await pending;
  expect(selected.conversationId).toBe('conversation-b');
});

test('counts are reactive and search is an explicit action', () => {
  const html = renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} />);
  expect(useQueryMock).toHaveBeenCalledWith(api.followUp.getFollowUpCounts, { csName: undefined });
  expect(html).toContain('Cari customer');
  expect(html).toContain('Tekan Cari');
  expect(html).toContain('>3<');
});

test('task keyboard navigation wraps and supports Home and End', () => {
  expect(getNextFollowUpTabIndex('ArrowRight', 5, 6)).toBe(0);
  expect(getNextFollowUpTabIndex('ArrowLeft', 0, 6)).toBe(5);
  expect(getNextFollowUpTabIndex('Home', 3, 6)).toBe(0);
  expect(getNextFollowUpTabIndex('End', 1, 6)).toBe(5);
  expect(getNextFollowUpTabIndex('Enter', 1, 6)).toBeNull();
});

test('workspace makes the manual-only behavior explicit', () => {
  const html = renderToStaticMarkup(<FollowUpDashboard initialMe={{ name: 'Owner', role: 'admin' }} />);
  expect(html).toContain('tanpa pengiriman otomatis');
  expect(html).not.toContain('Auto-send');
  expect(html).not.toContain('Kirim massal');
  expect(html).not.toMatch(/Ã|Â|â|�/);
});
