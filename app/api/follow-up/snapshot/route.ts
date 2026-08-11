import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

// One-shot fetch for the heavy follow-up data (candidates + KPI). Replaces the live
// useQuery subscriptions on the dashboard so these queries run only on page load /
// manual refresh / after an action — not on every inbound message (which was reading
// the whole conversations table over and over and blowing the DB I/O budget).
export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { csName, cursor } = await req.json().catch(() => ({ csName: undefined, cursor: undefined }));
  if (session.role === 'cs' && !session.csName?.trim()) {
    return NextResponse.json({ ok: false, error: 'CS scope required' }, { status: 403 });
  }
  const requestedCs = typeof csName === 'string' && csName.trim().length > 0 ? csName.trim() : undefined;
  const cs = session.role === 'cs' ? session.csName!.trim() : requestedCs;
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    // Carry the verified caller's identity into Convex (guarded queries reject anonymous).
    convex.setAuth(await signConvexToken(session));
    const [queue, kpi, sending, failed, unknown] = await Promise.all([
      convex.query(api.followUp.listDueFollowUps, {
        csName: cs,
        now,
        paginationOpts: { numItems: 100, cursor: typeof cursor === 'string' ? cursor : null },
      }),
      convex.query(api.followUp.getFollowUpEffectiveness, { startAt: thirtyDaysAgo, endAt: now, csName: cs }),
      ...(['sending', 'failed', 'unknown'] as const).map((state) => convex.query(api.followUp.listFollowUpAttention, {
        csName: cs,
        state,
        paginationOpts: { numItems: 50, cursor: null },
      })),
    ]);
    const candidates = {
      stage1: queue.page.filter((row) => row.stage === 1),
      stage2: queue.page.filter((row) => row.stage === 2),
      stage3: queue.page.filter((row) => row.stage === 3),
    };
    return NextResponse.json({
      ok: true,
      candidates,
      kpi,
      attention: [...sending.page, ...failed.page, ...unknown.page].sort((a, b) => b.updatedAt - a.updatedAt),
      attentionPagination: {
        sending: { isDone: sending.isDone, continueCursor: sending.continueCursor },
        failed: { isDone: failed.isDone, continueCursor: failed.continueCursor },
        unknown: { isDone: unknown.isDone, continueCursor: unknown.continueCursor },
      },
      pagination: { isDone: queue.isDone, continueCursor: queue.continueCursor },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || 'failed' }, { status: 500 });
  }
}
