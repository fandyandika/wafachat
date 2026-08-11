import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

const MAX_COUNT_PAGES = 10;

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'cs' || !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const counts = { h1: 0, h2: 0, h3: 0 };
    const now = Date.now();
    let cursor: string | null = null;
    let isDone = false;
    let pagesRead = 0;
    while (!isDone && pagesRead < MAX_COUNT_PAGES) {
      const rows: {
        page: Array<{ stage: 1 | 2 | 3 }>;
        isDone: boolean;
        continueCursor: string;
      } = await convex.query(api.followUp.listDueFollowUps, {
        csName: session.csName,
        now,
        paginationOpts: { numItems: 100, cursor },
      });
      for (const row of rows.page) {
        if (row.stage === 1) counts.h1++;
        else if (row.stage === 2) counts.h2++;
        else counts.h3++;
      }
      isDone = rows.isDone;
      cursor = rows.continueCursor || null;
      pagesRead++;
      if (!isDone && !cursor) throw new Error('Cursor antrean Follow-up tidak valid.');
    }
    return NextResponse.json({
      ok: true,
      counts,
      truncated: !isDone,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || 'Gagal memuat antrean' }, { status: 500 });
  }
}
