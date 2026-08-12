import type { FollowUpDueTone } from './follow-up-types';

const DAY = 86_400_000;

export function formatFollowUpDue(dueAt: number, now = Date.now()): { label: string; tone: FollowUpDueTone } {
  if (now < dueAt) {
    return {
      label: `Terjadwal ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }).format(dueAt)}`,
      tone: 'scheduled',
    };
  }
  const overdueDays = Math.floor((now - dueAt) / DAY);
  if (overdueDays < 1) return { label: 'Terlambat hari ini', tone: 'due-today' };
  return { label: `Terlambat ${overdueDays} hari`, tone: 'overdue' };
}

export function formatFollowUpTime(at?: number): string {
  if (at === undefined) return 'Waktu belum tersedia';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  }).format(at);
}

export const FOLLOW_UP_DUE_CLASS: Record<FollowUpDueTone, string> = {
  scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  'due-today': 'border-amber-200 bg-amber-50 text-amber-900',
  overdue: 'border-destructive/30 bg-destructive/10 text-destructive',
};
