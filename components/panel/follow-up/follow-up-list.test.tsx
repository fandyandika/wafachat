import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { FollowUpList } from './follow-up-list';
(globalThis as any).React = React;

test('queue rows explain the task with useful customer context', () => {
  const now = 2_000_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const html = renderToStaticMarkup(<FollowUpList
    view="action"
    loading={false}
    rows={[{
      conversationId: 'c1', customerName: 'Hasna', customerPhone: '62812', orderId: 'O1', csName: 'Aisyah', csKey: 'aisyah',
      cycleInboundAt: now - 28 * 3_600_000, stage: 1, dueAt: now - 4 * 3_600_000,
      productName: 'Quran Mapping', lastMessagePreview: 'Baik kak, kami tunggu kabarnya.', lastMessageAt: now - 28 * 3_600_000,
      reason: 'CS terakhir membalas, customer belum merespons',
    }]}
    selectedId={null}
    onSelect={vi.fn()}
  />);
  expect(html).toContain('Hasna');
  expect(html).toContain('Quran Mapping');
  expect(html).toContain('Diam 28 jam');
  expect(html).toContain('CS terakhir membalas');
  expect(html).toContain('Baik kak');
  expect(html).toContain('H+1');
});

test('empty queue uses the approved explanation', () => {
  const html = renderToStaticMarkup(<FollowUpList view="action" loading={false} rows={[]} selectedId={null} onSelect={vi.fn()} />);
  expect(html).toContain('Tidak ada customer yang memenuhi aturan follow-up saat ini.');
});
