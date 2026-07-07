'use client';

import { ReactNode, useMemo } from 'react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convex = useMemo(() => {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error('NEXT_PUBLIC_CONVEX_URL is not configured');
    }
    const client = new ConvexReactClient(convexUrl);
    // Attach the panel identity to every Convex call: exchange the httpOnly session
    // cookie for a short-lived RS256 token (validated via convex/auth.config.ts).
    // Unauthenticated visitors (login page) resolve to null = anonymous, which is
    // fine — guarded functions handle rejection (convex/authz.ts).
    client.setAuth(async () => {
      try {
        const res = await fetch('/api/auth/convex-token');
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: string };
        return body.token ?? null;
      } catch {
        return null;
      }
    });
    return client;
  }, []);

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
