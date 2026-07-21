import { expect, test } from 'vitest';
import { bucketResponseTimeRange } from './response-time-cache';

test('bucketResponseTimeRange: normalizes a range to two-minute cache boundaries', () => {
  expect(bucketResponseTimeRange(1_000, 241_999)).toEqual({ startAt: 0, endAt: 240_000 });
  expect(bucketResponseTimeRange(0, 120_000)).toEqual({ startAt: 0, endAt: 120_000 });
});

test('bucketResponseTimeRange: rejects an inverted range', () => {
  expect(() => bucketResponseTimeRange(200_000, 100_000)).toThrow();
});

test('bucketResponseTimeRange: validates timestamps and custom bucket sizes', () => {
  expect(() => bucketResponseTimeRange(Number.NaN, 120_000)).toThrow();
  expect(() => bucketResponseTimeRange(0, Number.POSITIVE_INFINITY)).toThrow();
  expect(() => bucketResponseTimeRange(0, 120_000, 0)).toThrow();
  expect(() => bucketResponseTimeRange(0, 120_000, Number.POSITIVE_INFINITY)).toThrow();
  expect(bucketResponseTimeRange(1_999, 2_001, 1_000)).toEqual({ startAt: 1_000, endAt: 2_000 });
});
