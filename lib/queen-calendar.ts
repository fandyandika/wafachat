export type QueenExclusion = {
  code: "sunday" | "national_holiday";
  label: string;
};

// Official Indonesian national holidays for 2026. Collective leave is intentionally
// not included: private-business operating days remain an owner policy.
const NATIONAL_HOLIDAYS: Readonly<Record<string, string>> = {
  "2026-01-01": "Tahun Baru Masehi",
  "2026-01-16": "Isra Mikraj Nabi Muhammad SAW",
  "2026-02-17": "Tahun Baru Imlek",
  "2026-03-19": "Hari Suci Nyepi",
  "2026-03-21": "Idulfitri",
  "2026-03-22": "Idulfitri",
  "2026-04-03": "Wafat Yesus Kristus",
  "2026-04-05": "Paskah",
  "2026-05-01": "Hari Buruh Internasional",
  "2026-05-14": "Kenaikan Yesus Kristus",
  "2026-05-27": "Iduladha",
  "2026-05-31": "Waisak",
  "2026-06-01": "Hari Lahir Pancasila",
  "2026-06-16": "Tahun Baru Islam",
  "2026-08-17": "Hari Kemerdekaan RI",
  "2026-08-25": "Maulid Nabi Muhammad SAW",
  "2026-12-25": "Hari Natal",
};

export function queenExclusionForDate(businessDate: string): QueenExclusion | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCDay() === 0) return { code: "sunday", label: "Ahad" };
  const holiday = NATIONAL_HOLIDAYS[businessDate];
  return holiday ? { code: "national_holiday", label: holiday } : null;
}
