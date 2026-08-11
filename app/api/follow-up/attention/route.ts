import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

const STATES = new Set(['sending', 'failed', 'unknown']);

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (session.role === 'cs' && !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const state = typeof body.state === 'string' && STATES.has(body.state) ? body.state as 'sending' | 'failed' | 'unknown' : null;
  if (!state) return NextResponse.json({ ok: false, error: 'Status tidak valid.' }, { status: 400 });
  const requestedCs = typeof body.csName === 'string' && body.csName.trim() ? body.csName.trim() : undefined;
  const csName = session.role === 'cs' ? session.csName!.trim() : requestedCs;
  const cursor = typeof body.cursor === 'string' ? body.cursor : null;

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const result = await convex.query(api.followUp.listFollowUpAttention, {
      csName,
      state,
      paginationOpts: { numItems: 50, cursor },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || 'Gagal memuat status.' }, { status: 500 });
  }
}
