import React, { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function LedgerSection({ title, description, action, children, className }: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-ledger-rule bg-card', className)}>
      <div className="flex min-h-14 items-start justify-between gap-4 border-b border-ledger-rule px-4 py-3 md:px-5">
        <div>
          <h2 className="font-semibold text-ledger-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LedgerMetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid sm:grid-cols-2 xl:grid-cols-3', className)}>{children}</div>;
}

const metricTone = {
  default: 'text-ledger-ink',
  positive: 'text-positive',
  warning: 'text-gold-foreground',
  negative: 'text-negative',
} as const;

export function LedgerMetric({ label, value, detail, tone = 'default' }: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: keyof typeof metricTone;
}) {
  return (
    <div className="min-h-28 border-b border-r border-ledger-rule p-4 last:border-r-0 md:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', metricTone[tone])}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

const stampTone = {
  neutral: 'border-border bg-secondary text-secondary-foreground',
  positive: 'border-positive bg-positive-soft text-positive',
  warning: 'border-gold bg-gold-soft text-gold-foreground',
  negative: 'border-negative bg-negative-soft text-negative',
} as const;

export function StatusStamp({ children, tone = 'neutral' }: {
  children: ReactNode;
  tone?: keyof typeof stampTone;
}) {
  return <span className={cn('inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-semibold', stampTone[tone])}>{children}</span>;
}

export function DashboardContextBar({ title, period, updatedAt, actions }: {
  title: string;
  period: string;
  updatedAt: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-ledger-rule bg-card px-4 py-3">
      <div>
        <h2 className="font-semibold text-ledger-ink">{title}</h2>
        <p className="text-sm text-muted-foreground">{period} · Diperbarui {updatedAt}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
