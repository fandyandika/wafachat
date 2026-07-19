const DEFAULT_BUCKET_MS = 120_000;

export function bucketResponseTimeRange(
  startAt: number,
  endAt: number,
  bucketMs = DEFAULT_BUCKET_MS,
): { startAt: number; endAt: number } {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
    throw new Error('Invalid response-time range');
  }
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
    throw new Error('Invalid response-time cache bucket');
  }

  return {
    startAt: Math.floor(startAt / bucketMs) * bucketMs,
    endAt: Math.floor(endAt / bucketMs) * bucketMs,
  };
}
