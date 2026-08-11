import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'Sesi tidak valid.' }, { status: 401 });
  if (session.role === 'cs' && !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const term = typeof body.query === 'string' ? body.query.trim() : '';
  if (term.length < 3) {
    return NextResponse.json({ ok: false, error: 'Pencarian minimal tiga karakter.' }, { status: 400 });
  }
  const requestedCs = typeof body.csName === 'string' && body.csName.trim() ? body.csName.trim() : undefined;
  const csName = session.role === 'cs' ? session.csName!.trim() : requestedCs;
  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const page = await convex.query(api.followUp.searchFollowUpCustomers, { query: term, csName, limit: 20 });
    return NextResponse.json({ ok: true, page });
  } catch (error) {
    console.error('Follow-up search failed', error);
    return NextResponse.json({ ok: false, error: 'Gagal mencari customer.' }, { status: 500 });
  }
}
