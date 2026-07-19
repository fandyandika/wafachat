import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  accessByToken: new Map<string, { orgId: string; role: 'admin' | 'cs'; effectiveCsName?: string }>(),
  calls: [] as Array<{ token?: string; args: Record<string, unknown> }>,
  clients: 0,
  cache: new Map<string, unknown>(),
}));

vi.mock('@/lib/auth-jwt', () => ({
  verifySession: vi.fn(async () => state.sessions.shift() ?? null),
}));

vi.mock('@/lib/convex-token', () => ({
  signConvexToken: vi.fn(async (session: { email: string }) => `token:${session.email}`),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: any[]) => Promise<unknown>, keyParts: string[]) =>
    async (...args: any[]) => {
      const key = JSON.stringify([...keyParts, ...args]);
      if (!state.cache.has(key)) state.cache.set(key, await fn(...args));
      return state.cache.get(key);
    },
}));

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    private token?: string;

    constructor() {
      state.clients++;
    }

    setAuth(token: string) {
      this.token = token;
    }

    async query(_query: unknown, args: Record<string, unknown>) {
      state.calls.push({ token: this.token, args });
      const access = this.token ? state.accessByToken.get(this.token) : undefined;
      if ('requestedCsName' in args) {
        if (!access) throw new Error('forbidden');
        return access;
      }
      return { orgId: access?.orgId ?? 'default-org', csName: args.csName ?? null };
    }
  },
}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/panel/response-times', {
    method: 'POST',
    headers: { cookie: 'auth_token=test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.sessions.length = 0;
  state.accessByToken.clear();
  state.calls.length = 0;
  state.clients = 0;
  state.cache.clear();
});

test('response-time cache is isolated by the DB-verified organization', async () => {
  state.sessions.push(
    { userId: 'u1', role: 'admin', name: 'Admin 1', email: 'one@example.test', orgId: 'org-1' },
    { userId: 'u2', role: 'admin', name: 'Admin 2', email: 'two@example.test', orgId: 'org-2' },
  );
  state.accessByToken.set('token:one@example.test', { orgId: 'org-1', role: 'admin' });
  state.accessByToken.set('token:two@example.test', { orgId: 'org-2', role: 'admin' });

  const first = await POST(request({ startAt: 1_000, endAt: 241_999 }));
  const second = await POST(request({ startAt: 1_000, endAt: 241_999 }));

  expect((await first.json()).data.orgId).toBe('org-1');
  expect((await second.json()).data.orgId).toBe('org-2');
  expect(state.calls.filter((call) => 'startAt' in call.args)).toHaveLength(2);
  expect(state.clients).toBe(2);
});

test('a CS request is forced to the CS identity stored in the database', async () => {
  state.sessions.push({
    userId: 'u1', role: 'cs', name: 'CS One', email: 'cs@example.test', csName: 'Stale Cookie Name', orgId: 'org-1',
  });
  state.accessByToken.set('token:cs@example.test', {
    orgId: 'org-1', role: 'cs', effectiveCsName: 'DB Canonical CS',
  });

  const response = await POST(request({ startAt: 0, endAt: 120_000, csName: 'Another Agent' }));

  expect(response.status).toBe(200);
  const metricCall = state.calls.find((call) => 'startAt' in call.args);
  expect(metricCall?.args.csName).toBe('DB Canonical CS');
  expect(metricCall?.token).toBe('token:cs@example.test');
});
