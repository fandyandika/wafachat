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
  if (!body || typeof body.channelId !== "string" || typeof body.customerPhone !== "string" ||
      typeof body.templateId !== "string" || typeof body.clientRequestId !== "string" || !Array.isArray(body.values)) {
    return NextResponse.json({ ok: false, error: "Data pengiriman template tidak lengkap." }, { status: 400 });
  }
  const values = body.values.filter((entry): entry is { key: string; value: string } => {
    return !!entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).key === "string" &&
      typeof (entry as Record<string, unknown>).value === "string";
  });
  if (values.length !== body.values.length) {
    return NextResponse.json({ ok: false, error: "Nilai template tidak valid." }, { status: 400 });
  }

  try {
    const result = await convex.action(api.adminInbox.sendTemplate, {
      authSecret: process.env.PANEL_AUTH_SECRET,
      orgId: session.orgId as never,
      actorUserId: session.userId,
      actorName: session.name,
      channelId: body.channelId as never,
      customerPhone: body.customerPhone,
      customerName: typeof body.customerName === "string" ? body.customerName : undefined,
      orderId: typeof body.orderId === "string" ? body.orderId : undefined,
      templateId: body.templateId as never,
      values,
      clientRequestId: body.clientRequestId,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: result.statusUnknown ? 409 : 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pengiriman template gagal.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
