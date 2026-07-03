import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';

// On-demand fetch for response-time stats. getResponseTimes scans the whole messages
// table for the window, and was live-subscribed on Dashboard/Performance/Laporan — so
// every inbound message re-read the entire window on every open page (a big DB I/O cost).
// Fetching once per load / date-change instead removes that reactive amplification.
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Second layer: a 2-minute shared cache. The query scans every message doc in the
// window (multi-MB of Convex DB bandwidth per call), and with CS staff opening
// Laporan on their phones all day the same window was re-scanned dozens of times.
// All opens within the TTL — across ALL users — now share one Convex read. The
// stats aggregate a whole day, so 2 minutes of staleness is invisible.
const getResponseTimesCached = unstable_cache(
  async (startAt: number, endAt: number, csName?: string) =>
    convex.query(api.responseTime.getResponseTimes, { startAt, endAt, csName }),
  ['panel-response-times'],
  { revalidate: 120 },
);

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const startAt = Number(body?.startAt);
  const endAt = Number(body?.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const csName = typeof body?.csName === 'string' && body.csName.length > 0 ? body.csName : undefined;

  try {
    const data = await getResponseTimesCached(startAt, endAt, csName);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || 'failed' }, { status: 500 });
  }
}
