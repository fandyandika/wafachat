import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { verifySession } from "@/lib/auth-jwt";
import { signConvexToken } from "@/lib/convex-token";

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get("auth_token")?.value);
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak valid." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.conversationId !== "string"
    || (body.stage !== 1 && body.stage !== 2 && body.stage !== 3)
    || typeof body.requestId !== "string"
    || !REQUEST_ID_RE.test(body.requestId)) {
    return NextResponse.json({ ok: false, error: "Data konfirmasi tidak valid." }, { status: 400 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(await signConvexToken(session));
  try {
    const result = await convex.mutation(api.followUp.confirmManualContact, {
      conversationId: body.conversationId as Id<"conversations">,
      stage: body.stage,
      requestId: body.requestId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konfirmasi Follow-up gagal.";
    const unauthorized = /unauthorized|requires a logged-in user/i.test(message);
    return NextResponse.json({ ok: false, error: message }, { status: unauthorized ? 403 : 409 });
  }
}
