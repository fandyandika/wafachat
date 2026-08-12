import { describe, expect, test } from "vitest";
import {
  detectFollowUpStage,
  nextStageAfterDetected,
  normalizeFollowUpText,
} from "./followUpTriggers";

describe("provider follow-up triggers", () => {
  test("higher trigger catches up and H+3 archives", () => {
    expect(nextStageAfterDetected(1, 2, Date.UTC(2026, 7, 12, 2))).toEqual({
      completedStages: [1, 2], nextStage: 3,
      dueAt: Date.UTC(2026, 7, 13, 1), state: "waiting",
    });
    expect(nextStageAfterDetected(2, 3, Date.UTC(2026, 7, 12, 2))).toMatchObject({ state: "archived" });
  });

  test("stale lower trigger is a no-op", () => {
    expect(nextStageAfterDetected(2, 1, Date.UTC(2026, 7, 12, 2))).toBeNull();
    expect(nextStageAfterDetected(3, 1, Date.UTC(2026, 7, 12, 2))).toBeNull();
  });

  test("template wins, normalized pattern matches, ordinary text does not", () => {
    const rules = [{ stage: 1 as const, templateName: "follow_up_h1", patterns: ["masih berminat kak"] }];
    expect(detectFollowUpStage({ templateName: "follow_up_h1", content: "", rules })).toBe(1);
    expect(detectFollowUpStage({ content: "Masih   berminat, Kak?", rules })).toBe(1);
    expect(detectFollowUpStage({ content: "Terima kasih kak", rules })).toBeNull();
  });

  test("normalization removes punctuation and collapses whitespace", () => {
    expect(normalizeFollowUpText("  Masih—berminat,   Kak?  ")).toBe("masih berminat kak");
  });
});
