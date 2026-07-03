'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';

type SnapshotArgs = Record<string, unknown> | 'skip';

export function useConvexSnapshotQuery<T>(queryRef: any, args: SnapshotArgs) {
  const convex = useConvex();
  // Content key: the effect re-fetches only when the args VALUES change, never on a
  // fresh object identity. A caller whose memo isn't perfectly stable used to make the
  // old effect (keyed on the args object) re-fire in a tight loop → the panel appeared
  // to auto-refresh every second. Keying on the string makes that impossible.
  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(args !== 'skip');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // Read the freshest args/query inside load without widening the effect's deps.
  const argsRef = useRef(args);
  const queryRefRef = useRef(queryRef);
  argsRef.current = args;
  queryRefRef.current = queryRef;

  const load = useCallback(
    async (opts?: { isCancelled?: () => boolean }) => {
      const currentArgs = argsRef.current;
      if (currentArgs === 'skip') {
        setData(undefined);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      // Note: do NOT clear existing data here — keep the last snapshot visible while the
      // next one loads so nothing blinks (same feel as Convex's live useQuery).
      try {
        const result = await convex.query(queryRefRef.current, currentArgs as any);
        if (opts?.isCancelled?.()) return;
        setData(result as T);
        setLastUpdatedAt(Date.now());
      } catch (e) {
        if (opts?.isCancelled?.()) return;
        setError((e as Error).message || 'Gagal memuat data');
      } finally {
        if (!opts?.isCancelled?.()) setLoading(false);
      }
    },
    [convex],
  );

  // Fetch on mount and ONLY when the stringified args actually change.
  useEffect(() => {
    let cancelled = false;
    void load({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [argsKey, load]);

  return { data, loading, error, lastUpdatedAt, refresh: load };
}
