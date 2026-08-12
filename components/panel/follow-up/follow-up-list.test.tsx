import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { FollowUpList } from './follow-up-list';

(globalThis as any).React = React;

test('queue rows show both sides of the conversation and follow-up context', () => {
  const now = Date.UTC(2026, 7, 12, 5);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const html = renderToStaticMarkup(<FollowUpList
    view="h1"
    loading={false}
    rows={[{
      conversationId: 'c1', customerName: 'Hasna', customerPhone: '62812', orderId: 'O1', csName: 'Aisyah', csKey: 'aisyah',
      cycleInboundAt: now - 28 * 3_600_000, cycleId: 'cycle-1', stage: 1, dueAt: now - 2 * 86_400_000,
      dueState: 'overdue', overdueDays: 2, productName: 'Quran Mapping',
      lastInboundPreview: 'Masih ada kak?', lastInboundAt: now - 30 * 3_600_000,
      lastOutboundPreview: 'Baik kak, kami tunggu kabarnya.', lastOutboundAt: now - 28 * 3_600_000,
      lastDetectedStage: 2, lastDetectedTemplate: 'follow_up_h2',
      lastMessagePreview: 'Baik kak, kami tunggu kabarnya.', lastMessageAt: now - 28 * 3_600_000,
      reason: 'CS terakhir membalas, customer belum merespons',
    }]}
    selectedId={null}
    onSelect={vi.fn()}
  />);
  expect(html).toContain('Hasna');
  expect(html).toContain('Customer');
  expect(html).toContain('Masih ada kak?');
  expect(html).toContain('CS');
  expect(html).toContain('Baik kak, kami tunggu kabarnya.');
  expect(html.match(/<time/g)).toHaveLength(2);
  expect(html).toContain('H+1');
  expect(html).toContain('Terlambat 2 hari');
  expect(html).toContain('Trigger terdeteksi');
  expect(html).toContain('H+2');
  expect(html).toContain('follow_up_h2');
  expect(html).toContain('Quran Mapping');
  expect(html).toContain('Order O1');
});

test('empty stage uses the approved explanation', () => {
  const html = renderToStaticMarkup(<FollowUpList view="h1" loading={false} rows={[]} selectedId={null} onSelect={vi.fn()} />);
  expect(html).toContain('Tidak ada customer pada tahap ini.');
});

test('retry controls are touch sized and visibly focusable', () => {
  const html = renderToStaticMarkup(<FollowUpList view="review" loading={false} error="Antrean gagal dimuat" rows={[]} selectedId={null} onSelect={vi.fn()} onRetry={vi.fn()} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain('min-h-11');
  expect(html).toContain('focus-visible:ring');
});
