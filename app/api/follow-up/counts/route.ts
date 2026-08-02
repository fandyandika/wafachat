import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'cs' || !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const rows = await convex.query(api.followUp.getFollowUpCandidates, { csName: session.csName });
    return NextResponse.json({
      ok: true,
      counts: { h1: rows.stage1.length, h2: rows.stage2.length, h3: rows.stage3.length },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || 'Gagal memuat antrean' }, { status: 500 });
  }
}
