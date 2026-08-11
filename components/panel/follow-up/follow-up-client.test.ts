import { beforeEach, expect, test, vi } from 'vitest';
import { confirmContact, fetchHistory, fetchQueue, FollowUpClientError, searchCustomers, sendTemplate } from './follow-up-client';

beforeEach(() => vi.unstubAllGlobals());

test('one-shot clients call only their requested view', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, page: [], pagination: { isDone: true, continueCursor: '' } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, page: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, page: [], isDone: true, continueCursor: '' }), { status: 200 }));
  await fetchQueue({ csName: 'Aisyah' }, null, request);
  await searchCustomers('Hasna', 'Aisyah', request);
  await fetchHistory('sent', 'Aisyah', null, request);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/follow-up/snapshot', '/api/follow-up/search', '/api/follow-up/history',
  ]);
});

test('actions use the dedicated guarded endpoints', async () => {
  const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, status: 'accepted' }), { status: 200 }));
  await sendTemplate({ conversationId: 'c1', stage: 1, templateId: 't1', requestId: crypto.randomUUID() }, request);
  await confirmContact({ conversationId: 'c1', stage: 1, requestId: crypto.randomUUID() }, request);
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/follow-up/send', '/api/follow-up/confirm-contact']);
});

test('localized server errors become typed client errors', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'Pencarian minimal tiga karakter.' }), { status: 400 }));
  await expect(searchCustomers('Ha', undefined, request)).rejects.toEqual(
    expect.objectContaining<Partial<FollowUpClientError>>({ message: 'Pencarian minimal tiga karakter.', status: 400 }),
  );
});
