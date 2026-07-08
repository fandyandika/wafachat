// Dependency-free 4pm-WIB ("4 sore") daily-report window math. No react/next imports
// so it runs clean in the edge-runtime vitest env. Source of truth for DATA_CUTOFF_MS.
// Window helpers (fourPmWibMs, windowKeyFor, windowRangeForKey, windowKeyToday)
// are re-exported from lib/report-window-core.ts (single source of truth; Task 10).

import { fourPmWibMs } from "@/lib/report-window-core";

export const JAK_MS = 7 * 60 * 60 * 1000;

// Closing/leads pipeline only fully wired from 2026-06-22 (Asia/Jakarta); earlier data
// is incomplete, so every window's start is clamped to this cutoff.
export const DATA_CUTOFF_MS = Date.parse('2026-06-22T00:00:00+07:00');

// Re-export from single source of truth (lib/report-window-core.ts)
export { fourPmWibMs, windowKeyFor, windowRangeForKey, windowKeyToday } from "@/lib/report-window-core";

/** Open-date convention: report labelled D covers [4pm D, 4pm (D+1)) — the period that OPENS at 4pm on D. */
export function reportWindowForLabelDate(y: number, m: number, d: number): { startAt: number; endAt: number } {
  return { startAt: fourPmWibMs(y, m, d), endAt: fourPmWibMs(y, m, d + 1) };
}

/** WIB calendar parts (0-based month) + day-of-week (0=Sun) for a timestamp. */
export function wibDateParts(ms: number): { y: number; m: number; d: number; dow: number } {
  const w = new Date(ms + JAK_MS);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), dow: w.getUTCDay() };
}

/** Label date of the OPEN window containing `now`: today if at/after 16:00 WIB, else yesterday (period opened at the prior 4pm). */
export function currentReportLabelDate(now: number): { y: number; m: number; d: number } {
  const w = new Date(now + JAK_MS);
  const base = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate());
  const labelMs = w.getUTCHours() >= 16 ? base : base - 86_400_000;
  const L = new Date(labelMs);
  return { y: L.getUTCFullYear(), m: L.getUTCMonth(), d: L.getUTCDate() };
}

export function clampStartToCutoff(startAt: number): { startAt: number; clamped: boolean } {
  const clamped = startAt < DATA_CUTOFF_MS;
  return { startAt: clamped ? DATA_CUTOFF_MS : startAt, clamped };
}
