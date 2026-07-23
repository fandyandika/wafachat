import { expect, test } from 'vitest';
import manifest from './manifest';

test('declares installable WaFaChat metadata', () => {
  expect(manifest()).toMatchObject({
    name: 'WaFaChat',
    short_name: 'WaFaChat',
    start_url: '/panel',
    display: 'standalone',
    theme_color: '#ffffff',
  });
});
