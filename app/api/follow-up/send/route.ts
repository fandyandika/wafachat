import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { verifySession } from "@/lib/auth-jwt";
import { signConvexToken } from "@/lib/convex-token";
import { buildTemplatePayload, sendKirimDevMessage } from "@/lib/kirimdev";

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SendBody = {
  conversationId?: string;
  stage?: number;
  requestId?: string;
};

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get("auth_token")?.value);
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak valid." }, { status: 401 });

  let body: SendBody;
  try {
    body = await req.json() as SendBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Payload tidak valid." }, { status: 400 });
  }
  const { conversationId, stage, requestId } = body;
  if (!conversationId || (stage !== 1 && stage !== 2 && stage !== 3) || !requestId || !REQUEST_ID_RE.test(requestId)) {
    return NextResponse.json({ ok: false, error: "Percakapan, tahap, atau request ID tidak valid." }, { status: 400 });
  }

  const apiKey = process.env.KIRIMDEV_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "KIRIMDEV_API_KEY belum dikonfigurasi." }, { status: 503 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(await signConvexToken(session));

  try {
    const reservation = await convex.mutation(api.followUp.reserveDueFollowUp, {
      conversationId: conversationId as Id<"conversations">,
      stage,
      requestId,
    });
    if (!reservation.shouldSend) {
      const done = reservation.status === "accepted";
      return NextResponse.json(
        { ok: done, status: reservation.status },
        { status: done ? 200 : 202 },
      );
    }

    const result = await sendKirimDevMessage({
      apiKey,
      baseUrl: process.env.KIRIMDEV_BASE_URL || "https://api.kirimdev.com/v1",
      phoneNumberId: reservation.phoneNumberId,
      payload: buildTemplatePayload(
        reservation.to,
        reservation.templateName,
        reservation.language,
        reservation.orderedValues,
      ),
      idempotencyKey: reservation.idempotencyKey,
    });

    if (result.ok) {
      await convex.mutation(api.followUp.finalizeDueFollowUp, {
        conversationId: conversationId as Id<"conversations">,
        requestId,
        outcome: "accepted",
        providerMessageId: result.providerMessageId,
        acceptedAt: Date.now(),
      });
      return NextResponse.json({ ok: true, status: "accepted", providerMessageId: result.providerMessageId });
    }

    const outcome = result.statusUnknown ? "unknown" as const : "failed" as const;
    await convex.mutation(api.followUp.finalizeDueFollowUp, {
      conversationId: conversationId as Id<"conversations">,
      requestId,
      outcome,
      error: result.error,
    });
    return NextResponse.json({ ok: false, status: outcome, error: result.error }, { status: 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pengiriman Follow-up gagal.";
    const unauthorized = /unauthorized|requires a logged-in user/i.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: unauthorized ? 403 : 409 },
    );
  }
}
