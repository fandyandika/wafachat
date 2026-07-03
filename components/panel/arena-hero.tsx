'use client';

import { useEffect, useState } from 'react';
import { Crown, Flame, Medal, PartyPopper, Rocket, ShieldAlert, TrendingUp, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CsAvatar } from '@/components/ui/cs-avatar';

// Gamified hero for the CS-scoped Laporan view ("Arena Harian").
// Pure presentation over data the dashboard already fetched — zero extra queries;
// the countdown is a client-side ticker only.
//
// Live states (before the 16:00 WIB cutoff):
//   - ladder #1  -> gold "defend the crown" hero (margin vs runner-up, urgency when tight)
//   - chaser, gap <= CHASE_GAP -> FOMO chase: "kurang N closing buat nyalip <name>" + race bar
//   - chaser, gap besar -> personal-race mode (milestone + vs-yesterday) so a big gap
//     never demoralizes — the mountain stays out of sight, progress stays in sight
//   - no activity yet -> "first closing puts you on the board" starter
// Final states (past periods): congrats hero for the Queen (confetti), medals +
// encouraging comeback copy for everyone else.

const CHASE_GAP = 5;

type OwnStats = { csName: string; closings: number; cr: number; leads: number };

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
      #{rank} dari {total} CS
    </span>
  );
}

export function ArenaHero({
  rank,
  totalCs,
  own,
  nextUp,
  runnerUp,
  queenName,
  medals,
  deltaClosings,
  isCurrent,
  endAt,
  titleDate,
  avatarUrl,
}: {
  rank: number; // 0 when the CS has no row yet today
  totalCs: number;
  own: OwnStats | null;
  nextUp: { csName: string; closings: number } | null; // one ladder rung above
  runnerUp: { csName: string; closings: number } | null; // rank 2, when self is #1
  queenName?: string; // scorecard Queen (closing+CR+speed) — the real crown
  medals: string[];
  deltaClosings: number | null; // own closings vs yesterday (full day)
  isCurrent: boolean;
  endAt: number;
  titleDate: string;
  avatarUrl?: string;
}) {
  const remainMs = useCountdown(endAt, isCurrent);
  const live = isCurrent && remainMs > 0;

  const countdown = live ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground">
      <Timer className="size-3.5" /> {fmtRemain(remainMs)} lagi · papan dikunci 16:00 WIB
    </span>
  ) : null;

  // ---- Starter: no activity yet today -------------------------------------
  if (live && (!own || rank === 0)) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Rocket className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground">Papan hari ini masih terbuka 🚀</div>
            <div className="text-xs text-muted-foreground">1 closing pertama langsung menempatkanmu di klasemen.</div>
          </div>
        </div>
        {countdown && <div className="mt-2">{countdown}</div>}
      </div>
    );
  }
  if (!own) return null;

  // ---- Live · ladder leader ------------------------------------------------
  if (live && rank === 1) {
    const margin = runnerUp ? own.closings - runnerUp.closings : own.closings;
    const tight = runnerUp != null && margin <= 2;
    return (
      <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/15 via-accent to-card p-4 shadow-sm ring-1 ring-gold/20">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/20 text-gold"><Crown className="size-6" /></span>
          <CsAvatar name={own.csName} size="md" src={avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gold">Pemimpin klasemen</span>
              <RankPill rank={1} total={totalCs} />
            </div>
            <div className="text-base font-bold tracking-tight text-foreground">Pertahankan mahkotamu, {own.csName}!</div>
            {tight ? (
              <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-destructive">
                <ShieldAlert className="size-3.5 shrink-0" /> {runnerUp!.csName} tinggal selisih {margin} closing — jangan lengah!
              </div>
            ) : runnerUp ? (
              <div className="text-xs text-muted-foreground">Unggul <span className="font-semibold text-foreground">{margin} closing</span> dari {runnerUp.csName}.</div>
            ) : (
              <div className="text-xs text-muted-foreground">{own.closings} closing sejauh ini — terus jaga ritme.</div>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {countdown}
          <span className="text-[11px] text-muted-foreground">Queen final dihitung dari closing + CR + speed saat papan dikunci.</span>
        </div>
      </div>
    );
  }

  // ---- Live · chaser ---------------------------------------------------------
  if (live && rank > 1 && nextUp) {
    const gap = nextUp.closings - own.closings + 1; // closings needed to OVERTAKE
    if (gap <= CHASE_GAP) {
      const target = nextUp.closings + 1;
      const pct = Math.min(100, Math.round((own.closings / target) * 100));
      return (
        <div className="relative overflow-hidden rounded-2xl border border-amber-300/70 bg-gradient-to-r from-amber-50 via-card to-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><Flame className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Kejar mahkota</span>
                <RankPill rank={rank} total={totalCs} />
              </div>
              <div className="text-base font-bold tracking-tight text-foreground">
                Kurang <span className="text-amber-600">{gap} closing</span> buat nyalip {nextUp.csName}!
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>{own.closings} closing kamu</span>
              <span>{target} = posisi #{rank - 1}</span>
            </div>
          </div>
          {countdown && <div className="mt-2">{countdown}</div>}
        </div>
      );
    }
    // Big gap: race yourself, not the mountain.
    const milestone = Math.max(5, Math.ceil((own.closings + 1) / 5) * 5);
    const need = milestone - own.closings;
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><TrendingUp className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">Race pribadi</span>
              <RankPill rank={rank} total={totalCs} />
            </div>
            <div className="text-base font-bold tracking-tight text-foreground">
              {need} closing lagi tembus <span className="text-primary">{milestone}</span> hari ini 💪
            </div>
            {deltaClosings != null && deltaClosings > 0 && (
              <div className="text-xs font-medium text-positive">📈 +{deltaClosings} closing dibanding kemarin — ritme naik!</div>
            )}
          </div>
        </div>
        {countdown && <div className="mt-2">{countdown}</div>}
      </div>
    );
  }

  // ---- Final states (period closed / past dates) ----------------------------
  const isQueen = queenName != null && queenName === own.csName;
  if (isQueen) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-gold/50 bg-gradient-to-r from-gold/20 via-accent to-card p-4 shadow-sm ring-1 ring-gold/25">
        <Confetti />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/25 text-gold"><Crown className="size-6" /></span>
          <CsAvatar name={own.csName} size="md" src={avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gold">Queen CS · {titleDate}</div>
            <div className="text-base font-bold tracking-tight text-foreground">Selamat, {own.csName}! Mahkotanya milikmu 🎉</div>
            <div className="text-xs tabular-nums text-muted-foreground">{own.closings} closing · CR {Math.round(own.cr * 10) / 10}% — kombinasi terbaik hari itu.</div>
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
            <span className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">Hasil final · {titleDate}</span>
            <RankPill rank={rank} total={totalCs} />
          </div>
          <div className="text-base font-bold tracking-tight text-foreground">
            {rank === 1 && queenName
              ? <>Closing kamu terbanyak 🏆 — mahkota ke {queenName} lewat CR+speed. Rebut lagi besok!</>
              : <>Finish #{rank} dengan {own.closings} closing. Besok mahkotanya bisa milikmu 👑</>}
          </div>
          {queenName && rank !== 1 && (
            <div className="text-xs text-muted-foreground">Queen {titleDate}: {queenName}. Hari baru, papan kosong — semua mulai dari 0 lagi.</div>
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
