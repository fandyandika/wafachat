import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

// One-shot, bounded queue fetch. Search and history use separate on-demand routes.
export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { csName, cursor, stage } = await req.json().catch(() => ({ csName: undefined, cursor: undefined, stage: undefined }));
  if (session.role === 'cs' && !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }
  const requestedCs = typeof csName === 'string' && csName.trim().length > 0 ? csName.trim() : undefined;
  const cs = session.role === 'cs' ? session.csName!.trim() : requestedCs;
  const now = Date.now();

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    // Carry the verified caller's identity into Convex (guarded queries reject anonymous).
    convex.setAuth(await signConvexToken(session));
    const queue = await convex.query(api.followUp.listDueFollowUps, {
      csName: cs,
      stage: stage === 1 || stage === 2 || stage === 3 ? stage : undefined,
      now,
      paginationOpts: { numItems: 30, cursor: typeof cursor === 'string' ? cursor : null },
    });
    return NextResponse.json({
      ok: true,
      page: queue.page,
      pagination: { isDone: queue.isDone, continueCursor: queue.continueCursor },
    });
  } catch (e) {
    console.error('Follow-up queue failed', e);
    return NextResponse.json({ ok: false, error: 'Gagal memuat antrean follow-up.' }, { status: 500 });
  }
}
