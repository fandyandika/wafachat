'use client';

import { useEffect, useState } from 'react';

export type ResponseTimesResult = {
  windowStart: number;
  windowEnd: number;
  overall: { firstReplyMedianMs: number | null; firstReplyCount: number; slaBreaches: number };
  cs: Array<{
    csName: string;
    csNameRaw: string;
    firstReplyMedianMs: number | null;
    firstReplyP90Ms: number | null;
    firstReplyCount: number;
    ongoingMedianMs: number | null;
    ongoingCount: number;
    slaBreaches: number;
    lastReplyAt: number | null;
  }>;
};

// Drop-in replacement for useQuery(api.responseTime.getResponseTimes, ...): fetches
// on-demand (on mount + when the window/CS changes) instead of holding a live
// subscription. getResponseTimes scans the messages table, so a live subscription
// re-read the whole window on every new message — fetching once is far cheaper.
// Returns undefined while loading (same contract as useQuery).
export function useResponseTimes(args: { startAt: number; endAt: number; csName?: string; refreshKey?: number }): ResponseTimesResult | undefined {
  const { startAt, endAt, csName, refreshKey = 0 } = args;
  const [data, setData] = useState<ResponseTimesResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setData(undefined); // show loading while the new window fetches
    fetch('/api/panel/response-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startAt, endAt, csName }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.ok) setData(j.data as ResponseTimesResult);
      })
      .catch(() => {
        /* keep undefined → callers show the '–' fallback, no crash */
      });
    return () => {
      cancelled = true;
    };
  }, [startAt, endAt, csName, refreshKey]);

  return data;
}
