'use client';

import { useEffect, useState } from 'react';
import { Crown, Medal, PartyPopper, Rocket, ShieldAlert, Swords, Target, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { QUEEN_MIN_LEADS, type QueenScoreRow } from '@/lib/queen';

// "Arena Takhta" — gamified hero for the CS-scoped Laporan view. The race is the
// REAL Queen scorecard (CR 50% + closing 35% + speed 15%), not raw closing count,
// so the ladder always reflects what actually wins the crown. Pure presentation
// over data the dashboard already fetched; the countdown is a client ticker only.
//
// Live states (before the 16:00 WIB lock):
//   - score #1        -> 👑 PEMEGANG TAKHTA (gold): margin vs runner-up, urgency when tight
//   - gap <= SENGGOL  -> ⚔️ TINGGAL SENGGOL: points needed to overtake + scoreboard
//   - gap besar       -> 🏹 PEMBURU TAKHTA: gap + "attack your biggest lever" focus
//   - not on board    -> 🚀 GERBANG ARENA: leads needed to qualify
// Final states: 👑 RATU HARI INI + confetti for the Queen; rank + medals + comeback
// copy for everyone else.

const SENGGOL_GAP_PTS = 10;

function stripCs(name: string): string {
  return name.replace(/^CS\s+/i, '');
}

function fmtPts(x: number): string {
  return String(Math.round(x * 10) / 10).replace(/\.0$/, '');
}

function useCountdown(endAt: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [enabled]);
  return Math.max(0, endAt - now);
}

function fmtRemain(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}j ${m}m` : `${m} menit`;
}

function Confetti() {
  // CSS-only celebration burst; hidden for prefers-reduced-motion (globals.css).
  const COLORS = ['bg-gold', 'bg-primary', 'bg-positive', 'bg-lead', 'bg-amber-400', 'bg-rose-400'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      {Array.from({ length: 16 }, (_, i) => (
        <span
          key={i}
          className={cn('confetti-piece absolute top-0 block size-1.5 rounded-[2px]', COLORS[i % COLORS.length])}
          style={{ left: `${(i * 61) % 100}%`, animationDelay: `${(i % 8) * 0.18}s`, animationDuration: `${2.2 + (i % 5) * 0.35}s` }}
        />
      ))}
    </div>
  );
}

function MedalChips({ medals }: { medals: string[] }) {
  if (medals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {medals.map((m) => (
        <span key={m} className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
          <Medal className="size-3" /> {m}
        </span>
      ))}
    </div>
  );
}

function RankPill({ rank, total }: { rank: number; total: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border">
      🏆 #{rank} Leaderboard · {total} CS
    </span>
  );
}

// Mini scorecard: the three Queen components as weighted-point bars, with the
// biggest remaining headroom flagged — "this is where the points are".
function ScoreBars({ row, showHint }: { row: QueenScoreRow; showHint: boolean }) {
  const items = [
    { key: 'cr', label: `CR ${fmtPts(row.cr)}%`, pts: row.crWpts, max: 50 },
    { key: 'close', label: `${row.closings} closing`, pts: row.closeWpts, max: 35 },
    {
      key: 'speed',
      label: row.respMedianMs != null ? `Respon ${Math.max(1, Math.round(row.respMedianMs / 60000))}m` : 'Respon –',
      pts: row.speedWpts,
      max: 15,
    },
  ];
  const biggest = items.reduce((best, it) => ((it.max - it.pts) > (best.max - best.pts) ? it : best), items[0]);
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-[11px] tabular-nums text-muted-foreground">{it.label}</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-700', showHint && it.key === biggest.key ? 'bg-amber-400' : 'bg-primary')}
              style={{ width: `${Math.round((it.pts / it.max) * 100)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
            {fmtPts(it.pts)}/{it.max}
          </span>
          {showHint && it.key === biggest.key && (
            <span className="shrink-0 text-[10px] font-bold uppercase text-amber-600">← poin</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ArenaHero({
  scores,
  ownName,
  ownLeads,
  medals,
  deltaClosings,
  isCurrent,
  endAt,
  titleDate,
  avatarUrl,
  queenName,
}: {
  scores: QueenScoreRow[]; // sorted output of computeQueenScores (eligible first)
  ownName: string | null; // raw csName matching a scores row; null = no activity yet
  ownLeads: number;
  medals: string[];
  deltaClosings: number | null; // own closings vs yesterday (full day)
  isCurrent: boolean;
  endAt: number;
  titleDate: string;
  avatarUrl?: string;
  queenName?: string; // final crown holder (undefined when the board didn't form)
}) {
  const remainMs = useCountdown(endAt, isCurrent);
  const live = isCurrent && remainMs > 0;

  const eligible = scores.filter((s) => s.eligible);
  const own = ownName ? scores.find((s) => s.csName === ownName) ?? null : null;
  const rank = own && own.eligible ? eligible.findIndex((s) => s.csName === own.csName) + 1 : 0;

  const countdown = live ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground">
      <Timer className="size-3.5" /> {fmtRemain(remainMs)} lagi · papan dikunci 16:00 WIB
    </span>
  ) : null;

  const paceLine = deltaClosings != null && deltaClosings > 0 ? (
    <div className="text-xs font-medium text-positive">📈 +{deltaClosings} closing dibanding kemarin — ritme naik!</div>
  ) : null;

  // ---- Live · not on the scoreboard yet ------------------------------------
  if (live && (!own || !own.eligible)) {
    const needLeads = Math.max(0, QUEEN_MIN_LEADS - ownLeads);
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Rocket className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">Gerbang Arena</div>
            <div className="text-sm font-bold text-foreground">
              {own ? `${needLeads} leads lagi buat masuk papan skor Takhta 🚀` : 'Leads pertama membuka papan skor Takhta 🚀'}
            </div>
            <div className="text-xs text-muted-foreground">Skor = CR (50) + closing (35) + kecepatan respon (15).</div>
          </div>
        </div>
        {countdown && <div className="mt-2">{countdown}</div>}
      </div>
    );
  }
  if (!own) return null;

  // ---- Live · throne holder --------------------------------------------------
  if (live && rank === 1) {
    const runner = eligible[1] ?? null;
    const margin = runner ? own.score - runner.score : own.score;
    const tight = runner != null && margin <= 3;
    return (
      <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/15 via-accent to-card p-4 shadow-sm ring-1 ring-gold/20">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/20 text-gold"><Crown className="size-6" /></span>
          <CsAvatar name={own.csName} size="md" src={avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gold">Pemegang Takhta</span>
              <RankPill rank={1} total={eligible.length} />
            </div>
            <div className="text-base font-bold tracking-tight text-foreground">
              Takhta belum dikunci — pertahankan, {stripCs(own.csName)}!
            </div>
            {tight ? (
              <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-destructive">
                <ShieldAlert className="size-3.5 shrink-0" /> {stripCs(runner!.csName)} tinggal {fmtPts(margin)} poin di belakang — jangan lengah!
              </div>
            ) : runner ? (
              <div className="text-xs text-muted-foreground">
                Skor <span className="font-semibold tabular-nums text-foreground">{fmtPts(own.score)}</span> · unggul {fmtPts(margin)} poin dari {stripCs(runner.csName)}.
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Skor {fmtPts(own.score)} — belum ada penantang di papan.</div>
            )}
          </div>
        </div>
        <div className="mt-3"><ScoreBars row={own} showHint={false} /></div>
        {countdown && <div className="mt-2">{countdown}</div>}
      </div>
    );
  }

  // ---- Live · chaser -----------------------------------------------------------
  // Only #2 races for the THRONE (there is one takhta, at #1). Everyone below
  // races the POSITION above them ("salip") — per owner: "#2 atau #3 ga pegang takhta".
  if (live && rank > 1) {
    const nextUp = eligible[rank - 2];
    const gap = nextUp.score - own.score;
    const close = gap <= SENGGOL_GAP_PTS;
    const forThrone = rank === 2;
    const header = forThrone ? (close ? 'Tinggal Senggol' : 'Pemburu Takhta') : 'Buruan Salip!';
    const headline = forThrone ? (
      close ? (
        <>Kurang <span className="text-amber-600">{fmtPts(gap)} poin</span> dari {stripCs(nextUp.csName)} — rebut takhtanya! ⚔️</>
      ) : (
        <>Gap {fmtPts(gap)} poin dari {stripCs(nextUp.csName)} — serang poin terbesarmu 🏹</>
      )
    ) : close ? (
      <>Kurang <span className="text-amber-600">{fmtPts(gap)} poin</span> dari {stripCs(nextUp.csName)} — salip posisinya! ⚔️</>
    ) : (
      <>Gap {fmtPts(gap)} poin dari {stripCs(nextUp.csName)} — serang poin terbesarmu 🏹</>
    );
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border p-4 shadow-sm',
          close ? 'border-amber-300/70 bg-gradient-to-r from-amber-50 via-card to-card' : 'border-border bg-card',
        )}
      >
        <div className="flex items-center gap-3">
          <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', close ? 'bg-amber-100 text-amber-600' : 'bg-accent text-accent-foreground')}>
            {close ? <Swords className="size-6" /> : <Target className="size-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-[11px] font-bold uppercase tracking-wide', close ? 'text-amber-600' : 'text-accent-foreground')}>
                {header}
              </span>
              <RankPill rank={rank} total={eligible.length} />
            </div>
            <div className="text-base font-bold tracking-tight text-foreground">{headline}</div>
            {paceLine}
          </div>
        </div>
        <div className="mt-3"><ScoreBars row={own} showHint /></div>
        {countdown && <div className="mt-2">{countdown}</div>}
      </div>
    );
  }

  // ---- Final states (period locked / past dates) --------------------------------
  const isQueen = queenName != null && queenName === own.csName;
  if (isQueen) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-gold/50 bg-gradient-to-r from-gold/20 via-accent to-card p-4 shadow-sm ring-1 ring-gold/25">
        <Confetti />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/25 text-gold"><Crown className="size-6" /></span>
          <CsAvatar name={own.csName} size="md" src={avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gold">Queen Hari Ini · {titleDate}</div>
            <div className="text-base font-bold tracking-tight text-foreground">SAH! Takhta milik kamu, Queen {stripCs(own.csName)}! 🎉</div>
            <div className="text-xs tabular-nums text-muted-foreground">
              Skor {fmtPts(own.score)} · {own.closings} closing · CR {fmtPts(own.cr)}% — kombinasi terbaik hari itu.
            </div>
          </div>
        </div>
        {medals.length > 0 && <div className="relative mt-2"><MedalChips medals={medals} /></div>}
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><PartyPopper className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">Papan dikunci · {titleDate}</span>
            {rank > 0 && <RankPill rank={rank} total={eligible.length} />}
          </div>
          <div className="text-base font-bold tracking-tight text-foreground">
            {rank > 0
              ? <>Finish #{rank} · skor {fmtPts(own.score)}. Besok takhtanya bisa milikmu 👑</>
              : <>Papan skor butuh ≥{QUEEN_MIN_LEADS} leads — besok gas dari leads pertama 🚀</>}
          </div>
          {queenName && (
            <div className="text-xs text-muted-foreground">
              Takhta {titleDate} milik Queen {stripCs(queenName)}. Hari baru, papan kosong — semua mulai dari 0.
            </div>
          )}
        </div>
      </div>
      {medals.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Yang kamu bawa pulang:</div>
          <MedalChips medals={medals} />
        </div>
      )}
    </div>
  );
}
