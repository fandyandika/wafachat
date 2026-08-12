import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { verifySession } from '@/lib/auth-jwt';
import { signConvexToken } from '@/lib/convex-token';

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { conversationId, requestId } = await req.json().catch(() => ({}));
  if (typeof conversationId !== 'string' || typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(await signConvexToken(session));
  try {
    const result = await convex.mutation(api.followUp.archiveFollowUp, {
      conversationId: conversationId as Id<'conversations'>,
      requestId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Archive Follow-up gagal.',
    }, { status: 409 });
  }
}
