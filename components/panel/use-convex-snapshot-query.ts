'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConvex } from 'convex/react';

type SnapshotArgs = Record<string, unknown> | 'skip';

export function useConvexSnapshotQuery<T>(queryRef: any, args: SnapshotArgs) {
  const convex = useConvex();
  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(args !== 'skip');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const load = useCallback(
    async (options?: { clear?: boolean; isCancelled?: () => boolean }) => {
      const currentArgs = args;
      if (currentArgs === 'skip') {
        setData(undefined);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      if (options?.clear) setData(undefined);

      try {
        const result = await convex.query(queryRef, currentArgs as any);
        if (options?.isCancelled?.()) return;
        setData(result as T);
        setLastUpdatedAt(Date.now());
      } catch (e) {
        if (options?.isCancelled?.()) return;
        setError((e as Error).message || 'Gagal memuat data');
      } finally {
        if (!options?.isCancelled?.()) setLoading(false);
      }
    },
    [args, argsKey, convex, queryRef],
  );

  useEffect(() => {
    let cancelled = false;
    void load({ clear: true, isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(() => load({ clear: false }), [load]);

  return { data, loading, error, lastUpdatedAt, refresh };
}
