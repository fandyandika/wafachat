'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type TrendPoint = { label: string; leads: number; closings: number };

const SERIES = [
  { key: 'leads' as const, name: 'Leads', color: 'var(--lead)' },
  { key: 'closings' as const, name: 'Closing', color: 'var(--positive)' },
];

/** Lightweight interactive line chart (no chart lib) — two series, hover guide + tooltip. */
export function TrendChart({ data, className }: { data: TrendPoint[]; className?: string }) {
  const uid = React.useId().replace(/:/g, '');
  const [hover, setHover] = React.useState<number | null>(null);

  const W = 720;
  const H = 200;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 8;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;

  const rawMax = Math.max(1, ...data.flatMap((d) => [d.leads, d.closings]));
  const maxY = niceCeil(rawMax);

  const xAt = (i: number) => (n <= 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - (v / maxY) * innerH;

  const linePath = (key: 'leads' | 'closings') => {
    const pts = data.map((d, i) => [xAt(i), yAt(d[key])] as const);
    if (pts.length < 2) return pts.length ? `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}` : '';
    // Smooth horizontal-midpoint bezier between points.
    let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const midX = (x1 + x2) / 2;
      path += ` C${midX.toFixed(1)},${y1.toFixed(1)} ${midX.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    return path;
  };
  const areaPath = (key: 'leads' | 'closings') => {
    const bottom = padT + innerH;
    return `${linePath(key)} L${xAt(n - 1).toFixed(1)},${bottom} L${xAt(0).toFixed(1)},${bottom} Z`;
  };

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + innerH - f * innerH);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(Math.max(Math.round(frac * (n - 1)), 0), n - 1));
  };

  const labelStep = Math.max(1, Math.ceil(n / 7));

  if (n === 0) return null;

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-3 flex items-center gap-4 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend leads dan closing harian">
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {grid.map((gy, i) => (
            <line key={i} x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="var(--border)" strokeWidth={1} />
          ))}

          {SERIES.map((s) => (
            <path key={`a-${s.key}`} d={areaPath(s.key)} fill={`url(#${uid}-${s.key})`} stroke="none" />
          ))}
          {SERIES.map((s) => (
            <path
              key={`l-${s.key}`}
              d={linePath(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hover != null && (
            <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + innerH} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {hover != null &&
            SERIES.map((s) => (
              <circle key={`p-${s.key}`} cx={xAt(hover)} cy={yAt(data[hover][s.key])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            ))}
        </svg>

        <div className="relative mt-1 h-4">
          {data.map((d, i) =>
            i % labelStep === 0 || i === n - 1 ? (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
                style={{ left: `${(xAt(i) / W) * 100}%` }}
              >
                {d.label}
              </span>
            ) : null,
          )}
        </div>

        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-elevate"
            style={{ left: `${clamp((xAt(hover) / W) * 100, 12, 88)}%` }}
          >
            <div className="mb-1 font-medium text-foreground">{data[hover].label}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4 tabular-nums">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-semibold text-foreground">{data[hover][s.key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const step = pow / 2;
  return Math.ceil(v / step) * step;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
