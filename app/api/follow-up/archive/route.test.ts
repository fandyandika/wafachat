import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  mutation: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('@/lib/auth-jwt', () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock('@/lib/convex-token', () => ({ signConvexToken: vi.fn(async () => 'archive-token') }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    mutation = state.mutation;
    setAuth = state.setAuth;
  },
}));

import { POST } from './route';

const requestId = '11111111-2222-4111-8111-111111111111';

function request(body: Record<string, unknown> = { conversationId: 'conversation-1', requestId }) {
  return new NextRequest('http://localhost/api/follow-up/archive', {
    method: 'POST',
    headers: { cookie: 'auth_token=test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = null;
  state.mutation.mockReset();
  state.setAuth.mockReset();
});

test('archive carries signed identity and never sends PANEL_AUTH_SECRET', async () => {
  state.session = { role: 'cs', name: 'Aisyah', email: 'aisyah@test', csName: 'Aisyah' };
  state.mutation.mockResolvedValue({ ok: true });

  expect((await POST(request())).status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith('archive-token');
  expect(state.mutation.mock.calls[0][1]).toEqual({ conversationId: 'conversation-1', requestId });
});

test('archive requires a request UUID for a distinct user action', async () => {
  state.session = { role: 'admin', name: 'Owner', email: 'owner@test' };
  expect((await POST(request({ conversationId: 'conversation-1' }))).status).toBe(400);
  expect(state.mutation).not.toHaveBeenCalled();
});
