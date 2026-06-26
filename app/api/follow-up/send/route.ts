import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const secret = () => process.env.PANEL_AUTH_SECRET!;

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { conversationId, stage } = await req.json();
  if (!conversationId || (stage !== 1 && stage !== 2)) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const result = await convex.action(api.followUp.sendFollowUp, {
    conversationId,
    stage,
    authSecret: secret(),
  });
  return NextResponse.json(result);
}
