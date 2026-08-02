import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { DashboardContextBar, LedgerMetric, LedgerMetricGrid, LedgerSection } from './ledger';

test('ledger primitives render a semantic operational section without elevated cards', () => {
  const html = renderToStaticMarkup(
    <LedgerSection title="Kinerja bisnis" description="Snapshot periode aktif">
      <LedgerMetricGrid>
        <LedgerMetric label="Leads" value="42" detail="hari ini" />
        <LedgerMetric label="Closing" value="30" detail="hari ini" tone="positive" />
      </LedgerMetricGrid>
    </LedgerSection>,
  );

  expect(html).toContain('<section');
  expect(html).toContain('Kinerja bisnis');
  expect(html).toContain('Snapshot periode aktif');
  expect(html).toContain('Leads');
  expect(html).toContain('42');
  expect(html).not.toContain('shadow-elevate');
});

test('context bar names the view, period, and update time', () => {
  const html = renderToStaticMarkup(
    <DashboardContextBar title="Kendali operasional" period="Hari kalender" updatedAt="11.20.00" />,
  );

  expect(html).toContain('Kendali operasional');
  expect(html).toContain('Hari kalender');
  expect(html).toContain('Diperbarui 11.20.00');
});
