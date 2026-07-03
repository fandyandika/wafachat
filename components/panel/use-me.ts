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
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && (j?.role === 'admin' || j?.role === 'cs')) setMe(j as Me);
      })
      .catch(() => {
        /* unauthenticated / offline — leave null, callers default to the safe view */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
