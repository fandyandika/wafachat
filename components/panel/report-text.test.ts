import { expect, test } from 'vitest';
import { groupThousands, reportText, crLabel } from './report-text';

test('groupThousands: dot separators', () => {
  expect(groupThousands(40000)).toBe('40.000');
  expect(groupThousands(1000)).toBe('1.000');
  expect(groupThousands(0)).toBe('0');
  expect(groupThousands(1234567)).toBe('1.234.567');
});

test('reportText: exact WA format', () => {
  const card = {
    csName: 'CS Azella',
    leads: 60, closings: 40, cr: 66.7,
    discount: 40000, cpDiscount: 1000,
    products: [
      { product: 'Quran Mapping', leads: 43, closings: 31, cr: 72.1 },
      { product: 'Al-Quran Tazyin', leads: 7, closings: 4, cr: 57.1 },
    ],
  };
  // 22 Jun 2026 is a Monday (dow=1), month index 5 = JUNI
  const out = reportText(card, { y: 2026, m: 5, d: 22, dow: 1 });
  expect(out).toBe(
`📝 SUMMARY CR
🟠 CS AZELLA

HARI SENIN
22 JUNI 2026

🔰 QURAN MAPPING : 72% (31/43)
🔰 AL-QURAN TAZYIN : 57% (4/7)

  . TOTAL LEADS      : 60
  . TOTAL CLOSING : 40
  . CR : 67%

  . Diskon : Rp40.000
  . CP Diskon : 1.000`
  );
});

test('crLabel: dash when leads 0, percent otherwise', () => {
  expect(crLabel(0, 0)).toBe('–');
  expect(crLabel(72.1, 43)).toBe('72%');
  expect(crLabel(122.2, 9)).toBe('122%');
});

test('reportText: leads=0 product shows "–" CR (not misleading 0%)', () => {
  const card = {
    csName: 'CS A', leads: 0, closings: 1, cr: 0, discount: 0, cpDiscount: 0,
    products: [{ product: 'Buku Tulis', leads: 0, closings: 1, cr: 0 }],
  };
  const out = reportText(card, { y: 2026, m: 5, d: 22, dow: 1 });
  expect(out).toContain('🔰 BUKU TULIS : – (1/0)');
  expect(out).toContain('  . CR : –');
});
