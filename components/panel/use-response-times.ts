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

export type ResponseTimesState = {
  data: ResponseTimesResult | undefined;
  loading: boolean;
  error: string | null;
};

export function useResponseTimesState(args: { startAt: number; endAt: number; csName?: string; refreshKey?: number }): ResponseTimesState {
  const { startAt, endAt, csName, refreshKey = 0 } = args;
  const [data, setData] = useState<ResponseTimesResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/panel/response-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startAt, endAt, csName }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error || 'Gagal memuat waktu respons');
        return body;
      })
      .then((body) => {
        if (!cancelled) setData(body.data as ResponseTimesResult);
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message || 'Gagal memuat waktu respons');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startAt, endAt, csName, refreshKey]);

  return { data, loading, error };
}

export function useResponseTimes(args: { startAt: number; endAt: number; csName?: string; refreshKey?: number }): ResponseTimesResult | undefined {
  return useResponseTimesState(args).data;
}
