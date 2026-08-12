import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
(globalThis as any).React = React;
import { TemplateSendDialog } from './template-send-dialog';

const candidate = {
  conversationId: 'c1', customerName: 'Hasna', customerPhone: '6281287497002', orderId: 'O1', csName: 'Aisyah', csKey: 'aisyah',
  cycleInboundAt: 1, stage: 1 as const, dueAt: 2, dueState: 'overdue' as const, overdueDays: 1, productName: 'Quran Mapping',
  lastInboundPreview: 'Masih ada?', lastInboundAt: 1, lastOutboundPreview: 'Halo', lastOutboundAt: 2,
  lastMessagePreview: 'Halo', lastMessageAt: 1,
  reason: 'CS terakhir membalas, customer belum merespons',
};

test('confirmation shows recipient, sender, template and resolved preview', () => {
  const html = renderToStaticMarkup(<TemplateSendDialog open candidate={candidate} sender={{ csName: 'Aisyah', providerNumberId: '1197' }} templates={[{
    id: 't1', stage: 1, label: 'Follow-up pertama', templateName: 'fu_h1', language: 'id', variables: ['customer_name', 'product_name', 'order_id'], isActive: true,
  }]} onClose={vi.fn()} onAccepted={vi.fn()} />);
  expect(html).toContain('Penerima');
  expect(html).toContain('Nomor pengirim');
  expect(html).toContain('Template');
  expect(html).toContain('Preview pesan');
  expect(html).toContain('Hasna');
  expect(html).toContain('Quran Mapping');
  expect(html).toContain('1197');
});

test('send is blocked when sender configuration is absent', () => {
  const html = renderToStaticMarkup(<TemplateSendDialog open candidate={candidate} templates={[]} onClose={vi.fn()} onAccepted={vi.fn()} />);
  expect(html).toContain('Lengkapi nomor API CS dan template aktif');
  expect(html).toContain('disabled=""');
});
