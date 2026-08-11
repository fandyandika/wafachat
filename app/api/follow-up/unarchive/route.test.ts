import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  mutation: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'unarchive-token') }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    mutation = state.mutation;
    setAuth = state.setAuth;
  },
}));

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost/api/follow-up/unarchive', {
    method: 'POST',
    headers: { cookie: 'auth_token=test', 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conversation-2' }),
  });
}

beforeEach(() => {
  state.session = null;
  state.mutation.mockReset();
  state.setAuth.mockReset();
});

test('unarchive carries signed identity and never sends PANEL_AUTH_SECRET', async () => {
  state.session = { role: 'admin', name: 'Owner', email: 'owner@test' };
  state.mutation.mockResolvedValue({ ok: true });

  expect((await POST(request())).status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith('unarchive-token');
  expect(state.mutation.mock.calls[0][1]).toEqual({ conversationId: 'conversation-2' });
});
