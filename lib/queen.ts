// Pure "Queen CS" scorer — the overall best CS for a period. PLACING SCORE: each metric is
// scored by RANK (0..100, 1st in field = 100, last = 0), not raw magnitude — so an outlier
// (e.g. one ultra-fast CS) can't distort, and a consistent all-rounder competes fairly.
// Weighted: CR (skill, volume-independent) heaviest, closing count (output) next, response
// speed (behaviour, already partly reflected in CR) lightest. No framework imports -> vitest.

export type QueenInput = {
  csName: string;
  closings: number;
  cr: number;
  leads: number;
  respMedianMs: number | null;
  respCount: number;
};

export const QUEEN_WEIGHTS = { closing: 0.35, cr: 0.5, speed: 0.15 };
export const QUEEN_MIN_LEADS = 10; // eligibility: enough workload to judge "overall best"
export const QUEEN_MIN_RESP = 5; //  enough first-replies for a fair speed placing

// Placing 0..100 for one metric across the field: best = 100, worst = 0, ties share the average.
function placings(items: { csName: string; value: number }[], higherIsBetter: boolean): Map<string, number> {
  const N = items.length;
  const sorted = [...items].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  const rankByCs = new Map<string, number>(); // 1-based average rank
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // average of the tied 1-based ranks
    for (let k = i; k <= j; k++) rankByCs.set(sorted[k].csName, avgRank);
    i = j + 1;
  }
  const out = new Map<string, number>();
  for (const it of items) {
    const r = rankByCs.get(it.csName)!;
    out.set(it.csName, N > 1 ? (100 * (N - r)) / (N - 1) : 100);
  }
  return out;
}

export function computeQueenCs(
  rows: QueenInput[],
  minLeads = QUEEN_MIN_LEADS,
  minRespCount = QUEEN_MIN_RESP,
): { csName: string; score: number } | null {
  const qualified = rows.filter((r) => r.leads >= minLeads);
  if (qualified.length < 2) return null;

  const closeP = placings(qualified.map((r) => ({ csName: r.csName, value: r.closings })), true);
  const crP = placings(qualified.map((r) => ({ csName: r.csName, value: r.cr })), true);
  // No/low speed data -> treated as slowest (worst placing). At >=10 leads this rarely binds.
  const speedP = placings(
    qualified.map((r) => ({
      csName: r.csName,
      value: r.respCount >= minRespCount && r.respMedianMs != null ? r.respMedianMs : Number.MAX_SAFE_INTEGER,
    })),
    false,
  );

  const scored = qualified.map((r) => ({
    csName: r.csName,
    closings: r.closings,
    cr: r.cr,
    score:
      QUEEN_WEIGHTS.closing * closeP.get(r.csName)! +
      QUEEN_WEIGHTS.cr * crP.get(r.csName)! +
      QUEEN_WEIGHTS.speed * speedP.get(r.csName)!,
  }));

  scored.sort((a, b) => b.score - a.score || b.cr - a.cr || b.closings - a.closings);
  return { csName: scored[0].csName, score: scored[0].score };
}
