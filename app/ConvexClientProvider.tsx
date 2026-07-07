'use client';

import { ReactNode, useMemo } from 'react';
import { ConvexProvider, ConvexReactClient, useConvexAuth } from 'convex/react';

// Hold rendering until the auth handshake resolves (authenticated OR confirmed
// anonymous). Without this, the first queries fire before the token is attached —
// harmless while authz is permissive, but they would be REJECTED once enforcement
// flips, leaving one-shot snapshot fetches stuck on an error until reload.
function AuthReadyGate({ children }: { children: ReactNode }) {
  const { isLoading } = useConvexAuth();
  if (isLoading) return null;
  return <>{children}</>;
}

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

  return (
    <ConvexProvider client={convex}>
      <AuthReadyGate>{children}</AuthReadyGate>
    </ConvexProvider>
  );
}
