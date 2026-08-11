import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'signed-token') }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = state.query;
    setAuth = state.setAuth;
  },
}));

import { POST } from './route';

function request(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/follow-up/snapshot', {
    method: 'POST',
    headers: { cookie: 'auth_token=test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = null;
  state.query.mockReset();
  state.setAuth.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(200_000);
});

test('snapshot rejects an anonymous request', async () => {
  expect((await POST(request())).status).toBe(401);
});

test('snapshot ignores a client CS override and passes signed identity with explicit now', async () => {
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test', csName: 'Aisyah' };
  state.query.mockResolvedValueOnce({
    page: [{ stage: 1, orderId: 'A' }, { stage: 3, orderId: 'B' }],
    isDone: true,
    continueCursor: 'done',
  });

  const response = await POST(request({ csName: 'Lila' }));

  expect(response.status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith('signed-token');
  expect(state.query.mock.calls[0][1]).toEqual({
    csName: 'Aisyah',
    stage: undefined,
    now: 200_000,
    paginationOpts: { numItems: 30, cursor: null },
  });
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(await response.json()).toMatchObject({
    ok: true,
    page: [{ stage: 1, orderId: 'A' }, { stage: 3, orderId: 'B' }],
    pagination: { isDone: true, continueCursor: 'done' },
  });
});

test('snapshot forwards a valid cursor without adding eager reads', async () => {
  state.session = { role: 'owner', name: 'Owner', email: 'owner@test' };
  state.query.mockResolvedValueOnce({ page: [], isDone: false, continueCursor: 'next' });

  await POST(request({ csName: 'Lila', cursor: 'cursor-1' }));

  expect(state.query.mock.calls[0][1]).toMatchObject({
    csName: 'Lila',
    paginationOpts: { numItems: 30, cursor: 'cursor-1' },
  });
  expect(state.query).toHaveBeenCalledTimes(1);
});
