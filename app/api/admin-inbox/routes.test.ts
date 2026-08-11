import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  action: vi.fn(),
}));

vi.mock("@/lib/auth-jwt", () => ({ verifySession: vi.fn(async () => state.session) }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class { action = state.action; },
}));

import { POST as sendTemplate } from "./send-template/route";
import { POST as sendText } from "./send-text/route";

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { cookie: "auth_token=test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const admin = { userId: "admin-1", role: "admin", name: "Owner", email: "owner@test", orgId: "org-1" };

beforeEach(() => {
  state.session = null;
  state.action.mockReset();
  process.env.PANEL_AUTH_SECRET = "server-secret";
  process.env.KIRIMDEV_API_KEY = "kdv-secret";
  process.env.KIRIMDEV_BASE_URL = "https://api.test/v1";
});

test("admin inbox send routes reject missing session and CS access", async () => {
  expect((await sendTemplate(request("/api/admin-inbox/send-template", {}))).status).toBe(401);
  state.session = { ...admin, role: "cs" };
  expect((await sendText(request("/api/admin-inbox/send-text", {}))).status).toBe(403);
  expect(state.action).not.toHaveBeenCalled();
});

test("template route sends an allowlisted reservation once and finalizes acceptance", async () => {
  state.session = admin;
  state.action.mockResolvedValue({ ok: true, duplicate: false, messageId: "message-1" });

  const response = await sendTemplate(request("/api/admin-inbox/send-template", {
    channelId: "channel-1", customerPhone: "085715682110", customerName: " Fandi ",
    productName: " Quran Mapping ", totalAmount: 189_000, orderId: "UNVERIFIED-1",
    templateId: "template-1", values: [],
    clientRequestId: "request-1",
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, duplicate: false, messageId: "message-1" });
  expect(state.action).toHaveBeenCalledTimes(1);
  expect(state.action.mock.calls[0][1]).toMatchObject({
    orgId: "org-1",
    actorUserId: "admin-1",
    actorName: "Owner",
    customerName: " Fandi ",
    productName: " Quran Mapping ",
    totalAmount: 189_000,
    values: [],
  });
  expect(state.action.mock.calls[0][1]).not.toHaveProperty("orderId");
});

test.each([-1, 1.5, "189000"])("template route rejects invalid total %s", async (totalAmount) => {
  state.session = admin;
  const response = await sendTemplate(request("/api/admin-inbox/send-template", {
    channelId: "channel-1", customerPhone: "085715682110", totalAmount,
    templateId: "template-1", values: [], clientRequestId: "request-invalid-total",
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("Harga total") });
  expect(state.action).not.toHaveBeenCalled();
});

test.each([
  ["customerName", 123],
  ["productName", false],
])("template route rejects invalid optional %s", async (field, value) => {
  state.session = admin;
  const response = await sendTemplate(request("/api/admin-inbox/send-template", {
    channelId: "channel-1", customerPhone: "085715682110", [field]: value,
    templateId: "template-1", values: [], clientRequestId: "request-invalid-context",
  }));

  expect(response.status).toBe(400);
  expect(state.action).not.toHaveBeenCalled();
});

test("duplicate client request does not send to KirimDev again", async () => {
  state.session = admin;
  state.action.mockResolvedValue({ ok: true, duplicate: true, messageId: "message-1" });
  const response = await sendText(request("/api/admin-inbox/send-text", {
    threadId: "thread-1", text: "Halo", clientRequestId: "request-1",
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, duplicate: true, messageId: "message-1" });
  expect(state.action).toHaveBeenCalledTimes(1);
});

test("provider timeout is recorded as unknown and is not reported as sent", async () => {
  state.session = admin;
  state.action.mockResolvedValue({ ok: false, error: "Status belum diketahui.", statusUnknown: true, messageId: "message-2" });

  const response = await sendText(request("/api/admin-inbox/send-text", {
    threadId: "thread-1", text: "Halo", clientRequestId: "request-2",
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ ok: false, statusUnknown: true });
  expect(state.action).toHaveBeenCalledTimes(1);
});
