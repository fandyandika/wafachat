import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get('auth_session')?.value;

  if (pathname.startsWith('/panel') && session !== '1') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(session === '1' ? '/panel' : '/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/panel/:path*'],
};
