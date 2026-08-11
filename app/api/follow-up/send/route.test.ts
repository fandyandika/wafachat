import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  action: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock("@/lib/auth-jwt", () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock("@/lib/convex-token", () => ({ signConvexToken: vi.fn(async () => "signed-token") }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = state.action;
    setAuth = state.setAuth;
  },
}));

import { POST } from "./route";

const requestId = "11111111-1111-4111-8111-111111111111";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/follow-up/send", {
    method: "POST",
    headers: { cookie: "auth_token=test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = null;
  state.action.mockReset();
  state.setAuth.mockReset();
});

test("manual send rejects an anonymous request", async () => {
  expect((await POST(request())).status).toBe(401);
});

test("manual send delegates the complete provider workflow to the signed Convex action", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.action.mockResolvedValue({ ok: true, status: "accepted", providerMessageId: "wamid.1" });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith("signed-token");
  expect(state.action).toHaveBeenCalledOnce();
  expect(state.action.mock.calls[0][1]).toEqual({ conversationId: "conv1", stage: 1, requestId });
  expect(await response.json()).toMatchObject({ ok: true, status: "accepted" });
});

test("manual send reports an in-progress duplicate reservation", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.action.mockResolvedValueOnce({ ok: false, status: "sending" });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(202);
  expect(state.action).toHaveBeenCalledOnce();
});

test("manual send exposes provider uncertainty without silently retrying", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.action.mockResolvedValueOnce({ ok: false, status: "unknown", error: "Timeout" });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ ok: false, status: "unknown", error: "Timeout" });
});
