// Closing-rate health thresholds (single source of truth):
//   >= 60%  → hijau (sehat)
//   50–59%  → oranye (waspada)
//   < 50%   → merah (perlu perhatian)

export function crBarClass(cr: number): string {
  if (cr >= 60) return 'bg-positive';
  if (cr >= 50) return 'bg-amber-500';
  return 'bg-negative';
}

export function crTextClass(cr: number): string {
  if (cr >= 60) return 'text-positive';
  if (cr >= 50) return 'text-amber-600';
  return 'text-negative';
}
