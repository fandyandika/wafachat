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
    const rows = await convex.query(api.followUp.listDueFollowUps, {
      csName: session.csName,
      now: Date.now(),
      paginationOpts: { numItems: 100, cursor: null },
    });
    const counts = rows.page.reduce((result, row) => {
      if (row.stage === 1) result.h1++;
      else if (row.stage === 2) result.h2++;
      else result.h3++;
      return result;
    }, { h1: 0, h2: 0, h3: 0 });
    return NextResponse.json({
      ok: true,
      counts,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || 'Gagal memuat antrean' }, { status: 500 });
  }
}
