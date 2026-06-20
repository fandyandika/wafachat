export function sanitizeTarget(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function shouldAnimate(reducedMotion: boolean, from: number, to: number): boolean {
  return !reducedMotion && to > from;
}

export function easeOutCubic(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, 3);
}

export function interpolate(from: number, to: number, progress: number): number {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return from + (to - from) * easeOutCubic(progress);
}

const intFormatter = new Intl.NumberFormat("id-ID");

export function formatInt(n: number): string {
  return intFormatter.format(Math.round(n));
}
