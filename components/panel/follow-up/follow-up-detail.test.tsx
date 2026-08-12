import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';

const { useMutationMock, usePaginatedQueryMock, useQueryMock } = vi.hoisted(() => ({
  useMutationMock: vi.fn(),
  usePaginatedQueryMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

(globalThis as any).React = React;
vi.mock('convex/react', () => ({
  useMutation: useMutationMock,
  usePaginatedQuery: usePaginatedQueryMock,
  useQuery: useQueryMock,
}));

import { api } from '@/convex/_generated/api';
import { FollowUpDetail, FollowUpReadOnlyDetail } from './follow-up-detail';

const candidate = {
  conversationId: 'c1', customerName: 'Hasna', customerPhone: '6281287497002', orderId: 'O1', csName: 'Aisyah', csKey: 'aisyah',
  cycleInboundAt: 1, cycleId: 'cycle-1', stage: 1 as const, dueAt: 2, dueState: 'overdue' as const, overdueDays: 1,
  productName: 'Quran Mapping', lastInboundPreview: 'Masih ada?', lastInboundAt: 1,
  lastOutboundPreview: 'Halo kak', lastOutboundAt: 2, lastDetectedStage: 1 as const, lastDetectedTemplate: 'follow_up_h1',
  lastMessagePreview: 'Halo', lastMessageAt: 1, reason: 'CS terakhir membalas, customer belum merespons',
};

beforeEach(() => {
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue(vi.fn());
  useQueryMock.mockReset();
  useQueryMock
    .mockReturnValueOnce([{
      _id: 'm1', _creationTime: 1, orgId: 'o1', conversationId: 'c1', orderId: 'O1', customerPhone: '62812',
      role: 'customer', direction: 'inbound', content: 'Masih ada kak?', messageType: 'text', source: 'ingest', createdAt: 1,
    }])
    .mockReturnValueOnce({ page: [{
      _id: 'health1', providerNumberId: 'provider1', csKey: 'aisyah', channelType: 'cs',
      lastError: 'Nomor provider belum dipetakan', errorAt: 3, updatedAt: 3,
    }], isDone: true, continueCursor: '' });
  usePaginatedQueryMock.mockReset();
  usePaginatedQueryMock.mockReturnValue({
    results: [{ transitionId: 't1', cycleId: 'cycle-1', kind: 'stage_corrected', source: 'manual', fromStage: 1, toStage: 2, actorName: 'Owner', createdAt: 2 }],
    status: 'Exhausted', isLoading: false, loadMore: vi.fn(),
  });
});

test('selected detail subscribes to at most 50 messages and transitions', () => {
  renderToStaticMarkup(<FollowUpDetail candidate={candidate} onBack={vi.fn()} onChanged={vi.fn()} />);
  expect(useQueryMock).toHaveBeenCalledWith(api.messages.listMessages, { conversationId: 'c1', limit: 50 });
  expect(usePaginatedQueryMock).toHaveBeenCalledWith(
    api.followUpTransitions.listConversationTransitions,
    { conversationId: 'c1' },
    { initialNumItems: 50 },
  );
});

test('empty detail skips message, transition, and health subscriptions', () => {
  renderToStaticMarkup(<FollowUpDetail candidate={null} />);
  expect(useQueryMock).toHaveBeenCalledWith(api.messages.listMessages, 'skip');
  expect(usePaginatedQueryMock).toHaveBeenCalledWith(api.followUpTransitions.listConversationTransitions, 'skip', { initialNumItems: 50 });
  expect(useQueryMock).toHaveBeenCalledWith(api.providerChannelHealth.listProviderChannelHealth, 'skip');
});

test('detail renders timeline, explicit health errors, accessible stage correction, and all actions', () => {
  const html = renderToStaticMarkup(<FollowUpDetail candidate={candidate} onBack={vi.fn()} onChanged={vi.fn()} />);
  expect(html).toContain('Riwayat tahap');
  expect(html).toContain('Tahap diubah');
  expect(html).toContain('H+1 â†’ H+2');
  expect(html).toContain('Masalah kanal');
  expect(html).toContain('Nomor provider belum dipetakan');
  expect(html).toContain('Ubah tahap');
  expect(html).toContain('Buka WhatsApp');
  expect(html).toContain('Kirim template');
  expect(html).toContain('Sudah dihubungi');
  expect(html).toContain('Closing');
  expect(html).toContain('Batal');
  expect(html).toContain('Arsip');
});

test('mobile action bar is sticky, opaque, touch sized, and focus visible', () => {
  const html = renderToStaticMarkup(<FollowUpDetail candidate={candidate} />);
  expect(html).toContain('sticky bottom-0');
  expect(html).toContain('bg-card');
  expect(html).not.toContain('bg-transparent');
  expect(html).toContain('min-h-11');
  expect(html).toContain('focus-visible:ring');
});

test('search and closing rows open a useful read-only customer detail', () => {
  const html = renderToStaticMarkup(<FollowUpReadOnlyDetail row={{ conversationId: 'c1', customerName: 'Hasna', customerPhone: '62812', orderId: 'O1', csName: 'Aisyah', updatedAt: 1 }} onBack={vi.fn()} />);
  expect(html).toContain('O1');
  expect(html).toContain('Aisyah');
  expect(html).toContain('Buka WhatsApp');
  expect(html).toContain('hanya untuk pemeriksaan');
});
