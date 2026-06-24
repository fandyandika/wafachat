// Pure "Queen CS" scorer — the overall best CS for a period, combining closings,
// closing-rate, and response speed. Weighted, normalized relative to the best
// qualified CS. No framework imports so it runs plain in vitest.

export type QueenInput = {
  csName: string;
  closings: number;
  cr: number;
  leads: number;
  respMedianMs: number | null;
  respCount: number;
};

export const QUEEN_WEIGHTS = { closing: 0.4, cr: 0.4, speed: 0.2 };

export function computeQueenCs(
  rows: QueenInput[],
  minLeads = 3,
  minRespCount = 3,
): { csName: string; score: number } | null {
  const qualified = rows.filter((r) => r.leads >= minLeads);
  if (qualified.length < 2) return null;

  const maxClosings = Math.max(...qualified.map((r) => r.closings));
  const maxCr = Math.max(...qualified.map((r) => r.cr));
  const speedEligible = qualified.filter((r) => r.respCount >= minRespCount && r.respMedianMs != null);
  const minMedian = speedEligible.length ? Math.min(...speedEligible.map((r) => r.respMedianMs as number)) : null;

  const scored = qualified.map((r) => {
    const closeScore = maxClosings > 0 ? r.closings / maxClosings : 0;
    const crScore = maxCr > 0 ? r.cr / maxCr : 0;
    const speedScore =
      minMedian != null && r.respCount >= minRespCount && r.respMedianMs != null ? minMedian / r.respMedianMs : 0;
    const score =
      QUEEN_WEIGHTS.closing * closeScore + QUEEN_WEIGHTS.cr * crScore + QUEEN_WEIGHTS.speed * speedScore;
    return { csName: r.csName, closings: r.closings, cr: r.cr, score };
  });

  scored.sort((a, b) => b.score - a.score || b.closings - a.closings || b.cr - a.cr);
  return { csName: scored[0].csName, score: scored[0].score };
}
