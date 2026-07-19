import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';
import { bucketResponseTimeRange } from '@/lib/response-time-cache';

// On-demand fetch removes reactive amplification from the response-time scan.
// The two-minute shared cache is explicitly isolated by DB-verified organization,
// effective CS scope, and bucketed half-open range.
export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const startAt = Number(body?.startAt);
  const endAt = Number(body?.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const requestedCsName = typeof body?.csName === 'string' && body.csName.length > 0
    ? body.csName
    : undefined;

  try {
    // Request-local mutable auth state: no caller can overwrite another request's token.
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(await signConvexToken(session));
    const access = await convex.query(api.responseTime.getResponseTimeAccess, { requestedCsName });
    const bucketedRange = bucketResponseTimeRange(startAt, endAt);
    const scopeKey = access.effectiveCsName ?? '__all__';
    const getResponseTimesCached = unstable_cache(
      () => convex.query(api.responseTime.getResponseTimes, {
        startAt: bucketedRange.startAt,
        endAt: bucketedRange.endAt,
        csName: access.effectiveCsName,
      }),
      [
        'panel-response-times',
        `org:${access.orgId}`,
        `scope:${scopeKey}`,
        `start:${bucketedRange.startAt}`,
        `end:${bucketedRange.endAt}`,
      ],
      { revalidate: 120 },
    );
    const data = await getResponseTimesCached();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || 'failed' }, { status: 500 });
  }
}
