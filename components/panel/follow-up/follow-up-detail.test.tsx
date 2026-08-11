import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
(globalThis as any).React = React;
vi.mock('convex/react', () => ({ useQuery: () => [] }));
import { FollowUpDetail } from './follow-up-detail';

const candidate = {
  conversationId: 'c1', customerName: 'Hasna', customerPhone: '6281287497002', orderId: 'O1', csName: 'Aisyah', csKey: 'aisyah',
  cycleInboundAt: 1, stage: 1 as const, dueAt: 2, productName: 'Quran Mapping', lastMessagePreview: 'Halo', lastMessageAt: 1,
  reason: 'CS terakhir membalas, customer belum merespons',
};

test('detail offers safe manual actions with mobile-size targets', () => {
  const html = renderToStaticMarkup(<FollowUpDetail candidate={candidate} onBack={vi.fn()} onChanged={vi.fn()} />);
  expect(html).toContain('Buka WhatsApp');
  expect(html).toContain('Kirim template');
  expect(html).toContain('Tandai sudah dihubungi');
  expect(html).toContain('https://wa.me/6281287497002');
  expect(html).toContain('min-h-11');
});
