export function formatRupiah(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  return 'Rp' + new Intl.NumberFormat('id-ID').format(value);
}

/** Compact rupiah for tight KPI tiles — "Rp33,4 jt". */
export function formatRupiahShort(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  if (value >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (value >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (value >= 1_000) return `Rp${Math.round(value / 1_000)} rb`;
  return 'Rp' + Math.round(value); // round: count-up interpolation passes floats (e.g. CP Diskon 667.91 -> Rp668)
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

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} jam ${rem} mnt` : `${h} jam`;
}
