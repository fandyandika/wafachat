import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { signSession } from '@/lib/auth-jwt';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await convex.mutation(api.auth.verifyCredentials, {
    authSecret: process.env.PANEL_AUTH_SECRET!,
    email: String(email),
    password: String(password),
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = await signSession({ userId: result.userId!, role: result.role!, name: result.name!, email: result.email!, csName: result.csName ?? undefined, orgId: result.orgId });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
