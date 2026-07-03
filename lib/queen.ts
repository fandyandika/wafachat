// Pure "Queen CS" scorer — the overall best CS for a period. ABSOLUTE SCORECARD: each metric
// is scored against a FIXED target (0..100), not against teammates. So a decent value earns
// real points (a 56% CR isn't crushed to 0 just for being lowest in the team), the score is
// stable/transparent (a CS knows the target to chase), and CR stays decisive via a tuned band.
// No framework imports -> runs plain in vitest.

export type QueenInput = {
  csName: string;
  closings: number;
  cr: number; // closing-rate percent, 0..100
  leads: number;
  respMedianMs: number | null;
  respCount: number;
};

export const QUEEN_WEIGHTS = { closing: 0.35, cr: 0.5, speed: 0.15 };
export const QUEEN_MIN_LEADS = 10; // eligibility: enough workload to judge "overall best"
export const QUEEN_MIN_RESP = 5; //  enough first-replies for a fair speed score
// Fixed absolute targets (score vs these, NOT vs teammates) — tunable.
export const QUEEN_TARGETS = {
  crFloor: 40, // CR%: <=40 -> 0 pts
  crCeil: 80, //  CR%: >=80 -> 100 pts
  speedCeilMin: 30, // active-hours median minutes: 0 -> 100 pts, >=30 -> 0 pts
  closingsTarget: 40, // closings: >=40 -> 100 pts
};

const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

// Full per-CS scorecard, weighted points per component (0..50 CR / 0..35 closing /
// 0..15 speed). Rows below the leads floor are scored too but flagged ineligible —
// the Arena view uses them to show "how far until you're on the board".
export type QueenScoreRow = {
  csName: string;
  score: number; // 0..100
  eligible: boolean;
  cr: number;
  closings: number;
  respMedianMs: number | null;
  crWpts: number; // weighted CR points, 0..50
  closeWpts: number; // weighted closing points, 0..35
  speedWpts: number; // weighted speed points, 0..15
};

export function computeQueenScores(
  rows: QueenInput[],
  minLeads = QUEEN_MIN_LEADS,
  minRespCount = QUEEN_MIN_RESP,
): QueenScoreRow[] {
  const T = QUEEN_TARGETS;
  const scored = rows.map((r) => {
    const crPts = clamp100(((r.cr - T.crFloor) / (T.crCeil - T.crFloor)) * 100);
    const closePts = clamp100((r.closings / T.closingsTarget) * 100);
    // No/low speed sample -> 0 speed points (can't credit unmeasured responsiveness).
    const hasSpeed = r.respCount >= minRespCount && r.respMedianMs != null;
    const speedMin = hasSpeed ? (r.respMedianMs as number) / 60000 : T.speedCeilMin;
    const speedPts = clamp100(((T.speedCeilMin - speedMin) / T.speedCeilMin) * 100);
    const score = QUEEN_WEIGHTS.closing * closePts + QUEEN_WEIGHTS.cr * crPts + QUEEN_WEIGHTS.speed * speedPts;
    return {
      csName: r.csName,
      score,
      eligible: r.leads >= minLeads,
      cr: r.cr,
      closings: r.closings,
      respMedianMs: r.respMedianMs,
      crWpts: QUEEN_WEIGHTS.cr * crPts,
      closeWpts: QUEEN_WEIGHTS.closing * closePts,
      speedWpts: QUEEN_WEIGHTS.speed * speedPts,
    };
  });
  // Eligible first, then the same decisive ordering computeQueenCs always used.
  scored.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) || b.score - a.score || b.cr - a.cr || b.closings - a.closings,
  );
  return scored;
}

export function computeQueenCs(
  rows: QueenInput[],
  minLeads = QUEEN_MIN_LEADS,
  minRespCount = QUEEN_MIN_RESP,
): { csName: string; score: number } | null {
  const eligible = computeQueenScores(rows, minLeads, minRespCount).filter((r) => r.eligible);
  if (eligible.length < 2) return null;
  return { csName: eligible[0].csName, score: eligible[0].score };
}
