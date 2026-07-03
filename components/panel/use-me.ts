'use client';

import { useEffect, useState } from 'react';

export type Me = { name: string; role: 'admin' | 'cs'; email: string; csName?: string };

// Fetch the current session (name/role/email) once. Used to scope UI by role —
// e.g. hide admin-only nav + total-business figures from CS staff. The route guard
// in middleware is the real enforcement; this is presentation only.
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Retry transient failures (flaky phone connections): a CS whose /api/me
    // fetch drops would otherwise be shown the unscoped presentation until reload.
    const attempt = (retriesLeft: number) => {
      fetch('/api/me')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          if (!cancelled && (j?.role === 'admin' || j?.role === 'cs')) setMe(j as Me);
        })
        .catch(() => {
          if (!cancelled && retriesLeft > 0) setTimeout(() => attempt(retriesLeft - 1), 1500);
          /* else unauthenticated / offline — leave null, callers default to the safe view */
        });
    };
    attempt(2);
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
