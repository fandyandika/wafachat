'use client';

import * as React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function sparkPaths(series: number[], w: number, h: number): { line: string; area: string } {
  if (series.length < 2) return { line: '', area: '' };
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const xs = (i: number) => (i / (series.length - 1)) * w;
  const ys = (v: number) => h - ((v - min) / span) * (h * 0.8) - h * 0.1;
  const pts = series.map((v, i) => [xs(i), ys(v)] as const);
  let line = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const mx = (x1 + x2) / 2;
    line += ` C${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

/** Hero stat: big figure + momentum pill + mini sparkline (colored by trend direction). */
export function StatsWidget({
  label,
  value,
  hint,
  series = [],
  deltaPct,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  series?: number[];
  deltaPct?: number | null;
  className?: string;
}) {
  const uid = React.useId().replace(/:/g, '');
  const W = 120;
  const H = 44;
  const { line, area } = sparkPaths(series, W, H);
  const up = (deltaPct ?? 0) >= 0;
  const stroke = deltaPct == null ? 'var(--primary)' : up ? 'var(--positive)' : 'var(--negative)';

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevate',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          {deltaPct != null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                up ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative',
              )}
            >
              {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
              {Math.abs(deltaPct)}%
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </div>
        {hint ? <div className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {line ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-28 shrink-0" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${uid})`} />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}
