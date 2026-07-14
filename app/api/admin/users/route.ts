import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { verifySession } from '@/lib/auth-jwt';
import type { Id } from '@/convex/_generated/dataModel';

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
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const s = secret();
  if (body.action === 'create') {
    const r = await convex.mutation(api.auth.createUser, { authSecret: s, email: String(body.email), name: String(body.name), role: body.role === 'admin' ? 'admin' : 'cs', password: String(body.password), csName: body.csName ? String(body.csName) : undefined, orgId: session.orgId as Id<"organizations"> | undefined });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'update') {
    const r = await convex.mutation(api.auth.updateUser, {
      authSecret: s, email: String(body.email),
      name: body.name !== undefined ? String(body.name) : undefined,
      csName: body.csName !== undefined ? String(body.csName) : undefined,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === 'delete') {
    const r = await convex.mutation(api.auth.deleteUser, { authSecret: s, email: String(body.email) });
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
