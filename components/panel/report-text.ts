// Dependency-free generator for the CS WA report text. Deterministic formatting
// (no Intl locale dependence) so the exact-string test is stable across envs.

export const DAYS_ID = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
export const MONTHS_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

export function groupThousands(n: number): string {
  const neg = n < 0 ? '-' : '';
  const s = Math.abs(Math.round(n)).toString();
  return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export type ReportCsCard = {
  csName: string;
  leads: number; closings: number; cr: number;
  discount: number; cpDiscount: number;
  products: Array<{ product: string; leads: number; closings: number; cr: number }>;
};

export function reportText(card: ReportCsCard, label: { y: number; m: number; d: number; dow: number }): string {
  const lines: string[] = [
    '📝 SUMMARY CR',
    '🟠 ' + card.csName.toUpperCase(),
    '',
    'HARI ' + DAYS_ID[label.dow],
    `${label.d} ${MONTHS_ID[label.m]} ${label.y}`,
    '',
  ];
  for (const p of card.products) {
    lines.push(`🔰 ${p.product.toUpperCase()} : ${Math.round(p.cr)}% (${p.closings}/${p.leads})`);
  }
  lines.push(
    '',
    `  . TOTAL LEADS      : ${card.leads}`,
    `  . TOTAL CLOSING : ${card.closings}`,
    `  . CR : ${Math.round(card.cr)}%`,
    '',
    `  . Diskon : Rp${groupThousands(card.discount)}`,
    `  . CP Diskon : ${groupThousands(card.cpDiscount)}`,
  );
  return lines.join('\n');
}
