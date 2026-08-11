import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  mutation: vi.fn(),
  setAuth: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/auth-jwt", () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock("@/lib/convex-token", () => ({ signConvexToken: vi.fn(async () => "signed-token") }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = state.mutation;
    setAuth = state.setAuth;
  },
}));
vi.mock("@/lib/kirimdev", () => ({
  buildTemplatePayload: vi.fn((to, templateName, language, orderedValues) => ({ to, templateName, language, orderedValues })),
  sendKirimDevMessage: state.send,
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
  state.mutation.mockReset();
  state.setAuth.mockReset();
  state.send.mockReset();
  process.env.KIRIMDEV_API_KEY = "k_test";
  process.env.KIRIMDEV_BASE_URL = "https://api.test/v1";
});

test("manual send rejects an anonymous request", async () => {
  expect((await POST(request())).status).toBe(401);
});

test("manual send reserves with signed identity, sends once, and finalizes acceptance", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.mutation
    .mockResolvedValueOnce({
      shouldSend: true,
      status: "sending",
      to: "6285715682110",
      phoneNumberId: "pn_cs",
      templateName: "follow_up_h1",
      language: "id",
      orderedValues: ["Fandi", "Quran Mapping", "O-1"],
      idempotencyKey: "fu-conv-cycle-1-request",
    })
    .mockResolvedValueOnce({ ok: true, status: "accepted" });
  state.send.mockResolvedValue({ ok: true, providerMessageId: "wamid.1" });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(200);
  expect(state.setAuth).toHaveBeenCalledWith("signed-token");
  expect(state.send).toHaveBeenCalledOnce();
  expect(state.send).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: "k_test",
    phoneNumberId: "pn_cs",
    idempotencyKey: "fu-conv-cycle-1-request",
  }));
  expect(state.mutation.mock.calls[1][1]).toMatchObject({
    conversationId: "conv1",
    requestId,
    outcome: "accepted",
    providerMessageId: "wamid.1",
  });
  expect(await response.json()).toMatchObject({ ok: true, status: "accepted" });
});

test("manual send does not call provider for a duplicate reservation", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.mutation.mockResolvedValueOnce({ shouldSend: false, status: "sending" });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(202);
  expect(state.send).not.toHaveBeenCalled();
  expect(state.mutation).toHaveBeenCalledOnce();
});

test("manual send records transport uncertainty and blocks silent retries", async () => {
  state.session = { userId: "admin", role: "admin", name: "Admin", email: "admin@test" };
  state.mutation
    .mockResolvedValueOnce({
      shouldSend: true,
      status: "sending",
      to: "6285715682110",
      phoneNumberId: "pn_cs",
      templateName: "follow_up_h1",
      language: "id",
      orderedValues: [],
      idempotencyKey: "fu-conv-cycle-1-request",
    })
    .mockResolvedValueOnce({ ok: true, status: "unknown" });
  state.send.mockResolvedValue({ ok: false, error: "Timeout", statusUnknown: true });

  const response = await POST(request({ conversationId: "conv1", stage: 1, requestId }));

  expect(response.status).toBe(502);
  expect(state.mutation.mock.calls[1][1]).toMatchObject({
    conversationId: "conv1",
    requestId,
    outcome: "unknown",
    error: "Timeout",
  });
});
