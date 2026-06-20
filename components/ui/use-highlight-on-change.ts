"use client";

import * as React from "react";

import { usePrefersReducedMotion } from "@/components/ui/use-prefers-reduced-motion";

export function useHighlightOnChange(
  value: number | null | undefined,
  durationMs = 1200,
): boolean {
  const [highlight, setHighlight] = React.useState(false);
  const prevRef = React.useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    const v =
      typeof value === "number" && Number.isFinite(value) ? value : null;
    const prev = prevRef.current;
    prevRef.current = v;

    if (prev === null || v === null || reducedMotion) return;
    if (v > prev) {
      setHighlight(true);
      const t = setTimeout(() => setHighlight(false), durationMs);
      return () => clearTimeout(t);
    }
  }, [value, reducedMotion, durationMs]);

  return highlight;
}
