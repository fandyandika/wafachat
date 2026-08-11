import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { verifySession } from "@/lib/auth-jwt";
import { signConvexToken } from "@/lib/convex-token";

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SendBody = {
  conversationId?: string;
  stage?: number;
  templateId?: string;
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
  const { conversationId, stage, templateId, requestId } = body;
  if (!conversationId || (stage !== 1 && stage !== 2 && stage !== 3) || !templateId || !requestId || !REQUEST_ID_RE.test(requestId)) {
    return NextResponse.json({ ok: false, error: "Percakapan, tahap, template, atau request ID tidak valid." }, { status: 400 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(await signConvexToken(session));

  try {
    const result = await convex.action(api.followUp.sendDueFollowUp, {
      conversationId: conversationId as Id<"conversations">,
      stage,
      templateId: templateId as Id<"followUpTemplates">,
      requestId,
    });
    const statusCode = result.ok ? 200 : result.status === "sending" ? 202 : 502;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pengiriman Follow-up gagal.";
    const unauthorized = /unauthorized|requires a logged-in user/i.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: unauthorized ? 403 : 409 },
    );
  }
}
