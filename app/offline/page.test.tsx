import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import OfflinePage from './page';

(globalThis as any).React = React;

test('shows a connection recovery page without business data', () => {
  const html = renderToStaticMarkup(<OfflinePage />);
  expect((html.match(/<h1\b/g) ?? [])).toHaveLength(1);
  expect(html).toMatch(/<h1[^>]*>Koneksi terputus<\/h1>/);
  expect(html).toContain('Koneksi terputus');
  expect(html).toContain('Periksa koneksi internet');
  expect(html).toContain('href="/panel"');
  expect(html).toContain('Coba lagi');
  expect(html).not.toContain('Leads');
});
