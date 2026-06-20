'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

export type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export function resolveRange(range: DateRangeKey, customDate?: string): { startAt: number; endAt: number } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === 'custom' && customDate) {
    const d = new Date(customDate + 'T12:00:00');
    start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    start.setHours(0, 0, 0, 0);
    end.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    end.setHours(23, 59, 59, 999);
  } else if (range === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (range === '30d') {
    start.setDate(start.getDate() - 29);
  } else if (range === 'month') {
    start.setDate(1);
  }
  return { startAt: start.getTime(), endAt: end.getTime() };
}

const VALID_RANGES: DateRangeKey[] = ['today', 'yesterday', '7d', '30d', 'month', 'custom'];

export function usePanelFilters() {
  const sp = useSearchParams();
  const rawRange = sp.get('range');
  const range: DateRangeKey = VALID_RANGES.includes(rawRange as DateRangeKey) ? (rawRange as DateRangeKey) : 'today';
  const cs = sp.get('cs') || 'all';
  const customDate = sp.get('date') || '';
  const { startAt, endAt } = useMemo(() => resolveRange(range, customDate), [range, customDate]);
  const jakartaDate = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(endAt)),
    [endAt],
  );
  return { range, cs, csName: cs === 'all' ? undefined : cs, customDate, startAt, endAt, jakartaDate };
}
