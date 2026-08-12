import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { FollowUpStageMenu } from './follow-up-stage-menu';

(globalThis as any).React = React;

test('stage correction exposes every target as a native focusable control', () => {
  const html = renderToStaticMarkup(<FollowUpStageMenu currentStage={2} onSelect={vi.fn()} />);
  expect(html).toContain('Ubah tahap');
  expect(html).toContain('aria-label="Ubah tahap follow-up"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('H+1');
  expect(html).toContain('H+2');
  expect(html).toContain('H+3');
  expect(html).toContain('min-h-11');
  expect(html).toContain('focus-visible:ring');
});

test('stage correction can be disabled while an action is running', () => {
  const html = renderToStaticMarkup(<FollowUpStageMenu currentStage={1} onSelect={vi.fn()} disabled />);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
});
