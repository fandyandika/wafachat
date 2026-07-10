// Pure "Queen CS" scorer — the overall best CS for a period.
// HYBRID SCORECARD (2026-07-03, supersedes the all-absolute 06-25 version):
//   - CR (50): ABSOLUTE band 40%..80% — a rate, comparable across days, fully in the
//     CS's control. A decent value earns real points (56% CR isn't crushed to 0).
//   - Closing (35): RELATIVE to the day's best eligible CS — a fixed target (was 40)
//     saturated once daily volume grew (everyone maxed 35/35, so closing stopped
//     differentiating and the race collapsed to CR-only). Proportional-to-best is
//     self-tuning at any volume, always rewards the top closer fully, and never
//     zeroes anyone.
//   - Speed (15): PERFECT-THEN-PENALTY, not a race. Owner's rule (revised 2026-07-09):
//     "di bawah 10 menit masih full poin, di atas itu baru mulai punish — biar nggak jadi
//     lomba respon, bikin burnout." So any median at/under 10 min (the team's SOP) earns
//     FULL points, then a linear penalty runs from the 10-min line down to 0 at 15 min
//     (zero-line kept at 15 — same floor as before, just a narrower/steeper penalty band
//     now that the perfect zone widened from 5 to 10). Answering in 1 min vs 9 min no
//     longer decides the crown (both perfect); speed only bites once someone is actually
//     over SOP. This lets CR (the allocation-neutral efficiency metric) be the real
//     differentiator when the team is uniformly within SOP.
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
export const QUEEN_MIN_LEADS = 6; // eligibility: enough workload to judge "overall best".
// Lowered 10->6 (2026-07-08): a genuine low-traffic performer (few new leads but strong CR,
// e.g. closing follow-ups) was benched at 9 leads. 6 keeps a real micro-sample (2-3 leads)
// out — those can't win on an inflated CR — while letting a lightly-loaded CS compete on CR.
export const QUEEN_MIN_RESP = 5; //  enough first-replies for a fair speed score
// Fixed bands for the absolute components (CR + speed) — tunable. Closing has no
// fixed target: it is scored relative to the day's best (see computeQueenScores).
export const QUEEN_TARGETS = {
  crFloor: 40, // CR%: <=40 -> 0 pts
  crCeil: 80, //  CR%: >=80 -> 100 pts
  speedPerfectMin: 10, // active-hours median: <=10 min (SOP) -> full 100 pts
  speedZeroMin: 15, // >=15 min -> 0 pts; linear penalty runs from the 10-min SOP line to 0 here
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
  // Closing benchmark = the day's best among ELIGIBLE CS (an ineligible outlier with
  // 5 leads must not deflate everyone else's closing points). Fallback to all rows
  // when nobody qualifies yet (early in the window) so the bars still mean something.
  const benchPool = rows.some((r) => r.leads >= minLeads) ? rows.filter((r) => r.leads >= minLeads) : rows;
  const closeBench = benchPool.reduce((m, r) => Math.max(m, r.closings), 0);
  const scored = rows.map((r) => {
    const crPts = clamp100(((r.cr - T.crFloor) / (T.crCeil - T.crFloor)) * 100);
    const closePts = closeBench > 0 ? clamp100((r.closings / closeBench) * 100) : 0;
    // Perfect at/under 10 min (SOP), then a linear penalty grows toward 0 at 15 min.
    // No/low speed sample -> 0 points (can't credit unmeasured responsiveness).
    const hasSpeed = r.respCount >= minRespCount && r.respMedianMs != null;
    const speedMin = hasSpeed ? (r.respMedianMs as number) / 60000 : Infinity;
    const speedPts = speedMin <= T.speedPerfectMin
      ? 100
      : clamp100(((T.speedZeroMin - speedMin) / (T.speedZeroMin - T.speedPerfectMin)) * 100);
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
