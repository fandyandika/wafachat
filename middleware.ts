import { NextRequest, NextResponse } from 'next/server';
import { verifySession, routeGuard } from '@/lib/auth-jwt';

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get('auth_token')?.value);
  const { redirect } = routeGuard(req.nextUrl.pathname, session);
  if (redirect) return NextResponse.redirect(new URL(redirect, req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/panel/:path*'],
};
