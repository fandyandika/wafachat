export function formatRupiah(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  return 'Rp' + new Intl.NumberFormat('id-ID').format(value);
}

export function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pct(n: number): string {
  return `${n}%`;
}

export function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(ms));
}
