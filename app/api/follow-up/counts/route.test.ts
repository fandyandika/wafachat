import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'token') }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = state.query;
    setAuth = state.setAuth;
  },
}));

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost/api/follow-up/counts', { method: 'POST', headers: { cookie: 'auth_token=test' } });
}

beforeEach(() => {
  state.session = null;
  state.query.mockReset();
  state.setAuth.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(123_456);
});

test('follow-up counts require an assigned CS session', async () => {
  expect((await POST(request())).status).toBe(401);
  state.session = { role: 'admin', name: 'Owner', email: 'owner@test' };
  expect((await POST(request())).status).toBe(403);
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test' };
  expect((await POST(request())).status).toBe(403);
});

test('follow-up counts use the verified CS scope and aggregate every indexed queue page', async () => {
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test', csName: 'Aisyah' };
  state.query
    .mockResolvedValueOnce({
      page: [{ stage: 1 }, { stage: 1 }],
      isDone: false,
      continueCursor: 'page-2',
    })
    .mockResolvedValueOnce({
      page: [{ stage: 2 }],
      isDone: true,
      continueCursor: 'done',
    });

  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(state.query).toHaveBeenCalledTimes(2);
  expect(state.setAuth).toHaveBeenCalledWith('token');
  expect(state.query.mock.calls[0][1]).toEqual({
    csName: 'Aisyah',
    now: 123_456,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(state.query.mock.calls[1][1]).toEqual({
    csName: 'Aisyah',
    now: 123_456,
    paginationOpts: { numItems: 100, cursor: 'page-2' },
  });
  expect(await response.json()).toEqual({ ok: true, counts: { h1: 2, h2: 1, h3: 0 }, truncated: false });
});
