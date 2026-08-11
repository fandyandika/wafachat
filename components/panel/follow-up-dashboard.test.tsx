import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

(globalThis as any).React = React;
vi.mock('convex/react', () => ({ useQuery: () => [] }));
vi.mock('@/components/panel/use-panel-filters', () => ({ usePanelFilters: () => ({ cs: 'all' }) }));
import { FollowUpDashboard, getNextFollowUpTabIndex } from './follow-up-dashboard';

test('follow-up is organized around five customer tasks', () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  expect(html).toContain('Perlu tindakan');
  expect(html).toContain('Cari customer');
  expect(html).toContain('Terkirim');
  expect(html).toContain('Perlu dicek');
  expect(html).toContain('Selesai');
  expect(html).not.toContain('>Arsip<');
  expect(html).not.toContain('>Closing<');
  expect(html.match(/role="tab"/g)).toHaveLength(5);
  expect(html).toContain('min-h-11');
});

test('task keyboard navigation wraps and supports Home and End', () => {
  expect(getNextFollowUpTabIndex('ArrowRight', 4, 5)).toBe(0);
  expect(getNextFollowUpTabIndex('ArrowLeft', 0, 5)).toBe(4);
  expect(getNextFollowUpTabIndex('Home', 3, 5)).toBe(0);
  expect(getNextFollowUpTabIndex('End', 1, 5)).toBe(4);
  expect(getNextFollowUpTabIndex('Enter', 1, 5)).toBeNull();
});

test('workspace makes the manual-only behavior explicit', () => {
  const html = renderToStaticMarkup(<FollowUpDashboard />);
  expect(html).toContain('tanpa pengiriman otomatis');
  expect(html).not.toContain('Auto-send');
  expect(html).not.toContain('Kirim massal');
});
