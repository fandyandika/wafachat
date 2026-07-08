'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { DATA_CUTOFF_MS } from './report-window';
import { windowKeyToday, windowRangeForKey, windowKeyFor } from '@/lib/report-window-core';

export type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export function resolveRange(range: DateRangeKey, customDate?: string): { startAt: number; endAt: number } {
  const now = Date.now();
  const todayKey = windowKeyToday(now);
  const todayRange = windowRangeForKey(todayKey);

  if (range === 'today') {
    return todayRange;
  } else if (range === 'yesterday') {
    // Yesterday's window (one day prior)
    const yesterday = todayRange.startAt - 86_400_000;
    const yesterdayKey = windowKeyFor(yesterday);
    return windowRangeForKey(yesterdayKey);
  } else if (range === '7d') {
    // 7 days = 7 windows ending at today's window end
    const sevenDaysAgoStart = todayRange.startAt - 6 * 86_400_000;
    const sevenDaysAgoKey = windowKeyFor(sevenDaysAgoStart);
    const sevenDaysAgoRange = windowRangeForKey(sevenDaysAgoKey);
    return { startAt: sevenDaysAgoRange.startAt, endAt: todayRange.endAt };
  } else if (range === '30d') {
    // 30 days = 30 windows ending at today's window end
    const thirtyDaysAgoStart = todayRange.startAt - 29 * 86_400_000;
    const thirtyDaysAgoKey = windowKeyFor(thirtyDaysAgoStart);
    const thirtyDaysAgoRange = windowRangeForKey(thirtyDaysAgoKey);
    return { startAt: thirtyDaysAgoRange.startAt, endAt: todayRange.endAt };
  } else if (range === 'month') {
    // Current calendar month (snap to whole windows)
    const today = new Date(now);
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    // First day of month at midnight UTC (offset for Jakarta)
    const firstDayMs = firstDayOfMonth.getTime() + 7 * 60 * 60 * 1000; // Add Jakarta offset
    const firstDayKey = windowKeyFor(firstDayMs);
    const firstDayRange = windowRangeForKey(firstDayKey);
    return { startAt: firstDayRange.startAt, endAt: todayRange.endAt };
  } else if (range === 'custom' && customDate) {
    // Snap custom date to its window
    const customMs = new Date(customDate + 'T12:00:00').getTime();
    const customKey = windowKeyFor(customMs);
    return windowRangeForKey(customKey);
  }

  // Fallback to today
  return todayRange;
}

const VALID_RANGES: DateRangeKey[] = ['today', 'yesterday', '7d', '30d', 'month', 'custom'];

export function usePanelFilters() {
  const sp = useSearchParams();
  const rawRange = sp.get('range');
  // Default "hari ini" — the cheapest window (reads ~today's recaps/orders vs a full week) and
  // what you glance at most. Trend charts anchor their own 7-day window so they stay useful.
  const range: DateRangeKey = VALID_RANGES.includes(rawRange as DateRangeKey) ? (rawRange as DateRangeKey) : 'today';
  const cs = sp.get('cs') || 'all';
  const customDate = sp.get('date') || '';
  const { startAt: rawStartAt, endAt } = useMemo(() => resolveRange(range, customDate), [range, customDate]);
  const startAt = Math.max(rawStartAt, DATA_CUTOFF_MS);
  const jakartaDate = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(endAt)),
    [endAt],
  );
  return { range, cs, csName: cs === 'all' ? undefined : cs, customDate, startAt, endAt, jakartaDate };
}
