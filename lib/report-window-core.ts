// Canonical 16:00 WIB business window helpers — single source of truth.
// Re-exported by both convex/lib.ts and components/panel/report-window.ts.

/** 16:00 WIB for calendar Y-M-D (m is 0-based) === 09:00 UTC. */
export function fourPmWibMs(y: number, mIdx: number, d: number): number {
  return Date.UTC(y, mIdx, d, 9, 0, 0);
}

/** Label date ("YYYY-MM-DD") of the 16:00-WIB window containing `ms` (date the window OPENS). */
export function windowKeyFor(ms: number): string {
  const shifted = new Date(ms - 9 * 3_600_000); // 16:00 WIB becomes UTC midnight
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function windowRangeForKey(key: string): { startAt: number; endAt: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { startAt: fourPmWibMs(y, m - 1, d), endAt: fourPmWibMs(y, m - 1, d + 1) };
}

export function windowKeyToday(now = Date.now()): string {
  return windowKeyFor(now);
}

/** True only when both bounds are exact 16:00-WIB business-window edges. */
export function isWindowAlignedRange(startAt: number, endAt: number): boolean {
  if (endAt <= startAt) return false;
  return windowRangeForKey(windowKeyFor(startAt)).startAt === startAt
    && windowRangeForKey(windowKeyFor(endAt)).startAt === endAt;
}
