import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';

// One-shot fetch for the heavy follow-up data (candidates + KPI). Replaces the live
// useQuery subscriptions on the dashboard so these queries run only on page load /
// manual refresh / after an action — not on every inbound message (which was reading
// the whole conversations table over and over and blowing the DB I/O budget).
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { csName } = await req.json().catch(() => ({ csName: undefined }));
  const cs = typeof csName === 'string' && csName.length > 0 ? csName : undefined;
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  try {
    const [candidates, kpi] = await Promise.all([
      convex.query(api.followUp.getFollowUpCandidates, { csName: cs }),
      convex.query(api.followUp.getFollowUpEffectiveness, { startAt: thirtyDaysAgo, endAt: now, csName: cs }),
    ]);
    return NextResponse.json({ ok: true, candidates, kpi });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || 'failed' }, { status: 500 });
  }
}
