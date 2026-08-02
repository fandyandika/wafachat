import { expect, test } from 'vitest';

import { requiresPanelAuth } from './ConvexClientProvider';

test('only panel routes request a Convex session token', () => {
  expect(requiresPanelAuth('/login')).toBe(false);
  expect(requiresPanelAuth('/offline')).toBe(false);
  expect(requiresPanelAuth('/panel/follow-up')).toBe(true);
});
