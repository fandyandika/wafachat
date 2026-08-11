import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("automatic and override follow-up surfaces are absent", () => {
  const cron = readFileSync(resolve("convex/crons.ts"), "utf8");
  const dashboard = readFileSync(resolve("components/panel/follow-up-dashboard.tsx"), "utf8");
  const settings = readFileSync(resolve("components/panel/settings-dashboard.tsx"), "utf8");
  const followUp = readFileSync(resolve("convex/followUp.ts"), "utf8");
  expect(cron).not.toContain("autoFollowUpSweep");
  expect(dashboard).not.toContain("/api/follow-up/auto-toggle");
  expect(dashboard).not.toContain("/api/follow-up/set-stage");
  expect(settings).not.toContain("autoFollowUpEnabled");
  expect(followUp).not.toContain("setFollowUpStage");
  expect(followUp).not.toContain("PANEL_AUTH_SECRET");
});
