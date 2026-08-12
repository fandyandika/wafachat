import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

const useQueryMock = vi.hoisted(() => vi.fn(() => ({ h1: 7, h2: 5, h3: 2, review: 1 })));
(globalThis as any).React = React;
vi.mock('convex/react', () => ({ useQuery: useQueryMock }));
vi.mock('./use-dashboard-data', () => ({
  formatDashboardUpdatedAt: () => 'baru saja',
  useDashboardData: () => ({
    lastUpdatedAt: 1, loading: false, refreshAll: vi.fn(), ready: { summary: true },
    stats: { orders: 10 }, totalClosing: 3, closingRate: 30, responseLabel: '5 menit',
  }),
}));

import { api } from '@/convex/_generated/api';
import { CsHome } from './cs-home';

test('CS home reads reactive follow-up counts without an HTTP refresh path', () => {
  const html = renderToStaticMarkup(<CsHome me={{ name: 'Aisyah', email: 'a@example.com', role: 'cs', csName: 'Aisyah' }} />);
  expect(useQueryMock).toHaveBeenCalledWith(api.followUp.getFollowUpCounts, { csName: 'Aisyah' });
  expect(html).toContain('>7<');
  expect(html).toContain('>5<');
  expect(html).toContain('>2<');
});
