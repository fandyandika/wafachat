'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth } from 'convex/react';

// Custom-auth integration (Fase 0): the panel's identity reaches Convex as a
// short-lived RS256 token exchanged from the httpOnly session cookie
// (/api/auth/convex-token), validated by Convex against our JWKS.
//
// ConvexProviderWithAuth is the supported pattern for this — it drives the token
// lifecycle (fetch, refresh, clear) from the useAuth contract below. Re-checking on
// pathname changes keeps the state correct across login/logout navigations without
// remounting the provider.
function useSessionAuth() {
  const pathname = usePathname();
  const [st, setSt] = useState<{ loaded: boolean; authed: boolean }>({ loaded: false, authed: false });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/convex-token')
      .then((r) => { if (!cancelled) setSt({ loaded: true, authed: r.ok }); })
      .catch(() => { if (!cancelled) setSt({ loaded: true, authed: false }); });
    return () => { cancelled = true; };
  }, [pathname]);

  const fetchAccessToken = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/convex-token');
      if (!r.ok) return null;
      const body = (await r.json()) as { token?: string };
      return body.token ?? null;
    } catch {
      return null;
    }
  }, []);

  return useMemo(
    () => ({ isLoading: !st.loaded, isAuthenticated: st.authed, fetchAccessToken }),
    [st.loaded, st.authed, fetchAccessToken],
  );
}

// Hold rendering until the auth handshake resolves (authenticated OR confirmed
// anonymous). Without this, first-mount queries would fire before the token is
// attached — harmless while authz is permissive, but rejected once enforcement
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
    return new ConvexReactClient(convexUrl);
  }, []);

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useSessionAuth}>
      <AuthReadyGate>{children}</AuthReadyGate>
    </ConvexProviderWithAuth>
  );
}
