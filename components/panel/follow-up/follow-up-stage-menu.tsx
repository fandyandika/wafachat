'use client';

import React from 'react';
import type { FollowUpStage } from './follow-up-types';
import { FOLLOW_UP_STAGE_LABEL } from './follow-up-types';

export function FollowUpStageMenu({ currentStage, disabled = false, onSelect }: {
  currentStage?: FollowUpStage;
  disabled?: boolean;
  onSelect: (stage: FollowUpStage) => void;
}) {
  return <fieldset aria-label="Ubah tahap follow-up" className="rounded-xl border bg-background p-3">
    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ubah tahap</legend>
    <div className="grid grid-cols-3 gap-2">
      {([1, 2, 3] as const).map((stage) => <button
        key={stage}
        type="button"
        aria-pressed={currentStage === stage}
        disabled={disabled}
        onClick={() => onSelect(stage)}
        className={`min-h-11 rounded-lg border px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${currentStage === stage ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-muted'}`}
      >{FOLLOW_UP_STAGE_LABEL[stage]}</button>)}
    </div>
  </fieldset>;
}
