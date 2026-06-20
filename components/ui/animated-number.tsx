"use client";

import * as React from "react";

import {
  sanitizeTarget,
  shouldAnimate,
  interpolate,
  formatInt,
} from "@/lib/animated-number";
import { usePrefersReducedMotion } from "@/components/ui/use-prefers-reduced-motion";

export function AnimatedNumber({
  value,
  format = formatInt,
  durationMs = 600,
  className,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const target = sanitizeTarget(value);
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = React.useState<number>(target ?? 0);
  const fromRef = React.useRef<number>(target ?? 0);
  const mountedRef = React.useRef(false);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (target === null) return;

    // First render: snap to value, no count-up on mount.
    if (!mountedRef.current) {
      mountedRef.current = true;
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    if (!shouldAnimate(reducedMotion, from, target)) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplay(interpolate(from, target, progress));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reducedMotion, durationMs]);

  if (target === null) return <span className={className}>–</span>;
  return <span className={className}>{format(display)}</span>;
}
