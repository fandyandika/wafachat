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
  state.query
    .mockResolvedValueOnce({
      page: [{ stage: 1, orderId: 'A' }, { stage: 3, orderId: 'B' }],
      isDone: true,
      continueCursor: 'done',
    })
    .mockResolvedValueOnce({ totalClosings: 0, fromFollowUp: 0, byStage: { h1: 0, h2: 0, h3: 0 } })
    .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: 'sending-done' })
    .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: 'failed-done' })
    .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: 'unknown-done' });

  const response = await POST(request({ csName: 'Lila' }));

  expect(response.status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith('signed-token');
  expect(state.query.mock.calls[0][1]).toEqual({
    csName: 'Aisyah',
    now: 200_000,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(state.query.mock.calls[1][1]).toEqual({
    startAt: 200_000 - 30 * 24 * 60 * 60 * 1000,
    endAt: 200_000,
    csName: 'Aisyah',
  });
  expect(state.query.mock.calls[2][1]).toEqual({
    csName: 'Aisyah', state: 'sending', paginationOpts: { numItems: 50, cursor: null },
  });
  expect(state.query.mock.calls[4][1]).toEqual({
    csName: 'Aisyah', state: 'unknown', paginationOpts: { numItems: 50, cursor: null },
  });
  expect((await response.json()).candidates).toMatchObject({
    stage1: [{ stage: 1, orderId: 'A' }],
    stage2: [],
    stage3: [{ stage: 3, orderId: 'B' }],
  });
});
