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
