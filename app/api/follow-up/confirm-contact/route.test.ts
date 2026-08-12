import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  mutation: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock("@/lib/auth-jwt", () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock("@/lib/convex-token", () => ({ signConvexToken: vi.fn(async () => "signed-token") }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = state.mutation;
    setAuth = state.setAuth;
  },
}));

import { POST } from "./route";

const requestId = "11111111-1111-4111-8111-111111111111";
const request = (body: Record<string, unknown>) => new NextRequest("http://localhost/api/follow-up/confirm-contact", {
  method: "POST",
  headers: { cookie: "auth_token=test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.session = null;
  state.mutation.mockReset();
  state.setAuth.mockReset();
});

test("manual confirmation requires a session and valid request UUID", async () => {
  expect((await POST(request({}))).status).toBe(401);
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  expect((await POST(request({ conversationId: "conv1", requestId: "bad" }))).status).toBe(400);
});

test("manual confirmation ignores a client stage claim and delegates only server-owned inputs", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.mutation.mockResolvedValue({ ok: true, duplicate: false });
  const response = await POST(request({ conversationId: "conv1", stage: 3, requestId }));
  expect(response.status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith("signed-token");
  expect(state.mutation.mock.calls[0][1]).toEqual({ conversationId: "conv1", requestId });
});
