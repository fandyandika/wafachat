import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { verifySession } from "@/lib/auth-jwt";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get("auth_token")?.value);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!session.orgId) return NextResponse.json({ ok: false, error: "Organisasi sesi tidak ditemukan." }, { status: 400 });
  if (!process.env.PANEL_AUTH_SECRET) {
    return NextResponse.json({ ok: false, error: "Konfigurasi autentikasi server belum lengkap." }, { status: 503 });
  }

  const body = await req.json().catch(() => null) as null | Record<string, unknown>;
  if (!body || typeof body.threadId !== "string" || typeof body.text !== "string" || typeof body.clientRequestId !== "string") {
    return NextResponse.json({ ok: false, error: "Data pesan tidak lengkap." }, { status: 400 });
  }

  try {
    const result = await convex.action(api.adminInbox.sendText, {
      authSecret: process.env.PANEL_AUTH_SECRET,
      orgId: session.orgId as never,
      actorUserId: session.userId,
      actorName: session.name,
      threadId: body.threadId as never,
      text: body.text,
      clientRequestId: body.clientRequestId,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: result.statusUnknown ? 409 : 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pengiriman pesan gagal.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
