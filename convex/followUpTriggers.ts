import { nextJakartaDueAt, type FollowUpStage } from "./followUpModel";

type FollowUpTriggerRule = {
  stage: FollowUpStage;
  templateName?: string;
  patterns?: string[];
};

type DetectFollowUpStageInput = {
  templateName?: string;
  content: string;
  rules: FollowUpTriggerRule[];
};

export function normalizeFollowUpText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function detectFollowUpStage(input: DetectFollowUpStageInput): FollowUpStage | null {
  const templateName = normalizeFollowUpText(input.templateName ?? "");
  if (templateName) {
    const templateMatch = input.rules.find((rule) => normalizeFollowUpText(rule.templateName ?? "") === templateName);
    if (templateMatch) return templateMatch.stage;
  }

  const content = normalizeFollowUpText(input.content);
  for (const rule of input.rules) {
    if (rule.patterns?.some((pattern) => {
      const normalizedPattern = normalizeFollowUpText(pattern);
      return normalizedPattern !== "" && normalizedPattern === content;
    })) return rule.stage;
  }
  return null;
}

export function nextStageAfterDetected(current: FollowUpStage, detected: FollowUpStage, eventAt: number) {
  if (detected < current) return null;

  const completedStages = [] as FollowUpStage[];
  for (let stage = current; stage <= detected; stage += 1) completedStages.push(stage as FollowUpStage);

  if (detected === 3) {
    return { completedStages, nextStage: null, dueAt: null, state: "archived" as const };
  }

  return {
    completedStages,
    nextStage: (detected + 1) as 2 | 3,
    dueAt: nextJakartaDueAt(eventAt),
    state: "waiting" as const,
  };
}
