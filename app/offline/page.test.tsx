import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import OfflinePage from './page';

(globalThis as any).React = React;

test('shows a connection recovery page without business data', () => {
  const html = renderToStaticMarkup(<OfflinePage />);
  expect(html).toContain('Koneksi terputus');
  expect(html).toContain('Coba lagi');
  expect(html).not.toContain('Leads');
});
