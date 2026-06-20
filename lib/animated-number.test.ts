import { expect, test } from "vitest";
import {
  sanitizeTarget,
  shouldAnimate,
  easeOutCubic,
  interpolate,
  formatInt,
} from "./animated-number";

test("sanitizeTarget: finite numbers pass, junk becomes null", () => {
  expect(sanitizeTarget(0)).toBe(0);
  expect(sanitizeTarget(42)).toBe(42);
  expect(sanitizeTarget(-3.5)).toBe(-3.5);
  expect(sanitizeTarget(NaN)).toBeNull();
  expect(sanitizeTarget(Infinity)).toBeNull();
  expect(sanitizeTarget(undefined)).toBeNull();
  expect(sanitizeTarget(null)).toBeNull();
  expect(sanitizeTarget("5")).toBeNull();
});

test("shouldAnimate: only animate increases, never under reduced motion", () => {
  expect(shouldAnimate(false, 5, 10)).toBe(true);
  expect(shouldAnimate(false, 10, 5)).toBe(false); // decrease snaps
  expect(shouldAnimate(false, 5, 5)).toBe(false); // no change
  expect(shouldAnimate(true, 5, 10)).toBe(false); // reduced motion short-circuits
});

test("easeOutCubic: clamped endpoints", () => {
  expect(easeOutCubic(0)).toBe(0);
  expect(easeOutCubic(1)).toBe(1);
  expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // decelerating curve
});

test("interpolate: endpoints exact and monotonic", () => {
  expect(interpolate(0, 100, 0)).toBe(0);
  expect(interpolate(0, 100, 1)).toBe(100);
  expect(interpolate(10, 10, 0.5)).toBe(10);
  expect(interpolate(0, 100, -0.2)).toBe(0); // clamp low
  expect(interpolate(0, 100, 1.5)).toBe(100); // clamp high
  const a = interpolate(0, 100, 0.25);
  const b = interpolate(0, 100, 0.75);
  expect(b).toBeGreaterThan(a);
});

test("formatInt: id-ID thousands, rounds", () => {
  expect(formatInt(0)).toBe("0");
  expect(formatInt(42)).toBe("42");
  expect(formatInt(1234567)).toBe("1.234.567");
  expect(formatInt(1234.6)).toBe("1.235");
});
