import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const secret = () => process.env.PANEL_AUTH_SECRET!;

async function requireAdmin(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  return session?.role === 'admin' ? session : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const users = await convex.query(api.auth.listUsers, { authSecret: secret() });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const s = secret();
  if (body.action === 'create') {
    const r = await convex.mutation(api.auth.createUser, { authSecret: s, email: String(body.email), name: String(body.name), role: body.role === 'admin' ? 'admin' : 'cs', password: String(body.password) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'reset') {
    const r = await convex.mutation(api.auth.resetPassword, { authSecret: s, email: String(body.email), newPassword: String(body.password) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'setActive') {
    const r = await convex.mutation(api.auth.setActive, { authSecret: s, email: String(body.email), isActive: Boolean(body.isActive) });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: 'bad action' }, { status: 400 });
}
