export const ANALYTICS_DAY_MS = 86_400_000;
export const MAX_PUBLIC_ANALYTICS_RANGE_MS = 35 * ANALYTICS_DAY_MS;
export const MAX_EXACT_ROWS_PER_SOURCE = 900;
export const MAX_EXACT_FALLBACK_LOOKUPS = 100;
export const MAX_RESPONSE_SAMPLES = 3_000;

export function assertPublicAnalyticsRange(
  startAt: number,
  endAt: number,
  label: string,
  maxRangeMs = MAX_PUBLIC_ANALYTICS_RANGE_MS,
): void {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
    throw new Error(`${label}: invalid half-open range`);
  }
  if (endAt - startAt > maxRangeMs) {
    throw new Error(`${label}: range exceeds ${Math.floor(maxRangeMs / ANALYTICS_DAY_MS)} days`);
  }
}

export async function collectExactBounded<T = any>(
  query: { take: (count: number) => Promise<T[]> },
  label: string,
  limit = MAX_EXACT_ROWS_PER_SOURCE,
): Promise<T[]> {
  const rows = await query.take(limit + 1);
  if (rows.length > limit) {
    throw new Error(`${label}: exact row cap ${limit} exceeded; narrow the requested range`);
  }
  return rows;
}

export function assertFallbackLookupBudget(count: number, label: string): void {
  if (count > MAX_EXACT_FALLBACK_LOOKUPS) {
    throw new Error(`${label}: fallback lookup cap ${MAX_EXACT_FALLBACK_LOOKUPS} exceeded; narrow the requested range`);
  }
}
