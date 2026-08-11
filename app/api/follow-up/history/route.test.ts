import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ session: null as null | Record<string, unknown>, query: vi.fn(), setAuth: vi.fn() }));
vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'signed-token') }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = state.query; setAuth = state.setAuth; } }));

import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/follow-up/history', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: 'auth_token=test' }, body: JSON.stringify(body),
});

beforeEach(() => { state.session = null; state.query.mockReset(); state.setAuth.mockReset(); });

test('history rejects unknown views', async () => {
  state.session = { role: 'owner', name: 'Owner' };
  expect((await POST(request({ view: 'archived' }))).status).toBe(400);
  expect(state.query).not.toHaveBeenCalled();
});

test('history forwards view, cursor, and verified CS scope once', async () => {
  state.session = { role: 'cs', name: 'Aisyah', csName: 'Aisyah' };
  state.query.mockResolvedValueOnce({ page: [], isDone: false, continueCursor: 'next' });
  const response = await POST(request({ view: 'review', csName: 'Lila', cursor: 'cursor-2' }));
  expect(response.status).toBe(200);
  expect(state.query.mock.calls[0][1]).toEqual({
    view: 'review', csName: 'Aisyah', paginationOpts: { numItems: 50, cursor: 'cursor-2' },
  });
  expect(state.query).toHaveBeenCalledTimes(1);
});
