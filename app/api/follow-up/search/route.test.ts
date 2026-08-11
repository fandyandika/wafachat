import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ session: null as null | Record<string, unknown>, query: vi.fn(), setAuth: vi.fn() }));
vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'signed-token') }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = state.query; setAuth = state.setAuth; } }));

import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/follow-up/search', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: 'auth_token=test' }, body: JSON.stringify(body),
});

beforeEach(() => { state.session = null; state.query.mockReset(); state.setAuth.mockReset(); });

test('search requires a session and at least three characters', async () => {
  expect((await POST(request({ query: 'Hasna' }))).status).toBe(401);
  state.session = { role: 'owner', name: 'Owner' };
  expect((await POST(request({ query: 'Ha' }))).status).toBe(400);
  expect(state.query).not.toHaveBeenCalled();
});

test('search enforces CS scope and performs one bounded query', async () => {
  state.session = { role: 'cs', name: 'Aisyah', csName: 'Aisyah' };
  state.query.mockResolvedValueOnce([{ customerName: 'Hasna' }]);
  const response = await POST(request({ query: ' Hasna ', csName: 'Lila' }));
  expect(response.status).toBe(200);
  expect(state.query.mock.calls[0][1]).toEqual({ query: 'Hasna', csName: 'Aisyah', limit: 20 });
  expect(state.query).toHaveBeenCalledTimes(1);
});
