import { expect, test } from 'vitest';
import {
  fourPmWibMs, reportWindowForLabelDate, wibDateParts, currentReportLabelDate, clampStartToCutoff, DATA_CUTOFF_MS,
} from './report-window';

test('fourPmWibMs: 16:00 WIB == 09:00 UTC', () => {
  expect(fourPmWibMs(2026, 5, 22)).toBe(Date.UTC(2026, 5, 22, 9, 0, 0));
});

test('reportWindowForLabelDate: close-date window [4pm D-1, 4pm D)', () => {
  const w = reportWindowForLabelDate(2026, 5, 22); // 22 Jun
  expect(w.startAt).toBe(Date.UTC(2026, 5, 21, 9, 0, 0)); // 4pm 21 Jun
  expect(w.endAt).toBe(Date.UTC(2026, 5, 22, 9, 0, 0));   // 4pm 22 Jun
});

test('reportWindowForLabelDate: rolls over month start', () => {
  const w = reportWindowForLabelDate(2026, 6, 1); // 1 Jul -> start 30 Jun
  expect(w.startAt).toBe(Date.UTC(2026, 5, 30, 9, 0, 0));
  expect(w.endAt).toBe(Date.UTC(2026, 6, 1, 9, 0, 0));
});

test('wibDateParts: returns WIB calendar parts + dow', () => {
  // 4pm 22 Jun 2026 WIB; 22 Jun 2026 is a Monday (dow=1)
  const p = wibDateParts(Date.UTC(2026, 5, 22, 9, 0, 0));
  expect(p).toEqual({ y: 2026, m: 5, d: 22, dow: 1 });
});

test('currentReportLabelDate: before 16:00 WIB -> today', () => {
  // 22 Jun 10:00 WIB = 22 Jun 03:00 UTC
  expect(currentReportLabelDate(Date.UTC(2026, 5, 22, 3, 0, 0))).toEqual({ y: 2026, m: 5, d: 22 });
});

test('currentReportLabelDate: at/after 16:00 WIB -> tomorrow', () => {
  // 22 Jun 18:00 WIB = 22 Jun 11:00 UTC
  expect(currentReportLabelDate(Date.UTC(2026, 5, 22, 11, 0, 0))).toEqual({ y: 2026, m: 5, d: 23 });
});

test('clampStartToCutoff: clamps starts before the data cutoff', () => {
  const before = DATA_CUTOFF_MS - 1000;
  expect(clampStartToCutoff(before)).toEqual({ startAt: DATA_CUTOFF_MS, clamped: true });
  const after = DATA_CUTOFF_MS + 1000;
  expect(clampStartToCutoff(after)).toEqual({ startAt: after, clamped: false });
});
