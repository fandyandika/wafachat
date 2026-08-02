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
});

test('follow-up counts require an assigned CS session', async () => {
  expect((await POST(request())).status).toBe(401);
  state.session = { role: 'admin', name: 'Owner', email: 'owner@test' };
  expect((await POST(request())).status).toBe(403);
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test' };
  expect((await POST(request())).status).toBe(403);
});

test('follow-up counts use the verified CS scope and one candidates read', async () => {
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test', csName: 'Aisyah' };
  state.query.mockResolvedValue({ stage1: [{}, {}], stage2: [{}], stage3: [] });

  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(state.query.mock.calls[0][1]).toEqual({ csName: 'Aisyah' });
  expect(await response.json()).toEqual({ ok: true, counts: { h1: 2, h2: 1, h3: 0 } });
});
