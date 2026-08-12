import { beforeEach, expect, test, vi } from 'vitest';
import {
  archiveFollowUp,
  confirmContact,
  FollowUpClientError,
  searchCustomers,
  sendTemplate,
  unarchiveFollowUp,
} from './follow-up-client';

beforeEach(() => vi.unstubAllGlobals());

test('search remains an explicit one-shot request', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, page: [] }), { status: 200 }));
  await searchCustomers('Hasna', 'Aisyah', request);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toBe('/api/follow-up/search');
});

test('actions use dedicated guarded endpoints', async () => {
  const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, status: 'accepted' }), { status: 200 }));
  await sendTemplate({ conversationId: 'c1', stage: 1, templateId: 't1', requestId: crypto.randomUUID() }, request);
  await confirmContact({ conversationId: 'c1', requestId: crypto.randomUUID() }, request);
  await unarchiveFollowUp('c1', request);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/follow-up/send', '/api/follow-up/confirm-contact', '/api/follow-up/unarchive',
  ]);
});

test('archive generates and sends a request UUID for the user action', async () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => requestId) });
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await archiveFollowUp('c1', request);
  expect(request).toHaveBeenCalledWith('/api/follow-up/archive', expect.objectContaining({
    body: JSON.stringify({ conversationId: 'c1', requestId }),
  }));
});

test('localized server errors become typed client errors', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'Pencarian minimal tiga karakter.' }), { status: 400 }));
  await expect(searchCustomers('Ha', undefined, request)).rejects.toEqual(
    expect.objectContaining<Partial<FollowUpClientError>>({ message: 'Pencarian minimal tiga karakter.', status: 400 }),
  );
});
