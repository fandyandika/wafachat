import { expect, test } from 'vitest';
import { formatFollowUpDue } from './follow-up-status';

test('future follow-up is scheduled', () => {
  const dueAt = Date.UTC(2026, 7, 12, 5);
  expect(formatFollowUpDue(dueAt, dueAt - 1).tone).toBe('scheduled');
});

test('a newly overdue follow-up is late today', () => {
  const dueAt = Date.UTC(2026, 7, 12, 5);
  expect(formatFollowUpDue(dueAt, dueAt + 60_000).label).toBe('Terlambat hari ini');
});

test('overdue days are explicit', () => {
  const dueAt = Date.UTC(2026, 7, 12, 5);
  expect(formatFollowUpDue(dueAt, dueAt + 2 * 86_400_000).label).toBe('Terlambat 2 hari');
});

test('overdue labels follow Asia/Jakarta calendar days instead of elapsed 24-hour windows', () => {
  const dueAt = Date.UTC(2026, 7, 11, 16, 59); // 23:59 Jakarta
  const now = Date.UTC(2026, 7, 11, 17, 1); // 00:01 Jakarta next day
  expect(formatFollowUpDue(dueAt, now)).toEqual({ label: 'Terlambat 1 hari', tone: 'overdue' });
});

test('scheduled labels use Jakarta calendar time explicitly', () => {
  const dueAt = Date.UTC(2026, 7, 11, 18, 0); // 12 Aug, 01:00 Jakarta
  expect(formatFollowUpDue(dueAt, dueAt - 60_000).label).toContain('12 Agu');
});
