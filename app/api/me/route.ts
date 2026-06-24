import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth-jwt';

export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ name: session.name, role: session.role, email: session.email });
}
