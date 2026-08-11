import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

const VIEWS = new Set(['sent', 'review', 'completed']);
type HistoryView = 'sent' | 'review' | 'completed';

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'Sesi tidak valid.' }, { status: 401 });
  if (session.role === 'cs' && !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const view = typeof body.view === 'string' && VIEWS.has(body.view) ? body.view as HistoryView : null;
  if (!view) return NextResponse.json({ ok: false, error: 'Tampilan riwayat tidak valid.' }, { status: 400 });
  const requestedCs = typeof body.csName === 'string' && body.csName.trim() ? body.csName.trim() : undefined;
  const csName = session.role === 'cs' ? session.csName!.trim() : requestedCs;
  const cursor = typeof body.cursor === 'string' ? body.cursor : null;
  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const result = await convex.query(api.followUpAttempts.listFollowUpHistory, {
      view, csName, paginationOpts: { numItems: 50, cursor },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Follow-up history failed', error);
    return NextResponse.json({ ok: false, error: 'Gagal memuat riwayat follow-up.' }, { status: 500 });
  }
}
