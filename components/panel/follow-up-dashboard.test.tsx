import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { getFunctionName } from 'convex/server';

const { usePaginatedQueryMock, useQueryMock } = vi.hoisted(() => ({
  usePaginatedQueryMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

(globalThis as any).React = React;
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  usePaginatedQuery: usePaginatedQueryMock,
  useQuery: useQueryMock,
}));
vi.mock('@/components/panel/use-panel-filters', () => ({ usePanelFilters: () => ({ cs: 'all' }) }));

import { api } from '@/convex/_generated/api';
import { FollowUpDashboard, getNextFollowUpTabIndex } from './follow-up-dashboard';

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock
    .mockReturnValueOnce([])
    .mockReturnValueOnce({ h1: 3, h2: 2, h3: 1, review: 4 })
    .mockReturnValue(undefined);
  usePaginatedQueryMock.mockReset();
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
});
